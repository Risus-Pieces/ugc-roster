import Link from "next/link";
import { connection } from "next/server";
import { and, asc, desc, eq, inArray, isNotNull, ne, sql } from "drizzle-orm";
import { db, calls, campaigns, creatorAccounts, creators, messages } from "@/db";
import { Card, Empty, Field, Grid, Notice, PageHeader, StageBadge, Stat, Table, Tabs, Td, btn, btnSm, cx, input, label } from "@/components/ui";
import { ActionForm, SubmitButton } from "@/components/client";
import { coldEmailsOn, followUpsDue, outreachMode } from "@/lib/services/outreach";
import { centralLabel, viewsBarStatus } from "@/lib/engines/outreach";
import { latestScores } from "@/lib/services/common";
import { foodFitFor } from "@/lib/services/food-fit";
import { getBrand, getOps } from "@/lib/settings";
import { compact, dateTime, day, pct, relative } from "@/lib/format";
import { bookCallAction, draftFollowUpsAction, draftsAction, logReplyAction, sendReplyAction, writeOpenersAction } from "./actions";
import { TopMessageForm } from "./top-message-form";
import { TzInput } from "./tz-input";
import { Authenticity, ClassBadge, FoodBadge, Handles, MsgStatusBadge, groupBy, one, requestTime, type SearchParams } from "../creators/bits";

export const metadata = { title: "Outreach" };

type Tab = "replies" | "followups" | "compose" | "sent";

export default async function OutreachPage({ searchParams }: { searchParams: SearchParams }) {
  await connection();
  const sp = await searchParams;
  const t = one(sp.tab);
  const tab: Tab = t === "compose" || t === "sent" || t === "followups" ? t : "replies";
  const mode = outreachMode();

  const [waiting, drafts, outbound, inboundCreators] = await Promise.all([
    db.$count(messages, and(eq(messages.direction, "in"), eq(messages.status, "received"))),
    db.$count(messages, and(eq(messages.direction, "out"), eq(messages.status, "draft"))),
    db
      .selectDistinct({ creatorId: messages.creatorId })
      .from(messages)
      .where(and(eq(messages.direction, "out"), ne(messages.status, "draft"))),
    db.selectDistinct({ creatorId: messages.creatorId }).from(messages).where(eq(messages.direction, "in")),
  ]);
  const contacted = new Set(outbound.map((r) => r.creatorId));
  const replied = inboundCreators.filter((r) => contacted.has(r.creatorId)).length;
  const [sentCount, due, sentToday, ops] = await Promise.all([
    db.$count(messages, and(eq(messages.direction, "out"), inArray(messages.status, ["sent", "simulated", "failed"]))),
    followUpsDue(),
    coldEmailsOn(),
    getOps(),
  ]);

  return (
    <>
      <PageHeader step="02 · Reach" title="Outreach" description="Email first: cold email gets 10–20% reply rates, DMs 2–4%. Every opener is your email from Settings, with each creator’s name filled in." />

      <div className="mb-4 grid gap-2 md:grid-cols-2">
        {mode.emailLive ? (
          <Notice tone="profit">Email is live — messages go out through Resend from EMAIL_FROM.</Notice>
        ) : (
          <Notice tone="tally">Email is simulated — messages are logged but not delivered. Set RESEND_API_KEY and EMAIL_FROM (use a separate outreach domain with SPF, DKIM and DMARC).</Notice>
        )}
        {mode.aiLive ? (
          <Notice tone="profit">Openers use the email in Settings → First email, word for word. Claude only sorts replies and drafts answers to them.</Notice>
        ) : (
          <Notice>Openers use the email in Settings → First email, word for word. Reply drafts use templates; set ANTHROPIC_API_KEY to have Claude sort replies.</Notice>
        )}
      </div>

      <Grid cols={4} className="mb-6">
        <Stat label="Creators contacted" value={contacted.size} />
        <Stat label="Replied" value={replied} />
        <Stat label="Reply rate" value={contacted.size ? pct(replied / contacted.size, 0) : "—"} hint="email benchmark 10–20%" />
        <Stat label="Replies waiting on you" value={waiting} tone={waiting ? "tally" : undefined} />
      </Grid>

      <Tabs
        active={tab}
        tabs={[
          { key: "replies", label: "Replies", href: "/outreach", count: waiting },
          { key: "followups", label: "Follow-ups", href: "/outreach?tab=followups", count: due.length },
          { key: "compose", label: "Compose", href: "/outreach?tab=compose", count: drafts },
          { key: "sent", label: "Sent", href: "/outreach?tab=sent", count: sentCount },
        ]}
      />

      {tab === "compose" && (
        <p className="mb-3 text-[14px] text-ink-2">
          <span className="num">
            {sentToday}/{ops.outreach.dailySendLimit}
          </span>{" "}
          cold emails sent or scheduled today. They go out 2-5 minutes apart, 9am-6pm Central. Every opener and follow-up gets a footer with your mailing address and an opt-out line, and creators who said no are never emailed again.
        </p>
      )}
      {tab === "replies" ? <RepliesTab /> : tab === "followups" ? <FollowUpsTab due={due} days={ops.outreach.followUpDays} /> : tab === "compose" ? <ComposeTab pick={Number(one(sp.pick) ?? 0) || 0} next={Number(one(sp.next) ?? 0) || 0} showAll={one(sp.show) === "all"} showBelow={one(sp.below) === "1"} bar={ops.outreach.minTypicalViews} leftToday={Math.max(0, ops.outreach.dailySendLimit - sentToday)} dailyLimit={ops.outreach.dailySendLimit} /> : <SentTab />}
    </>
  );
}

// ─── Follow-ups ─────────────────────────────────────────────────────────────

function FollowUpsTab({ due, days }: { due: Awaited<ReturnType<typeof followUpsDue>>; days: number[] }) {
  if (!days.length) return <Empty title="Follow-ups are off">Set follow-up days in Settings → Outreach to nudge creators who haven&apos;t replied.</Empty>;
  if (!due.length)
    return (
      <Empty title="No follow-ups due">
        Creators who haven&apos;t replied get a follow-up on day {days.join(" and day ")} after the first email. They&apos;ll show up here when it&apos;s time.
      </Empty>
    );
  return (
    <Card title={`${due.length} due`} flush>
      <ActionForm action={draftFollowUpsAction}>
        <Table head={["", "Creator", "Follow-up", { label: "Days since first email", align: "right" }, "Subject"]}>
          {due.map((d) => (
            <tr key={d.creator.id}>
              <Td>
                <input type="checkbox" name="creatorId" value={d.creator.id} defaultChecked aria-label={`Follow up with ${d.creator.name}`} />
              </Td>
              <Td>
                <Link href={`/creators/${d.creator.id}`} className="font-bold hover:underline">
                  {d.creator.name}
                </Link>
              </Td>
              <Td mono>
                {d.step} of {d.of}
              </Td>
              <Td right mono>
                {d.daysSinceFirst}
              </Td>
              <Td className="max-w-[280px] truncate text-ink-2">{d.subject}</Td>
            </tr>
          ))}
        </Table>
        <div className="flex items-center gap-3 border-t-2 border-line px-4 py-3">
          <SubmitButton variant="primary" pendingText="Writing…">
            Write follow-ups
          </SubmitButton>
          <span className="text-[13px] text-muted">Drafts go to Compose so you can read them before they send.</span>
        </div>
      </ActionForm>
    </Card>
  );
}

// ─── Replies ────────────────────────────────────────────────────────────────

async function RepliesTab() {
  const [inbound, brand, loggable] = await Promise.all([
    db
      .select()
      .from(messages)
      .where(and(eq(messages.direction, "in"), eq(messages.status, "received")))
      .orderBy(desc(messages.createdAt)),
    getBrand(),
    db
      .select({ id: creators.id, name: creators.name, stage: creators.stage })
      .from(creators)
      .where(and(isNotNull(creators.email), inArray(creators.stage, ["contacted", "replied", "prospect", "trial"])))
      .orderBy(asc(creators.name)),
  ]);
  const ids = [...new Set(inbound.map((m) => m.creatorId))];
  const [cs, lastOut, booked] = ids.length
    ? await Promise.all([
        db.select().from(creators).where(inArray(creators.id, ids)),
        db
          .select()
          .from(messages)
          .where(and(inArray(messages.creatorId, ids), eq(messages.direction, "out"), ne(messages.status, "draft")))
          .orderBy(desc(messages.createdAt)),
        db
          .select()
          .from(calls)
          .where(and(inArray(calls.creatorId, ids), eq(calls.status, "booked")))
          .orderBy(asc(calls.scheduledAt)),
      ])
    : [[], [], []];
  const now = requestTime();
  const byId = new Map(cs.map((c) => [c.id, c]));
  const lastOutBy = new Map<string, (typeof lastOut)[number]>();
  for (const m of lastOut) if (!lastOutBy.has(m.creatorId)) lastOutBy.set(m.creatorId, m);
  const callBy = groupBy(booked, (c) => c.creatorId);
  const stageOrder = ["contacted", "replied", "prospect", "trial"];
  const logOptions = [...loggable].sort((a, b) => stageOrder.indexOf(a.stage) - stageOrder.indexOf(b.stage) || a.name.localeCompare(b.name));

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
      <div className="min-w-0 space-y-4">
        {inbound.length === 0 ? (
          <Empty title="No replies waiting">Send openers from Compose, or paste a reply with “Log a reply” to try the flow.</Empty>
        ) : (
          inbound.map((m) => {
            const c = byId.get(m.creatorId);
            if (!c) return null;
            const last = lastOutBy.get(m.creatorId);
            const nextCall = (callBy.get(m.creatorId) ?? []).find((k) => k.scheduledAt.getTime() > now);
            return (
              <Card
                key={m.id}
                title={
                  <span className="flex flex-wrap items-center gap-2">
                    <Link href={`/creators/${c.id}`} className="hover:underline">
                      {c.name}
                    </Link>
                    <StageBadge stage={c.stage} />
                    <ClassBadge c={m.classification} />
                  </span>
                }
                action={<span className="num text-[13px] text-muted">{relative(m.createdAt)}</span>}
              >
                {last && (
                  <details className="mb-2 text-[13px] text-muted">
                    <summary className="cursor-pointer">
                      Your message · <span className="num">{day(last.sentAt ?? last.createdAt)}</span>
                      {last.subject ? ` · ${last.subject}` : ""}
                    </summary>
                    <p className="mt-1 whitespace-pre-wrap rounded-md border border-line px-3 py-2 text-ink-2">{last.body}</p>
                  </details>
                )}
                {m.subject && <div className="mb-1 text-[13px] text-muted">{m.subject}</div>}
                <blockquote className="whitespace-pre-wrap rounded-md bg-sunken px-3 py-2">{m.body}</blockquote>

                <div className="mt-3 grid gap-4 xl:grid-cols-[1fr_240px]">
                  <ActionForm action={sendReplyAction} className="space-y-2">
                    <input type="hidden" name="inboundId" value={m.id} />
                    <label className="block">
                      <span className={label}>Draft reply — edit before sending</span>
                      <textarea name="body" rows={6} defaultValue={m.draftReply ?? ""} className={input} />
                    </label>
                    <div className="flex flex-wrap items-center gap-2">
                      <SubmitButton variant="primary" pendingText="Sending…">
                        Send reply
                      </SubmitButton>
                      {m.classification === "not_interested" && <span className="text-[13px] text-muted">Sending also moves them to cut.</span>}
                    </div>
                  </ActionForm>
                  <ActionForm action={bookCallAction} className="space-y-2" resetOnSuccess>
                    <input type="hidden" name="creatorId" value={c.id} />
                    <TzInput />
                    <Field label="Book a call">
                      <input type="datetime-local" name="at" required className={cx(input, "num")} />
                    </Field>
                    <input name="link" placeholder={brand.bookingUrl} className={input} aria-label="Call link (optional)" />
                    <SubmitButton pendingText="Booking…">Book call</SubmitButton>
                    {nextCall && (
                      <p className="text-[13px] text-ink-2">
                        Booked: <span className="num">{dateTime(nextCall.scheduledAt)}</span>
                      </p>
                    )}
                  </ActionForm>
                </div>
              </Card>
            );
          })
        )}
      </div>

      <div className="min-w-0">
        <Card title="Log a reply">
          <ActionForm action={logReplyAction} className="space-y-3" resetOnSuccess>
            <Field label="Who replied">
              <select name="creatorId" required className={input} defaultValue="">
                <option value="" disabled>
                  Pick a creator
                </option>
                {logOptions.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name} · {c.stage}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Subject (optional)">
              <input name="subject" className={input} placeholder="Re: Paid video collab" />
            </Field>
            <Field label="Their reply" hint="We classify it and draft an answer. Replies from email arrive here automatically once inbound email is set up.">
              <textarea name="text" required rows={5} className={input} placeholder="Sounds fun! What's the rate for 3 videos a week?" />
            </Field>
            <SubmitButton pendingText="Reading…">Log reply</SubmitButton>
          </ActionForm>
        </Card>
      </div>
    </div>
  );
}

// ─── Compose ────────────────────────────────────────────────────────────────

/**
 * `pick`: tick the top N real audiences. `next`: tick the next N in the list. Both only tick food creators
 * at or above the views bar. Non-food creators are hidden unless `showAll`; creators below the bar or
 * without a score are hidden unless `showBelow`.
 */
async function ComposeTab({ pick, next, showAll, showBelow, bar, leftToday, dailyLimit }: { pick: number; next: number; showAll: boolean; showBelow: boolean; bar: number; leftToday: number; dailyLimit: number }) {
  const [prospects, touched, draftRows, camps] = await Promise.all([
    db
      .select()
      .from(creators)
      .where(and(eq(creators.stage, "prospect"), isNotNull(creators.email))),
    // A failed send never reached them, so they're still fresh.
    db.selectDistinct({ creatorId: messages.creatorId }).from(messages).where(and(eq(messages.direction, "out"), ne(messages.status, "failed"))),
    db
      .select()
      .from(messages)
      .where(and(eq(messages.direction, "out"), eq(messages.status, "draft")))
      .orderBy(desc(messages.createdAt)),
    db.select({ id: campaigns.id, name: campaigns.name }).from(campaigns).orderBy(desc(campaigns.createdAt)),
  ]);
  const touchedSet = new Set(touched.map((t) => t.creatorId));
  const fresh = prospects.filter((c) => !touchedSet.has(c.id));
  const draftCreatorIds = [...new Set(draftRows.map((d) => d.creatorId))];
  const ids = [...new Set([...fresh.map((c) => c.id), ...draftCreatorIds])];
  const [scores, accts, draftCreators] = ids.length
    ? await Promise.all([
        latestScores(ids),
        db.select({ creatorId: creatorAccounts.creatorId, platform: creatorAccounts.platform, handle: creatorAccounts.handle, viewsNote: creatorAccounts.viewsNote }).from(creatorAccounts).where(inArray(creatorAccounts.creatorId, ids)),
        draftCreatorIds.length ? db.select().from(creators).where(inArray(creators.id, draftCreatorIds)) : Promise.resolve([]),
      ])
    : [new Map(), [], []];
  const acctBy = groupBy(accts, (a) => a.creatorId);
  const draftCreatorBy = new Map(draftCreators.map((c) => [c.id, c]));
  const fits = await foodFitFor(fresh);
  const fitOf = (id: string) => fits.get(id)?.fit ?? "unknown";
  const barOf = (id: string) => viewsBarStatus(scores.get(id), bar);
  const typical = (id: string) => (barOf(id) === "unscored" ? -1 : scores.get(id)!.medianViews);
  const sorted = [...fresh].sort((a, b) => typical(b.id) - typical(a.id));
  const notFood = sorted.filter((c) => fitOf(c.id) === "not_food").length;
  const offBar = sorted.filter((c) => fitOf(c.id) !== "not_food" && barOf(c.id) !== "above").length;
  const ranked = sorted.filter((c) => (showAll || fitOf(c.id) !== "not_food") && (showBelow || barOf(c.id) === "above"));
  const pickable = ranked.filter((c) => fitOf(c.id) === "food" && barOf(c.id) === "above");
  const realAudiences = pickable.filter((c) => scores.get(c.id)?.authenticityVerdict === "pass");
  const preselected = new Set((next > 0 ? pickable.slice(0, next) : realAudiences.slice(0, pick)).map((c) => c.id));
  const composeHref = (o: { show?: boolean; below?: boolean; tick?: string } = {}) => {
    const q = new URLSearchParams({ tab: "compose" });
    if (o.show ?? showAll) q.set("show", "all");
    if (o.below ?? showBelow) q.set("below", "1");
    return `/outreach?${q}${o.tick ? `&${o.tick}` : ""}`;
  };
  // "Write openers" handles 25 at a time; default to what's left of today's sending limit.
  const batch = Math.min(25, leftToday > 0 ? leftToday : dailyLimit);

  return (
    <div className="space-y-4">
      <Card title="Pick prospects" action={<span className="num text-[13px] text-muted">{pickable.length} food creator{pickable.length === 1 ? "" : "s"} at or above {bar.toLocaleString("en-US")} · {offBar} below or unscored</span>} flush>
        {fresh.length === 0 ? (
          <div className="p-4">
            <Empty
              title="Everyone with an email has been contacted"
              action={
                <Link href="/discover" className={btn}>
                  Find more creators
                </Link>
              }
            >
              Run discovery on a campaign to add prospects.
            </Empty>
          </div>
        ) : (
          <TopMessageForm action={writeOpenersAction} key={`pick-${pick}-${next}-${showAll}-${showBelow}`}>
            <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-2">
              <Link href={composeHref({ tick: `next=${batch}` })} scroll={false} className={cx(btn, btnSm)}>
                Tick next {batch}
              </Link>
              {realAudiences.length > 0 && (
                <Link href={composeHref({ tick: "pick=10" })} scroll={false} className={cx(btn, btnSm)}>
                  Tick top 10 real audiences
                </Link>
              )}
              {(pick > 0 || next > 0) && (
                <Link href={composeHref()} scroll={false} className={cx(btn, btnSm)}>
                  Clear ticks
                </Link>
              )}
              <span className="text-[13px] text-muted">Highest typical views first. The tick buttons only pick food creators at or above the bar.</span>
              {offBar > 0 && (
                <Link href={composeHref({ below: !showBelow })} scroll={false} className="text-[13px] text-info hover:underline">
                  {showBelow ? `Hide the ${offBar} below the bar or unscored` : `Show ${offBar} below the bar or unscored`}
                </Link>
              )}
              {notFood > 0 && (
                <Link href={composeHref({ show: !showAll })} scroll={false} className="text-[13px] text-info hover:underline">
                  {showAll ? `Hide the ${notFood} non-food creators` : `Show ${notFood} hidden non-food creators`}
                </Link>
              )}
            </div>
            {ranked.length === 0 && <p className="p-4 text-ink-2">No creators at or above {bar.toLocaleString("en-US")} typical views yet. Run pnpm check-views on your computer to score them, or lower the bar in Settings → Operations.</p>}
            <div className="max-h-[440px] overflow-y-auto">
              <Table head={["", "Creator", "Food?", "Handle", { label: "Typical views", align: "right" }, { label: "Worst 5 avg", align: "right" }, "Audience", "Email"]}>
                {ranked.map((c) => {
                  const s = scores.get(c.id);
                  const status = barOf(c.id);
                  const note = (acctBy.get(c.id) ?? []).find((a) => a.viewsNote)?.viewsNote;
                  return (
                    <tr key={c.id} className="align-top">
                      <Td>
                        <input type="checkbox" name="creatorId" value={c.id} defaultChecked={preselected.has(c.id)} aria-label={`Select ${c.name}`} />
                      </Td>
                      <Td>
                        <Link href={`/creators/${c.id}`} className="whitespace-nowrap font-medium hover:underline">
                          {c.name}
                        </Link>
                      </Td>
                      <Td>
                        <FoodBadge fit={fits.get(c.id)} />
                      </Td>
                      <Td>
                        <Handles accounts={(acctBy.get(c.id) ?? []).slice(0, 2)} />
                      </Td>
                      <Td right mono className={cx("font-medium", status === "below" && "text-loss")}>
                        {status === "unscored" ? <span className="whitespace-nowrap text-[13px] font-normal text-muted">{note ?? "not checked"}</span> : compact(s!.medianViews)}
                      </Td>
                      <Td right mono>
                        {status === "unscored" ? "—" : compact(s!.worst5AvgViews)}
                      </Td>
                      <Td>
                        <Authenticity score={s} />
                      </Td>
                      <Td className="text-ink-2">{c.email}</Td>
                    </tr>
                  );
                })}
              </Table>
            </div>
            <div className="flex flex-wrap items-end gap-3 border-t border-line px-4 py-3">
              <label className="block min-w-[200px]">
                <span className={label}>Campaign (optional)</span>
                <select name="campaignId" className={input} defaultValue="">
                  <option value="">No campaign</option>
                  {camps.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </label>
              <SubmitButton variant="primary" pendingText="Writing openers…">
                Write openers
              </SubmitButton>
              <span className="text-[13px] text-muted">Up to 25 at a time. Nothing is sent until you press Send.</span>
            </div>
          </TopMessageForm>
        )}
      </Card>

      <Card title="Drafts" action={<span className="num text-[13px] text-muted">{draftRows.length}</span>} flush>
        {/* The form stays mounted when the list empties so the "N sent" result is still shown. */}
        <TopMessageForm action={draftsAction}>
          {draftRows.length === 0 ? (
            <p className="p-4 text-ink-2">No drafts. Tick prospects above and press Write openers.</p>
          ) : (
            <>
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-2">
                <span className="text-[13px] text-muted">Edit any draft, then schedule it on its own or schedule them all. Edits are kept either way. Each one goes out 2-5 minutes after the last, 9am-6pm Central.</span>
                <SubmitButton variant="primary" name="intent" value="send-all" pendingText="Scheduling…">
                  Send all {draftRows.length}
                </SubmitButton>
              </div>
              <ul className="divide-y divide-line">
                {draftRows.map((d) => {
                  const c = draftCreatorBy.get(d.creatorId);
                  const s = scores.get(d.creatorId);
                  const status = viewsBarStatus(s, bar);
                  return (
                    <li key={d.id} className="space-y-2 px-4 py-3">
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px]">
                        <Link href={`/creators/${d.creatorId}`} className="text-[14px] font-medium hover:underline">
                          {c?.name ?? "Unknown"}
                        </Link>
                        <span className="text-ink-2">{c?.email}</span>
                        {status !== "unscored" && <span className={cx("num", status === "below" ? "text-loss" : "text-muted")}>typical {compact(s!.medianViews)}</span>}
                        <span className="num ml-auto text-muted">drafted {relative(d.createdAt)}</span>
                      </div>
                      <input name={`subject:${d.id}`} defaultValue={d.subject ?? ""} className={cx(input, "font-medium")} aria-label="Subject" />
                      <textarea name={`body:${d.id}`} defaultValue={d.body} rows={7} className={input} aria-label="Body" />
                      {status === "below" && (
                        <label className="flex items-center gap-2 text-[14px] text-loss">
                          <input type="checkbox" name={`override:${d.id}`} />
                          Under your {bar.toLocaleString("en-US")} views bar. Send anyway
                        </label>
                      )}
                      <div className="flex gap-2">
                        <SubmitButton name="intent" value={`send:${d.id}`} pendingText="Scheduling…" className={btnSm}>
                          Send
                        </SubmitButton>
                        <button type="submit" name="intent" value={`discard:${d.id}`} className={cx(btn, btnSm, "text-muted")}>
                          Discard
                        </button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </>
          )}
        </TopMessageForm>
      </Card>
    </div>
  );
}

// ─── Sent ───────────────────────────────────────────────────────────────────

async function SentTab() {
  const sent = await db
    .select({
      id: messages.id,
      creatorId: messages.creatorId,
      subject: messages.subject,
      body: messages.body,
      status: messages.status,
      error: messages.error,
      sentAt: messages.sentAt,
      createdAt: messages.createdAt,
      name: creators.name,
      stage: creators.stage,
    })
    .from(messages)
    .innerJoin(creators, eq(creators.id, messages.creatorId))
    .where(and(eq(messages.direction, "out"), inArray(messages.status, ["sent", "simulated", "failed"])))
    .orderBy(desc(sql`coalesce(${messages.sentAt}, ${messages.createdAt})`))
    .limit(300);
  const ids = [...new Set(sent.map((m) => m.creatorId))];
  const inbound = ids.length
    ? await db
        .select({ creatorId: messages.creatorId, createdAt: messages.createdAt })
        .from(messages)
        .where(and(eq(messages.direction, "in"), inArray(messages.creatorId, ids)))
    : [];
  const inBy = groupBy(inbound, (m) => m.creatorId);

  if (!sent.length) return <Empty title="Nothing sent yet">Write openers in Compose and send them.</Empty>;
  const now = requestTime();
  return (
    <Card flush>
      <Table head={["When", "Creator", "Subject", "Status", "Reply"]}>
        {sent.map((m) => {
          const at = m.sentAt ?? m.createdAt;
          const gotReply = (inBy.get(m.creatorId) ?? []).some((r) => r.createdAt.getTime() >= at.getTime());
          const scheduled = m.status !== "failed" && at.getTime() > now;
          return (
            <tr key={m.id} className="align-top">
              <Td mono className="whitespace-nowrap text-ink-2">
                {scheduled ? centralLabel(at) : dateTime(at)}
              </Td>
              <Td>
                <Link href={`/creators/${m.creatorId}`} className="whitespace-nowrap font-medium hover:underline">
                  {m.name}
                </Link>
              </Td>
              <Td>
                <span className="line-clamp-1 max-w-[380px]" title={m.body}>
                  {m.subject ?? m.body.slice(0, 80)}
                </span>
              </Td>
              <Td>
                <MsgStatusBadge status={scheduled ? "scheduled" : m.status} />
                {m.status === "failed" && <p className="mt-1 max-w-[280px] text-[13px] text-loss">{m.error ?? "Reason not saved"}</p>}
              </Td>
              <Td>{gotReply ? <span className="text-ink">replied</span> : <span className="text-muted">—</span>}</Td>
            </tr>
          );
        })}
      </Table>
    </Card>
  );
}
