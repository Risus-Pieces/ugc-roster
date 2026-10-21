import Link from "next/link";
import { connection } from "next/server";
import { asc, desc, eq, inArray } from "drizzle-orm";
import { db, briefs, creators, reviews, type Review } from "@/db";
import { Badge, Card, CheckBadge, Empty, Notice, PageHeader, PlatformTag, Tabs, input, label, cx } from "@/components/ui";
import { ActionForm, SubmitButton, KeepForm, KeepSubmit } from "@/components/client";
import { aiEnabled } from "@/lib/ai";
import { dateTime, relative } from "@/lib/format";
import { decideReviewAction, submitOnBehalfAction } from "./actions";
import { DraftFields } from "./draft-fields";

export const metadata = { title: "Review queue" };

const TABS = [
  { key: "pending", label: "Pending" },
  { key: "approved", label: "Approved" },
  { key: "changes_requested", label: "Changes requested" },
  { key: "rejected", label: "Rejected" },
] as const;
type TabKey = (typeof TABS)[number]["key"];

const LIMIT = 40;

export default async function ReviewPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await connection();
  const sp = await searchParams;
  const tab: TabKey = TABS.some((t) => t.key === sp.tab) ? (sp.tab as TabKey) : "pending";

  const [counts, rows, roster] = await Promise.all([
    Promise.all(TABS.map((t) => db.$count(reviews, eq(reviews.status, t.key)))),
    db
      .select()
      .from(reviews)
      .where(eq(reviews.status, tab))
      // Pending: oldest first so nothing waits too long. Decided: most recent first.
      .orderBy(tab === "pending" ? asc(reviews.createdAt) : desc(reviews.decidedAt), desc(reviews.createdAt))
      .limit(LIMIT),
    db.select({ id: creators.id, name: creators.name, stage: creators.stage }).from(creators).where(inArray(creators.stage, ["trial", "active"])).orderBy(creators.name),
  ]);

  const creatorIds = [...new Set(rows.map((r) => r.creatorId))];
  const briefIds = rows.map((r) => r.briefId).filter((x): x is string => Boolean(x));
  const [names, briefRows] = await Promise.all([
    creatorIds.length ? db.select({ id: creators.id, name: creators.name }).from(creators).where(inArray(creators.id, creatorIds)) : [],
    briefIds.length ? db.select({ id: briefs.id, hook: briefs.hook, format: briefs.format, date: briefs.date }).from(briefs).where(inArray(briefs.id, briefIds)) : [],
  ]);
  const nameOf = new Map(names.map((n) => [n.id, n.name]));
  const briefOf = new Map(briefRows.map((b) => [b.id, b]));
  const total = counts[TABS.findIndex((t) => t.key === tab)];

  return (
    <>
      <PageHeader
        step="05 · Review"
        title="Review queue"
        description="Every draft is checked for disclosure, claims, experience, AI labels and originality before a person looks at it. Nothing goes live — or gets paid — without your approval."
      />

      <Tabs active={tab} tabs={TABS.map((t, i) => ({ key: t.key, label: t.label, href: t.key === "pending" ? "/review" : `/review?tab=${t.key}`, count: counts[i] }))} />

      <div className="grid gap-4 xl:grid-cols-[1fr_360px]">
        <div className="min-w-0 space-y-3">
          {rows.length === 0 ? (
            <Empty title={tab === "pending" ? "No drafts waiting" : `No ${TABS.find((t) => t.key === tab)!.label.toLowerCase()} drafts`}>
              {tab === "pending" ? "Creators submit drafts from their portal. You can also add one on a creator's behalf with the form on this page." : "Decided drafts show up here."}
            </Empty>
          ) : (
            rows.map((r) => <ReviewCard key={r.id} r={r} creatorName={nameOf.get(r.creatorId) ?? "Unknown creator"} brief={r.briefId ? briefOf.get(r.briefId) : undefined} />)
          )}
          {total > rows.length && (
            <p className="text-[13px] text-muted">
              Showing the {rows.length} most recent of <span className="num">{total}</span>.
            </p>
          )}
        </div>

        <div className="space-y-3">
          <Card title="Submit a draft on a creator's behalf">
            <p className="mb-3 text-[14px] text-ink-2">For drafts that arrive by email or DM. It runs the same checks and lands in the pending queue.</p>
            <KeepForm action={submitOnBehalfAction} resetOnSuccess>
              <DraftFields creators={roster} />
              <KeepSubmit variant="primary" className="mt-3 w-full" pendingText="Running checks…">
                Submit for review
              </KeepSubmit>
            </KeepForm>
          </Card>
          {!aiEnabled() && <Notice>The AI review pass is off. Add ANTHROPIC_API_KEY to get a second read on claims and disclosure; the rule-based checks run either way.</Notice>}
        </div>
      </div>
    </>
  );
}

function ReviewCard({ r, creatorName, brief }: { r: Review; creatorName: string; brief?: { id: string; hook: string; format: string; date: string } }) {
  const checks = r.checks ?? [];
  const statusTone = r.status === "approved" ? "profit" : r.status === "rejected" ? "loss" : r.status === "changes_requested" ? "tally" : "info";
  return (
    <article className={cx("rounded-lg border bg-panel", r.status === "pending" && r.overall === "fail" ? "border-loss/40" : "border-line")}>
      <header className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-line px-4 py-2.5">
        <Link href={`/creators/${r.creatorId}`} className="font-medium hover:underline">
          {creatorName}
        </Link>
        <PlatformTag platform={r.platform} />
        <span className="text-[13px] text-muted" title={dateTime(r.createdAt)}>
          submitted {relative(r.createdAt)}
        </span>
        <span className="ml-auto flex items-center gap-2">
          {r.overall && (
            <span className="flex items-center gap-1 text-[13px] text-ink-2">
              Checks <CheckBadge status={r.overall} />
            </span>
          )}
          <Badge tone={statusTone}>{r.status.replace("_", " ")}</Badge>
        </span>
      </header>

      <div className="grid gap-4 p-4 lg:grid-cols-[1fr_minmax(0,320px)]">
        <div className="min-w-0 space-y-3">
          {brief && (
            <div className="text-[13px] text-ink-2">
              Brief <span className="num">{brief.date}</span> · {brief.format}: <span className="text-ink">&ldquo;{brief.hook}&rdquo;</span>
            </div>
          )}
          <div>
            <div className={label}>Caption</div>
            <p className="whitespace-pre-line break-words">{r.caption}</p>
          </div>
          {r.transcript && (
            <div>
              <div className={label}>Transcript</div>
              <p className="max-h-44 overflow-y-auto whitespace-pre-line break-words rounded-md bg-sunken px-3 py-2 text-[14px] text-ink-2">{r.transcript}</p>
            </div>
          )}
          <div className="flex flex-wrap gap-1.5">
            <Badge tone={r.paidPartnershipToggle ? "profit" : "tally"}>Paid-partnership label {r.paidPartnershipToggle ? "on" : "off"}</Badge>
            <Badge tone={r.containsAiFootage ? "info" : "neutral"}>{r.containsAiFootage ? "Contains AI footage" : "No AI footage"}</Badge>
            {r.containsAiFootage && <Badge tone={r.aiLabelToggle ? "profit" : "loss"}>AI label {r.aiLabelToggle ? "on" : "off"}</Badge>}
            {r.draftUrl && (
              <a href={r.draftUrl} target="_blank" rel="noreferrer noopener" className="text-[13px] text-info hover:underline">
                Open draft ↗
              </a>
            )}
          </div>
        </div>

        <ul className="space-y-2 lg:border-l lg:border-line lg:pl-4">
          {checks.length === 0 && <li className="text-[14px] text-muted">No checks recorded.</li>}
          {checks.map((c) => (
            <li key={c.key} className="text-[14px]">
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium">{c.label}</span>
                <CheckBadge status={c.status} />
              </div>
              <p className={cx("mt-0.5 text-[13px] leading-snug", c.status === "fail" ? "text-loss" : c.status === "warn" ? "text-ink-2" : "text-muted")}>{c.detail}</p>
            </li>
          ))}
        </ul>
      </div>

      {r.status === "pending" ? (
        <ActionForm action={decideReviewAction} className="border-t border-line px-4 py-3">
          <input type="hidden" name="reviewId" value={r.id} />
          <label className="block">
            <span className="sr-only">Notes for the creator</span>
            <textarea name="notes" rows={2} placeholder="Notes for the creator — required when requesting changes" className={input} />
          </label>
          <div className="mt-2 flex flex-wrap gap-2">
            <SubmitButton variant="primary" name="decision" value="approved" pendingText="Saving…">
              Approve
            </SubmitButton>
            <SubmitButton name="decision" value="changes_requested" pendingText="Saving…">
              Request changes
            </SubmitButton>
            <SubmitButton name="decision" value="rejected" className="!border-loss !text-loss hover:!bg-loss-soft" pendingText="Saving…">
              Reject
            </SubmitButton>
          </div>
        </ActionForm>
      ) : (
        (r.reviewerNotes || r.decidedAt) && (
          <footer className="border-t border-line px-4 py-2.5 text-[14px] text-ink-2">
            {r.decidedAt && <span className="num text-[13px] text-muted">Decided {dateTime(r.decidedAt)}</span>}
            {r.reviewerNotes && <p className="mt-0.5 whitespace-pre-line">{r.reviewerNotes}</p>}
          </footer>
        )
      )}
    </article>
  );
}
