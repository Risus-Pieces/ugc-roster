import "server-only";
import { and, eq, gte, inArray } from "drizzle-orm";
import { db, creators, posts, statements, messages } from "@/db";
import { decide, type Decision } from "@/lib/engines/decisions";
import { forecast } from "@/lib/engines/forecast";
import { resolveTier } from "@/lib/engines/rate-card";
import { median } from "@/lib/engines/stats";
import { getOps } from "@/lib/settings";
import { attributionReport } from "./attribution";
import { defaultRateCard, latestScores, rateCardFor, rulesOf, snapshotsByPost, log, DAY } from "./common";

export type CreatorEconomics = {
  creatorId: string;
  name: string;
  stage: string;
  posts: number;
  views: number;
  paidCents: number;
  revenuePer1kCents: number;
  revenuePer1kLow: number;
  revenuePer1kHigh: number;
  confidence: "high" | "medium" | "low";
  decision: Decision;
};

/** Profit check + keep/cut/promote for every roster creator. */
export async function creatorEconomics(): Promise<CreatorEconomics[]> {
  const [ops, attr] = await Promise.all([getOps(), attributionReport(90)]);
  const roster = await db.select().from(creators).where(inArray(creators.stage, ["trial", "active"]));
  const attrBy = new Map(attr.rows.map((r) => [r.creatorId, r]));
  const owed = await db.select().from(statements).where(inArray(statements.status, ["approved", "paid", "draft"]));
  const paidBy = new Map<string, number>();
  for (const s of owed) paidBy.set(s.creatorId, (paidBy.get(s.creatorId) ?? 0) + s.totalCents);

  const out: CreatorEconomics[] = [];
  for (const c of roster) {
    const ps = (await db.select().from(posts).where(and(eq(posts.creatorId, c.id), eq(posts.isCampaignPost, true)))).sort((a, b) => a.postedAt.getTime() - b.postedAt.getTime());
    const snaps = await snapshotsByPost(ps.map((p) => p.id));
    const views = ps.reduce((a, p) => a + (snaps.get(p.id)?.at(-1)?.credibleViews ?? p.views), 0);
    // Trend compares like with like: day-7 credible views on posts at least a week old.
    const history = ps.map((p) => snaps.get(p.id)?.find((s) => s.dayMark === 7)?.credibleViews).filter((v): v is number => v !== undefined);
    const a = attrBy.get(c.id);
    const paidCents = paidBy.get(c.id) ?? 0;
    const decision = decide({
      posts: ps.length,
      views,
      paidCents,
      revenuePer1kCents: a?.revenuePer1k ?? 0,
      confidence: a?.confidence ?? "low",
      viewHistory: history,
      minPosts: ops.decisionMinPosts,
    });
    out.push({
      creatorId: c.id,
      name: c.name,
      stage: c.stage,
      posts: ps.length,
      views,
      paidCents,
      revenuePer1kCents: a?.revenuePer1k ?? 0,
      revenuePer1kLow: a?.revenuePer1kLow ?? 0,
      revenuePer1kHigh: a?.revenuePer1kHigh ?? 0,
      confidence: a?.confidence ?? "low",
      decision,
    });
  }
  return out.sort((x, y) => y.decision.profitPer1kCents - x.decision.profitPer1kCents);
}

/** Forecast from the roster's actual numbers, e.g. "150 videos a day needs about 75 creators and about $X a month." */
export async function rosterForecast(targetVideosPerDay: number, overrides: { postsPerCreatorPerDay?: number; viewsPerVideo?: number; revenuePer1kCents?: number } = {}) {
  const card = await defaultRateCard();
  const since = new Date(Date.now() - 30 * DAY);
  const recent = await db.select().from(posts).where(and(eq(posts.isCampaignPost, true), gte(posts.postedAt, since)));
  const activeCreators = new Set(recent.map((p) => p.creatorId)).size;
  const snaps = await snapshotsByPost(recent.map((p) => p.id));
  const windowViews = recent.map((p) => snaps.get(p.id)?.at(-1)?.credibleViews ?? p.views);
  const econ = await attributionReport(60);
  const totalViews = econ.rows.reduce((a, r) => a + r.views, 0);
  const weightedRev = totalViews ? econ.rows.reduce((a, r) => a + r.revenuePer1k * r.views, 0) / totalViews : 0;

  const inputs = {
    postsPerCreatorPerDay: overrides.postsPerCreatorPerDay ?? (activeCreators ? Math.max(0.3, Math.round((recent.length / activeCreators / 30) * 10) / 10) : 2),
    viewsPerVideo: overrides.viewsPerVideo ?? Math.round(median(windowViews) || 3000),
    revenuePer1kCents: overrides.revenuePer1kCents ?? Math.round(weightedRev),
  };
  return { inputs, rateCard: card, result: forecast({ targetVideosPerDay, ...inputs, rules: rulesOf(card) }) };
}

/** The tier each creator is paid at today (earned from views, or promoted to) and the next one up. */
export async function tierStatus(creatorIds: string[]) {
  const out = new Map<string, { current: string; next: string | null }>();
  if (!creatorIds.length) return out;
  const cs = await db.select().from(creators).where(inArray(creators.id, creatorIds));
  const scores = await latestScores(creatorIds);
  for (const c of cs) {
    const card = await rateCardFor(c.rateCardId);
    const tiers = [...card.tiers].sort((a, b) => a.minTypicalViews - b.minTypicalViews);
    const current = resolveTier(rulesOf(card), scores.get(c.id)?.medianViews, c.tier).name;
    out.set(c.id, { current, next: tiers[tiers.findIndex((t) => t.name === current) + 1]?.name ?? null });
  }
  return out;
}

/**
 * Promote: move the creator to the next tier on their rate card (tiers ordered by typical views).
 * Throws when they're already on the top tier, with what to do instead.
 */
export async function promoteCreator(creatorId: string) {
  const c = await db.query.creators.findFirst({ where: eq(creators.id, creatorId) });
  if (!c) throw new Error("Creator not found");
  const card = await rateCardFor(c.rateCardId);
  const tiers = [...card.tiers].sort((a, b) => a.minTypicalViews - b.minTypicalViews);
  if (!tiers.length) throw new Error(`The "${card.name}" rate card has no tiers. Add tiers on the rate card first.`);
  // Step up from the tier they're actually paid at (earned from views, or a previous promotion).
  const typical = (await latestScores([c.id])).get(c.id)?.medianViews;
  const current = resolveTier(rulesOf(card), typical, c.tier);
  const idx = tiers.findIndex((t) => t.name === current.name);
  const next = tiers[idx + 1];
  if (!next) throw new Error(`${c.name} is already on the top tier (${current.name}). Raise their quota or add a higher tier on the rate card.`);
  await db.update(creators).set({ tier: next.name }).where(eq(creators.id, creatorId));
  await log("promote", `${c.name} promoted to ${next.name} tier ($${(next.baseCents / 100).toFixed(0)} base, $${(next.cpmCents / 100).toFixed(2)}/1K)`, creatorId);
  return { from: c.tier ?? "Standard", to: next.name };
}

/** Recruiting funnel from the pipeline: contacted → replied → trial → active. */
export async function funnelActuals() {
  const out = await db.select({ creatorId: messages.creatorId, direction: messages.direction, status: messages.status }).from(messages);
  const contacted = new Set(out.filter((m) => m.direction === "out" && ["sent", "simulated"].includes(m.status)).map((m) => m.creatorId));
  const replied = new Set(out.filter((m) => m.direction === "in" && contacted.has(m.creatorId)).map((m) => m.creatorId));
  const cs = contacted.size ? await db.select({ id: creators.id, stage: creators.stage, productAccessAt: creators.productAccessAt }).from(creators).where(inArray(creators.id, [...contacted])) : [];
  const trial = cs.filter((c) => replied.has(c.id) && (c.productAccessAt || ["trial", "active"].includes(c.stage)));
  const active = trial.filter((c) => c.stage === "active");
  const rate = (a: number, b: number) => (b > 0 ? a / b : null);
  return {
    contacted: contacted.size,
    replied: replied.size,
    trial: trial.length,
    active: active.length,
    replyRate: rate(replied.size, contacted.size),
    trialRate: rate(trial.length, replied.size),
    activationRate: rate(active.length, trial.length),
  };
}
