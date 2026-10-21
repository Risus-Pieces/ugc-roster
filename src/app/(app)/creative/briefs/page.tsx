import Link from "next/link";
import Form from "next/form";
import { connection } from "next/server";
import { eq, inArray } from "drizzle-orm";
import { db, briefs, creators } from "@/db";
import { Badge, Empty, PageHeader, btn, btnSm, input, cx, type Tone } from "@/components/ui";
import { ActionForm, SubmitButton } from "@/components/client";
import { generateBriefsAction } from "@/app/actions/jobs";
import { getOps } from "@/lib/settings";
import { isoDate } from "@/lib/format";

export const metadata = { title: "Daily briefs" };

type Brief = typeof briefs.$inferSelect;

const KINDS = [
  { key: "proven", title: "Proven formats", blurb: "Structures that already work in the hook bank, with fresh words." },
  { key: "test", title: "Format tests", blurb: "New formats being tried on a small share of the roster." },
  { key: "breakout", title: "Breakout variations", blurb: "Rewrites of a video that just took off, sent to everyone." },
] as const;

const STATUS_TONE: Record<Brief["status"], Tone> = { assigned: "neutral", submitted: "info", done: "profit", skipped: "loss" };

const shift = (date: string, days: number) => isoDate(new Date(new Date(`${date}T00:00:00Z`).getTime() + days * 86_400_000));

export default async function BriefsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await connection();
  const sp = await searchParams;
  const today = isoDate(new Date()); // same UTC date the brief writer uses
  const raw = Array.isArray(sp.date) ? sp.date[0] : sp.date;
  const date = raw && /^\d{4}-\d{2}-\d{2}$/.test(raw) && !Number.isNaN(Date.parse(raw)) ? raw : today;

  const [ops, rows] = await Promise.all([getOps(), db.select().from(briefs).where(eq(briefs.date, date))]);
  const ids = [...new Set(rows.map((b) => b.creatorId))];
  const names = ids.length ? await db.select({ id: creators.id, name: creators.name }).from(creators).where(inArray(creators.id, ids)) : [];
  const nameOf = new Map(names.map((n) => [n.id, n.name]));
  const byKind = (k: Brief["kind"]) => rows.filter((b) => b.kind === k).sort((a, b) => (nameOf.get(a.creatorId) ?? "").localeCompare(nameOf.get(b.creatorId) ?? ""));

  const proven = rows.filter((b) => b.kind === "proven").length;
  const test = rows.filter((b) => b.kind === "test").length;
  const daily = proven + test;
  const testTarget = Math.round(ops.testShare * 100);
  const done = rows.filter((b) => b.status === "done").length;
  const submitted = rows.filter((b) => b.status === "submitted").length;

  return (
    <>
      <PageHeader
        step="04 · Create"
        title="Daily briefs"
        description={`Each creator gets a hook, a script and a shot list every day — about ${100 - testTarget}% on proven formats from the hook bank and ${testTarget}% testing new ones.`}
        actions={
          date === today ? (
            <ActionForm action={generateBriefsAction}>
              <SubmitButton variant="primary" pendingText="Writing briefs…">
                Write today&apos;s briefs
              </SubmitButton>
            </ActionForm>
          ) : (
            <Link href="/creative/briefs" className={btn}>
              Back to today
            </Link>
          )
        }
      />

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-1">
          <Link href={`/creative/briefs?date=${shift(date, -1)}`} className={cx(btn, btnSm)} aria-label="Previous day">
            ←
          </Link>
          <Form action="/creative/briefs" className="flex items-center gap-1">
            <input type="date" name="date" defaultValue={date} className={cx(input, "num w-[150px]")} aria-label="Brief date" />
            <button type="submit" className={cx(btn, btnSm)}>
              Go
            </button>
          </Form>
          <Link href={`/creative/briefs?date=${shift(date, 1)}`} className={cx(btn, btnSm)} aria-label="Next day">
            →
          </Link>
        </div>
        <span className="text-[14px] text-ink-2">
          {new Date(`${date}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", timeZone: "UTC" })}
          {date === today && <span className="text-muted"> · today</span>}
        </span>
      </div>

      {rows.length > 0 && (
        <div className="mb-5 grid gap-3 rounded-lg border border-line bg-panel px-4 py-3 md:grid-cols-[1fr_auto] md:items-center">
          <div>
            <div className="mb-1.5 flex flex-wrap items-baseline gap-x-4 gap-y-1 text-[14px]">
              <span>
                <span className="num font-medium">{proven}</span> proven <span className="num text-muted">({daily ? Math.round((proven / daily) * 100) : 0}%)</span>
              </span>
              <span>
                <span className="num font-medium">{test}</span> test <span className="num text-muted">({daily ? Math.round((test / daily) * 100) : 0}%)</span>
              </span>
              <span>
                <span className="num font-medium">{rows.length - daily}</span> breakout
              </span>
              <span className="text-[13px] text-muted">
                target {100 - testTarget}/{testTarget}
              </span>
            </div>
            <div className="relative flex h-2 overflow-hidden rounded-full bg-sunken" aria-hidden>
              <div className="bg-ink-2" style={{ width: `${daily ? (proven / daily) * 100 : 0}%` }} />
              <div className="bg-tally" style={{ width: `${daily ? (test / daily) * 100 : 0}%` }} />
              <div className="absolute inset-y-0 w-px bg-panel" style={{ left: `${100 - testTarget}%` }} title="target split" />
            </div>
          </div>
          <div className="flex gap-4 text-[14px] text-ink-2">
            <span>
              <span className="num text-ink">{submitted}</span> submitted
            </span>
            <span>
              <span className="num text-ink">{done}</span> done
            </span>
          </div>
        </div>
      )}

      {rows.length === 0 ? (
        <Empty
          title={date === today ? "No briefs written for today yet" : `No briefs for ${date}`}
          action={
            date === today ? (
              <ActionForm action={generateBriefsAction}>
                <SubmitButton variant="primary" pendingText="Writing briefs…">
                  Write today&apos;s briefs
                </SubmitButton>
              </ActionForm>
            ) : undefined
          }
        >
          {date === today ? "Write them now — each creator on trial or the roster gets one." : "Briefs are only written for the day they're for."}
        </Empty>
      ) : (
        <div className="space-y-6">
          {KINDS.map((k) => {
            const list = byKind(k.key);
            if (list.length === 0) return null;
            return (
              <section key={k.key}>
                <div className="mb-2 flex flex-wrap items-baseline gap-x-3">
                  <h2 className="font-display text-[17px] font-bold tracking-[-0.01em]">{k.title}</h2>
                  <span className="num text-[13px] text-muted">{list.length}</span>
                  <span className="text-[13px] text-ink-2">{k.blurb}</span>
                </div>
                <div className="grid gap-3 md:grid-cols-2 2xl:grid-cols-3">
                  {list.map((b) => (
                    <BriefCard key={b.id} b={b} creatorName={nameOf.get(b.creatorId) ?? "Unknown creator"} />
                  ))}
                </div>
              </section>
            );
          })}
        </div>
      )}
    </>
  );
}

function BriefCard({ b, creatorName }: { b: Brief; creatorName: string }) {
  return (
    <article className="flex flex-col rounded-lg border border-line bg-panel">
      <header className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-2">
        <Link href={`/creators/${b.creatorId}`} className="font-medium hover:underline">
          {creatorName}
        </Link>
        <span className="text-[13px] text-ink-2">{b.format}</span>
        <Badge tone={STATUS_TONE[b.status]} className="ml-auto">
          {b.status}
        </Badge>
      </header>
      <div className="flex-1 space-y-2.5 px-4 py-3">
        <div className="font-display text-[16px] font-bold leading-snug">{b.hook}</div>
        <p className="whitespace-pre-line break-words text-[14px] text-ink-2">{b.script}</p>
        {b.shotList.length > 0 && (
          <ol className="list-decimal space-y-0.5 pl-5 text-[13px] text-ink-2 marker:text-muted">
            {b.shotList.map((s, i) => (
              <li key={i}>{s}</li>
            ))}
          </ol>
        )}
      </div>
      {(b.sourcePostId || b.breakoutId) && (
        <footer className="flex gap-3 border-t border-line px-4 py-2 text-[13px]">
          {b.sourcePostId && (
            <Link href={`/creative/${b.sourcePostId}`} className="text-ink-2 hover:text-ink">
              Source video →
            </Link>
          )}
          {b.breakoutId && (
            <Link href={`/creative/breakouts#${b.breakoutId}`} className="text-ink-2 hover:text-ink">
              Breakout →
            </Link>
          )}
        </footer>
      )}
    </article>
  );
}
