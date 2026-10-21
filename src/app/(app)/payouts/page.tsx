import { Suspense } from "react";
import Loading from "@/app/(app)/loading";
import Link from "next/link";
import { connection } from "next/server";
import { desc, inArray } from "drizzle-orm";
import { db, creators, statements, type Statement } from "@/db";
import { Card, Grid, PageHeader, Stat, Table, Td, Notice, Empty, Badge, btn, btnSm, input, cx } from "@/components/ui";
import { ActionForm, SubmitButton } from "@/components/client";
import { usd2, relative } from "@/lib/format";
import { draftStatementsAction, approveAllDraftsAction } from "./actions";
import { providerInfo, monthPeriod, shiftMonth, monthLabel, shortDate, STATUS_ORDER, STATUS_LABEL, PROVIDER_NAME } from "./shared";

export const metadata = { title: "Statements" };

/** Own Suspense boundary: same-route navigations (tabs, filters) re-render below the (app) loading boundary. */
export default function PayoutsPage(props: { searchParams: Promise<{ period?: string }> }) {
  return (
    <Suspense fallback={<Loading />}>
      <PayoutsPageContent {...props} />
    </Suspense>
  );
}

async function PayoutsPageContent({ searchParams }: { searchParams: Promise<{ period?: string }> }) {
  await connection();
  const sp = await searchParams;
  const thisMonth = new Date().toISOString().slice(0, 7);
  const month = /^\d{4}-(0[1-9]|1[0-2])$/.test(sp.period ?? "") ? sp.period! : thisMonth;
  const period = monthPeriod(month);
  const lastMonth = shiftMonth(thisMonth, -1);

  const all = await db.select().from(statements).orderBy(desc(statements.createdAt));
  const inPeriod = all.filter((s) => s.periodStart.startsWith(month));
  const elsewhere = all.filter((s) => !s.periodStart.startsWith(month) && s.status !== "paid");
  const ids = [...new Set(inPeriod.map((s) => s.creatorId))];
  const cs = ids.length ? await db.select({ id: creators.id, name: creators.name, payoutProvider: creators.payoutProvider }).from(creators).where(inArray(creators.id, ids)) : [];
  const creatorOf = new Map(cs.map((c) => [c.id, c]));

  const byStatus = new Map(STATUS_ORDER.map((st) => [st, inPeriod.filter((s) => s.status === st)]));
  const sum = (xs: Statement[]) => xs.reduce((a, s) => a + s.totalCents, 0);
  const drafts = byStatus.get("draft")!;
  const otherMonths = [...new Set(elsewhere.map((s) => s.periodStart.slice(0, 7)))].sort().reverse();
  const providers = (["wise", "paypal", "stripe"] as const).map((p) => providerInfo(p)!);
  const anyLive = providers.some((p) => p.live);

  return (
    <>
      <PageHeader
        step="08 · Pay"
        title="Statements"
        description="Itemized statements per creator: base pay for approved videos, per-view pay once each video's view window closes, milestones, referral bonuses and clawbacks."
        actions={
          <form method="get" action="/payouts" className="flex flex-wrap items-center justify-end gap-2">
            <Link href={`/payouts?period=${thisMonth}`} className={cx(btn, btnSm, month === thisMonth && "bg-sunken")}>
              This month
            </Link>
            <Link href={`/payouts?period=${lastMonth}`} className={cx(btn, btnSm, month === lastMonth && "bg-sunken")}>
              Last month
            </Link>
            <input type="month" name="period" defaultValue={month} max={thisMonth} className={cx(input, "!w-40 py-1")} aria-label="Statement month" />
            <button type="submit" className={cx(btn, btnSm)}>
              Show
            </button>
          </form>
        }
      />

      <div className="mb-4">
        <Notice tone="tally">
          <span className="font-medium">Money only moves after approval.</span> Drafting builds itemized statements and sends nothing. Approve a statement to lock its amount, then press Pay on it to send the money.{" "}
          {anyLive ? "Providers marked live send real money." : "No payout provider is connected yet, so payments are simulated."}
        </Notice>
      </div>

      <Grid cols={4} className="mb-6">
        <Stat label="Drafts" value={usd2(sum(drafts))} hint={`${drafts.length} statements to review`} tone={drafts.length ? "tally" : undefined} />
        <Stat label="Approved, not paid" value={usd2(sum(byStatus.get("approved")!))} hint={`${byStatus.get("approved")!.length} statements`} />
        <Stat label="Paid" value={usd2(sum(byStatus.get("paid")!))} hint={`${byStatus.get("paid")!.length} statements`} />
        <Stat label="Failed" value={byStatus.get("failed")!.length} tone={byStatus.get("failed")!.length ? "loss" : undefined} hint="payouts to retry" />
      </Grid>

      <Card title={monthLabel(month)} className="mb-4">
        {period.future ? (
          <p className="text-ink-2">This month hasn&apos;t started. Pick this month or an earlier one.</p>
        ) : (
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="max-w-xl text-[14px] text-ink-2">
              Period <span className="num text-ink">{shortDate(period.start)} – {shortDate(period.end)}</span>
              {period.monthToDate && " (month to date)"}. Drafting again replaces this month&apos;s drafts; approved and paid statements are never changed.
            </div>
            <div className="flex flex-wrap items-start gap-2">
              <ActionForm action={draftStatementsAction}>
                <input type="hidden" name="start" value={period.start} />
                <input type="hidden" name="end" value={period.end} />
                <SubmitButton variant={drafts.length ? "default" : "primary"} pendingText="Drafting…">
                  {drafts.length ? "Redraft statements" : "Draft statements for period"}
                </SubmitButton>
              </ActionForm>
              {drafts.length > 0 && (
                <ActionForm action={approveAllDraftsAction}>
                  <input type="hidden" name="month" value={month} />
                  <SubmitButton variant="primary" pendingText="Approving…">
                    Approve all {drafts.length} drafts ({usd2(sum(drafts))})
                  </SubmitButton>
                </ActionForm>
              )}
            </div>
          </div>
        )}
      </Card>

      {otherMonths.length > 0 && (
        <div className="mb-4">
          <Notice tone="info">
            Unpaid statements in other months:{" "}
            {otherMonths.map((m, i) => (
              <span key={m}>
                {i > 0 && " · "}
                <Link href={`/payouts?period=${m}`} className="font-medium underline">
                  {monthLabel(m)} ({elsewhere.filter((s) => s.periodStart.startsWith(m)).length})
                </Link>
              </span>
            ))}
          </Notice>
        </div>
      )}

      {inPeriod.length === 0 ? (
        <Empty title={`No statements for ${monthLabel(month)}`}>
          {period.future ? "Pick an earlier month." : "Press Draft statements for period to build them from approved campaign posts. Nothing is paid until you approve."}
        </Empty>
      ) : (
        <div className="space-y-4">
          {STATUS_ORDER.map((st) => {
            const list = byStatus.get(st)!;
            if (!list.length) return null;
            return (
              <Card key={st} title={`${STATUS_LABEL[st]} · ${list.length}`} action={<span className="num text-[13px] text-ink-2">{usd2(sum(list))}</span>} flush>
                <Table head={["Creator", "Period", { label: "Lines", align: "right" }, { label: "Total", align: "right" }, "Provider", st === "paid" ? "Paid" : st === "approved" ? "Approved" : "Drafted", ""]}>
                  {list.map((s) => {
                    const c = creatorOf.get(s.creatorId);
                    const prov = providerInfo(st === "paid" ? s.payoutProvider : (c?.payoutProvider ?? s.payoutProvider));
                    return (
                      <tr key={s.id} className="hover:bg-sunken/60">
                        <Td className="whitespace-nowrap">
                          <Link href={`/payouts/${s.id}`} className="font-medium hover:underline">
                            {c?.name ?? "Unknown creator"}
                          </Link>
                        </Td>
                        <Td mono className="whitespace-nowrap text-[13px] text-ink-2">
                          {shortDate(s.periodStart)} – {shortDate(s.periodEnd)}
                        </Td>
                        <Td right mono>
                          {s.lineItems.length}
                        </Td>
                        <Td right mono className="font-medium">
                          {usd2(s.totalCents)}
                        </Td>
                        <Td className="whitespace-nowrap">
                          {prov ? (
                            <span className="inline-flex items-center gap-1.5">
                              {PROVIDER_NAME[prov.key]}
                              {st !== "paid" && <Badge tone={prov.live ? "profit" : "neutral"}>{prov.live ? "live" : "simulated"}</Badge>}
                            </span>
                          ) : (
                            <span className="text-tally">No payout method</span>
                          )}
                          {st === "failed" && s.payoutError && <div className="max-w-[260px] truncate text-[13px] text-loss" title={s.payoutError}>{s.payoutError}</div>}
                        </Td>
                        <Td mono className="whitespace-nowrap text-[13px] text-muted">
                          {relative(st === "paid" ? s.paidAt : st === "approved" ? s.approvedAt : s.createdAt)}
                        </Td>
                        <Td right>
                          <Link href={`/payouts/${s.id}`} className={cx(btn, btnSm)}>
                            {st === "draft" ? "Review" : st === "approved" ? "Pay →" : st === "failed" ? "Fix" : "View"}
                          </Link>
                        </Td>
                      </tr>
                    );
                  })}
                </Table>
              </Card>
            );
          })}
        </div>
      )}

      <p className="mt-6 text-[13px] text-muted">
        Payout providers:{" "}
        {providers.map((p, i) => (
          <span key={p.key}>
            {i > 0 && " · "}
            {p.name} <span className={p.live ? "text-profit" : ""}>{p.live ? "live" : `simulated (set ${p.env})`}</span>
          </span>
        ))}
        . <Link href="/payouts/rate-cards" className="underline">Rate cards</Link> · <Link href="/payouts/tax" className="underline">Tax &amp; 1099s</Link>
      </p>
    </>
  );
}
