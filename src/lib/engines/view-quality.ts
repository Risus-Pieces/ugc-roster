export type ViewQualityInput = {
  views: number;
  likes: number;
  comments: number;
  shares: number;
  saves: number;
  /** Views the platform reports as coming from paid promotion (Spark Ads, Promote, boosts). */
  paidViews: number;
  /** The creator's typical engagement rate on organic posts. */
  baselineEngagementRate: number;
};

/**
 * Filter out views we shouldn't pay for or credit:
 * 1. Paid boosts — subtracted using the platform's paid/organic breakdown.
 * 2. Bot views — views that the engagement can't support. If engagement falls below half the
 *    creator's normal rate, we only credit the views that engagement would justify.
 */
export function credibleViews(i: ViewQualityInput, floorFactor = 0.5) {
  const organic = Math.max(0, i.views - i.paidViews);
  const engagements = i.likes + i.comments + i.shares + i.saves;
  const baseline = Math.max(0.005, i.baselineEngagementRate);
  const supportable = engagements / (baseline * floorFactor);
  const credible = Math.round(Math.min(organic, supportable));
  return {
    credibleViews: credible,
    paidViews: Math.min(i.views, i.paidViews),
    botViewsEst: Math.max(0, organic - credible),
  };
}
