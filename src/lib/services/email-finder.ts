import "server-only";
import { and, eq, isNull, ne, notExists } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db, creators, creatorAccounts } from "@/db";
import { extractEmails, creatorEmailsFromPage, normalizeEmail } from "@/lib/engines/contact";
import { emailLooksLike, looksLikeSamePerson, parseTikTokProfile, worthOpening, type PublicProfile } from "@/lib/engines/public-profile";
import { log } from "./common";

const HEADERS = {
  "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Safari/537.36",
  "Accept-Language": "en-US,en;q=0.9",
  Accept: "text/html,application/xhtml+xml",
};
const MAX_FAILURES_IN_A_ROW = 5;

export type FindEmailsOptions = { limit?: number; dryRun?: boolean; delayMs?: number; onProgress?: (line: string) => void };

export type FindEmailsResult = {
  checked: number;
  fromBio: number;
  fromLink: number;
  noEmail: number;
  /** TikTok pass: account deleted or private. Instagram pass: no TikTok with the same handle. */
  gone: number;
  /** Instagram pass: a TikTok with the same handle exists but the name doesn't match. */
  differentPerson: number;
  sameEmailAs: { handle: string; email: string; existing: string }[];
  stopped: string | null;
};

const emptyResult = (): FindEmailsResult => ({ checked: 0, fromBio: 0, fromLink: 0, noEmail: 0, gone: 0, differentPerson: 0, sameEmailAs: [], stopped: null });

async function getPage(url: string) {
  const res = await fetch(url, { headers: HEADERS, redirect: "follow", signal: AbortSignal.timeout(15_000) });
  return { status: res.status, html: res.ok ? (await res.text()).slice(0, 3_000_000) : "" };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Visit public TikTok profiles one every few seconds. Stops if TikTok starts refusing requests
 * (blocked or challenge pages) instead of trying to get around it.
 */
async function eachTikTokProfile<T extends { handle: string }>(
  rows: T[],
  opts: FindEmailsOptions,
  result: FindEmailsResult,
  visit: (row: T, profile: PublicProfile, tag: string) => Promise<void>,
) {
  const say = opts.onProgress ?? (() => {});
  const delay = opts.delayMs ?? 3000;
  let failures = 0;
  for (const [i, row] of rows.entries()) {
    if (i > 0) await sleep(delay + Math.random() * delay * 0.6);
    const tag = `[${i + 1}/${rows.length}] @${row.handle}`;
    let page: { status: number; html: string };
    try {
      page = await getPage(`https://www.tiktok.com/@${encodeURIComponent(row.handle)}`);
    } catch (e) {
      page = { status: 0, html: String(e) };
    }
    const profile = page.status === 404 ? { found: false, name: null, bio: "", bioLink: null, followers: null } : page.status === 200 ? parseTikTokProfile(page.html) : null;
    if (!profile) {
      failures++;
      say(`${tag}: no profile data (HTTP ${page.status})`);
      if (failures >= MAX_FAILURES_IN_A_ROW) {
        result.stopped = `TikTok stopped returning profiles (${failures} in a row, last HTTP ${page.status}). Wait an hour or two and run it again; it picks up where it left off.`;
        return;
      }
      continue;
    }
    failures = 0;
    result.checked++;
    await visit(row, profile, tag);
  }
}

/** The bio's email, else one from the bio link (Linktree, Beacons, a personal site). Never guessed. */
async function contactEmail(profile: PublicProfile, handle: string): Promise<{ email: string | null; via: string }> {
  const fromBio = extractEmails(profile.bio)[0];
  if (fromBio) return { email: fromBio, via: "bio" };
  const link = worthOpening(profile.bioLink);
  if (!link) return { email: null, via: "" };
  try {
    const page = await getPage(link);
    return { email: creatorEmailsFromPage(page.html, link, handle)[0] ?? null, via: new URL(link).hostname };
  } catch {
    return { email: null, via: "" }; // dead or slow link pages are common
  }
}

/** Save the email unless another creator already has it (usually the same person on another platform). */
async function saveEmail(creatorId: string, handle: string, found: { email: string; via: string }, opts: FindEmailsOptions, result: FindEmailsResult, tag: string) {
  const say = opts.onProgress ?? (() => {});
  const normalized = normalizeEmail(found.email)!;
  const owner = await db.query.creators.findFirst({ where: and(eq(creators.emailNormalized, normalized), ne(creators.id, creatorId)) });
  if (owner) {
    result.sameEmailAs.push({ handle, email: found.email, existing: owner.name });
    say(`${tag}: ${found.email} (already on ${owner.name})`);
    return;
  }
  if (!opts.dryRun) await db.update(creators).set({ email: found.email, emailNormalized: normalized }).where(eq(creators.id, creatorId));
  if (found.via === "bio" || found.via === "TikTok bio") result.fromBio++;
  else result.fromLink++;
  say(`${tag}: ${found.email} (from ${found.via})`);
}

/**
 * Emails TikTok creators published themselves, from their bio or bio link.
 * A checked account keeps its bio (empty string if none), so re-runs only visit new accounts.
 */
export async function findTikTokEmails(opts: FindEmailsOptions = {}): Promise<FindEmailsResult> {
  const say = opts.onProgress ?? (() => {});
  const todo = await db
    .select({ accountId: creatorAccounts.id, handle: creatorAccounts.handle, creatorId: creators.id })
    .from(creatorAccounts)
    .innerJoin(creators, eq(creators.id, creatorAccounts.creatorId))
    .where(and(eq(creatorAccounts.platform, "tiktok"), isNull(creatorAccounts.bio), isNull(creators.email)))
    .limit(opts.limit ?? 5000);
  const result = emptyResult();
  say(`${todo.length} TikTok creators to check`);

  await eachTikTokProfile(todo, opts, result, async (row, profile, tag) => {
    if (!profile.found) {
      result.gone++;
      say(`${tag}: account not found or private`);
      if (!opts.dryRun) await db.update(creatorAccounts).set({ bio: "" }).where(eq(creatorAccounts.id, row.accountId));
      return;
    }
    const found = await contactEmail(profile, row.handle);
    if (!opts.dryRun) await db.update(creatorAccounts).set({ bio: profile.bio, ...(profile.followers !== null && { followers: profile.followers }) }).where(eq(creatorAccounts.id, row.accountId));
    if (!found.email) {
      result.noEmail++;
      say(`${tag}: no email${profile.bioLink ? ` (link: ${profile.bioLink})` : ""}`);
      return;
    }
    await saveEmail(row.creatorId, row.handle, { email: found.email, via: found.via }, opts, result, tag);
  });

  const total = result.fromBio + result.fromLink;
  if (!opts.dryRun && total) await log("discovery", `Found ${total} creator emails in TikTok bios and bio links`);
  return result;
}

/**
 * Instagram hides bios from logged-out visitors, but many creators use the same handle on TikTok.
 * For Instagram creators without an email, open the TikTok with the same handle; if the display
 * name matches, link that TikTok to the creator and use its contact email.
 */
export async function findInstagramEmailsViaTikTok(opts: FindEmailsOptions = {}): Promise<FindEmailsResult> {
  const say = opts.onProgress ?? (() => {});
  const tiktok = alias(creatorAccounts, "tiktok");
  const todo = await db
    .select({ handle: creatorAccounts.handle, creatorId: creators.id, name: creators.name })
    .from(creatorAccounts)
    .innerJoin(creators, eq(creators.id, creatorAccounts.creatorId))
    .where(
      and(
        eq(creatorAccounts.platform, "instagram"),
        isNull(creators.email),
        notExists(db.select({ one: tiktok.id }).from(tiktok).where(and(eq(tiktok.creatorId, creators.id), eq(tiktok.platform, "tiktok")))),
        // A TikTok with this handle already in Roster is its own creator record; the TikTok pass covers it.
        notExists(db.select({ one: tiktok.id }).from(tiktok).where(and(eq(tiktok.handle, creatorAccounts.handle), eq(tiktok.platform, "tiktok")))),
      ),
    )
    .limit(opts.limit ?? 5000);
  const result = emptyResult();
  say(`${todo.length} Instagram creators to match on TikTok`);

  await eachTikTokProfile(todo, opts, result, async (row, profile, tag) => {
    if (!profile.found) {
      result.gone++;
      say(`${tag}: no TikTok with this handle`);
      return;
    }
    const found = await contactEmail(profile, row.handle);
    // Names often differ (real name on one platform, brand on the other); an email built from the handle or name settles it.
    if (!looksLikeSamePerson(row.name, profile.name) && !(found.email && emailLooksLike(found.email, row.handle, row.name))) {
      result.differentPerson++;
      say(`${tag}: TikTok “${profile.name}” doesn't look like “${row.name}”, skipped`);
      return;
    }
    if (!opts.dryRun) {
      await db
        .insert(creatorAccounts)
        .values({ creatorId: row.creatorId, platform: "tiktok", handle: row.handle, url: `https://www.tiktok.com/@${row.handle}`, bio: profile.bio, followers: profile.followers ?? 0 })
        .onConflictDoNothing();
    }
    if (!found.email) {
      result.noEmail++;
      say(`${tag}: same person on TikTok, no email`);
      return;
    }
    await saveEmail(row.creatorId, row.handle, { email: found.email, via: found.via === "bio" ? "TikTok bio" : `TikTok link, ${found.via}` }, opts, result, tag);
  });

  const total = result.fromBio + result.fromLink;
  if (!opts.dryRun && total) await log("discovery", `Found ${total} Instagram creator emails through their TikTok`);
  return result;
}
