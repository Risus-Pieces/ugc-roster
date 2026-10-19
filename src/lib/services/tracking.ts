import "server-only";
import { and, desc, eq, inArray, gte } from "drizzle-orm";
import { db, creators, creatorAccounts, posts, postSnapshots, breakouts, type CreatorAccount } from "@/db";
import { connectedProviders, type DiscoveredPost } from "@/lib/integrations/platforms";
import { simulateGrowth } from "@/lib/integrations/platforms/demo";
import { decrypt, encrypt } from "@/lib/integrations/crypto";
import { credibleViews } from "@/lib/engines/view-quality";
import { isBreakout, engagementRate } from "@/lib/engines/breakout";
import { median } from "@/lib/engines/stats";
import { getOps } from "@/lib/settings";
import { latestScores, log, snapshotsByPost, DAY } from "./common";
import { createBreakout } from "./creative";
import { linkPostToReview } from "./review";
import { invalidateAttribution } from "./attribution";

const DISCLOSURE = /(#ad\b|#sponsored\b|#paidpartnership\b|#partner\b|paid partnership)/i;
const DAY_MARKS = [1, 7, 14] as const;

async function accessToken(acct: CreatorAccount) {
  if (!acct.accessTokenEnc) return null;
  const provider = connectedProviders[acct.platform];
  if (acct.tokenExpiresAt && acct.tokenExpiresAt.getTime() < Date.now() + 5 * 60_000 && provider.refresh) {
    const refreshSecret = acct.refreshTokenEnc ? decrypt(acct.refreshTokenEnc) : decrypt(acct.accessTokenEnc); // IG refreshes with the access token
    const t = await provider.refresh(refreshSecret);
    await db
      .update(creatorAccounts)
      .set({ accessTokenEnc: encrypt(t.accessToken), refreshTokenEnc: t.refreshToken ? encrypt(t.refreshToken) : acct.refreshTokenEnc, tokenExpiresAt: t.expiresAt })
      .where(eq(creatorAccounts.id, acct.id));
    return t.accessToken;
  }
  return decrypt(acct.accessTokenEnc);
}

/**
 * Pull the latest posts for one connected account, detect new posts, and record day-1/7/14
 * snapshots with bot and paid views filtered out.
 */
export async function syncAccount(accountId: string) {
  const acct = await db.query.creatorAccounts.findFirst({ where: eq(creatorAccounts.id, accountId) });
  if (!acct?.connected) return { newPosts: 0, snapshots: 0 };
  const creator = await db.query.creators.findFirst({ where: eq(creators.id, acct.creatorId) });
  if (!creator) return { newPosts: 0, snapshots: 0 };

  let fetched: DiscoveredPost[];
  const token = await accessToken(acct);
  if (token) {
    fetched = await connectedProviders[acct.platform].recentPosts(token, acct.platformUserId ?? "");
  } else {
    // Demo-connected: grow existing posts along a realistic curve.
    const existing = await db.select().from(posts).where(and(eq(posts.accountId, acct.id), gte(posts.postedAt, new Date(Date.now() - 30 * DAY))));
    fetched = existing.map((p) => ({ externalId: p.externalId, url: p.url ?? undefined, caption: p.caption ?? "", postedAt: p.postedAt, ...simulateGrowth(p, acct.lastSyncedAt ?? p.createdAt) }));
  }

  const since = creator.productAccessAt ?? creator.warmupStartedAt;
  const score = (await latestScores([creator.id])).get(creator.id);
  let newPosts = 0;
  let snapshots = 0;

  for (const f of fetched) {
    const existing = await db.query.posts.findFirst({ where: and(eq(posts.platform, acct.platform), eq(posts.externalId, f.externalId)) });
    const isCampaign = Boolean(since && f.postedAt >= since && (f.isPaidPartnership || DISCLOSURE.test(f.caption)));
    let postId = existing?.id;
    if (!existing) {
      const [p] = await db
        .insert(posts)
        .values({
          creatorId: creator.id,
          accountId: acct.id,
          platform: acct.platform,
          externalId: f.externalId,
          url: f.url,
          caption: f.caption,
          transcript: f.transcript,
          postedAt: f.postedAt,
          source: "roster",
          isCampaignPost: isCampaign,
          isPaidPartnership: f.isPaidPartnership ?? false,
          views: f.views,
          likes: f.likes,
          comments: f.comments,
          shares: f.shares,
          saves: f.saves,
          paidViews: f.paidViews ?? 0,
        })
        .returning();
      postId = p.id;
      newPosts++;
      if (isCampaign) {
        await linkPostToReview(p.id);
        await log("post", `New post detected from ${creator.name}`, creator.id);
      }
    } else {
      await db
        .update(posts)
        .set({ views: f.views, likes: f.likes, comments: f.comments, shares: f.shares, saves: f.saves, paidViews: f.paidViews ?? existing.paidViews, source: existing.source === "prospect" ? "roster" : existing.source })
        .where(eq(posts.id, existing.id));
    }

    // Snapshots at day 1, 7, 14 (taken at the first sync after each mark)
    const ageDays = (Date.now() - f.postedAt.getTime()) / DAY;
    const baseline = score?.engagementRate ?? 0.05;
    for (const mark of DAY_MARKS) {
      if (ageDays < mark) continue;
      const q = credibleViews({ views: f.views, likes: f.likes, comments: f.comments, shares: f.shares, saves: f.saves, paidViews: f.paidViews ?? 0, baselineEngagementRate: baseline });
      const res = await db
        .insert(postSnapshots)
        .values({ postId: postId!, dayMark: mark, views: f.views, likes: f.likes, comments: f.comments, shares: f.shares, saves: f.saves, paidViews: q.paidViews, credibleViews: q.credibleViews, botViewsEst: q.botViewsEst })
        .onConflictDoNothing()
        .returning();
      snapshots += res.length;
    }
  }

  await db.update(creatorAccounts).set({ lastSyncedAt: new Date() }).where(eq(creatorAccounts.id, acct.id));
  if (newPosts || snapshots) invalidateAttribution();
  await detectBreakouts(creator.id);
  return { newPosts, snapshots };
}

export async function syncAll() {
  const accts = await db.select().from(creatorAccounts).where(eq(creatorAccounts.connected, true));
  let newPosts = 0;
  let snapshots = 0;
  const errors: string[] = [];
  for (const a of accts) {
    try {
      const r = await syncAccount(a.id);
      newPosts += r.newPosts;
      snapshots += r.snapshots;
    } catch (e) {
      errors.push(`${a.platform}/@${a.handle}: ${e instanceof Error ? e.message : e}`);
    }
  }
  return { accounts: accts.length, newPosts, snapshots, errors };
}

export async function detectBreakouts(creatorId?: string) {
  const ops = await getOps();
  const recent = await db
    .select()
    .from(posts)
    .where(and(eq(posts.isCampaignPost, true), gte(posts.postedAt, new Date(Date.now() - ops.breakout.maxAgeHours * 3_600_000)), creatorId ? eq(posts.creatorId, creatorId) : undefined));
  const already = new Set((await db.select({ postId: breakouts.postId }).from(breakouts)).map((b) => b.postId));
  const typical = await typicalCampaignViews([...new Set(recent.map((p) => p.creatorId!))]);
  const created: string[] = [];
  for (const p of recent) {
    if (already.has(p.id) || !isBreakout(p, ops.breakout, new Date(), typical.get(p.creatorId!))) continue;
    const b = await createBreakout(p.id);
    created.push(b.id);
  }
  return created;
}

/** Median day-7 views of each creator's campaign posts (their "typical" sponsored video). */
async function typicalCampaignViews(creatorIds: string[]) {
  const out = new Map<string, number>();
  if (!creatorIds.length) return out;
  const ps = await db.select({ id: posts.id, creatorId: posts.creatorId }).from(posts).where(and(eq(posts.isCampaignPost, true), inArray(posts.creatorId, creatorIds)));
  const snaps = ps.length ? await db.select().from(postSnapshots).where(and(inArray(postSnapshots.postId, ps.map((p) => p.id)), eq(postSnapshots.dayMark, 7))) : [];
  const byPost = new Map(snaps.map((s) => [s.postId, s.views]));
  for (const id of creatorIds) {
    const v = ps.filter((p) => p.creatorId === id).map((p) => byPost.get(p.id)).filter((x): x is number => x !== undefined);
    if (v.length >= 5) out.set(id, median(v));
  }
  // Too few campaign posts yet: fall back to their organic typical views from scoring.
  const missing = creatorIds.filter((id) => !out.has(id));
  if (missing.length) for (const [id, s] of await latestScores(missing)) out.set(id, s.medianViews);
  return out;
}

export type LeaderRow = {
  creatorId: string;
  name: string;
  posts: number;
  views: number;
  credibleViews: number;
  medianViews: number;
  engagementRate: number;
  saves: number;
  shares: number;
  botViews: number;
  paidViews: number;
};

/** Leaderboard over campaign posts in the window, using credible views (bots + boosts removed). */
export async function leaderboard(days = 30): Promise<LeaderRow[]> {
  const since = new Date(Date.now() - days * DAY);
  const ps = await db.select().from(posts).where(and(eq(posts.isCampaignPost, true), gte(posts.postedAt, since)));
  const ids = ps.map((p) => p.id);
  const snaps = ids.length ? await db.select().from(postSnapshots).where(inArray(postSnapshots.postId, ids)) : [];
  const latest = new Map<string, (typeof snaps)[number]>();
  for (const s of snaps) if (!latest.has(s.postId) || latest.get(s.postId)!.dayMark < s.dayMark) latest.set(s.postId, s);
  const cs = await db.select({ id: creators.id, name: creators.name }).from(creators).where(inArray(creators.id, [...new Set(ps.map((p) => p.creatorId!))]));
  const nameOf = new Map(cs.map((c) => [c.id, c.name]));

  const rows = new Map<string, LeaderRow & { _views: number[] }>();
  for (const p of ps) {
    const s = latest.get(p.id);
    const r =
      rows.get(p.creatorId!) ??
      ({ creatorId: p.creatorId!, name: nameOf.get(p.creatorId!) ?? "?", posts: 0, views: 0, credibleViews: 0, medianViews: 0, engagementRate: 0, saves: 0, shares: 0, botViews: 0, paidViews: 0, _views: [] } as LeaderRow & { _views: number[] });
    r.posts++;
    r.views += p.views;
    r.credibleViews += s?.credibleViews ?? p.views;
    r.botViews += s?.botViewsEst ?? 0;
    r.paidViews += s?.paidViews ?? p.paidViews;
    r.saves += p.saves;
    r.shares += p.shares;
    r.engagementRate += engagementRate(p) * p.views;
    r._views.push(s?.credibleViews ?? p.views);
    rows.set(p.creatorId!, r);
  }
  return [...rows.values()]
    .map(({ _views, ...r }) => ({ ...r, medianViews: Math.round(median(_views)), engagementRate: r.views ? r.engagementRate / r.views : 0 }))
    .sort((a, b) => b.credibleViews - a.credibleViews);
}

export async function recentCampaignPosts(limit = 50) {
  return db.select().from(posts).where(eq(posts.isCampaignPost, true)).orderBy(desc(posts.postedAt)).limit(limit);
}

export type RecentPostRow = {
  post: Awaited<ReturnType<typeof recentCampaignPosts>>[number];
  creatorName: string;
  /** Credible views at day 1 / 7 / 14 (null until the post reaches that mark). */
  day1: number | null;
  day7: number | null;
  day14: number | null;
  engagementRate: number;
  botViews: number;
  paidViews: number;
};

/** Recent campaign posts with their day-1/7/14 credible views and what was filtered out. */
export async function recentCampaignPostsWithSnapshots(limit = 50): Promise<RecentPostRow[]> {
  const ps = await recentCampaignPosts(limit);
  const snaps = await snapshotsByPost(ps.map((p) => p.id));
  const ids = [...new Set(ps.map((p) => p.creatorId).filter((x): x is string => Boolean(x)))];
  const cs = ids.length ? await db.select({ id: creators.id, name: creators.name }).from(creators).where(inArray(creators.id, ids)) : [];
  const nameOf = new Map(cs.map((c) => [c.id, c.name]));
  return ps.map((p) => {
    const s = snaps.get(p.id) ?? [];
    const at = (mark: number) => s.find((x) => x.dayMark === mark)?.credibleViews ?? null;
    const latest = s.at(-1);
    return {
      post: p,
      creatorName: (p.creatorId && nameOf.get(p.creatorId)) || "?",
      day1: at(1),
      day7: at(7),
      day14: at(14),
      engagementRate: engagementRate(p),
      botViews: latest?.botViewsEst ?? 0,
      paidViews: latest?.paidViews ?? p.paidViews,
    };
  });
}

/** How many accounts are connected for automatic tracking, and when the last sync ran. */
export async function trackingStatus() {
  const accts = await db.select({ lastSyncedAt: creatorAccounts.lastSyncedAt }).from(creatorAccounts).where(eq(creatorAccounts.connected, true));
  const last = accts.reduce<number>((a, x) => Math.max(a, x.lastSyncedAt?.getTime() ?? 0), 0);
  return { connectedAccounts: accts.length, lastSyncedAt: last ? new Date(last) : null };
}
