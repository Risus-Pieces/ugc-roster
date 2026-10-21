import { Suspense } from "react";
import Loading from "@/app/(app)/loading";
import Link from "next/link";
import { connection } from "next/server";
import { Card, Grid, PageHeader, Stat, Table, Td, Tabs, Badge, Empty, Meter, MarginBar, ConfidenceBadge, StageBadge, btn, btnDanger, btnSm, cx, type Tone } from "@/components/ui";
import { ActionForm, SubmitButton } from "@/components/client";
import { tierStatus, creatorEconomics } from "@/lib/services/decisions";
import { getOps } from "@/lib/settings";
import { compact, usd, usd2 } from "@/lib/format";
import { cutCreatorAction, promoteCreatorAction } from "./actions";

export const metadata = { title: "Profit check" };

const ACTIONS = ["promote", "keep", "cut", "evaluating"] as const;
type Action = (typeof ACTIONS)[number];
const ACTION_TONE: Record<Action, Tone> = { promote: "profit", keep: "neutral", cut: "loss", evaluating: "info" };

/** Own Suspense boundary: same-route navigations (tabs, filters) re-render below the (app) loading boundary. */
export default function DecisionsPage(props: { searchParams: Promise<{ action?: string }> }) {
  return (
    <Suspense fallback={<Loading />}>
      <DecisionsPageContent {...props} />
    </Suspense>
  );
}

async function DecisionsPageContent({ searchParams }: { searchParams: Promise<{ action?: string }> }) {
  await connection();
  const sp = await searchParams;
  const filter = (ACTIONS as readonly string[]).includes(sp.action ?? "") ? (sp.action as Action) : "all";

  const [econ, ops] = await Promise.all([creatorEconomics(), getOps()]);
  const ids = econ.map((e) => e.creatorId);
  const tiers = await tierStatus(ids);

  const judged = econ.filter((e) => e.views > 0);
  const totalViews = judged.reduce((a, e) => a + e.views, 0);
  const wavg = (f: (e: (typeof econ)[number]) => number) => (totalViews ? judged.reduce((a, e) => a + f(e) * e.views, 0) / totalViews : 0);
  const blendedRev = wavg((e) => e.revenuePer1kCents);
  const blendedCost = wavg((e) => e.decision.costPer1kCents);
  const blendedProfit = blendedRev - blendedCost;
  const counts = Object.fromEntries(ACTIONS.map((a) => [a, econ.filter((e) => e.decision.action === a).length])) as Record<Action, number>;
  const scale = Math.max(1, ...econ.map((e) => Math.max(e.revenuePer1kHigh, e.revenuePer1kCents, e.decision.costPer1kCents)));
  const rows = filter === "all" ? econ : econ.filter((e) => e.decision.action === filter);
  const minPosts = ops.decisionMinPosts;

  return (
    <>
      <PageHeader
        step="09 · Decide"
        title="Profit check"
        description={
          <>
            Revenue per 1,000 views minus what you pay per 1,000 views. <span className="font-medium text-ink">This is the number that matters.</span> A suggestion to promote, keep or cut appears once a creator has {minPosts} posts (20–30 is enough to judge).
          </>
        }
      />

      <Grid cols={5} className="mb-6">
        <Stat label="Blended profit per 1K views" value={usd2(blendedProfit)} tone={blendedProfit >= 0 ? "profit" : "loss"} hint={`${usd2(blendedRev)} revenue − ${usd2(blendedCost)} cost`} />
        <Stat label="Promote" value={counts.promote} tone={counts.promote ? "profit" : undefined} hint="profitable, healthy margin" />
        <Stat label="Keep" value={counts.keep} hint="fine, or not sure yet" />
        <Stat label="Cut" value={counts.cut} tone={counts.cut ? "loss" : undefined} hint="losing money, no upward trend" />
        <Stat label="Evaluating" value={counts.evaluating} hint={`under ${minPosts} posts`} />
      </Grid>

      <div className="overflow-x-auto">
        <Tabs
          active={filter}
          tabs={[
            { key: "all", label: "All", href: "/decisions", count: econ.length },
            ...ACTIONS.map((a) => ({ key: a, label: a[0].toUpperCase() + a.slice(1), href: `/decisions?action=${a}`, count: counts[a] })),
          ]}
        />
      </div>

      <Card flush>
        {rows.length === 0 ? (
          <div className="p-4">
            <Empty title={filter === "all" ? "No creators in trial or active" : `No creators to ${filter === "evaluating" ? "evaluate" : filter} right now`}>
              {filter === "all" ? "Move creators to trial on the Pipeline page. Their numbers show up here as they post." : "Check the other tabs."}
            </Empty>
          </div>
        ) : (
          <Table
            head={[
              "Creator",
              "Stage",
              { label: "Posts", align: "right" },
              { label: "Credible views", align: "right" },
              { label: "Paid", align: "right" },
              { label: "Revenue / 1K", align: "right" },
              { label: "Cost / 1K", align: "right" },
              "Profit per 1K",
              "Suggestion",
              "",
            ]}
          >
            {rows.map((e) => {
              const d = e.decision;
              const tier = tiers.get(e.creatorId)?.current;
              const next = tiers.get(e.creatorId)?.next ?? null;
              return (
                <tr key={e.creatorId} className="align-top hover:bg-sunken/60">
                  <Td className="whitespace-nowrap">
                    <Link href={`/creators/${e.creatorId}`} className="font-medium hover:underline">
                      {e.name}
                    </Link>
                    <div className="text-[13px] text-muted">{tier ?? "Standard"} tier</div>
                  </Td>
                  <Td>
                    <StageBadge stage={e.stage} />
                  </Td>
                  <Td right mono>
                    {d.action === "evaluating" ? (
                      <div className="ml-auto w-20">
                        <div className="mb-1">
                          {e.posts}/{minPosts}
                        </div>
                        <Meter value={e.posts} max={minPosts} tone="tally" />
                      </div>
                    ) : (
                      e.posts
                    )}
                  </Td>
                  <Td right mono>
                    {compact(e.views)}
                  </Td>
                  <Td right mono>
                    {usd(e.paidCents)}
                  </Td>
                  <Td right mono className="whitespace-nowrap">
                    <div>{usd2(e.revenuePer1kCents)}</div>
                    <div className="text-[12px] text-muted">
                      {usd2(e.revenuePer1kLow)}–{usd2(e.revenuePer1kHigh)}
                    </div>
                  </Td>
                  <Td right mono>
                    {usd2(d.costPer1kCents)}
                  </Td>
                  <Td>
                    {e.views > 0 ? (
                      <>
                        <MarginBar revenue={e.revenuePer1kCents} cost={d.costPer1kCents} scale={scale} low={e.revenuePer1kLow} high={e.revenuePer1kHigh} />
                        {d.marginPct !== null && <div className="num mt-0.5 text-[12px] text-muted">{d.marginPct}% margin{d.trendPct !== null && ` · views ${d.trendPct >= 0 ? "+" : ""}${d.trendPct}%`}</div>}
                      </>
                    ) : (
                      <span className="text-[13px] text-muted">No views yet</span>
                    )}
                  </Td>
                  <Td>
                    <details className="group">
                      <summary className="cursor-pointer list-none whitespace-nowrap">
                        <Badge tone={ACTION_TONE[d.action]}>{d.action}</Badge>
                        <span className="ml-1 text-[12px] text-muted group-open:hidden">why</span>
                      </summary>
                      <ul className="mt-1.5 w-[240px] list-disc space-y-0.5 pl-4 text-[13px] text-ink-2">
                        {d.reasons.map((r) => (
                          <li key={r}>{r}</li>
                        ))}
                      </ul>
                    </details>
                    <div className="mt-1">
                      <ConfidenceBadge level={e.confidence} />
                    </div>
                  </Td>
                  <Td right>
                    <div className="flex items-start justify-end gap-1.5">
                      <ActionForm action={promoteCreatorAction}>
                        <input type="hidden" name="id" value={e.creatorId} />
                        <SubmitButton variant={d.action === "promote" ? "primary" : "default"} className={btnSm} disabled={!next} title={next ? `Move to the ${next} tier on their rate card` : "Already on the top tier"} pendingText="…">
                          {next ? "Promote" : "Top tier"}
                        </SubmitButton>
                      </ActionForm>
                      <details className="group/cut text-left">
                        <summary className={cx(d.action === "cut" ? btnDanger : btn, btnSm, "cursor-pointer list-none")}>Cut</summary>
                        <div className="mt-1.5 w-56 rounded-md border border-line bg-sunken p-2.5">
                          <p className="mb-2 text-[13px] text-ink-2">Move {e.name} to cut? They stop getting briefs. Videos already posted still settle on their next statement.</p>
                          <ActionForm action={cutCreatorAction}>
                            <input type="hidden" name="id" value={e.creatorId} />
                            <input type="hidden" name="name" value={e.name} />
                            <SubmitButton className={cx(btnSm, "w-full !border-loss !text-loss hover:!bg-loss-soft")} pendingText="Cutting…">
                              Confirm cut
                            </SubmitButton>
                          </ActionForm>
                        </div>
                      </details>
                    </div>
                  </Td>
                </tr>
              );
            })}
          </Table>
        )}
      </Card>

      <p className="mt-3 text-[13px] text-muted">
        Revenue per 1K comes from the last 90 days of{" "}
        <Link href="/attribution" className="underline">
          attribution
        </Link>{" "}
        (range across methods). Cost per 1K is everything owed on statements (draft, approved and paid) divided by credible views on all their campaign posts. Promoting moves a creator to the next tier on their rate card. Forecast what more creators would cost on the{" "}
        <Link href="/decisions/forecast" className="underline">
          Forecast
        </Link>{" "}
        page.
      </p>
    </>
  );
}
