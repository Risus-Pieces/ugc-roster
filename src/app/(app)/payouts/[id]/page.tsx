import { Suspense } from "react";
import Loading from "@/app/(app)/loading";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import type { LineItem } from "@/db";
import { Card, PageHeader, Table, Td, Badge, Notice, PlatformTag, cx, type Tone } from "@/components/ui";
import { ActionForm, SubmitButton } from "@/components/client";
import { statementDetail } from "@/lib/services/payouts";
import { usd2, dateTime } from "@/lib/format";
import { approveStatementAction, payStatementAction, reopenStatementAction } from "../actions";
import { providerInfo, shortDate } from "../shared";

export const metadata = { title: "Statement" };

const KIND: Record<LineItem["kind"], string> = {
  base: "Base",
  cpm: "Per-view",
  milestone: "Milestone",
  signup: "Signup bonus",
  referral: "Referral",
  clawback: "Clawback",
  cap_adjustment: "Cap adjustment",
};
const KIND_ORDER: LineItem["kind"][] = ["base", "cpm", "milestone", "signup", "referral", "clawback", "cap_adjustment"];
const STATUS_TONE: Record<string, Tone> = { draft: "tally", approved: "info", paid: "profit", failed: "loss" };

/** Own Suspense boundary: same-route navigations (tabs, filters) re-render below the (app) loading boundary. */
export default function StatementPage(props: { params: Promise<{ id: string }> }) {
  return (
    <Suspense fallback={<Loading />}>
      <StatementPageContent {...props} />
    </Suspense>
  );
}

async function StatementPageContent({ params }: { params: Promise<{ id: string }> }) {
  await connection();
  const { id } = await params;
  const d = await statementDetail(id);
  if (!d) notFound();
  const { statement: s, creator: c, taxForm, posts } = d;

  const prov = providerInfo(s.status === "paid" ? s.payoutProvider : (c?.payoutProvider ?? s.payoutProvider));
  const taxOk = taxForm && ["submitted", "verified"].includes(taxForm.status);
  const methodOk = Boolean(c?.payoutProvider && c?.payoutDestination);
  const subtotals = KIND_ORDER.map((k) => ({ k, n: s.lineItems.filter((l) => l.kind === k).length, cents: s.lineItems.filter((l) => l.kind === k).reduce((a, l) => a + l.amountCents, 0) })).filter((x) => x.n > 0);
  const items = [...s.lineItems].sort((a, b) => KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind));
  const expectedForm = c?.country?.toUpperCase() === "US" ? "W-9" : "W-8BEN";

  return (
    <>
      <div className="mb-3">
        <Link href={`/payouts?period=${s.periodStart.slice(0, 7)}`} className="text-[13px] text-ink-2 hover:text-ink">
          ← Statements
        </Link>
      </div>
      <PageHeader
        step="08 · Pay"
        title={c?.name ?? "Unknown creator"}
        description={
          <span className="inline-flex flex-wrap items-center gap-2">
            <span className="num">
              {shortDate(s.periodStart)} – {shortDate(s.periodEnd)}
            </span>
            <Badge tone={STATUS_TONE[s.status]}>{s.status}</Badge>
            {c && (
              <Link href={`/creators/${c.id}`} className="text-[14px] underline">
                Creator profile
              </Link>
            )}
          </span>
        }
        actions={<div className="font-display text-[28px] font-medium tabular-nums">{usd2(s.totalCents)}</div>}
      />

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="min-w-0 space-y-4">
          <div className="flex flex-wrap gap-2">
            {subtotals.map((x) => (
              <div key={x.k} className="rounded-md border border-line bg-panel px-3 py-2">
                <div className="text-[12px] text-muted">
                  {KIND[x.k]} <span className="num">×{x.n}</span>
                </div>
                <div className={cx("num text-[16px] font-medium", x.cents < 0 && "text-loss")}>{usd2(x.cents)}</div>
              </div>
            ))}
          </div>

          <Card title="Line items" flush>
            {items.length === 0 ? (
              <p className="p-4 text-ink-2">This statement has no line items.</p>
            ) : (
              <Table head={["Type", "Description", "Video", { label: "Amount", align: "right" }]}>
                {items.map((l, i) => {
                  const p = l.postId ? posts.get(l.postId) : undefined;
                  return (
                    <tr key={i}>
                      <Td>
                        <Badge tone={l.kind === "clawback" || l.kind === "cap_adjustment" ? "loss" : l.kind === "referral" || l.kind === "milestone" ? "info" : "neutral"}>{KIND[l.kind]}</Badge>
                      </Td>
                      <Td className="text-ink-2">{l.description}</Td>
                      <Td className="whitespace-nowrap">
                        {p ? (
                          <span className="inline-flex items-center gap-1.5">
                            <PlatformTag platform={p.platform} />
                            {p.url ? (
                              <a href={p.url} target="_blank" rel="noopener noreferrer" className="text-[13px] text-ink-2 hover:text-ink">
                                Open ↗
                              </a>
                            ) : (
                              <span className="text-[13px] text-muted">no link</span>
                            )}
                            {p.removedAt && <span className="text-[13px] text-loss">removed</span>}
                          </span>
                        ) : (
                          <span className="text-muted">—</span>
                        )}
                      </Td>
                      <Td right mono className={cx("whitespace-nowrap", l.amountCents < 0 && "text-loss")}>
                        {usd2(l.amountCents)}
                      </Td>
                    </tr>
                  );
                })}
                <tr className="border-t-2 border-line-strong">
                  <Td className="font-medium">Total</Td>
                  <Td className="text-[13px] text-muted">Totals never go below $0.</Td>
                  <Td />
                  <Td right mono className="text-[16px] font-medium">
                    {usd2(s.totalCents)}
                  </Td>
                </tr>
              </Table>
            )}
          </Card>
          <p className="text-[13px] text-muted">
            Per-view pay uses credible views (bots and paid boosts removed) when each video&apos;s view window closes. Caps apply per video, then per month.{" "}
            <Link href="/payouts/rate-cards" className="underline">
              Rate card
            </Link>
          </p>
        </div>

        <div className="space-y-4">
          <Card title="Payment">
            <ol className="mb-4 space-y-2 text-[14px]">
              <Step done label="Drafted" at={s.createdAt} />
              <Step done={Boolean(s.approvedAt)} label="Approved" at={s.approvedAt} />
              <Step done={s.status === "paid"} label={s.status === "failed" ? "Payment failed" : "Paid"} at={s.paidAt} failed={s.status === "failed"} />
            </ol>

            <dl className="mb-4 space-y-1.5 border-t border-line pt-3 text-[14px]">
              <Row label="Payout method">
                {methodOk && prov ? (
                  <span className="inline-flex items-center gap-1.5">
                    {prov.name}
                    <Badge tone={prov.live ? "profit" : "neutral"}>{prov.live ? "live" : "simulated"}</Badge>
                  </span>
                ) : (
                  <span className="text-tally">Not set up</span>
                )}
              </Row>
              <Row label="Tax form">
                {taxOk ? (
                  <span>
                    {taxForm!.formType} · {taxForm!.status}
                  </span>
                ) : (
                  <span className="text-tally">{expectedForm} {taxForm ? taxForm.status : "missing"}</span>
                )}
              </Row>
              {s.payoutRef && (
                <Row label="Reference">
                  <span className="num text-[13px]">{s.payoutRef}</span>
                </Row>
              )}
            </dl>

            {s.status === "draft" && (
              <>
                <ActionForm action={approveStatementAction}>
                  <input type="hidden" name="id" value={s.id} />
                  <SubmitButton variant="primary" className="w-full" pendingText="Approving…">
                    Approve {usd2(s.totalCents)}
                  </SubmitButton>
                </ActionForm>
                <p className="mt-2 text-[13px] text-muted">Approving locks this amount. No money moves until you press Pay.</p>
              </>
            )}

            {s.status === "approved" && (
              <>
                {(!methodOk || !taxOk) && (
                  <div className="mb-3">
                    <Notice tone="tally">
                      {!methodOk ? `${c?.name ?? "This creator"} needs to add a payout method in their portal before you can pay.` : `${c?.name ?? "This creator"} needs to submit a ${expectedForm} before you can pay.`}
                    </Notice>
                  </div>
                )}
                <ActionForm action={payStatementAction}>
                  <input type="hidden" name="id" value={s.id} />
                  <SubmitButton variant="primary" className="w-full" disabled={!methodOk || !taxOk} pendingText="Paying…">
                    Pay {usd2(s.totalCents)}
                    {prov ? ` via ${prov.name}` : ""}
                  </SubmitButton>
                </ActionForm>
                <p className="mt-2 text-[13px] text-muted">
                  {prov?.live ? `Sends real money through ${prov.name}. Retries are safe: the payout is keyed to this statement, so it can't be paid twice.` : `${prov?.name ?? "The provider"} isn't connected (${prov?.env ?? "credentials missing"}), so this will be recorded as a simulated payment. No money moves.`}
                </p>
              </>
            )}

            {s.status === "failed" && (
              <>
                <div className="mb-3">
                  <Notice tone="loss">{s.payoutError ?? "The payout failed."}</Notice>
                </div>
                <ActionForm action={reopenStatementAction}>
                  <input type="hidden" name="id" value={s.id} />
                  <SubmitButton className="w-full" pendingText="Moving…">
                    Move back to approved to retry
                  </SubmitButton>
                </ActionForm>
              </>
            )}

            {s.status === "paid" && (
              <Notice tone="profit">
                Paid {usd2(s.totalCents)}
                {prov ? ` via ${prov.name}` : ""} on {dateTime(s.paidAt)}
                {s.payoutRef?.startsWith("sim_") ? " (simulated, no money moved)" : ""}.
              </Notice>
            )}
          </Card>
        </div>
      </div>
    </>
  );
}

function Step({ done, label, at, failed }: { done: boolean; label: string; at: Date | null; failed?: boolean }) {
  return (
    <li className="flex items-center gap-2">
      <span className={cx("h-2.5 w-2.5 rounded-full border", failed ? "border-loss bg-loss" : done ? "border-profit bg-profit" : "border-line-strong bg-panel")} />
      <span className={cx("flex-1", !done && !failed && "text-muted")}>{label}</span>
      <span className="num text-[13px] text-muted">{at ? dateTime(at) : "—"}</span>
    </li>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <dt className="text-ink-2">{label}</dt>
      <dd className="text-right">{children}</dd>
    </div>
  );
}
