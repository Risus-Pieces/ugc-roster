import "server-only";
import { desc, eq, inArray } from "drizzle-orm";
import { db, activity, rateCards, creatorScores, postSnapshots, type RateCard } from "@/db";
import type { RateCardRules } from "@/lib/engines/rate-card";

export async function log(type: string, message: string, creatorId?: string | null) {
  await db.insert(activity).values({ type, message, creatorId: creatorId ?? null });
}

export async function defaultRateCard(): Promise<RateCard> {
  const card = await db.query.rateCards.findFirst({ orderBy: rateCards.createdAt });
  if (card) return card;
  const [created] = await db
    .insert(rateCards)
    .values({
      name: "Standard",
      baseCents: 2500,
      cpmCents: 100,
      viewWindowDays: 14,
      perVideoCapCents: 50_000,
      monthlyCapCents: 300_000,
      videosPerMonth: 60,
      minViewsForCpm: 1000,
      milestones: [
        { views: 100_000, bonusCents: 5_000 },
        { views: 500_000, bonusCents: 15_000 },
      ],
      tiers: [
        { name: "Rising", minTypicalViews: 10_000, baseCents: 4000, cpmCents: 120 },
        { name: "Pro", minTypicalViews: 30_000, baseCents: 7500, cpmCents: 150 },
      ],
      referralBonusCents: 15_000,
    })
    .returning();
  return created;
}

export async function rateCardFor(rateCardId: string | null | undefined): Promise<RateCard> {
  if (rateCardId) {
    const c = await db.query.rateCards.findFirst({ where: eq(rateCards.id, rateCardId) });
    if (c) return c;
  }
  return defaultRateCard();
}

export const rulesOf = (c: RateCard): RateCardRules => ({
  baseCents: c.baseCents,
  cpmCents: c.cpmCents,
  viewWindowDays: c.viewWindowDays,
  perVideoCapCents: c.perVideoCapCents,
  monthlyCapCents: c.monthlyCapCents,
  videosPerMonth: c.videosPerMonth,
  minViewsForCpm: c.minViewsForCpm,
  milestones: c.milestones,
  tiers: c.tiers,
  quotaScope: c.quotaScope,
  milestoneMode: c.milestoneMode,
  signupBonusCents: c.signupBonusCents,
  bonusCapCents: c.bonusCapCents,
});

/** Most recent score per creator. */
export async function latestScores(creatorIds?: string[]) {
  const rows = await db
    .select()
    .from(creatorScores)
    .where(creatorIds ? inArray(creatorScores.creatorId, creatorIds) : undefined)
    .orderBy(desc(creatorScores.computedAt));
  const out = new Map<string, typeof creatorScores.$inferSelect>();
  for (const r of rows) if (!out.has(r.creatorId)) out.set(r.creatorId, r);
  return out;
}

/** All snapshots for the given posts, grouped by post. */
export async function snapshotsByPost(postIds: string[]) {
  const out = new Map<string, (typeof postSnapshots.$inferSelect)[]>();
  if (!postIds.length) return out;
  for (let i = 0; i < postIds.length; i += 500) {
    const rows = await db.select().from(postSnapshots).where(inArray(postSnapshots.postId, postIds.slice(i, i + 500)));
    for (const r of rows) {
      const list = out.get(r.postId) ?? [];
      list.push(r);
      out.set(r.postId, list);
    }
  }
  for (const list of out.values()) list.sort((a, b) => a.dayMark - b.dayMark);
  return out;
}

/** Credible views at the close of the view window (or latest available before it). */
export function windowViews(snaps: (typeof postSnapshots.$inferSelect)[] | undefined, windowDays: number, fallbackViews = 0) {
  if (!snaps?.length) return fallbackViews;
  const within = snaps.filter((s) => s.dayMark <= windowDays);
  const pick = within.at(-1) ?? snaps[0];
  return pick.credibleViews;
}

export const DAY = 86_400_000;
