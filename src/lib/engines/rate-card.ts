import type { LineItem, Milestone, Tier } from "@/db/schema";

export type RateCardRules = {
  baseCents: number;
  cpmCents: number;
  viewWindowDays: number;
  perVideoCapCents: number;
  monthlyCapCents: number;
  videosPerMonth: number;
  minViewsForCpm: number;
  milestones: Milestone[];
  tiers: Tier[];
};

export type PayoutPost = {
  id: string;
  label: string;
  postedAt: Date;
  approved: boolean;
  /** Credible views (bots + paid boosts removed) at the close of the view window. */
  windowViews: number;
  /** Has the view window closed? CPM and milestones settle only once it has. */
  windowClosed: boolean;
  /** Base already paid in a previous statement. */
  basePaid: boolean;
  /** Performance pay already settled in a previous statement. */
  performancePaid: boolean;
};

export type StatementInput = {
  rules: RateCardRules;
  typicalViews?: number;
  /** Tier the creator was promoted to; pay never drops below it. */
  tierFloor?: string | null;
  posts: PayoutPost[];
  basePostsAlreadyPaidThisMonth?: number;
  extras?: LineItem[]; // referral bonuses, clawbacks
};

/**
 * Resolve which tier applies: the highest tier whose typical-views threshold the creator meets,
 * or the tier they were promoted to (`floorTier`) if that's higher.
 */
export function resolveTier(rules: RateCardRules, typicalViews = 0, floorTier?: string | null) {
  const earned = [...rules.tiers].sort((a, b) => b.minTypicalViews - a.minTypicalViews).find((t) => typicalViews >= t.minTypicalViews);
  const floor = floorTier ? rules.tiers.find((t) => t.name === floorTier) : undefined;
  const tier = floor && (!earned || floor.minTypicalViews > earned.minTypicalViews) ? floor : earned;
  return {
    name: tier?.name ?? "Standard",
    baseCents: tier?.baseCents ?? rules.baseCents,
    cpmCents: tier?.cpmCents ?? rules.cpmCents,
  };
}

/** Performance pay (per-view + milestones) for one video, before caps. */
export function performancePay(rules: RateCardRules, cpmCents: number, views: number) {
  const cpm = views >= rules.minViewsForCpm ? Math.round((views / 1000) * cpmCents) : 0;
  const milestones = rules.milestones.filter((m) => views >= m.views);
  return { cpm, milestones, milestoneCents: milestones.reduce((a, m) => a + m.bonusCents, 0) };
}

/**
 * Builds an itemized statement:
 * - Base pay for approved videos, up to the monthly video quota.
 * - Per-view pay + milestone bonuses on credible views, once each video's view window closes.
 * - Per-video cap on (base + performance), then a monthly cap on the total.
 * - Extras (referral bonuses, clawbacks) are added after caps.
 */
export function buildStatement({ rules, typicalViews, tierFloor, posts, basePostsAlreadyPaidThisMonth = 0, extras = [] }: StatementInput) {
  const tier = resolveTier(rules, typicalViews, tierFloor);
  const items: LineItem[] = [];
  let quotaLeft = Math.max(0, rules.videosPerMonth - basePostsAlreadyPaidThisMonth);

  const sorted = [...posts].sort((a, b) => a.postedAt.getTime() - b.postedAt.getTime());
  for (const p of sorted) {
    if (!p.approved) continue;

    let baseThisVideo = 0;
    if (!p.basePaid && quotaLeft > 0) {
      baseThisVideo = tier.baseCents;
      quotaLeft--;
      items.push({ kind: "base", postId: p.id, description: `Base — ${p.label}`, amountCents: baseThisVideo });
    } else if (p.basePaid) {
      baseThisVideo = tier.baseCents;
    }

    if (p.windowClosed && !p.performancePaid) {
      const perf = performancePay(rules, tier.cpmCents, p.windowViews);
      const room = Math.max(0, rules.perVideoCapCents - baseThisVideo);
      let remaining = room;
      if (perf.cpm > 0) {
        const amt = Math.min(perf.cpm, remaining);
        remaining -= amt;
        items.push({
          kind: "cpm",
          postId: p.id,
          description: `${p.windowViews.toLocaleString("en-US")} views × $${(tier.cpmCents / 100).toFixed(2)}/1K — ${p.label}${amt < perf.cpm ? " (capped)" : ""}`,
          amountCents: amt,
        });
      }
      for (const m of perf.milestones) {
        const amt = Math.min(m.bonusCents, remaining);
        remaining -= amt;
        if (amt > 0)
          items.push({
            kind: "milestone",
            postId: p.id,
            description: `Milestone ${m.views.toLocaleString("en-US")} views — ${p.label}`,
            amountCents: amt,
          });
      }
    }
  }

  const subtotal = items.reduce((a, i) => a + i.amountCents, 0);
  if (subtotal > rules.monthlyCapCents) {
    items.push({
      kind: "cap_adjustment",
      description: `Monthly cap ($${(rules.monthlyCapCents / 100).toFixed(0)})`,
      amountCents: rules.monthlyCapCents - subtotal,
    });
  }
  items.push(...extras);
  const totalCents = Math.max(0, items.reduce((a, i) => a + i.amountCents, 0));
  return { tier, lineItems: items, totalCents };
}

/** Expected cost of one video at a given credible view count (used by forecasts and profit checks). */
export function expectedCostPerVideo(rules: RateCardRules, views: number, typicalViews?: number) {
  const tier = resolveTier(rules, typicalViews ?? views);
  const perf = performancePay(rules, tier.cpmCents, views);
  return Math.min(rules.perVideoCapCents, tier.baseCents + perf.cpm + perf.milestoneCents);
}
