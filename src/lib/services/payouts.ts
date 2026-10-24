import "server-only";
import { and, eq, gte, inArray, lt } from "drizzle-orm";
import { db, creators, posts, reviews, statements, referrals, contracts, attributionEvents, type LineItem } from "@/db";
import { buildStatement } from "@/lib/engines/rate-card";
import { needs1099, form1099Threshold } from "@/lib/engines/onboarding";
import { sendPayout } from "@/lib/integrations/payouts";
import { latestScores, rateCardFor, rulesOf, snapshotsByPost, windowViews, log, DAY } from "./common";

/**
 * Draft itemized statements for a period. Base pay covers approved videos posted in the
 * period; per-view pay + milestones settle once a video's view window has closed.
 * Referral bonuses and clawbacks are added as separate lines.
 */
export async function generateStatements(periodStart: string, periodEnd: string) {
  const start = new Date(`${periodStart}T00:00:00Z`);
  const end = new Date(`${periodEnd}T23:59:59Z`);
  const roster = await db.select().from(creators).where(inArray(creators.stage, ["trial", "active", "cut"]));
  const scores = await latestScores(roster.map((c) => c.id));
  const prior = await db.select().from(statements).where(inArray(statements.status, ["approved", "paid"]));
  const paidLines = new Map<string, Set<string>>(); // postId → kinds paid
  const paidBasesThisMonth = new Map<string, number>();
  const paidBasesEver = new Map<string, number>();
  const bonusesPaid = new Map<string, number>(); // milestone + signup cents, for the bonus cap
  const add = (m: Map<string, number>, k: string, n: number) => m.set(k, (m.get(k) ?? 0) + n);
  for (const s of prior) {
    for (const li of s.lineItems) {
      if (li.kind === "milestone" || li.kind === "signup") add(bonusesPaid, s.creatorId, li.amountCents);
      if (!li.postId) continue;
      const set = paidLines.get(li.postId) ?? new Set();
      set.add(li.kind);
      paidLines.set(li.postId, set);
    }
    const bases = s.lineItems.filter((l) => l.kind === "base").length;
    add(paidBasesEver, s.creatorId, bases);
    if (s.periodStart.slice(0, 7) === periodStart.slice(0, 7)) add(paidBasesThisMonth, s.creatorId, bases);
  }

  const created = [];
  for (const c of roster) {
    const card = await rateCardFor(c.rateCardId);
    const rules = rulesOf(card);
    const signed = await db.query.contracts.findFirst({ where: and(eq(contracts.creatorId, c.id), eq(contracts.status, "signed")) });
    const clawbackDays = signed?.terms.clawbackDays ?? 30;

    // Posts relevant to this period: posted in period (base) or window closed in period (performance).
    const earliest = new Date(start.getTime() - rules.viewWindowDays * DAY);
    const ps = await db.select().from(posts).where(and(eq(posts.creatorId, c.id), eq(posts.isCampaignPost, true), gte(posts.postedAt, earliest), lt(posts.postedAt, end)));
    if (!ps.length) continue;
    const reviewIds = ps.map((p) => p.reviewId).filter((x): x is string => Boolean(x));
    const approvedIds = new Set(reviewIds.length ? (await db.select({ id: reviews.id }).from(reviews).where(and(inArray(reviews.id, reviewIds), eq(reviews.status, "approved")))).map((r) => r.id) : []);
    const snaps = await snapshotsByPost(ps.map((p) => p.id));
    const signupsByPost = rules.signupBonusCents > 0 ? await signupsPerPost(c.id, ps.filter((p) => !p.removedAt && p.reviewId && approvedIds.has(p.reviewId)), rules.viewWindowDays) : new Map<string, number>();

    const payoutPosts = ps
      .filter((p) => !p.removedAt)
      .map((p) => {
        const closesAt = p.postedAt.getTime() + rules.viewWindowDays * DAY;
        const paid = paidLines.get(p.id);
        return {
          id: p.id,
          label: `${p.platform} ${p.postedAt.toISOString().slice(5, 10)}`,
          postedAt: p.postedAt,
          approved: Boolean(p.reviewId && approvedIds.has(p.reviewId)),
          windowViews: windowViews(snaps.get(p.id), rules.viewWindowDays, p.views),
          windowClosed: closesAt <= end.getTime(),
          basePaid: Boolean(paid?.has("base")) || p.postedAt < start,
          performancePaid: Boolean(paid?.has("cpm") || paid?.has("milestone") || paid?.has("signup")),
          windowSignups: signupsByPost.get(p.id) ?? 0,
        };
      });

    const extras: LineItem[] = [];
    // Clawbacks: deleted within the clawback window after we paid for it
    for (const p of ps.filter((x) => x.removedAt && x.removedAt.getTime() - x.postedAt.getTime() <= clawbackDays * DAY)) {
      const paidFor = prior.flatMap((s) => s.lineItems).filter((li) => li.postId === p.id && li.amountCents > 0);
      const already = prior.flatMap((s) => s.lineItems).some((li) => li.postId === p.id && li.kind === "clawback");
      const amt = paidFor.reduce((a, li) => a + li.amountCents, 0);
      if (amt > 0 && !already) extras.push({ kind: "clawback", postId: p.id, description: `Clawback — video removed within ${clawbackDays} days`, amountCents: -amt });
    }
    // Referral bonuses that qualified and haven't been paid
    const refs = await db.select().from(referrals).where(and(eq(referrals.referrerId, c.id), eq(referrals.status, "qualified")));
    for (const r of refs) {
      const friend = await db.query.creators.findFirst({ where: eq(creators.id, r.referredId) });
      extras.push({ kind: "referral", description: `Referral bonus — ${friend?.name ?? "friend"} became active`, amountCents: r.bonusCents });
    }

    const s = buildStatement({
      rules,
      typicalViews: scores.get(c.id)?.medianViews,
      tierFloor: c.tier,
      posts: payoutPosts,
      basePostsAlreadyPaid: (rules.quotaScope === "total" ? paidBasesEver : paidBasesThisMonth).get(c.id) ?? 0,
      bonusesAlreadyPaidCents: bonusesPaid.get(c.id) ?? 0,
      extras,
    });
    if (!s.lineItems.length) continue;

    await db.delete(statements).where(and(eq(statements.creatorId, c.id), eq(statements.periodStart, periodStart), eq(statements.periodEnd, periodEnd), eq(statements.status, "draft")));
    const [row] = await db
      .insert(statements)
      .values({ creatorId: c.id, periodStart, periodEnd, lineItems: s.lineItems, totalCents: s.totalCents, payoutProvider: c.payoutProvider })
      .returning();
    created.push(row);
  }
  await log("statements", `Drafted ${created.length} statements for ${periodStart} → ${periodEnd}`);
  return created;
}

/**
 * Waitlist signups through a creator's link, assigned to the earliest approved video whose view window
 * (posting time + window days) contains the signup, so overlapping windows never count one signup twice.
 * Signups outside every window aren't paid.
 */
async function signupsPerPost(creatorId: string, approved: { id: string; postedAt: Date }[], windowDays: number) {
  const out = new Map<string, number>();
  if (!approved.length) return out;
  const events = await db.select({ at: attributionEvents.occurredAt }).from(attributionEvents).where(and(eq(attributionEvents.creatorId, creatorId), eq(attributionEvents.kind, "signup")));
  const windows = [...approved].sort((a, b) => a.postedAt.getTime() - b.postedAt.getTime());
  for (const e of events) {
    const t = e.at.getTime();
    const post = windows.find((p) => t >= p.postedAt.getTime() && t < p.postedAt.getTime() + windowDays * DAY);
    if (post) out.set(post.id, (out.get(post.id) ?? 0) + 1);
  }
  return out;
}

export async function approveStatement(id: string) {
  await db.update(statements).set({ status: "approved", approvedAt: new Date() }).where(and(eq(statements.id, id), eq(statements.status, "draft")));
}

/** Pay an approved statement via the creator's chosen provider. Requires a submitted tax form. */
export async function payStatement(id: string) {
  const s = await db.query.statements.findFirst({ where: eq(statements.id, id) });
  if (!s || s.status !== "approved") throw new Error("Only approved statements can be paid");
  const c = await db.query.creators.findFirst({ where: eq(creators.id, s.creatorId) });
  if (!c?.payoutProvider || !c.payoutDestination) throw new Error(`${c?.name ?? "Creator"} hasn't set up a payout method`);
  const tax = await db.query.taxForms.findFirst({ where: (t, { and, eq, inArray }) => and(eq(t.creatorId, c.id), inArray(t.status, ["submitted", "verified"])) });
  if (!tax) throw new Error(`${c.name} hasn't submitted a ${c.country === "US" ? "W-9" : "W-8BEN"} yet`);

  const res = await sendPayout(c.payoutProvider, {
    statementId: s.id,
    amountCents: s.totalCents,
    currency: "USD",
    destination: c.payoutDestination,
    recipientName: tax.legalName ?? c.name,
    note: `Creator payout ${s.periodStart} to ${s.periodEnd}`,
  });
  if (res.status === "failed") {
    await db.update(statements).set({ status: "failed", payoutError: res.error }).where(eq(statements.id, id));
    throw new Error(res.error);
  }
  await db.update(statements).set({ status: "paid", paidAt: new Date(), payoutProvider: c.payoutProvider, payoutRef: res.ref, payoutError: null }).where(eq(statements.id, id));
  // Mark referral bonuses on this statement paid
  if (s.lineItems.some((l) => l.kind === "referral")) await db.update(referrals).set({ status: "paid" }).where(and(eq(referrals.referrerId, c.id), eq(referrals.status, "qualified")));
  await log("payout", `Paid ${c.name} $${(s.totalCents / 100).toFixed(2)} via ${c.payoutProvider}${res.status === "simulated" ? " (simulated)" : ""}`, c.id);
  return res;
}

/** Year-end 1099-NEC list for US creators. PayPal payouts are reported by PayPal on a 1099-K. */
export async function form1099Summary(year: number) {
  const paid = await db.select().from(statements).where(and(eq(statements.status, "paid"), gte(statements.paidAt, new Date(`${year}-01-01T00:00:00Z`)), lt(statements.paidAt, new Date(`${year + 1}-01-01T00:00:00Z`))));
  const byCreator = new Map<string, { total: number; tpso: number }>();
  for (const s of paid) {
    const r = byCreator.get(s.creatorId) ?? { total: 0, tpso: 0 };
    r.total += s.totalCents;
    if (s.payoutProvider === "paypal") r.tpso += s.totalCents;
    byCreator.set(s.creatorId, r);
  }
  const cs = byCreator.size ? await db.select().from(creators).where(inArray(creators.id, [...byCreator.keys()])) : [];
  const forms = cs.length ? await db.query.taxForms.findMany({ where: (t, { inArray }) => inArray(t.creatorId, cs.map((c) => c.id)) }) : [];
  return {
    threshold: form1099Threshold(year),
    rows: cs
      .map((c) => {
        const r = byCreator.get(c.id)!;
        const n = needs1099({ country: c.country, totalCents: r.total, tpsoCents: r.tpso, year });
        const form = forms.find((f) => f.creatorId === c.id && f.formType === "W-9");
        return { creator: c, totalCents: r.total, tpsoCents: r.tpso, reportableCents: n.reportableCents, required: n.required, w9: form ?? null };
      })
      .sort((a, b) => b.totalCents - a.totalCents),
  };
}

/**
 * Draft statements for a period, first clearing any older drafts that start on the same day
 * (e.g. a month-to-date draft from earlier in the month), so re-drafting never duplicates.
 * Approved and paid statements are never touched.
 */
export async function redraftStatements(periodStart: string, periodEnd: string) {
  await db.delete(statements).where(and(eq(statements.periodStart, periodStart), eq(statements.status, "draft")));
  return generateStatements(periodStart, periodEnd);
}

/** Approve every draft statement whose period starts in the given month (YYYY-MM). */
export async function approveAllDrafts(month: string) {
  const drafts = await db.select({ id: statements.id, periodStart: statements.periodStart }).from(statements).where(eq(statements.status, "draft"));
  const ids = drafts.filter((d) => d.periodStart.startsWith(month)).map((d) => d.id);
  for (const id of ids) await approveStatement(id);
  if (ids.length) await log("statements", `Approved ${ids.length} statements for ${month}`);
  return ids.length;
}

/** A failed payout goes back to approved so it can be retried (idempotent on statement id). */
export async function reopenFailedStatement(id: string) {
  await db.update(statements).set({ status: "approved", payoutError: null }).where(and(eq(statements.id, id), eq(statements.status, "failed")));
}

/** Statement with its creator, tax-form status and referenced posts, for the detail page. */
export async function statementDetail(id: string) {
  const s = await db.query.statements.findFirst({ where: eq(statements.id, id) });
  if (!s) return null;
  const creator = await db.query.creators.findFirst({ where: eq(creators.id, s.creatorId) });
  const tax = await db.query.taxForms.findFirst({ where: (t, { eq }) => eq(t.creatorId, s.creatorId), orderBy: (t, { desc }) => desc(t.createdAt) });
  const postIds = [...new Set(s.lineItems.map((l) => l.postId).filter((x): x is string => Boolean(x)))];
  const ps = postIds.length ? await db.select().from(posts).where(inArray(posts.id, postIds)) : [];
  return { statement: s, creator: creator ?? null, taxForm: tax ?? null, posts: new Map(ps.map((p) => [p.id, p])) };
}

/** Amount owed per creator (draft + approved + paid) on statements ending on or after a date. */
export async function spendByCreatorSince(fromIso: string) {
  const rows = await db
    .select({ creatorId: statements.creatorId, total: statements.totalCents })
    .from(statements)
    .where(and(inArray(statements.status, ["draft", "approved", "paid"]), gte(statements.periodEnd, fromIso)));
  const out = new Map<string, number>();
  for (const r of rows) out.set(r.creatorId, (out.get(r.creatorId) ?? 0) + r.total);
  return out;
}
