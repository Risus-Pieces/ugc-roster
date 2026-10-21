import Link from "next/link";
import { connection } from "next/server";
import { and, asc, eq, gte, ne } from "drizzle-orm";
import { db, calls, contracts, creatorAccounts, creators, messages, statements, STAGES, type Stage } from "@/db";
import { Card, Empty, PageHeader, PlatformTag, StageBadge, Table, Td, btnSm, cx } from "@/components/ui";
import { ActionForm, SubmitButton } from "@/components/client";
import { latestScores } from "@/lib/services/common";
import { compact, dateTime, pct, relative } from "@/lib/format";
import { moveStageAction } from "./actions";
import { requestTime } from "../creators/bits";
import { Villager } from "@/components/sprites";

export const metadata = { title: "Pipeline" };

const DAY = 86_400_000;
const COLUMNS = ["contacted", "replied", "trial", "active", "cut"] as const satisfies readonly Stage[];
const FUNNEL = ["prospect", "contacted", "replied", "trial", "active"] as const;
const PER_COLUMN = 40;

/** Days in stage after which a card needs a nudge. */
const STALE: Partial<Record<Stage, number>> = { contacted: 5, replied: 3 };
const HINT: Record<(typeof COLUMNS)[number], string> = {
  contacted: "Follow up after 5 days",
  replied: "Answer within 3 days",
  trial: "Contract, tax form, warm-up",
  active: "Posting and paid",
  cut: "Ended",
};

export default async function PipelinePage() {
  await connection();
  const now = requestTime();
  const [all, accts, outbound, inbound, contractRows, statementRows, upcoming] = await Promise.all([
    db
      .select({ id: creators.id, name: creators.name, stage: creators.stage, stageChangedAt: creators.stageChangedAt, createdAt: creators.createdAt, warmupStartedAt: creators.warmupStartedAt })
      .from(creators),
    db.select({ creatorId: creatorAccounts.creatorId, platform: creatorAccounts.platform, followers: creatorAccounts.followers }).from(creatorAccounts),
    db
      .selectDistinct({ creatorId: messages.creatorId })
      .from(messages)
      .where(and(eq(messages.direction, "out"), ne(messages.status, "draft"))),
    db.selectDistinct({ creatorId: messages.creatorId }).from(messages).where(eq(messages.direction, "in")),
    db.selectDistinct({ creatorId: contracts.creatorId }).from(contracts),
    db.selectDistinct({ creatorId: statements.creatorId }).from(statements),
    db
      .select({ id: calls.id, scheduledAt: calls.scheduledAt, link: calls.link, creatorId: calls.creatorId, name: creators.name, stage: creators.stage })
      .from(calls)
      .innerJoin(creators, eq(creators.id, calls.creatorId))
      .where(and(eq(calls.status, "booked"), gte(calls.scheduledAt, new Date(now - 2 * 3600_000))))
      .orderBy(asc(calls.scheduledAt)),
  ]);
  const inPipeline = all.filter((c) => c.stage !== "prospect");
  const scores = await latestScores(inPipeline.map((c) => c.id));

  const platformBy = new Map<string, { platform: string; followers: number }>();
  for (const a of accts) if ((platformBy.get(a.creatorId)?.followers ?? -1) < a.followers) platformBy.set(a.creatorId, a);

  // How far each creator got. Cut creators are placed by evidence: statement → active, contract → trial, reply → replied, sent email → contacted.
  const has = (rows: { creatorId: string }[]) => new Set(rows.map((r) => r.creatorId));
  const [sent, got, contracted, paid] = [has(outbound), has(inbound), has(contractRows), has(statementRows)];
  const furthest = (c: (typeof all)[number]) => {
    if (c.stage !== "cut") return FUNNEL.indexOf(c.stage as (typeof FUNNEL)[number]);
    if (paid.has(c.id)) return 4;
    if (contracted.has(c.id) || c.warmupStartedAt) return 3;
    if (got.has(c.id)) return 2;
    if (sent.has(c.id)) return 1;
    return 0;
  };
  const reached = FUNNEL.map((_, i) => all.filter((c) => furthest(c) >= i).length);

  const daysIn = (c: (typeof all)[number]) => Math.max(0, Math.floor((now - (c.stageChangedAt ?? c.createdAt).getTime()) / DAY));
  const prospects = all.length - inPipeline.length;

  return (
    <>
      <PageHeader
        step="02 · Reach"
        title="Pipeline"
        description={
          <>
            Contacted → replied → trial → active. <span className="num">{prospects}</span> prospects not yet contacted are kept in{" "}
            <Link href="/creators?stage=prospect" className="underline decoration-line-strong underline-offset-2 hover:text-ink">
              Creators
            </Link>
            .
          </>
        }
      />

      <div className="mb-6 grid gap-4 lg:grid-cols-[1fr_380px]">
        <Card title="Conversion" action={<span className="text-[13px] text-muted">share who reached the next stage</span>}>
          <ol className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {FUNNEL.slice(1).map((s, j) => {
              const i = j + 1;
              const rate = i > 1 && reached[i - 1] ? reached[i] / reached[i - 1] : null;
              return (
                <li key={s} className="rounded-md bg-sunken px-3 py-2">
                  <div className="text-[13px] capitalize text-muted">{s}</div>
                  <div className="font-display text-[20px] font-medium tabular-nums">{reached[i]}</div>
                  <div className="text-[12px] font-bold leading-tight text-ink-2">{rate === null ? "reached out" : `${pct(rate, 0)} of ${FUNNEL[i - 1]}`}</div>
                </li>
              );
            })}
          </ol>
          <p className="mt-3 text-[13px] text-muted">
            Contacted to active: <span className="num text-ink-2">{reached[1] ? pct(reached[4] / reached[1], 0) : "—"}</span>. Referral sign-ups enter at replied. Cut creators count toward the
            furthest stage they reached.
          </p>
        </Card>

        <Card title="Upcoming calls" action={<span className="num text-[13px] text-muted">{upcoming.length}</span>} flush>
          {upcoming.length === 0 ? (
            <p className="p-4 text-ink-2">
              No calls booked. Book one from a reply in{" "}
              <Link href="/outreach" className="underline underline-offset-2">
                Outreach
              </Link>
              .
            </p>
          ) : (
            <Table head={["When", "Creator", "Link"]}>
              {upcoming.map((c) => (
                <tr key={c.id}>
                  <Td>
                    <div className="num whitespace-nowrap">{dateTime(c.scheduledAt)}</div>
                    <div className="num text-[12px] text-muted">{relative(c.scheduledAt, now)}</div>
                  </Td>
                  <Td>
                    <Link href={`/creators/${c.creatorId}`} className="font-medium hover:underline">
                      {c.name}
                    </Link>
                    <div>
                      <StageBadge stage={c.stage} />
                    </div>
                  </Td>
                  <Td>
                    {c.link ? (
                      <a href={c.link} target="_blank" rel="noreferrer" className="text-[13px] hover:underline">
                        Join
                      </a>
                    ) : (
                      <span className="text-muted">—</span>
                    )}
                  </Td>
                </tr>
              ))}
            </Table>
          )}
        </Card>
      </div>

      <div className="grid auto-cols-[minmax(200px,1fr)] grid-flow-col gap-3 overflow-x-auto pb-2">
        {COLUMNS.map((stage) => {
          const cards = inPipeline.filter((c) => c.stage === stage).sort((a, b) => daysIn(b) - daysIn(a));
          const idx = STAGES.indexOf(stage);
          const prev = STAGES[idx - 1];
          const next = STAGES[idx + 1];
          return (
            <section key={stage} className="flex min-w-0 flex-col rounded-lg border border-line bg-sunken/60">
              <header className="border-b border-line px-3 py-2">
                <div className="flex items-center justify-between">
                  <h2 className="text-[14px] font-semibold capitalize">{stage}</h2>
                  <span className="num text-[13px] text-muted">{cards.length}</span>
                </div>
                <div className="text-[12px] text-muted">{HINT[stage]}</div>
              </header>
              {cards.length === 0 ? (
                <p className="px-3 py-4 text-[13px] text-muted">{stage === "contacted" ? "Send openers from Outreach to fill this column." : "Nobody here."}</p>
              ) : (
                <ul className="space-y-2 p-2">
                  {cards.slice(0, PER_COLUMN).map((c) => {
                    const d = daysIn(c);
                    const stale = STALE[stage] !== undefined && d >= STALE[stage]!;
                    const p = platformBy.get(c.id);
                    const s = scores.get(c.id);
                    return (
                      <li key={c.id} className="rounded-md border border-line bg-panel p-2.5">
                        <div className="flex items-start justify-between gap-2">
                          <Link href={`/creators/${c.id}`} className="flex min-w-0 items-center gap-1.5 font-bold hover:underline">
                            <Villager seed={c.id} scale={2} />
                            <span className="truncate">{c.name}</span>
                          </Link>
                          {p && <PlatformTag platform={p.platform} />}
                        </div>
                        <div className="mt-0.5 flex items-center justify-between text-[13px]">
                          <span className="num text-ink-2">{s ? `${compact(s.medianViews)} median` : "not scored"}</span>
                          <span className={cx("num", stale ? "font-medium text-tally" : "text-muted")} title={stale ? `Over ${STALE[stage]} days in ${stage}` : undefined}>
                            {d}d in stage
                          </span>
                        </div>
                        <div className="mt-2 flex items-start justify-between gap-1">
                          {prev ? (
                            <ActionForm action={moveStageAction}>
                              <input type="hidden" name="creatorId" value={c.id} />
                              <input type="hidden" name="stage" value={prev} />
                              <SubmitButton className={cx(btnSm, "text-ink-2")} pendingText="Moving…">
                                ← {prev}
                              </SubmitButton>
                            </ActionForm>
                          ) : (
                            <span />
                          )}
                          {next && (
                            <ActionForm action={moveStageAction}>
                              <input type="hidden" name="creatorId" value={c.id} />
                              <input type="hidden" name="stage" value={next} />
                              <SubmitButton className={btnSm} pendingText="Moving…">
                                {next} →
                              </SubmitButton>
                            </ActionForm>
                          )}
                        </div>
                      </li>
                    );
                  })}
                  {cards.length > PER_COLUMN && (
                    <li className="px-1 text-[13px]">
                      <Link href={`/creators?stage=${stage}`} className="text-ink-2 hover:text-ink">
                        +{cards.length - PER_COLUMN} more →
                      </Link>
                    </li>
                  )}
                </ul>
              )}
            </section>
          );
        })}
      </div>
      {inPipeline.length === 0 && (
        <div className="mt-4">
          <Empty
            title="Pipeline is empty"
            action={
              <Link href="/outreach?tab=compose" className="text-[14px] underline">
                Write openers
              </Link>
            }
          >
            Send openers to prospects and they appear here as contacted.
          </Empty>
        </div>
      )}
    </>
  );
}
