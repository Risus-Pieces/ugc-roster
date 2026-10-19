import { median, round } from "./stats";

export type Bucket = { t: number; installs: number; revenueCents: number };
export type AttributionPost = { id: string; creatorId: string; postedAt: number; credibleViews: number };
export type DirectSignals = { linkInstalls: number; promoRedemptions: number; revenueCents: number };

export type CreatorAttribution = {
  creatorId: string;
  views: number;
  posts: number;
  direct: { installs: number; revenueCents: number };
  survey: { responses: number; installs: number; revenueCents: number } | null;
  lift: { installs: number; revenueCents: number } | null;
  estimate: { installs: number; revenueCents: number; lowCents: number; highCents: number };
  revenuePer1k: number; // cents
  revenuePer1kLow: number;
  revenuePer1kHigh: number;
  confidence: "high" | "medium" | "low";
  confidenceReasons: string[];
};

const HOUR = 3_600_000;
const WEEK = 168 * HOUR;

/**
 * Baseline for each bucket = median of the same hour-of-week over the prior `weeks` weeks.
 * Falls back to the median of the same hour-of-day over the prior 7 days.
 */
export function baselines(series: Bucket[], weeks = 3): Map<number, number> {
  const byT = new Map(series.map((b) => [b.t, b.installs]));
  const out = new Map<number, number>();
  for (const b of series) {
    const prior: number[] = [];
    for (let w = 1; w <= weeks; w++) {
      const v = byT.get(b.t - w * WEEK);
      if (v !== undefined) prior.push(v);
    }
    if (prior.length < 2) {
      for (let d = 1; d <= 7; d++) {
        const v = byT.get(b.t - d * 24 * HOUR);
        if (v !== undefined) prior.push(v);
      }
    }
    out.set(b.t, prior.length ? median(prior) : b.installs);
  }
  return out;
}

/**
 * Time-series lift: installs above baseline in the hours after each post, split between
 * posts live at the same time in proportion to their (decaying) credible views.
 * Excess in hours with no post influence stays unattributed.
 */
export function liftByCreator(series: Bucket[], posts: AttributionPost[], opts: { windowHours?: number; halfLifeHours?: number } = {}) {
  const { windowHours = 48, halfLifeHours = 12 } = opts;
  const base = baselines(series);
  const lambda = Math.LN2 / halfLifeHours;
  const result = new Map<string, number>();
  let attributed = 0;
  let unattributed = 0;

  for (const b of series) {
    const excess = Math.max(0, b.installs - (base.get(b.t) ?? b.installs));
    if (excess === 0) continue;
    const weights: { creatorId: string; w: number }[] = [];
    for (const p of posts) {
      const dt = (b.t - p.postedAt) / HOUR;
      if (dt < 0 || dt >= windowHours) continue;
      weights.push({ creatorId: p.creatorId, w: p.credibleViews * Math.exp(-lambda * dt) });
    }
    const total = weights.reduce((a, x) => a + x.w, 0);
    if (total === 0) {
      unattributed += excess;
      continue;
    }
    for (const x of weights) result.set(x.creatorId, (result.get(x.creatorId) ?? 0) + (excess * x.w) / total);
    attributed += excess;
  }
  return { byCreator: result, attributed, unattributed };
}

export type AttributionInput = {
  series: Bucket[];
  posts: AttributionPost[];
  direct: Map<string, DirectSignals>;
  surveyCounts: Map<string, number>;
  /** Total survey responses including "other" answers. */
  surveyTotal: number;
  /** Installs during the period the survey answers cover (the series may include extra baseline history). */
  surveyPeriodInstalls?: number;
};

/**
 * Blends three independent estimates per creator:
 * - Direct (links + promo codes): a hard floor, always undercounts.
 * - Survey: creator's share of "where did you hear about us?" × total installs.
 * - Lift: excess installs after their posts.
 * Estimate = max(direct, mean(survey, lift)); the range spans the methods.
 * Confidence rises with views, post count, direct signals, and agreement between methods.
 */
export function attribute(input: AttributionInput): CreatorAttribution[] {
  const totalInstalls = input.series.reduce((a, b) => a + b.installs, 0);
  const totalRevenue = input.series.reduce((a, b) => a + b.revenueCents, 0);
  const arpu = totalInstalls > 0 ? totalRevenue / totalInstalls : 0;
  const lift = liftByCreator(input.series, input.posts);

  const creatorIds = new Set(input.posts.map((p) => p.creatorId));
  const out: CreatorAttribution[] = [];

  for (const creatorId of creatorIds) {
    const mine = input.posts.filter((p) => p.creatorId === creatorId);
    const views = mine.reduce((a, p) => a + p.credibleViews, 0);
    const d = input.direct.get(creatorId) ?? { linkInstalls: 0, promoRedemptions: 0, revenueCents: 0 };
    const directInstalls = d.linkInstalls + d.promoRedemptions;
    const directRevenue = Math.max(d.revenueCents, Math.round(directInstalls * arpu));

    const responses = input.surveyCounts.get(creatorId) ?? 0;
    const survey =
      input.surveyTotal >= 30
        ? (() => {
            const installs = (responses / input.surveyTotal) * (input.surveyPeriodInstalls ?? totalInstalls);
            return { responses, installs: round(installs, 1), revenueCents: Math.round(installs * arpu) };
          })()
        : null;

    const liftInstalls = lift.byCreator.get(creatorId) ?? 0;
    const spanDays = input.series.length ? (input.series[input.series.length - 1].t - input.series[0].t) / (24 * HOUR) : 0;
    const liftEst = spanDays >= 14 ? { installs: round(liftInstalls, 1), revenueCents: Math.round(liftInstalls * arpu) } : null;

    const modeled = [survey?.revenueCents, liftEst?.revenueCents].filter((x): x is number => x !== undefined);
    const modeledMean = modeled.length ? modeled.reduce((a, b) => a + b, 0) / modeled.length : directRevenue;
    const estimateCents = Math.round(Math.max(directRevenue, modeledMean));
    const lowCents = Math.round(Math.max(directRevenue, modeled.length ? Math.min(...modeled) : directRevenue));
    const highCents = Math.round(Math.max(directRevenue, ...modeled));

    // Confidence
    let points = 0;
    const reasons: string[] = [];
    if (views >= 500_000) points += 2;
    else if (views >= 100_000) points += 1;
    else reasons.push(`Only ${Math.round(views / 1000)}K credible views so far`);
    if (mine.length >= 20) points += 1;
    else reasons.push(`${mine.length} posts (20+ needed)`);
    if (directInstalls >= 30) points += 1;
    else reasons.push(`${directInstalls} direct conversions (link/code)`);
    if (survey && liftEst) {
      const hi = Math.max(survey.revenueCents, liftEst.revenueCents);
      const lo = Math.min(survey.revenueCents, liftEst.revenueCents);
      const agreement = hi > 0 ? lo / hi : 1;
      if (agreement >= 0.6) {
        points += 2;
        reasons.push("Survey and lift agree");
      } else if (agreement >= 0.35) points += 1;
      else reasons.push("Survey and lift disagree");
    } else reasons.push("Only one modeled method available");
    const confidence = points >= 5 ? "high" : points >= 3 ? "medium" : "low";

    const per1k = (cents: number) => (views > 0 ? Math.round((cents / views) * 1000) : 0);
    out.push({
      creatorId,
      views,
      posts: mine.length,
      direct: { installs: directInstalls, revenueCents: directRevenue },
      survey,
      lift: liftEst,
      estimate: { installs: round(arpu > 0 ? estimateCents / arpu : 0, 1), revenueCents: estimateCents, lowCents, highCents },
      revenuePer1k: per1k(estimateCents),
      revenuePer1kLow: per1k(lowCents),
      revenuePer1kHigh: per1k(highCents),
      confidence,
      confidenceReasons: reasons,
    });
  }
  return out.sort((a, b) => b.revenuePer1k - a.revenuePer1k);
}
