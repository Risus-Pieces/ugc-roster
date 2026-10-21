import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { db, calls, campaigns, campaignCreators, contracts, creatorAccounts, creatorScores, creators, messages, posts, referrals, taxForms, STAGES, type CreatorScore } from "@/db";
import { Badge, Card, ConfidenceBadge, Empty, MarginBar, Meter, PageHeader, PlatformTag, StageBadge, Table, Td, VerdictBadge, cx, input, type Tone } from "@/components/ui";
import { ActionForm, SubmitButton } from "@/components/client";
import { creatorEconomics } from "@/lib/services/decisions";
import { rateCardFor, snapshotsByPost } from "@/lib/services/common";
import { warmupStatus } from "@/lib/engines/onboarding";
import { compact, dateTime, day, pct, relative, usd, usd2 } from "@/lib/format";
import { draftOpenerAction, moveStageAction } from "../actions";
import { ClassBadge, MsgStatusBadge, requestTime, viralDependence } from "../bits";
import { ViewsChart } from "./views-chart";
import { Villager } from "@/components/sprites";

const DAY = 86_400_000;

export const metadata = { title: "Creator" };

const CONTRACT_TONE: Record<string, Tone> = { draft: "neutral", sent: "info", signed: "profit", void: "loss" };
const TAX_TONE: Record<string, Tone> = { requested: "tally", submitted: "info", verified: "profit", rejected: "loss" };

export default async function CreatorPage({ params }: { params: Promise<{ id: string }> }) {
  await connection();
  const { id } = await params;
  const creator = await db.query.creators.findFirst({ where: eq(creators.id, id) });
  if (!creator) notFound();

  const onRoster = creator.stage === "trial" || creator.stage === "active";
  const [accounts, scoreRows, recentPosts, campaignPosts, thread, contractRows, taxRows, campRows, callRows, referralsMade, referrer, card, econAll] = await Promise.all([
    db.select().from(creatorAccounts).where(eq(creatorAccounts.creatorId, id)).orderBy(desc(creatorAccounts.followers)),
    db.select().from(creatorScores).where(eq(creatorScores.creatorId, id)).orderBy(desc(creatorScores.computedAt)),
    db
      .select({ id: posts.id, views: posts.views, postedAt: posts.postedAt, isCampaignPost: posts.isCampaignPost, caption: posts.caption, source: posts.source })
      .from(posts)
      .where(and(eq(posts.creatorId, id), inArray(posts.source, ["prospect", "roster"])))
      .orderBy(desc(posts.postedAt))
      .limit(30),
    db
      .select()
      .from(posts)
      .where(and(eq(posts.creatorId, id), eq(posts.isCampaignPost, true)))
      .orderBy(desc(posts.postedAt))
      .limit(20),
    db.select().from(messages).where(eq(messages.creatorId, id)).orderBy(asc(messages.createdAt)),
    db.select().from(contracts).where(eq(contracts.creatorId, id)).orderBy(desc(contracts.createdAt)),
    db.select().from(taxForms).where(eq(taxForms.creatorId, id)).orderBy(desc(taxForms.createdAt)),
    db.select({ id: campaigns.id, name: campaigns.name }).from(campaignCreators).innerJoin(campaigns, eq(campaigns.id, campaignCreators.campaignId)).where(eq(campaignCreators.creatorId, id)),
    db.select().from(calls).where(eq(calls.creatorId, id)).orderBy(desc(calls.scheduledAt)),
    db.select({ status: referrals.status, bonusCents: referrals.bonusCents }).from(referrals).where(eq(referrals.referrerId, id)),
    creator.referredById ? db.query.creators.findFirst({ where: eq(creators.id, creator.referredById) }) : Promise.resolve(undefined),
    rateCardFor(creator.rateCardId),
    onRoster ? creatorEconomics() : Promise.resolve([]),
  ]);
  const snaps = await snapshotsByPost(campaignPosts.map((p) => p.id));

  const latestByPlatform = new Map<string, CreatorScore>();
  for (const s of scoreRows) if (!latestByPlatform.has(s.platform)) latestByPlatform.set(s.platform, s);
  const scores = [...latestByPlatform.values()];
  const econ = econAll.find((e) => e.creatorId === id);
  const contract = contractRows.find((c) => c.status !== "void") ?? contractRows[0];
  const tax = taxRows[0];
  const warm = warmupStatus(creator.warmupStartedAt, creator.warmupTargetDays);
  const since = creator.stageChangedAt ?? creator.createdAt;
  const now = requestTime();
  const daysInStage = Math.max(0, Math.floor((now - since.getTime()) / DAY));
  const chartPosts = [...recentPosts].reverse();
  const canDraft = creator.stage === "prospect" && Boolean(creator.email);
  const hasDraft = thread.some((m) => m.status === "draft");
  const upcoming = callRows.filter((c) => c.status === "booked" && c.scheduledAt.getTime() > now - 2 * 3600_000);

  return (
    <>
      <div className="mb-2 text-[13px]">
        <Link href="/creators" className="text-muted hover:text-ink">
          ← Creators
        </Link>
      </div>
      <PageHeader
        avatar={<Villager seed={creator.id} scale={5} />}
        title={creator.name}
        description={
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[14px]">
            <StageBadge stage={creator.stage} />
            <span className="num text-muted">{daysInStage}d in stage</span>
            {creator.country && <span className="num">{creator.country}</span>}
            {creator.email ? <span>{creator.email}</span> : <span className="text-muted">no email</span>}
            {creator.niche && <span className="text-muted">{creator.niche}</span>}
            <span className="num text-muted">
              {usd(card.baseCents)}/video + {usd2(card.cpmCents)}/1K views
            </span>
          </span>
        }
        actions={
          canDraft ? (
            <ActionForm action={draftOpenerAction}>
              <input type="hidden" name="creatorId" value={creator.id} />
              <SubmitButton variant="primary" pendingText="Writing…">
                {hasDraft ? "Draft another opener" : "Draft opener"}
              </SubmitButton>
            </ActionForm>
          ) : undefined
        }
      />

      <div className="grid gap-4 lg:grid-cols-[1fr_340px]">
        <div className="min-w-0 space-y-4">
          <Card title="Accounts" flush>
            {accounts.length === 0 ? (
              <p className="p-4 text-ink-2">No platform accounts on file.</p>
            ) : (
              <Table head={["Platform", "Handle", { label: "Followers", align: "right" }, "Connected", "Last synced"]}>
                {accounts.map((a) => (
                  <tr key={a.id}>
                    <Td>
                      <PlatformTag platform={a.platform} />
                    </Td>
                    <Td>
                      {a.url ? (
                        <a href={a.url} target="_blank" rel="noreferrer" className="hover:underline">
                          @{a.handle}
                        </a>
                      ) : (
                        `@${a.handle}`
                      )}
                    </Td>
                    <Td right mono>
                      {compact(a.followers)}
                    </Td>
                    <Td>{a.connected ? <Badge tone="profit">yes</Badge> : <span className="text-muted">no</span>}</Td>
                    <Td mono className="text-ink-2">
                      {a.lastSyncedAt ? relative(a.lastSyncedAt) : "—"}
                    </Td>
                  </tr>
                ))}
              </Table>
            )}
          </Card>

          <Card title="Score" action={<span className="text-[13px] text-muted">typical views, not the one viral hit</span>}>
            {scores.length === 0 ? (
              <p className="text-ink-2">Not scored yet. Scores are computed when discovery or a sync pulls in their posts.</p>
            ) : (
              <div className="space-y-4">
                {scores.map((s) => (
                  <ScoreBlock key={s.id} s={s} />
                ))}
              </div>
            )}
          </Card>

          <Card title={chartPosts.length ? `Views on the last ${chartPosts.length} posts` : "Recent views"}>
            <ViewsChart posts={chartPosts} />
          </Card>

          <Card title="Campaign posts" action={<span className="text-[13px] text-muted">latest 20 · credible views at day 1 / 7 / 14</span>} flush>
            {campaignPosts.length === 0 ? (
              <p className="p-4 text-ink-2">{onRoster ? "No campaign posts yet. They show up after the next sync." : "Campaign posts appear once they're on the roster."}</p>
            ) : (
              <Table
                head={[
                  "Posted",
                  "Post",
                  { label: "Views now", align: "right" },
                  { label: "Day 1", align: "right" },
                  { label: "Day 7", align: "right" },
                  { label: "Day 14", align: "right" },
                  { label: "Bots est.", align: "right" },
                ]}
              >
                {campaignPosts.map((p) => {
                  const ss = snaps.get(p.id) ?? [];
                  const at = (d: number) => ss.find((s) => s.dayMark === d)?.credibleViews;
                  const last = ss.at(-1);
                  return (
                    <tr key={p.id}>
                      <Td mono className="whitespace-nowrap text-ink-2">
                        {day(p.postedAt)}
                      </Td>
                      <Td>
                        <div className="flex max-w-[260px] items-center gap-1.5">
                          <PlatformTag platform={p.platform} />
                          {p.url ? (
                            <a href={p.url} target="_blank" rel="noreferrer" className="truncate hover:underline">
                              {p.caption || p.externalId}
                            </a>
                          ) : (
                            <span className="truncate">{p.caption || p.externalId}</span>
                          )}
                          {p.removedAt && <Badge tone="loss">removed</Badge>}
                        </div>
                      </Td>
                      <Td right mono>
                        {compact(p.views)}
                      </Td>
                      {[1, 7, 14].map((d) => (
                        <Td key={d} right mono className={at(d) === undefined ? "text-muted" : ""}>
                          {at(d) === undefined ? "—" : compact(at(d)!)}
                        </Td>
                      ))}
                      <Td right mono className={last && last.botViewsEst > 0 ? "text-tally" : "text-muted"}>
                        {last ? compact(last.botViewsEst) : "—"}
                      </Td>
                    </tr>
                  );
                })}
              </Table>
            )}
          </Card>

          <Card title="Messages" action={<span className="num text-[13px] text-muted">{thread.length}</span>} flush>
            {thread.length === 0 ? (
              <div className="p-4">
                <Empty title="No messages yet">
                  {canDraft
                    ? "Draft an opener above — it references their recent videos and states pay up front."
                    : creator.email
                      ? "Nothing sent or received yet."
                      : "No email on file, so outreach isn't possible yet."}
                </Empty>
              </div>
            ) : (
              <ul className="divide-y divide-line">
                {thread.map((m) => (
                  <li key={m.id} className={cx("px-4 py-3", m.direction === "in" && "bg-sunken/50")}>
                    <div className="flex flex-wrap items-center gap-2 text-[13px]">
                      <span className="font-medium">{m.direction === "in" ? `← ${creator.name.split(" ")[0]}` : "→ You"}</span>
                      <MsgStatusBadge status={m.status} />
                      <ClassBadge c={m.classification} />
                      <span className="num ml-auto text-muted">{dateTime(m.sentAt ?? m.createdAt)}</span>
                    </div>
                    {m.subject && <div className="mt-1 font-medium">{m.subject}</div>}
                    <p className="mt-1 whitespace-pre-wrap text-ink-2">{m.body}</p>
                    {m.direction === "in" && m.status === "received" && (
                      <Link href="/outreach" className="mt-1 inline-block text-[13px] text-tally hover:underline">
                        Answer in Outreach →
                      </Link>
                    )}
                    {m.status === "draft" && (
                      <Link href="/outreach?tab=compose" className="mt-1 inline-block text-[13px] text-ink hover:underline">
                        Edit and send in Outreach →
                      </Link>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>

        <div className="min-w-0 space-y-4">
          <Card title="Stage">
            <ActionForm action={moveStageAction} className="space-y-2">
              <input type="hidden" name="creatorId" value={creator.id} />
              <div className="flex gap-2">
                <select name="stage" defaultValue={creator.stage} className={input} aria-label="New stage">
                  {STAGES.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
                <SubmitButton pendingText="Moving…">Move</SubmitButton>
              </div>
            </ActionForm>
            <p className="mt-2 text-[13px] text-muted">
              Moving to <b className="font-medium text-ink-2">trial</b> starts product access and the warm-up, and automatically creates their contract and a tax form request (W-9 for US, W-8BEN
              otherwise). Moving to <b className="font-medium text-ink-2">active</b> qualifies their referrer&apos;s bonus.
            </p>
          </Card>

          <Card title="Economics">
            {!onRoster ? (
              <p className="text-ink-2">Profit per 1K views shows once they&apos;re on the roster (trial or active).</p>
            ) : !econ ? (
              <p className="text-ink-2">No economics yet.</p>
            ) : (
              <EconBlock e={econ} />
            )}
          </Card>

          <Card
            title="Onboarding"
            action={
              <Link href="/onboarding" className="text-[13px] text-ink-2 hover:text-ink">
                Onboarding →
              </Link>
            }
          >
            <dl className="space-y-2.5 text-[14px]">
              <Row label="Contract">
                {contract ? (
                  <span className="flex items-center gap-2">
                    <Badge tone={CONTRACT_TONE[contract.status]}>{contract.status}</Badge>
                    <span className="num text-[13px] text-muted">
                      {contract.signedAt ? `signed ${day(contract.signedAt)}` : contract.sentAt ? `sent ${day(contract.sentAt)}` : `drafted ${day(contract.createdAt)}`}
                    </span>
                  </span>
                ) : (
                  <span className="text-muted">created at trial</span>
                )}
              </Row>
              <Row label="Tax form">
                {tax ? (
                  <span className="flex items-center gap-2">
                    <span className="num text-[13px]">{tax.formType}</span>
                    <Badge tone={TAX_TONE[tax.status]}>{tax.status}</Badge>
                  </span>
                ) : (
                  <span className="text-muted">requested at trial</span>
                )}
              </Row>
              <Row label="Warm-up">
                {!warm.started ? (
                  <span className="text-muted">starts at trial</span>
                ) : warm.done ? (
                  <span className="num text-profit">done · {warm.targetDays} days</span>
                ) : (
                  <span className="w-32">
                    <span className="num text-[13px]">
                      day {warm.day} of {warm.targetDays}
                    </span>
                    <Meter value={warm.day} max={warm.targetDays} tone="tally" />
                  </span>
                )}
              </Row>
              <Row label="Product access">
                <span className="num text-[13px]">{creator.productAccessAt ? day(creator.productAccessAt) : "—"}</span>
              </Row>
              <Row label="Payout">
                <span className="text-[13px]">{creator.payoutProvider ?? <span className="text-muted">not set</span>}</span>
              </Row>
            </dl>
          </Card>

          <Card title="Codes and links">
            <dl className="space-y-2.5 text-[14px]">
              <Row label="Promo code">{creator.promoCode ? <span className="num font-medium">{creator.promoCode}</span> : <span className="text-muted">assigned at trial</span>}</Row>
              <LinkRow label="Tracking link" path={creator.promoCode ? `/r/${creator.promoCode}` : null} hint="Put in bio — every click is counted" plain />
              <LinkRow label="Referral link" path={`/join/${creator.referralCode}`} hint="For recruiting friends" />
              <LinkRow label="Creator portal" path={`/c/${creator.portalToken}`} hint="Their contract, tax form, briefs and pay" />
            </dl>
          </Card>

          <Card title="Campaigns and referrals">
            <div className="space-y-2.5 text-[14px]">
              <div className="flex flex-wrap gap-1">
                {campRows.length ? (
                  campRows.map((c) => (
                    <Link key={c.id} href={`/discover?campaign=${c.id}`}>
                      <Badge>{c.name}</Badge>
                    </Link>
                  ))
                ) : (
                  <span className="text-muted">Not in a campaign</span>
                )}
              </div>
              {referrer && (
                <p>
                  Referred by{" "}
                  <Link href={`/creators/${referrer.id}`} className="font-medium hover:underline">
                    {referrer.name}
                  </Link>
                </p>
              )}
              <p className="text-ink-2">
                Referred <span className="num text-ink">{referralsMade.length}</span> creator{referralsMade.length === 1 ? "" : "s"}
                {referralsMade.length > 0 && <span className="num text-muted"> · {usd(referralsMade.filter((r) => r.status !== "void").reduce((a, r) => a + r.bonusCents, 0))} in bonuses</span>}
              </p>
            </div>
          </Card>

          {callRows.length > 0 && (
            <Card title="Calls">
              <ul className="space-y-1.5 text-[14px]">
                {callRows.map((c) => (
                  <li key={c.id} className="flex items-center justify-between gap-2">
                    <span className="num">{dateTime(c.scheduledAt)}</span>
                    <span className="flex items-center gap-2">
                      {upcoming.includes(c) && c.link && (
                        <a href={c.link} target="_blank" rel="noreferrer" className="text-[13px] hover:underline">
                          link
                        </a>
                      )}
                      <Badge tone={c.status === "booked" ? "info" : c.status === "done" ? "profit" : "neutral"}>{c.status.replace("_", " ")}</Badge>
                    </span>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </div>
      </div>
    </>
  );
}

function ScoreBlock({ s }: { s: CreatorScore }) {
  const dep = viralDependence(s);
  const items: { label: string; value: React.ReactNode; hint?: string; strong?: boolean }[] = [
    { label: "Median views", value: compact(s.medianViews), strong: true },
    { label: "Worst 5 avg", value: s.sampleSize > 0 ? compact(s.worst5AvgViews) : "—", strong: true },
    { label: "Max views", value: compact(s.maxViews), hint: `${dep.toFixed(1)}× median` },
    { label: "Engagement", value: pct(s.engagementRate) },
    { label: "Views / followers", value: pct(s.viewFollowerRatio, 0) },
    { label: "Comment quality", value: pct(s.commentQuality, 0) },
    { label: "Suggested base", value: usd(s.suggestedBaseCents), hint: "per video" },
  ];
  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <PlatformTag platform={s.platform} />
        <VerdictBadge verdict={s.authenticityVerdict} score={s.authenticityScore} />
        <span className="num text-[13px] text-muted">
          {s.sampleSize > 0 ? `${s.sampleSize} posts` : "From imported averages"} · scored {relative(s.computedAt)}
        </span>
      </div>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-4 xl:grid-cols-7">
        {items.map((it) => (
          <div key={it.label}>
            <dt className="text-[12px] text-muted">{it.label}</dt>
            <dd className={cx("num text-[17px]", it.strong ? "font-medium" : "text-ink-2")}>{it.value}</dd>
            {it.hint && <dd className={cx("num text-[12px]", it.label === "Max views" && dep >= 10 ? "text-tally" : "text-muted")}>{it.hint}</dd>}
          </div>
        ))}
      </dl>
      {s.authenticityFlags.length > 0 && (
        <ul className="mt-2 flex flex-wrap gap-1">
          {s.authenticityFlags.map((f) => (
            <Badge key={f} tone={s.authenticityVerdict === "fail" ? "loss" : "tally"}>
              {f}
            </Badge>
          ))}
        </ul>
      )}
    </div>
  );
}

function EconBlock({ e }: { e: Awaited<ReturnType<typeof creatorEconomics>>[number] }) {
  const d = e.decision;
  const scale = Math.max(e.revenuePer1kCents, d.costPer1kCents, e.revenuePer1kHigh, 1) * 1.15;
  if (e.posts === 0) return <p className="text-ink-2">No campaign posts yet. Profit per 1K views shows after their first synced posts.</p>;
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <Badge tone={d.action === "promote" ? "profit" : d.action === "cut" ? "loss" : "neutral"}>{d.action}</Badge>
        <ConfidenceBadge level={e.confidence} />
      </div>
      <MarginBar revenue={e.revenuePer1kCents} cost={d.costPer1kCents} scale={scale} low={e.revenuePer1kLow} high={e.revenuePer1kHigh} />
      <dl className="grid grid-cols-3 gap-2 text-[13px]">
        <div>
          <dt className="text-muted">Revenue / 1K</dt>
          <dd className="num">{usd2(e.revenuePer1kCents)}</dd>
        </div>
        <div>
          <dt className="text-muted">Cost / 1K</dt>
          <dd className="num">{usd2(d.costPer1kCents)}</dd>
        </div>
        <div>
          <dt className="text-muted">Profit / 1K</dt>
          <dd className={cx("num", d.profitPer1kCents >= 0 ? "text-profit" : "text-loss")}>{usd2(d.profitPer1kCents)}</dd>
        </div>
        <div>
          <dt className="text-muted">Posts</dt>
          <dd className="num">{e.posts}</dd>
        </div>
        <div>
          <dt className="text-muted">Credible views</dt>
          <dd className="num">{compact(e.views)}</dd>
        </div>
        <div>
          <dt className="text-muted">Owed + paid</dt>
          <dd className="num">{usd(e.paidCents)}</dd>
        </div>
      </dl>
      <ul className="list-disc space-y-0.5 pl-4 text-[13px] text-ink-2">
        {d.reasons.map((r) => (
          <li key={r}>{r}</li>
        ))}
      </ul>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <dt className="shrink-0 text-[13px] text-muted">{label}</dt>
      <dd className="min-w-0 text-right">{children}</dd>
    </div>
  );
}

function LinkRow({ label, path, hint, plain }: { label: string; path: string | null; hint: string; plain?: boolean }) {
  return (
    <div>
      <dt className="text-[13px] text-muted">{label}</dt>
      <dd className="num break-all text-[13px]">
        {!path ? (
          <span className="text-muted">available once they have a promo code</span>
        ) : plain ? (
          <span className="select-all">{path}</span>
        ) : (
          <a href={path} target="_blank" rel="noreferrer" className="select-all hover:underline">
            {path}
          </a>
        )}
      </dd>
      <dd className="text-[12px] text-muted">{hint}</dd>
    </div>
  );
}
