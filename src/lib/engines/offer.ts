import type { Milestone } from "@/db/schema";

/** The parts of a rate card a creator cares about. A RateCard row satisfies this. */
export type Offer = {
  baseCents: number;
  cpmCents: number;
  videosPerMonth: number;
  quotaScope: "month" | "total";
  viewWindowDays: number;
  milestones: Milestone[];
  milestoneMode: "all" | "highest";
  signupBonusCents: number;
  bonusCapCents: number;
  perks: string;
};

const usd = (c: number) => `$${(c / 100).toFixed(c % 100 ? 2 : 0)}`;
const views = (n: number) => (n >= 1000 && n % 1000 === 0 ? `${n / 1000}K` : n.toLocaleString("en-US"));
const byViews = (o: Offer) => [...o.milestones].sort((a, b) => a.views - b.views);

export const perksOf = (o: Pick<Offer, "perks">) =>
  o.perks
    .split("\n")
    .map((p) => p.trim())
    .filter(Boolean);

/** One sentence for cold emails: the pay, up front. "$30 per video for 4 videos, up to $100 more per video at view milestones, plus $1 for every waitlist signup from your link" */
export function offerLine(o: Offer) {
  const parts = [`${usd(o.baseCents)} per video ${o.quotaScope === "total" ? `for ${o.videosPerMonth} videos` : "you post"}`];
  if (o.cpmCents > 0) parts.push(`${usd(o.cpmCents)} per 1,000 views`);
  const ms = byViews(o);
  if (ms.length) {
    const top = o.milestoneMode === "highest" ? ms.at(-1)!.bonusCents : ms.reduce((a, m) => a + m.bonusCents, 0);
    parts.push(`up to ${usd(top)} more per video at view milestones`);
  }
  if (o.signupBonusCents > 0) parts.push(`${usd(o.signupBonusCents)} for every waitlist signup from your link`);
  return parts.length > 1 ? `${parts.slice(0, -1).join(", ")}, plus ${parts.at(-1)}` : parts[0];
}

/** The deal in a breath, for follow-ups: "4 videos at $25 each, plus bonuses when one takes off past 10K views". */
export function shortOffer(o: Offer) {
  const base = o.quotaScope === "total" ? `${o.videosPerMonth} videos at ${usd(o.baseCents)} each` : `${usd(o.baseCents)} a video`;
  const first = byViews(o)[0];
  return first ? `${base}, plus bonuses when one takes off past ${views(first.views)} views` : base;
}

/** The full deal in plain English, one point per line (reply drafts and the creator portal). */
export function offerTerms(o: Offer) {
  const w = o.viewWindowDays;
  const lines = [o.quotaScope === "total" ? `${usd(o.baseCents)} per approved video, for ${o.videosPerMonth} videos` : `${usd(o.baseCents)} per approved video, up to ${o.videosPerMonth} a month`];
  if (o.cpmCents > 0) lines.push(`${usd(o.cpmCents)} per 1,000 views in the first ${w} days`);
  const ms = byViews(o);
  if (ms.length) {
    const list = ms.map((m) => `${usd(m.bonusCents)} at ${views(m.views)}`).join(", ");
    lines.push(o.milestoneMode === "highest" ? `View bonus per video (first ${w} days): ${list}. You get the highest level reached; they don't add up.` : `View bonuses per video (first ${w} days): ${list}. Each one reached pays.`);
  }
  if (o.signupBonusCents > 0) lines.push(`${usd(o.signupBonusCents)} per waitlist signup through your link, counted for ${w} days after each post`);
  if (o.bonusCapCents > 0) lines.push(`Bonuses (view bonuses plus signups) top out at ${usd(o.bonusCapCents)} ${o.quotaScope === "total" ? "for the whole trial" : "in total"}`);
  const perks = perksOf(o);
  if (perks.length) lines.push(`Perks: ${perks.join("; ")}`);
  return lines;
}
