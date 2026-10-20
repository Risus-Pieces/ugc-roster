import Link from "next/link";
import { connection } from "next/server";
import { and, asc, desc, eq, inArray, isNotNull, ne, sql } from "drizzle-orm";
import { db, calls, campaigns, creatorAccounts, creators, messages } from "@/db";
import { Card, Empty, Field, Grid, Notice, PageHeader, StageBadge, Stat, Table, Tabs, Td, btn, btnSm, cx, input, label } from "@/components/ui";
import { ActionForm, SubmitButton } from "@/components/client";
import { coldEmailsSentToday, followUpsDue, outreachMode } from "@/lib/services/outreach";
import { latestScores } from "@/lib/services/common";
import { getBrand, getOps } from "@/lib/settings";
import { compact, dateTime, day, pct, relative } from "@/lib/format";
import { bookCallAction, draftFollowUpsAction, draftsAction, logReplyAction, sendReplyAction, writeOpenersAction } from "./actions";
import { TopMessageForm } from "./top-message-form";
import { TzInput } from "./tz-input";
import { Authenticity, ClassBadge, Handles, MsgStatusBadge, groupBy, one, requestTime, type SearchParams } from "../creators/bits";

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
    coldEmailsSentToday(),
    getOps(),
  ]);

  return (
    <>
      <PageHeader step="02 · Reach" title="Outreach" description="Email first: cold email gets 10–20% reply rates, DMs 2–4%. Every opener mentions a recent video and states the pay up front." />

      <div className="mb-4 grid gap-2 md:grid-cols-2">
        {mode.emailLive ? (
          <Notice tone="profit">Email is live — messages go out through Resend from EMAIL_FROM.</Notice>
        ) : (
          <Notice tone="tally">Email is simulated — messages are logged but not delivered. Set RESEND_API_KEY and EMAIL_FROM (use a separate outreach domain with SPF, DKIM and DMARC).</Notice>
        )}
        {mode.aiLive ? (
          <Notice tone="profit">AI drafting is on — Claude writes openers from each creator&apos;s recent captions and triages replies.</Notice>
        ) : (
          <Notice>Openers and reply drafts use templates. Set ANTHROPIC_API_KEY to have Claude write them from each creator&apos;s recent videos.</Notice>
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
        <p className="mb-3 text-[13px] text-ink-2">
          <span className="num">
            {sentToday}/{ops.outreach.dailySendLimit}
          </span>{" "}
          cold emails sent today. Every opener and follow-up gets a footer with your mailing address and an opt-out line, and creators who said no are never emailed again.
        </p>
      )}
      {tab === "replies" ? <RepliesTab /> : tab === "followups" ? <FollowUpsTab due={due} days={ops.outreach.followUpDays} /> : tab === "compose" ? <ComposeTab pick={Number(one(sp.pick) ?? 0) || 0} /> : <SentTab />}
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
          <span className="text-[12px] text-muted">Drafts go to Compose so you can read them before they send.</span>
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
                action={<span className="num text-[12px] text-muted">{relative(m.createdAt)}</span>}
              >
                {last && (
                  <details className="mb-2 text-[12px] text-muted">
                    <summary className="cursor-pointer">
                      Your message · <span className="num">{day(last.sentAt ?? last.createdAt)}</span>
                      {last.subject ? ` · ${last.subject}` : ""}
                    </summary>
                    <p className="mt-1 whitespace-pre-wrap rounded-md border border-line px-3 py-2 text-ink-2">{last.body}</p>
                  </details>
                )}
                {m.subject && <div className="mb-1 text-[12px] text-muted">{m.subject}</div>}
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
                      {m.classification === "not_interested" && <span className="text-[12px] text-muted">Sending also moves them to cut.</span>}
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
                      <p className="text-[12px] text-ink-2">
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

async function ComposeTab({ pick }: { pick: number }) {
  const [prospects, touched, draftRows, camps] = await Promise.all([
    db
      .select()
      .from(creators)
      .where(and(eq(creators.stage, "prospect"), isNotNull(creators.email))),
    db.selectDistinct({ creatorId: messages.creatorId }).from(messages).where(eq(messages.direction, "out")),
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
        db.select({ creatorId: creatorAccounts.creatorId, platform: creatorAccounts.platform, handle: creatorAccounts.handle }).from(creatorAccounts).where(inArray(creatorAccounts.creatorId, ids)),
        draftCreatorIds.length ? db.select().from(creators).where(inArray(creators.id, draftCreatorIds)) : Promise.resolve([]),
      ])
    : [new Map(), [], []];
  const acctBy = groupBy(accts, (a) => a.creatorId);
  const draftCreatorBy = new Map(draftCreators.map((c) => [c.id, c]));
  const ranked = [...fresh].sort((a, b) => (scores.get(b.id)?.medianViews ?? -1) - (scores.get(a.id)?.medianViews ?? -1));
  const preselected = new Set(
    ranked
      .filter((c) => scores.get(c.id)?.authenticityVerdict === "pass")
      .slice(0, pick)
      .map((c) => c.id),
  );

  return (
    <div className="space-y-4">
      <Card title="Pick prospects" action={<span className="num text-[12px] text-muted">{ranked.length} with email, not contacted</span>} flush>
        {ranked.length === 0 ? (
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
          <TopMessageForm action={writeOpenersAction} key={`pick-${pick}`}>
            <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-2">
              <Link href="/outreach?tab=compose&pick=10" scroll={false} className={cx(btn, btnSm)}>
                Tick top 10 real audiences
              </Link>
              {pick > 0 && (
                <Link href="/outreach?tab=compose" scroll={false} className={cx(btn, btnSm)}>
                  Clear ticks
                </Link>
              )}
              <span className="text-[12px] text-muted">Sorted by median views.</span>
            </div>
            <div className="max-h-[440px] overflow-y-auto">
              <Table head={["", "Creator", "Handle", { label: "Median views", align: "right" }, { label: "Worst 5 avg", align: "right" }, "Audience", "Email"]}>
                {ranked.map((c) => {
                  const s = scores.get(c.id);
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
                        <Handles accounts={(acctBy.get(c.id) ?? []).slice(0, 2)} />
                      </Td>
                      <Td right mono className="font-medium">
                        {s ? compact(s.medianViews) : "—"}
                      </Td>
                      <Td right mono>
                        {s && s.sampleSize > 0 ? compact(s.worst5AvgViews) : "—"}
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
              <span className="text-[12px] text-muted">Up to 25 at a time. Nothing is sent until you press Send.</span>
            </div>
          </TopMessageForm>
        )}
      </Card>

      <Card title="Drafts" action={<span className="num text-[12px] text-muted">{draftRows.length}</span>} flush>
        {/* The form stays mounted when the list empties so the "N sent" result is still shown. */}
        <TopMessageForm action={draftsAction}>
          {draftRows.length === 0 ? (
            <p className="p-4 text-ink-2">No drafts. Tick prospects above and press Write openers.</p>
          ) : (
            <>
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-2">
                <span className="text-[12px] text-muted">Edit any draft, then send it on its own or send them all. Edits are kept either way.</span>
                <SubmitButton variant="primary" name="intent" value="send-all" pendingText="Sending…">
                  Send all {draftRows.length}
                </SubmitButton>
              </div>
              <ul className="divide-y divide-line">
                {draftRows.map((d) => {
                  const c = draftCreatorBy.get(d.creatorId);
                  const s = scores.get(d.creatorId);
                  return (
                    <li key={d.id} className="space-y-2 px-4 py-3">
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px]">
                        <Link href={`/creators/${d.creatorId}`} className="text-[13px] font-medium hover:underline">
                          {c?.name ?? "Unknown"}
                        </Link>
                        <span className="text-ink-2">{c?.email}</span>
                        {s && <span className="num text-muted">median {compact(s.medianViews)}</span>}
                        <span className="num ml-auto text-muted">drafted {relative(d.createdAt)}</span>
                      </div>
                      <input name={`subject:${d.id}`} defaultValue={d.subject ?? ""} className={cx(input, "font-medium")} aria-label="Subject" />
                      <textarea name={`body:${d.id}`} defaultValue={d.body} rows={7} className={input} aria-label="Body" />
                      <div className="flex gap-2">
                        <SubmitButton name="intent" value={`send:${d.id}`} pendingText="Sending…" className={btnSm}>
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
  return (
    <Card flush>
      <Table head={["Sent", "Creator", "Subject", "Status", "Reply"]}>
        {sent.map((m) => {
          const at = m.sentAt ?? m.createdAt;
          const gotReply = (inBy.get(m.creatorId) ?? []).some((r) => r.createdAt.getTime() >= at.getTime());
          return (
            <tr key={m.id}>
              <Td mono className="whitespace-nowrap text-ink-2">
                {dateTime(at)}
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
                <MsgStatusBadge status={m.status} />
              </Td>
              <Td>{gotReply ? <span className="text-ink">replied</span> : <span className="text-muted">—</span>}</Td>
            </tr>
          );
        })}
      </Table>
    </Card>
  );
}
