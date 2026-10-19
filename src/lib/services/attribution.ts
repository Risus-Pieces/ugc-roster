import "server-only";
import { and, eq, gte, lte, inArray } from "drizzle-orm";
import { db, posts, appMetrics, attributionEvents, creators } from "@/db";
import { attribute, type Bucket, type DirectSignals, type CreatorAttribution } from "@/lib/engines/attribution";
import { snapshotsByPost, DAY } from "./common";

const HOUR = 3_600_000;

/**
 * Builds the install/revenue series. Hourly data (RevenueCat, your own analytics) is used when
 * present; otherwise we fall back to daily App Store / Play buckets.
 */
export async function loadSeries(from: Date, to: Date): Promise<{ series: Bucket[]; granularity: "hour" | "day" }> {
  const rows = await db.select().from(appMetrics).where(and(gte(appMetrics.bucketStart, from), lte(appMetrics.bucketStart, to)));
  const hourly = rows.filter((r) => r.granularity === "hour");
  const hourlyInstalls = hourly.some((r) => r.installs > 0);
  const use = hourlyInstalls ? hourly : rows.filter((r) => r.granularity === "day");
  const granularity = hourlyInstalls ? "hour" : "day";
  const step = granularity === "hour" ? HOUR : DAY;

  const byT = new Map<number, Bucket>();
  for (const r of use) {
    const t = Math.floor(r.bucketStart.getTime() / step) * step;
    const b = byT.get(t) ?? { t, installs: 0, revenueCents: 0 };
    b.installs += r.installs;
    b.revenueCents += r.revenueCents;
    byT.set(t, b);
  }
  // Daily revenue from RevenueCat when installs come from day-level store reports
  if (granularity === "day") {
    for (const r of hourly) {
      const t = Math.floor(r.bucketStart.getTime() / DAY) * DAY;
      const b = byT.get(t) ?? { t, installs: 0, revenueCents: 0 };
      b.revenueCents += r.revenueCents;
      byT.set(t, b);
    }
  }
  // Fill gaps with zeros so baselines line up
  const series: Bucket[] = [];
  if (byT.size) {
    const ts = [...byT.keys()];
    for (let t = Math.min(...ts); t <= Math.max(...ts); t += step) series.push(byT.get(t) ?? { t, installs: 0, revenueCents: 0 });
  }
  return { series, granularity };
}

export type AttributionReport = {
  rows: (CreatorAttribution & { name: string })[];
  totals: { installs: number; revenueCents: number; attributedRevenueCents: number; surveyResponses: number; arpuCents: number };
  granularity: "hour" | "day";
  from: Date;
  to: Date;
};

/**
 * The model reads every hourly bucket and campaign post, so results are memoized briefly:
 * several pages (Today, profit check, creator detail) ask for it on the same load.
 */
const REPORT_TTL_MS = 30_000;
const reportCache = new Map<number, { at: number; value: Promise<AttributionReport> }>();

export function attributionReport(days = 60): Promise<AttributionReport> {
  const hit = reportCache.get(days);
  if (hit && Date.now() - hit.at < REPORT_TTL_MS) return hit.value;
  const value = computeAttributionReport(days);
  reportCache.set(days, { at: Date.now(), value });
  value.catch(() => reportCache.delete(days));
  return value;
}

/** Drop memoized reports after writes that change attribution inputs. */
export function invalidateAttribution() {
  reportCache.clear();
}

async function computeAttributionReport(days: number): Promise<AttributionReport> {
  const to = new Date();
  const from = new Date(to.getTime() - days * DAY);
  const { series, granularity } = await loadSeries(new Date(from.getTime() - 21 * DAY), to); // extra history for baselines
  const inRange = series.filter((b) => b.t >= from.getTime());

  const ps = await db.select().from(posts).where(and(eq(posts.isCampaignPost, true), gte(posts.postedAt, from)));
  const snaps = await snapshotsByPost(ps.map((p) => p.id));
  const aPosts = ps.map((p) => ({ id: p.id, creatorId: p.creatorId!, postedAt: p.postedAt.getTime(), credibleViews: snaps.get(p.id)?.at(-1)?.credibleViews ?? p.views }));

  const events = await db.select().from(attributionEvents).where(gte(attributionEvents.occurredAt, from));
  const direct = new Map<string, DirectSignals>();
  const surveyCounts = new Map<string, number>();
  let surveyTotal = 0;
  for (const e of events) {
    if (e.kind === "survey") {
      surveyTotal++;
      if (e.creatorId) surveyCounts.set(e.creatorId, (surveyCounts.get(e.creatorId) ?? 0) + 1);
      continue;
    }
    if (!e.creatorId || e.kind === "link_click") continue;
    const d = direct.get(e.creatorId) ?? { linkInstalls: 0, promoRedemptions: 0, revenueCents: 0 };
    if (e.kind === "link_install") d.linkInstalls++;
    if (e.kind === "promo_redemption") d.promoRedemptions++;
    d.revenueCents += e.revenueCents;
    direct.set(e.creatorId, d);
  }

  // Run the model on the full series (baselines need history) but only credit posts in range.
  const surveyPeriodInstalls = inRange.reduce((a, b) => a + b.installs, 0);
  const result = attribute({ series, posts: aPosts, direct, surveyCounts, surveyTotal, surveyPeriodInstalls });
  const names = new Map(
    (await db.select({ id: creators.id, name: creators.name }).from(creators).where(inArray(creators.id, [...new Set(aPosts.map((p) => p.creatorId))].concat("")))).map((c) => [c.id, c.name]),
  );
  const installs = inRange.reduce((a, b) => a + b.installs, 0);
  const revenueCents = inRange.reduce((a, b) => a + b.revenueCents, 0);
  return {
    rows: result.map((r) => ({ ...r, name: names.get(r.creatorId) ?? "?" })),
    totals: {
      installs,
      revenueCents,
      attributedRevenueCents: result.reduce((a, r) => a + r.estimate.revenueCents, 0),
      surveyResponses: surveyTotal,
      arpuCents: installs ? Math.round(revenueCents / installs) : 0,
    },
    granularity,
    from,
    to,
  };
}

/** In-app "where did you hear about us?" — the survey lists creator names plus generic options. */
export async function surveyOptions() {
  const roster = await db.select({ id: creators.id, name: creators.name }).from(creators).where(inArray(creators.stage, ["trial", "active"]));
  return roster.sort((a, b) => a.name.localeCompare(b.name));
}

export async function recordSurvey(p: { creatorId?: string | null; answer: string; appUserId?: string }) {
  invalidateAttribution();
  await db.insert(attributionEvents).values({ creatorId: p.creatorId ?? null, kind: "survey", surveyAnswer: p.answer, appUserId: p.appUserId, occurredAt: new Date() });
}

/** Survey answers in the window, split into creator names vs generic options. */
export async function surveyBreakdown(days = 60) {
  const from = new Date(Date.now() - days * DAY);
  const rows = await db
    .select({ answer: attributionEvents.surveyAnswer, creatorId: attributionEvents.creatorId })
    .from(attributionEvents)
    .where(and(eq(attributionEvents.kind, "survey"), gte(attributionEvents.occurredAt, from)));
  const by = new Map<string, { answer: string; creatorId: string | null; count: number }>();
  for (const r of rows) {
    const key = r.creatorId ? `c:${r.creatorId}` : `a:${(r.answer ?? "No answer").trim()}`;
    const x = by.get(key) ?? { answer: (r.answer ?? "No answer").trim(), creatorId: r.creatorId, count: 0 };
    x.count++;
    by.set(key, x);
  }
  const list = [...by.values()].sort((a, b) => b.count - a.count);
  return {
    total: rows.length,
    creatorTotal: list.filter((x) => x.creatorId).reduce((a, x) => a + x.count, 0),
    creators: list.filter((x) => x.creatorId),
    generic: list.filter((x) => !x.creatorId),
  };
}

/** Each roster creator's promo code and tracking-link performance in the window. */
export async function codeStats(days = 60) {
  const from = new Date(Date.now() - days * DAY);
  const roster = await db
    .select({ id: creators.id, name: creators.name, promoCode: creators.promoCode, stage: creators.stage })
    .from(creators)
    .where(inArray(creators.stage, ["trial", "active"]));
  const events = await db
    .select({ creatorId: attributionEvents.creatorId, kind: attributionEvents.kind, revenueCents: attributionEvents.revenueCents })
    .from(attributionEvents)
    .where(and(inArray(attributionEvents.kind, ["link_click", "link_install", "promo_redemption"]), gte(attributionEvents.occurredAt, from)));
  const by = new Map<string, { clicks: number; installs: number; redemptions: number; revenueCents: number }>();
  for (const e of events) {
    if (!e.creatorId) continue;
    const x = by.get(e.creatorId) ?? { clicks: 0, installs: 0, redemptions: 0, revenueCents: 0 };
    if (e.kind === "link_click") x.clicks++;
    if (e.kind === "link_install") x.installs++;
    if (e.kind === "promo_redemption") x.redemptions++;
    x.revenueCents += e.revenueCents;
    by.set(e.creatorId, x);
  }
  return roster
    .map((c) => ({ ...c, ...(by.get(c.id) ?? { clicks: 0, installs: 0, redemptions: 0, revenueCents: 0 }) }))
    .sort((a, b) => b.installs + b.redemptions - (a.installs + a.redemptions) || a.name.localeCompare(b.name));
}

/** Campaign post times (with credible views) for marking posts on the install chart. */
export async function campaignPostTimes(from: Date, to = new Date()) {
  const ps = await db
    .select({ id: posts.id, creatorId: posts.creatorId, postedAt: posts.postedAt, views: posts.views })
    .from(posts)
    .where(and(eq(posts.isCampaignPost, true), gte(posts.postedAt, from), lte(posts.postedAt, to)));
  const snaps = await snapshotsByPost(ps.map((p) => p.id));
  return ps.map((p) => ({ id: p.id, creatorId: p.creatorId, postedAt: p.postedAt.getTime(), credibleViews: snaps.get(p.id)?.at(-1)?.credibleViews ?? p.views }));
}
