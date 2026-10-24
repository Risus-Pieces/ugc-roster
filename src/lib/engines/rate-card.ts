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
  /** "month": the video quota resets monthly. "total": it covers every video the creator makes (a trial). */
  quotaScope: "month" | "total";
  /** "all": each milestone passed pays. "highest": only the highest milestone reached pays. */
  milestoneMode: "all" | "highest";
  signupBonusCents: number;
  /** Most a creator can earn in milestone + signup bonuses, ever (0 = no cap). */
  bonusCapCents: number;
};

/** Caps stored as 0 mean "no cap". */
const cap = (cents: number) => (cents > 0 ? cents : Infinity);

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
  /** Waitlist signups through the creator's link inside this video's view window (each signup counted for one video only). */
  windowSignups?: number;
};

export type StatementInput = {
  rules: RateCardRules;
  typicalViews?: number;
  /** Tier the creator was promoted to; pay never drops below it. */
  tierFloor?: string | null;
  posts: PayoutPost[];
  /** Videos already given base pay: this month, or ever when the quota covers the whole trial. */
  basePostsAlreadyPaid?: number;
  /** Milestone + signup bonuses already paid to this creator, counted against the bonus cap. */
  bonusesAlreadyPaidCents?: number;
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
  const reached = rules.milestones.filter((m) => views >= m.views).sort((a, b) => a.views - b.views);
  const milestones = rules.milestoneMode === "highest" ? reached.slice(-1) : reached;
  return { cpm, milestones, milestoneCents: milestones.reduce((a, m) => a + m.bonusCents, 0) };
}

/**
 * Builds an itemized statement:
 * - Base pay for approved videos, up to the video quota (per month, or for the whole trial).
 * - Per-view pay, milestone bonuses and signup bonuses once each video's view window closes.
 * - Per-video cap on (base + performance), the creator's lifetime bonus cap on milestones +
 *   signups, then a monthly cap on the total.
 * - Extras (referral bonuses, clawbacks) are added after caps.
 */
export function buildStatement({ rules, typicalViews, tierFloor, posts, basePostsAlreadyPaid = 0, bonusesAlreadyPaidCents = 0, extras = [] }: StatementInput) {
  const tier = resolveTier(rules, typicalViews, tierFloor);
  const items: LineItem[] = [];
  let quotaLeft = Math.max(0, rules.videosPerMonth - basePostsAlreadyPaid);
  let bonusRoom = Math.max(0, cap(rules.bonusCapCents) - bonusesAlreadyPaidCents);
  const capNote = (paid: number, owed: number) => (paid < owed ? (bonusRoom === 0 && rules.bonusCapCents > 0 ? " (bonus cap reached)" : " (capped)") : "");

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
      const room = Math.max(0, cap(rules.perVideoCapCents) - baseThisVideo);
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
        const amt = Math.min(m.bonusCents, remaining, bonusRoom);
        remaining -= amt;
        bonusRoom -= amt;
        if (amt > 0)
          items.push({
            kind: "milestone",
            postId: p.id,
            description: `Milestone ${m.views.toLocaleString("en-US")} views — ${p.label}${capNote(amt, m.bonusCents)}`,
            amountCents: amt,
          });
      }
      const signups = p.windowSignups ?? 0;
      if (signups > 0 && rules.signupBonusCents > 0) {
        const owed = signups * rules.signupBonusCents;
        const amt = Math.min(owed, remaining, bonusRoom);
        remaining -= amt;
        bonusRoom -= amt;
        if (amt > 0)
          items.push({
            kind: "signup",
            postId: p.id,
            description: `${signups} waitlist signup${signups === 1 ? "" : "s"} × $${(rules.signupBonusCents / 100).toFixed(2)} — ${p.label}${capNote(amt, owed)}`,
            amountCents: amt,
          });
      }
    }
  }

  const subtotal = items.reduce((a, i) => a + i.amountCents, 0);
  if (subtotal > cap(rules.monthlyCapCents)) {
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
  return Math.min(cap(rules.perVideoCapCents), tier.baseCents + perf.cpm + Math.min(perf.milestoneCents, cap(rules.bonusCapCents)));
}
