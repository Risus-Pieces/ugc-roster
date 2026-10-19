import { median, worstN, round } from "./stats";

export type PostSample = {
  views: number;
  likes: number;
  comments: number;
  shares: number;
  saves?: number;
  postedAt: Date;
};

export type TypicalViews = {
  sampleSize: number;
  medianViews: number;
  worst5AvgViews: number;
  maxViews: number;
  /** How much the creator's reputation leans on one hit: max / median. */
  viralDependence: number;
  engagementRate: number;
};

const DAY = 86_400_000;

/**
 * Judge a creator on typical performance, not their one viral hit:
 * the median of recent posts and the average of their 5 worst videos.
 * Posts younger than `minAgeDays` are excluded because their views are still climbing.
 */
export function typicalViews(
  posts: PostSample[],
  opts: { recent?: number; minAgeDays?: number; now?: Date } = {},
): TypicalViews {
  const { recent = 30, minAgeDays = 3, now = new Date() } = opts;
  const mature = posts
    .filter((p) => now.getTime() - p.postedAt.getTime() >= minAgeDays * DAY)
    .sort((a, b) => b.postedAt.getTime() - a.postedAt.getTime())
    .slice(0, recent);

  const views = mature.map((p) => p.views);
  const med = median(views);
  const engagements = mature.reduce((a, p) => a + p.likes + p.comments + p.shares + (p.saves ?? 0), 0);
  const totalViews = views.reduce((a, v) => a + v, 0);

  return {
    sampleSize: mature.length,
    medianViews: Math.round(med),
    worst5AvgViews: Math.round(worstN(views, 5)),
    maxViews: views.length ? Math.max(...views) : 0,
    viralDependence: med > 0 ? round(Math.max(...views) / med, 1) : 0,
    engagementRate: totalViews > 0 ? round(engagements / totalViews, 4) : 0,
  };
}

/**
 * Price a creator off their floor, the way Cal AI did: the base fee is what their
 * worst videos are worth at your target CPM, so you never overpay for a bad week.
 * Anything above the floor gets paid through per-view pay instead.
 */
export function suggestedBaseCents(t: Pick<TypicalViews, "worst5AvgViews" | "medianViews">, targetCpmCents: number) {
  const floorViews = Math.min(t.worst5AvgViews, t.medianViews);
  const cents = (floorViews / 1000) * targetCpmCents;
  // Round to the nearest $5, minimum $10.
  return Math.max(1000, Math.round(cents / 500) * 500);
}

export function followerBandOk(followers: number, min = 2000, max = 20000) {
  return followers >= min && followers <= max;
}
