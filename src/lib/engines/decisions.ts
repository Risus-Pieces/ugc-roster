import { median, round } from "./stats";

export type DecisionInput = {
  posts: number;
  views: number;
  paidCents: number;
  revenuePer1kCents: number;
  confidence: "high" | "medium" | "low";
  /** Credible views per post in chronological order. */
  viewHistory: number[];
  minPosts?: number;
};

export type Decision = {
  action: "promote" | "keep" | "cut" | "evaluating";
  profitPer1kCents: number;
  costPer1kCents: number;
  marginPct: number | null;
  trendPct: number | null;
  reasons: string[];
};

/** The number that matters: revenue per 1,000 views minus what you pay per 1,000 views. */
export function profitPer1k(revenuePer1kCents: number, paidCents: number, views: number) {
  const costPer1k = views > 0 ? Math.round((paidCents / views) * 1000) : 0;
  return { costPer1kCents: costPer1k, profitPer1kCents: revenuePer1kCents - costPer1k };
}

/** Keep, cut or promote — suggested once a creator has 20–30 posts. */
export function decide(i: DecisionInput): Decision {
  const minPosts = i.minPosts ?? 20;
  const { costPer1kCents, profitPer1kCents } = profitPer1k(i.revenuePer1kCents, i.paidCents, i.views);
  const marginPct = i.revenuePer1kCents > 0 ? round((profitPer1kCents / i.revenuePer1kCents) * 100, 0) : null;

  const h = i.viewHistory;
  const k = Math.min(10, Math.floor(h.length / 2));
  const trendPct = k >= 3 && median(h.slice(0, k)) > 0 ? round((median(h.slice(-k)) / median(h.slice(0, k)) - 1) * 100, 0) : null;

  const reasons: string[] = [];
  const base = { profitPer1kCents, costPer1kCents, marginPct, trendPct };

  if (i.posts < minPosts) {
    reasons.push(`${i.posts}/${minPosts} posts — too early to judge`);
    return { action: "evaluating", ...base, reasons };
  }

  const fmt = (c: number) => `$${(c / 100).toFixed(2)}`;
  reasons.push(`Profit ${fmt(profitPer1kCents)} per 1K views (revenue ${fmt(i.revenuePer1kCents)} − cost ${fmt(costPer1kCents)})`);
  if (trendPct !== null) reasons.push(`Typical views ${trendPct >= 0 ? "up" : "down"} ${Math.abs(trendPct)}% (first vs last ${k} posts)`);
  reasons.push(`Attribution confidence: ${i.confidence}`);

  if (i.confidence === "low") {
    reasons.push("Confidence too low to cut or promote — keep collecting data");
    return { action: "keep", ...base, reasons };
  }
  if (profitPer1kCents > 0 && (marginPct ?? 0) >= 40 && (trendPct ?? 0) > -25) {
    reasons.push("Profitable with healthy margin — raise quota or move up a tier");
    return { action: "promote", ...base, reasons };
  }
  if (profitPer1kCents < 0 && (trendPct ?? 0) < 30) {
    reasons.push("Losing money per 1K views without an upward trend");
    return { action: "cut", ...base, reasons };
  }
  return { action: "keep", ...base, reasons };
}
