import "server-only";
import { and, eq, inArray, isNotNull, sql } from "drizzle-orm";
import { db, creators, creatorAccounts, creatorScores, posts } from "@/db";
import { assessAuthenticity, assessFromViews } from "@/lib/engines/authenticity";
import { suggestedBaseCents, typicalViews, type TypicalViews } from "@/lib/engines/creator-score";
import { parseTikTokEmbed, typicalFromVideos, type EmbedProfile } from "@/lib/engines/public-views";
import { businessDiscoveryVideos, instagramBusinessId, InstagramRateLimit, InstagramTokenExpired } from "@/lib/integrations/platforms/instagram";
import { getBrand } from "@/lib/settings";
import { latestScores, log } from "./common";
import { getPage, MAX_FAILURES_IN_A_ROW, sleep } from "./email-finder";

const NO_DATA = "no view data";
const RECHECK_DAYS = 14;
const DAY = 86_400_000;
// The embed answers 429 at one request every few seconds, and now and then at 12-19 seconds. It clears within a minute or two.
const TIKTOK_DELAY_MS = 18_000;
const TOO_FAST_PAUSE_MS = 120_000;
// Meta's limit for a one-user app is on processing time over a rolling hour, about 40 of these lookups.
const INSTAGRAM_DELAY_MS = 60_000;
const LIMIT_PAUSE_MS = 900_000;
const MAX_LIMIT_WAITS = 4;

export type CheckViewsOptions = { limit?: number; dryRun?: boolean; delayMs?: number; recheckDays?: number; handles?: string[]; includeNoEmail?: boolean; onProgress?: (line: string) => void };
export type CheckViewsResult = { checked: number; scored: number; noData: number; stopped: string | null };

type Account = { accountId: string; creatorId: string; handle: string; stage: string };

/** Prospects with emails first, then creators already contacted, then (if asked) anyone without an email. Accounts checked recently are skipped. */
async function accountsToCheck(platform: "tiktok" | "instagram", opts: CheckViewsOptions): Promise<Account[]> {
  const rows = await db
    .select({ accountId: creatorAccounts.id, creatorId: creators.id, handle: creatorAccounts.handle, stage: creators.stage, email: creators.email, checkedAt: creatorAccounts.viewsCheckedAt })
    .from(creatorAccounts)
    .innerJoin(creators, eq(creators.id, creatorAccounts.creatorId))
    .where(and(eq(creatorAccounts.platform, platform), opts.includeNoEmail ? undefined : isNotNull(creators.email), inArray(creators.stage, ["prospect", "contacted", "replied"]), opts.handles ? inArray(creatorAccounts.handle, opts.handles) : undefined));
  const cutoff = Date.now() - (opts.recheckDays ?? RECHECK_DAYS) * DAY;
  const due = opts.handles ? rows : rows.filter((r) => !r.checkedAt || r.checkedAt.getTime() < cutoff);
  const turn = (r: (typeof rows)[number]) => (!r.email ? 2 : r.stage === "prospect" ? 0 : 1);
  return due.sort((a, b) => turn(a) - turn(b)).slice(0, opts.limit ?? due.length);
}

type Video = { externalId: string; url?: string; postedAt: Date; views: number; likes?: number; comments?: number };

async function saveVideos(row: Account, platform: "tiktok" | "instagram", videos: Video[]) {
  if (!videos.length) return;
  await db
    .insert(posts)
    .values(videos.map((v) => ({ creatorId: row.creatorId, accountId: row.accountId, platform, source: "prospect" as const, externalId: v.externalId, url: v.url, postedAt: v.postedAt, views: v.views, likes: v.likes ?? 0, comments: v.comments ?? 0 })))
    .onConflictDoUpdate({ target: [posts.platform, posts.externalId], set: { views: sql`excluded.views`, likes: sql`excluded.likes`, comments: sql`excluded.comments` }, setWhere: sql`${posts.source} = 'prospect'` });
}

async function saveScore(row: Account, platform: "tiktok" | "instagram", t: TypicalViews, audience: { score: number; verdict: "pass" | "review" | "fail"; flags: string[]; commentQuality: number; viewFollowerRatio: number }) {
  const brand = await getBrand();
  await db.insert(creatorScores).values({
    creatorId: row.creatorId,
    platform,
    sampleSize: t.sampleSize,
    medianViews: t.medianViews,
    worst5AvgViews: t.worst5AvgViews,
    maxViews: t.maxViews,
    engagementRate: t.engagementRate,
    viewFollowerRatio: audience.viewFollowerRatio,
    authenticityScore: audience.score,
    authenticityVerdict: audience.verdict,
    authenticityFlags: audience.flags,
    commentQuality: audience.commentQuality,
    suggestedBaseCents: suggestedBaseCents(t, brand.targetCpmCents),
  });
}

/** `retry` leaves the account due: videos too new to judge won't be by the next run. */
const markChecked = (accountId: string, note: string | null, followers: number | null, opts: { retry?: boolean } = {}) =>
  db
    .update(creatorAccounts)
    .set({ viewsCheckedAt: opts.retry ? null : new Date(), viewsNote: note, ...(followers !== null && { followers }) })
    .where(eq(creatorAccounts.id, accountId));

/**
 * Score TikTok creators from their public embed, one every few seconds. Stops if TikTok starts refusing
 * requests instead of trying to get around it; accounts not reached yet are picked up on the next run.
 */
export async function checkTikTokViews(opts: CheckViewsOptions = {}): Promise<CheckViewsResult> {
  const say = opts.onProgress ?? (() => {});
  const rows = await accountsToCheck("tiktok", opts);
  const delay = opts.delayMs ?? TIKTOK_DELAY_MS;
  const result: CheckViewsResult = { checked: 0, scored: 0, noData: 0, stopped: null };
  say(`${rows.length} TikTok accounts to check`);
  let failures = 0;

  for (const [i, row] of rows.entries()) {
    if (i > 0) await sleep(delay + Math.random() * delay * 0.6);
    const tag = `[${i + 1}/${rows.length}] @${row.handle}`;
    let profile: EmbedProfile | null = null;
    let status = 0;
    while (!profile) {
      const page = await getPage(`https://www.tiktok.com/embed/@${encodeURIComponent(row.handle)}`).catch(() => ({ status: 0, html: "" }));
      status = page.status;
      // The embed answers 400 for missing accounts, and getPage only keeps bodies of successful pages.
      profile = status === 400 ? { found: false, privateAccount: false, followers: null, videos: [] } : status === 200 ? parseTikTokEmbed(page.html) : null;
      if (profile) break;
      failures++;
      say(`${tag}: no data (HTTP ${status})`);
      if (failures >= MAX_FAILURES_IN_A_ROW) break;
      if (status === 429 || status === 0) await sleep(TOO_FAST_PAUSE_MS); // told to slow down, or the network dropped
      else break;
    }
    if (failures >= MAX_FAILURES_IN_A_ROW) {
      result.stopped = `TikTok stopped returning pages (${failures} in a row, last HTTP ${status}). Wait an hour or two and run it again; it picks up where it left off.`;
      break;
    }
    if (!profile) continue;
    failures = 0;
    result.checked++;

    const { typical, includesNewVideos } = typicalFromVideos(profile.videos);
    const pinned = profile.videos.filter((v) => v.pinned).length;
    if (!typical.sampleSize) {
      result.noData++;
      const why = !profile.found ? "not found" : profile.privateAccount ? "private" : profile.videos.length ? "only brand-new videos" : "no videos";
      say(`${tag}: ${NO_DATA} (${why})`);
      if (!opts.dryRun) await markChecked(row.accountId, NO_DATA, profile.followers, { retry: profile.videos.length > 0 });
      continue;
    }
    result.scored++;
    say(`${tag}: typical ${typical.medianViews.toLocaleString("en-US")} from ${typical.sampleSize} videos${pinned ? `, ${pinned} pinned skipped` : ""}${includesNewVideos ? ", includes videos under 3 days old" : ""}`);
    if (opts.dryRun) continue;

    const followers = profile.followers ?? (await db.query.creatorAccounts.findFirst({ where: eq(creatorAccounts.id, row.accountId) }))?.followers ?? null;
    const audience = assessFromViews({ followers, medianViews: typical.medianViews });
    if (includesNewVideos) audience.flags.push("Some videos are under 3 days old, so their views may still climb");
    await saveVideos(row, "tiktok", profile.videos.filter((v) => !v.pinned).map((v) => ({ externalId: v.id, url: `https://www.tiktok.com/@${row.handle}/video/${v.id}`, postedAt: v.postedAt, views: v.views })));
    await saveScore(row, "tiktok", typical, audience);
    await markChecked(row.accountId, null, profile.followers);
  }
  if (!opts.dryRun && result.scored) await log("discovery", `Checked views on ${result.scored} TikTok creators`);
  return result;
}

/**
 * Score Instagram creators through Business Discovery, skipping anyone TikTok already scored. Only
 * professional accounts answer, and only videos that report view_count count: anyone else is marked
 * "no view data", never estimated.
 */
export async function checkInstagramViews(opts: CheckViewsOptions = {}): Promise<CheckViewsResult> {
  const say = opts.onProgress ?? (() => {});
  const result: CheckViewsResult = { checked: 0, scored: 0, noData: 0, stopped: null };
  const token = process.env.INSTAGRAM_GRAPH_TOKEN?.trim();
  if (!token) return { ...result, stopped: "INSTAGRAM_GRAPH_TOKEN is blank in .env.local, so Instagram wasn't checked. Nobody was marked." };
  const delay = opts.delayMs ?? INSTAGRAM_DELAY_MS;
  try {
    const igUserId = process.env.INSTAGRAM_BUSINESS_ID?.trim() || (await instagramBusinessId(token));
    if (!igUserId) return { ...result, stopped: "None of this token's Facebook Pages has a linked Instagram professional account. Set INSTAGRAM_BUSINESS_ID to your account's ID." };
    const all = await accountsToCheck("instagram", opts);
    const ids = all.map((r) => r.creatorId);
    const [scores, tiktok] = await Promise.all([latestScores(ids), db.select({ creatorId: creatorAccounts.creatorId, viewsNote: creatorAccounts.viewsNote }).from(creatorAccounts).where(and(eq(creatorAccounts.platform, "tiktok"), inArray(creatorAccounts.creatorId, ids)))]);
    // Creators with a TikTok get scored there; Instagram is for those without one, or whose TikTok had no data.
    const coveredByTikTok = new Set(tiktok.filter((t) => !t.viewsNote).map((t) => t.creatorId));
    const rows = all.filter((r) => !scores.get(r.creatorId)?.sampleSize && !coveredByTikTok.has(r.creatorId));
    say(`${rows.length} Instagram accounts to check`);

    for (const [i, row] of rows.entries()) {
      if (i > 0) await sleep(delay);
      const tag = `[${i + 1}/${rows.length}] @${row.handle}`;
      let found: Awaited<ReturnType<typeof businessDiscoveryVideos>> | null = null;
      for (let wait = 0; !found; wait++) {
        try {
          found = await businessDiscoveryVideos(row.handle, { token, igUserId });
        } catch (e) {
          if (!(e instanceof InstagramRateLimit) || wait >= MAX_LIMIT_WAITS) throw e;
          say(`${tag}: Instagram's limit reached, waiting ${LIMIT_PAUSE_MS / 60_000} minutes`);
          await sleep(LIMIT_PAUSE_MS);
        }
      }
      result.checked++;
      const samples = found.found ? found.videos.map((v) => ({ views: v.view_count!, likes: v.like_count ?? 0, comments: v.comments_count ?? 0, shares: 0, postedAt: new Date(v.timestamp) })) : [];
      const typical = typicalViews(samples);
      const followers = found.found ? found.followers : null;
      if (!typical.sampleSize) {
        result.noData++;
        say(`${tag}: ${NO_DATA}`);
        if (!opts.dryRun) await markChecked(row.accountId, NO_DATA, followers);
        continue;
      }
      result.scored++;
      say(`${tag}: typical ${typical.medianViews.toLocaleString("en-US")} from ${typical.sampleSize} videos`);
      if (opts.dryRun || !found.found) continue;
      const audience = assessAuthenticity({ followers: followers ?? 0, posts: samples.slice(0, 30) });
      await saveVideos(row, "instagram", found.videos.map((v) => ({ externalId: v.id, url: v.permalink, postedAt: new Date(v.timestamp), views: v.view_count!, likes: v.like_count, comments: v.comments_count })));
      await saveScore(row, "instagram", typical, audience);
      await markChecked(row.accountId, null, followers);
    }
  } catch (e) {
    if (e instanceof InstagramRateLimit) result.stopped = "Instagram's limit didn't clear after an hour of waiting. Run it again later; it picks up where it left off.";
    else if (e instanceof InstagramTokenExpired) result.stopped = `INSTAGRAM_GRAPH_TOKEN has expired: ${e.message}`;
    else throw e;
  }
  if (!opts.dryRun && result.scored) await log("discovery", `Checked views on ${result.scored} Instagram creators`);
  return result;
}
