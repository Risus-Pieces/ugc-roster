export type BreakoutConfig = {
  minViews: number;
  minEngagementRate: number;
  /** Only alert on posts younger than this, so variations ride the trend. */
  maxAgeHours: number;
  /** Must also beat the creator's own median by this multiple, so routine posts from big creators don't alert. */
  minMultipleOfTypical?: number;
};

export const DEFAULT_BREAKOUT: BreakoutConfig = { minViews: 10_000, minEngagementRate: 0.03, maxAgeHours: 96, minMultipleOfTypical: 2 };

export function engagementRate(p: { views: number; likes: number; comments: number; shares: number; saves?: number }) {
  return p.views > 0 ? (p.likes + p.comments + p.shares + (p.saves ?? 0)) / p.views : 0;
}

export function isBreakout(
  p: { views: number; likes: number; comments: number; shares: number; saves?: number; postedAt: Date },
  cfg: BreakoutConfig = DEFAULT_BREAKOUT,
  now = new Date(),
  typicalViews?: number,
) {
  const ageH = (now.getTime() - p.postedAt.getTime()) / 3_600_000;
  const beatsOwnTypical = !typicalViews || !cfg.minMultipleOfTypical || p.views >= typicalViews * cfg.minMultipleOfTypical;
  return p.views >= cfg.minViews && engagementRate(p) >= cfg.minEngagementRate && ageH <= cfg.maxAgeHours && beatsOwnTypical;
}

/** Top-N% performers by views for the hook bank. */
export function topPercent<T extends { views: number }>(items: T[], pct = 5): T[] {
  if (items.length === 0) return [];
  const n = Math.max(1, Math.ceil((items.length * pct) / 100));
  return [...items].sort((a, b) => b.views - a.views).slice(0, n);
}
