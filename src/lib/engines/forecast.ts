import { expectedCostPerVideo, type RateCardRules } from "./rate-card";

export type ForecastInput = {
  targetVideosPerDay: number;
  postsPerCreatorPerDay: number;
  viewsPerVideo: number; // typical credible views at window close
  revenuePer1kCents: number;
  rules: RateCardRules;
  /** Funnel rates for recruiting: emails → replies → trials → active. */
  replyRate?: number;
  trialRate?: number;
  activationRate?: number;
};

export function forecast(i: ForecastInput) {
  const { replyRate = 0.15, trialRate = 0.4, activationRate = 0.5 } = i;
  const creators = Math.ceil(i.targetVideosPerDay / Math.max(0.1, i.postsPerCreatorPerDay));
  const videosPerMonth = i.targetVideosPerDay * 30;
  const costPerVideo = expectedCostPerVideo(i.rules, i.viewsPerVideo);
  const perCreatorMonthly = Math.min(i.rules.monthlyCapCents, costPerVideo * Math.min(i.rules.videosPerMonth, i.postsPerCreatorPerDay * 30));
  const monthlyCostCents = creators * perCreatorMonthly;
  const monthlyViews = videosPerMonth * i.viewsPerVideo;
  const monthlyRevenueCents = Math.round((monthlyViews / 1000) * i.revenuePer1kCents);
  const emailsNeeded = Math.ceil(creators / (replyRate * trialRate * activationRate));
  const quotaLimited = i.postsPerCreatorPerDay * 30 > i.rules.videosPerMonth;

  return {
    creators,
    videosPerMonth,
    costPerVideoCents: costPerVideo,
    monthlyCostCents,
    monthlyViews,
    monthlyRevenueCents,
    monthlyProfitCents: monthlyRevenueCents - monthlyCostCents,
    costPer1kCents: monthlyViews > 0 ? Math.round((monthlyCostCents / monthlyViews) * 1000) : 0,
    emailsNeeded,
    quotaLimited,
    summary: `${i.targetVideosPerDay} videos a day needs about ${creators} creators and about $${Math.round(monthlyCostCents / 100).toLocaleString("en-US")} a month.`,
  };
}
