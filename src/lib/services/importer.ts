import "server-only";
import { and, eq, inArray } from "drizzle-orm";
import { db, creators, creatorAccounts, campaignCreators, campaigns, creatorScores } from "@/db";
import { normalizeRows, parseCsv, type Field, type ImportPlatform, type ImportRow } from "@/lib/engines/csv-import";
import { assessFromAggregates } from "@/lib/engines/authenticity";
import { normalizeEmail, isReservedAddress } from "@/lib/engines/contact";
import { followerBandOk, suggestedBaseCents } from "@/lib/engines/creator-score";
import { getBrand } from "@/lib/settings";
import { log } from "./common";

export type ImportOptions = { campaignId: string; source: string; defaultPlatform: ImportPlatform | null; onlyInBand: boolean };

export type ImportPlan = {
  headers: string[];
  mapping: Partial<Record<Field, string>>;
  total: number;
  ready: ImportRow[];
  skipped: { line: number; reason: string; handle?: string | null }[];
  duplicates: { line: number; handle: string; existingName: string }[];
  withEmail: number;
  outOfBand: number;
  band: { min: number; max: number };
};

const MAX_ROWS = 2000;

/** Parse and check an export without writing anything. */
export async function planImport(csv: string, opts: ImportOptions): Promise<ImportPlan> {
  const campaign = await db.query.campaigns.findFirst({ where: eq(campaigns.id, opts.campaignId) });
  if (!campaign) throw new Error("Pick a campaign to import into.");
  const parsed = parseCsv(csv);
  if (parsed.length < 2) throw new Error("The file needs a header row and at least one creator.");
  if (parsed.length - 1 > MAX_ROWS) throw new Error(`That's ${parsed.length - 1} rows. Import up to ${MAX_ROWS} at a time.`);
  const { map, headers, rows } = normalizeRows(parsed, opts.defaultPlatform);
  if (map.handle === undefined && map.url === undefined) throw new Error("Couldn't find a username or profile link column. Rename it to “Username” or “Profile URL”.");

  const skipped: ImportPlan["skipped"] = [];
  const candidates: ImportRow[] = [];
  const seen = new Set<string>();
  let outOfBand = 0;
  for (const r of rows) {
    if (!r.handle) skipped.push({ line: r.line, reason: "No username or profile link" });
    else if (!r.platform) skipped.push({ line: r.line, reason: "Unknown platform (choose a default platform)", handle: r.handle });
    else if (seen.has(`${r.platform}:${r.handle}`)) skipped.push({ line: r.line, reason: "Listed twice in this file", handle: r.handle });
    else if (r.followers !== null && !followerBandOk(r.followers, campaign.minFollowers, campaign.maxFollowers)) {
      outOfBand++;
      if (opts.onlyInBand) skipped.push({ line: r.line, reason: `${r.followers.toLocaleString("en-US")} followers is outside ${campaign.minFollowers.toLocaleString("en-US")}–${campaign.maxFollowers.toLocaleString("en-US")}`, handle: r.handle });
      else candidates.push(r);
    } else candidates.push(r);
    if (r.handle && r.platform) seen.add(`${r.platform}:${r.handle}`);
  }

  // Already in Roster? Match by platform + handle, then by normalized email.
  const duplicates: ImportPlan["duplicates"] = [];
  const handles = candidates.map((r) => r.handle!);
  const existingAccts = handles.length ? await db.select({ platform: creatorAccounts.platform, handle: creatorAccounts.handle, creatorId: creatorAccounts.creatorId }).from(creatorAccounts).where(inArray(creatorAccounts.handle, handles)) : [];
  const emails = candidates.map((r) => normalizeEmail(r.email)).filter((e): e is string => Boolean(e));
  const existingEmails = emails.length ? await db.select({ id: creators.id, name: creators.name, emailNormalized: creators.emailNormalized }).from(creators).where(inArray(creators.emailNormalized, emails)) : [];
  const names = new Map((existingAccts.length ? await db.select({ id: creators.id, name: creators.name }).from(creators).where(inArray(creators.id, existingAccts.map((a) => a.creatorId))) : []).map((c) => [c.id, c.name]));
  const ready: ImportRow[] = [];
  for (const r of candidates) {
    const acct = existingAccts.find((a) => a.platform === r.platform && a.handle === r.handle);
    const byEmail = r.email ? existingEmails.find((c) => c.emailNormalized === normalizeEmail(r.email)) : undefined;
    if (acct) duplicates.push({ line: r.line, handle: r.handle!, existingName: names.get(acct.creatorId) ?? r.handle! });
    else if (byEmail) duplicates.push({ line: r.line, handle: r.handle!, existingName: byEmail.name });
    else ready.push(r);
  }

  return {
    headers,
    mapping: Object.fromEntries(Object.entries(map).map(([f, i]) => [f, headers[i as number]])) as ImportPlan["mapping"],
    total: rows.length,
    ready,
    skipped,
    duplicates,
    withEmail: ready.filter((r) => r.email && !isReservedAddress(r.email)).length,
    outOfBand,
    band: { min: campaign.minFollowers, max: campaign.maxFollowers },
  };
}

/** Write the creators the plan marked ready: creator + account + campaign link + an aggregate score. */
export async function runImport(csv: string, opts: ImportOptions) {
  const plan = await planImport(csv, opts);
  const brand = await getBrand();
  let created = 0;
  for (const r of plan.ready) {
    const email = r.email && !isReservedAddress(r.email) ? r.email : null;
    const [c] = await db
      .insert(creators)
      .values({ name: (r.name || r.handle!).slice(0, 120), email, emailNormalized: normalizeEmail(email), country: r.country?.slice(0, 60) ?? null, source: opts.source })
      .onConflictDoNothing()
      .returning();
    if (!c) continue; // email collided with a creator added in the meantime
    await db
      .insert(creatorAccounts)
      .values({
        creatorId: c.id,
        platform: r.platform!,
        handle: r.handle!,
        url: r.url ?? (r.platform === "tiktok" ? `https://www.tiktok.com/@${r.handle}` : r.platform === "instagram" ? `https://www.instagram.com/${r.handle}` : `https://www.youtube.com/@${r.handle}`),
        bio: r.bio,
        followers: r.followers ?? 0,
      })
      .onConflictDoNothing();
    await db.insert(campaignCreators).values({ campaignId: opts.campaignId, creatorId: c.id }).onConflictDoNothing();
    if (r.avgViews !== null || r.engagementRate !== null || r.fakeFollowersPct !== null) {
      const a = assessFromAggregates(r);
      const views = r.avgViews ?? 0;
      await db.insert(creatorScores).values({
        creatorId: c.id,
        platform: r.platform!,
        sampleSize: 0, // averages from the export, not per-post data
        medianViews: views,
        worst5AvgViews: 0,
        maxViews: 0,
        engagementRate: r.engagementRate ?? 0,
        viewFollowerRatio: a.viewFollowerRatio,
        authenticityScore: a.score,
        authenticityVerdict: a.verdict,
        authenticityFlags: a.flags,
        commentQuality: 0,
        // Averages include viral hits, so price off half the average until real posts are scored.
        suggestedBaseCents: views ? suggestedBaseCents({ worst5AvgViews: Math.round(views / 2), medianViews: views }, brand.targetCpmCents) : 0,
      });
    }
    created++;
  }
  await log("import", `Imported ${created} creators from ${opts.source}${plan.duplicates.length ? ` · ${plan.duplicates.length} already in Roster` : ""}`);
  return { created, plan };
}

export async function campaignOptions() {
  return db.select({ id: campaigns.id, name: campaigns.name, minFollowers: campaigns.minFollowers, maxFollowers: campaigns.maxFollowers }).from(campaigns).where(and(eq(campaigns.status, "active")));
}
