import "server-only";
import { and, eq, inArray, desc, sql } from "drizzle-orm";
import { db, campaigns, creators, creatorAccounts, campaignCreators, posts, creatorScores, type Platform } from "@/db";
import { discoveryFor, type DiscoveredCreator } from "@/lib/integrations/platforms";
import { extractEmails, normalizeEmail, normalizeHandle } from "@/lib/engines/contact";
import { typicalViews, suggestedBaseCents, followerBandOk } from "@/lib/engines/creator-score";
import { assessAuthenticity } from "@/lib/engines/authenticity";
import { rankLookalikes, seedKeywords, type LookalikeProfile } from "@/lib/engines/lookalike";
import { getBrand } from "@/lib/settings";
import { latestScores, log } from "./common";

export type DiscoveryRun = {
  searched: number;
  inBand: number;
  created: number;
  duplicates: number; // already known (from this or another campaign)
  alreadyInOtherCampaign: number;
  withEmail: number;
  providers: string[];
};

/** Upsert one discovered creator, de-duplicating by platform handle and normalized email. */
async function upsertDiscovered(d: DiscoveredCreator, campaignId: string, niche: string) {
  const handle = normalizeHandle(d.handle);
  const emails = extractEmails(d.bio);
  const email = emails[0] ?? null;
  const emailNorm = normalizeEmail(email);

  const existingAccount = await db.query.creatorAccounts.findFirst({ where: and(eq(creatorAccounts.platform, d.platform), eq(creatorAccounts.handle, handle)) });
  let creatorId = existingAccount?.creatorId;
  if (!creatorId && emailNorm) {
    const byEmail = await db.query.creators.findFirst({ where: eq(creators.emailNormalized, emailNorm) });
    creatorId = byEmail?.id;
  }

  let isNew = false;
  if (!creatorId) {
    const [c] = await db.insert(creators).values({ name: d.name, email, emailNormalized: emailNorm, country: d.country, niche }).returning();
    creatorId = c.id;
    isNew = true;
  } else if (email) {
    // Fill in a missing email on a known creator
    const c = await db.query.creators.findFirst({ where: eq(creators.id, creatorId) });
    if (c && !c.email) await db.update(creators).set({ email, emailNormalized: emailNorm }).where(eq(creators.id, creatorId));
  }

  let accountId = existingAccount?.id;
  if (!accountId) {
    const [a] = await db
      .insert(creatorAccounts)
      .values({ creatorId, platform: d.platform, handle, platformUserId: d.platformUserId, url: d.url, bio: d.bio, followers: d.followers })
      .onConflictDoNothing()
      .returning();
    accountId = a?.id;
  } else {
    await db.update(creatorAccounts).set({ followers: d.followers, bio: d.bio }).where(eq(creatorAccounts.id, accountId));
  }

  if (d.posts.length) {
    await db
      .insert(posts)
      .values(d.posts.map((p) => ({
        creatorId,
        accountId,
        platform: d.platform,
        externalId: p.externalId,
        url: p.url,
        caption: p.caption,
        transcript: p.transcript,
        postedAt: p.postedAt,
        source: "prospect" as const,
        views: p.views,
        likes: p.likes,
        comments: p.comments,
        shares: p.shares,
        saves: p.saves,
        sampleComments: p.sampleComments,
        isPaidPartnership: p.isPaidPartnership ?? false,
      })))
      .onConflictDoUpdate({
        target: [posts.platform, posts.externalId],
        set: { views: sql`excluded.views`, likes: sql`excluded.likes`, comments: sql`excluded.comments`, shares: sql`excluded.shares`, saves: sql`excluded.saves` },
      });
  }

  const otherCampaigns = await db.select().from(campaignCreators).where(eq(campaignCreators.creatorId, creatorId));
  const inOther = otherCampaigns.some((c) => c.campaignId !== campaignId);
  await db.insert(campaignCreators).values({ campaignId, creatorId }).onConflictDoNothing();
  await scoreCreator(creatorId);
  return { isNew, inOther, hasEmail: Boolean(email) };
}

export async function runDiscovery(campaignId: string, opts: { perKeyword?: number } = {}): Promise<DiscoveryRun> {
  const campaign = await db.query.campaigns.findFirst({ where: eq(campaigns.id, campaignId) });
  if (!campaign) throw new Error("Campaign not found");
  const run: DiscoveryRun = { searched: 0, inBand: 0, created: 0, duplicates: 0, alreadyInOtherCampaign: 0, withEmail: 0, providers: [] };

  for (const platform of campaign.platforms) {
    const provider = discoveryFor(platform);
    run.providers.push(`${platform}: ${provider.name}`);
    for (const kw of campaign.keywords) {
      const found = await provider.search(kw, { minFollowers: campaign.minFollowers, maxFollowers: campaign.maxFollowers, limit: opts.perKeyword ?? 12 });
      run.searched += found.length;
      for (const d of found) {
        if (!followerBandOk(d.followers, campaign.minFollowers, campaign.maxFollowers)) continue;
        run.inBand++;
        const r = await upsertDiscovered(d, campaign.id, campaign.niche);
        if (r.isNew) run.created++;
        else run.duplicates++;
        if (r.inOther) run.alreadyInOtherCampaign++;
        if (r.hasEmail) run.withEmail++;
      }
    }
  }
  await log("discovery", `Discovery for "${campaign.name}": ${run.created} new, ${run.duplicates} duplicates skipped`);
  return run;
}

/** Score a creator on typical views and audience authenticity, per platform account. */
export async function scoreCreator(creatorId: string) {
  const brand = await getBrand();
  const accounts = await db.select().from(creatorAccounts).where(eq(creatorAccounts.creatorId, creatorId));
  for (const acct of accounts) {
    const ps = await db
      .select()
      .from(posts)
      // Organic posts only: sponsored campaign posts shouldn't define a creator's audience.
      .where(and(eq(posts.accountId, acct.id), inArray(posts.source, ["prospect", "roster"]), eq(posts.isCampaignPost, false)))
      .orderBy(desc(posts.postedAt))
      .limit(40);
    if (!ps.length) continue;
    const samples = ps.map((p) => ({ views: p.views, likes: p.likes, comments: p.comments, shares: p.shares, saves: p.saves, postedAt: p.postedAt, caption: p.caption, sampleComments: p.sampleComments }));
    const t = typicalViews(samples);
    const auth = assessAuthenticity({ followers: acct.followers, posts: samples.slice(0, 30) });
    await db.insert(creatorScores).values({
      creatorId,
      platform: acct.platform,
      sampleSize: t.sampleSize,
      medianViews: t.medianViews,
      worst5AvgViews: t.worst5AvgViews,
      maxViews: t.maxViews,
      engagementRate: t.engagementRate,
      viewFollowerRatio: auth.viewFollowerRatio,
      authenticityScore: auth.score,
      authenticityVerdict: auth.verdict,
      authenticityFlags: auth.flags,
      commentQuality: auth.commentQuality,
      suggestedBaseCents: suggestedBaseCents(t, brand.targetCpmCents),
    });
  }
}

/**
 * "Find more like my top 10": seeds default to the 10 roster creators with the best
 * typical views (or the ones you pick); candidates are scored prospects.
 */
export async function findLookalikes(seedIds?: string[], limit = 25) {
  const all = await db.select().from(creators);
  const scores = await latestScores();
  const accounts = await db.select().from(creatorAccounts);
  const recentCaptions = await db.select({ creatorId: posts.creatorId, caption: posts.caption }).from(posts).orderBy(desc(posts.postedAt));

  const textBy = new Map<string, string>();
  for (const a of accounts) textBy.set(a.creatorId, `${textBy.get(a.creatorId) ?? ""} ${a.bio ?? ""}`);
  const capCount = new Map<string, number>();
  for (const c of recentCaptions) {
    if (!c.creatorId || (capCount.get(c.creatorId) ?? 0) >= 12) continue;
    capCount.set(c.creatorId, (capCount.get(c.creatorId) ?? 0) + 1);
    textBy.set(c.creatorId, `${textBy.get(c.creatorId) ?? ""} ${c.caption ?? ""}`);
  }
  const followersBy = new Map<string, number>();
  for (const a of accounts) followersBy.set(a.creatorId, Math.max(followersBy.get(a.creatorId) ?? 0, a.followers));

  const profile = (id: string): LookalikeProfile | null => {
    const s = scores.get(id);
    if (!s) return null;
    return { id, followers: followersBy.get(id) ?? 0, medianViews: s.medianViews, engagementRate: s.engagementRate, text: textBy.get(id) ?? "" };
  };

  const roster = all.filter((c) => ["active", "trial"].includes(c.stage));
  const seeds = (seedIds?.length ? all.filter((c) => seedIds.includes(c.id)) : [...roster].sort((a, b) => (scores.get(b.id)?.medianViews ?? 0) - (scores.get(a.id)?.medianViews ?? 0)).slice(0, 10))
    .map((c) => profile(c.id))
    .filter((x): x is LookalikeProfile => x !== null);

  const candidates = all
    .filter((c) => c.stage === "prospect" && scores.get(c.id)?.authenticityVerdict !== "fail")
    .map((c) => profile(c.id))
    .filter((x): x is LookalikeProfile => x !== null);

  const ranked = rankLookalikes(seeds, candidates, limit);
  const byId = new Map(all.map((c) => [c.id, c]));
  return {
    seeds: seeds.map((s) => byId.get(s.id)!),
    keywords: seedKeywords(seeds),
    results: ranked.map((r) => ({ ...r, creator: byId.get(r.id)!, score: scores.get(r.id)! })),
  };
}

export async function createCampaign(p: { name: string; niche: string; keywords: string[]; platforms: Platform[]; minFollowers?: number; maxFollowers?: number }) {
  const [c] = await db
    .insert(campaigns)
    .values({ name: p.name, niche: p.niche, keywords: p.keywords, platforms: p.platforms, minFollowers: p.minFollowers ?? 2000, maxFollowers: p.maxFollowers ?? 20000 })
    .returning();
  await log("campaign", `Created campaign "${c.name}"`);
  return c;
}

/** Which search provider each platform will use (demo data unless a real API key is configured). */
export function discoveryProviders(platforms: readonly Platform[]) {
  return platforms.map((platform) => {
    const p = discoveryFor(platform);
    return { platform, name: p.name, live: p.live };
  });
}
