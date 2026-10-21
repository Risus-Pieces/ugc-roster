import Link from "next/link";
import { connection } from "next/server";
import { desc, inArray } from "drizzle-orm";
import { db, breakouts, creators, posts } from "@/db";
import { Badge, Empty, Notice, PageHeader, PlatformTag, VerticalFrame, btnSm, cx } from "@/components/ui";
import { ActionForm, SubmitButton } from "@/components/client";
import { getOps } from "@/lib/settings";
import { compact, dateTime, pct, relative } from "@/lib/format";
import { dismissBreakoutAction, sendBreakoutAction } from "../actions";

export const metadata = { title: "Breakouts" };

type Breakout = typeof breakouts.$inferSelect;
type PostLite = { id: string; creatorId: string | null; hookText: string | null; caption: string | null; format: string | null; platform: string; source: string; competitorName: string | null; views: number };

export default async function BreakoutsPage() {
  await connection();
  const [ops, rows, roster] = await Promise.all([
    getOps(),
    db.select().from(breakouts).orderBy(desc(breakouts.detectedAt)),
    db.select({ id: creators.id, name: creators.name }).from(creators).where(inArray(creators.stage, ["active", "trial"])),
  ]);
  const postIds = [...new Set(rows.map((b) => b.postId))];
  const postRows: PostLite[] = postIds.length
    ? await db
        .select({ id: posts.id, creatorId: posts.creatorId, hookText: posts.hookText, caption: posts.caption, format: posts.format, platform: posts.platform, source: posts.source, competitorName: posts.competitorName, views: posts.views })
        .from(posts)
        .where(inArray(posts.id, postIds))
    : [];
  const postOf = new Map(postRows.map((p) => [p.id, p]));
  const authorIds = [...new Set(postRows.map((p) => p.creatorId).filter((x): x is string => Boolean(x)))];
  const authors = authorIds.length ? await db.select({ id: creators.id, name: creators.name }).from(creators).where(inArray(creators.id, authorIds)) : [];
  const nameOf = new Map(authors.map((a) => [a.id, a.name]));

  const order = { new: 0, sent: 1, dismissed: 2 } as const;
  const live = rows.filter((b) => b.status !== "dismissed").sort((a, b) => order[a.status] - order[b.status]);
  const dismissed = rows.filter((b) => b.status === "dismissed");
  const t = ops.breakout;

  return (
    <>
      <PageHeader
        step="04 · Create"
        title="Breakouts"
        description="When a roster video takes off, variations are written the same day so every creator can ride the trend while it lasts."
      />

      <div className="mb-4 flex flex-wrap items-center gap-x-6 gap-y-2 rounded-lg border border-line bg-panel px-4 py-3 text-[14px]">
        <span className="text-muted">Alert threshold</span>
        <span>
          <span className="num font-medium">{compact(t.minViews)}+</span> views
        </span>
        <span>
          at <span className="num font-medium">{pct(t.minEngagementRate, 0)}+</span> engagement
        </span>
        <span>
          within <span className="num font-medium">{t.maxAgeHours}h</span> of posting
        </span>
        <Link href="/settings" className="ml-auto text-[13px] text-ink-2 hover:text-ink">
          Change in settings →
        </Link>
      </div>

      <div className="mb-4">
        <Notice>Variations are rewrites, not word-for-word copies: same hook mechanism and format, new wording and scenario. Copies get flagged by the originality check in review.</Notice>
      </div>

      {live.length === 0 ? (
        <Empty title="No breakouts right now">Breakouts are detected on every account sync. You can also write variations for any video from the <Link href="/creative" className="underline">hook bank</Link>.</Empty>
      ) : (
        <div className="space-y-4">
          {live.map((b) => {
            const p = postOf.get(b.postId);
            const recipients = roster.filter((c) => c.id !== p?.creatorId).length;
            return <BreakoutCard key={b.id} b={b} p={p} author={p?.creatorId ? nameOf.get(p.creatorId) : undefined} recipients={recipients} />;
          })}
        </div>
      )}

      {dismissed.length > 0 && (
        <details className="mt-6">
          <summary className="cursor-pointer text-[14px] text-ink-2 hover:text-ink">
            Dismissed <span className="num">({dismissed.length})</span>
          </summary>
          <div className="mt-3 space-y-4 opacity-80">
            {dismissed.map((b) => {
              const p = postOf.get(b.postId);
              return <BreakoutCard key={b.id} b={b} p={p} author={p?.creatorId ? nameOf.get(p.creatorId) : undefined} recipients={0} />;
            })}
          </div>
        </details>
      )}
    </>
  );
}

function BreakoutCard({ b, p, author, recipients }: { b: Breakout; p?: PostLite; author?: string; recipients: number }) {
  const who = p?.source === "competitor" ? (p.competitorName ?? "Competitor") : (author ?? "Roster creator");
  const hook = p?.hookText ?? (p?.caption ?? "Original video").split("\n")[0];
  return (
    <article id={b.id} className={cx("grid scroll-mt-6 gap-4 rounded-lg border bg-panel p-4 md:grid-cols-[180px_1fr]", b.status === "new" ? "border-tally/60" : "border-line")}>
      <div className="mx-auto w-full max-w-[180px]">
        <VerticalFrame hook={hook} views={p?.views ?? b.views} meta={`${who} · ${p?.format ?? "untagged"}`} href={p ? `/creative/${p.id}` : undefined} tone={b.status === "new" ? "tally" : undefined} />
      </div>

      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <Badge tone={b.status === "new" ? "tally" : b.status === "sent" ? "profit" : "neutral"}>{b.status === "new" ? "new breakout" : b.status}</Badge>
          {p?.creatorId ? (
            <Link href={`/creators/${p.creatorId}`} className="font-medium hover:underline">
              {who}
            </Link>
          ) : (
            <span className="font-medium">{who}</span>
          )}
          {p && <PlatformTag platform={p.platform} />}
          <span className="text-[13px] text-muted" title={dateTime(b.detectedAt)}>
            detected {relative(b.detectedAt)}
          </span>
        </div>
        <div className="mt-1 flex flex-wrap gap-x-4 text-[14px] text-ink-2">
          <span>
            <span className="num text-ink">{compact(b.views)}</span> views at detection
          </span>
          <span>
            <span className="num text-ink">{pct(b.engagementRate)}</span> engagement
          </span>
          <span>
            <span className="num text-ink">{b.variations.length}</span> variations
          </span>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          {b.status === "new" && (
            <>
              <ActionForm action={sendBreakoutAction}>
                <input type="hidden" name="breakoutId" value={b.id} />
                <SubmitButton variant="primary" pendingText="Sending…" disabled={recipients === 0}>
                  Send to every creator <span className="num opacity-70">({recipients})</span>
                </SubmitButton>
              </ActionForm>
              <ActionForm action={dismissBreakoutAction}>
                <input type="hidden" name="breakoutId" value={b.id} />
                <SubmitButton pendingText="Dismissing…">Dismiss</SubmitButton>
              </ActionForm>
            </>
          )}
          {b.status === "sent" && (
            <p className="text-[14px] text-profit">
              Sent to <span className="num">{b.sentToCount}</span> creators as a breakout brief.{" "}
              <Link href="/creative/briefs" className={cx("text-ink-2 underline hover:text-ink", btnSm)}>
                See today&apos;s briefs
              </Link>
            </p>
          )}
        </div>

        <ol className="mt-4 grid gap-2 lg:grid-cols-2">
          {b.variations.map((v, i) => (
            <li key={i} className="rounded-md border border-line bg-sunken/50 p-3">
              <div className="flex gap-2">
                <span className="num mt-0.5 text-[12px] text-muted">{String(i + 1).padStart(2, "0")}</span>
                <div className="min-w-0">
                  <div className="font-display font-bold leading-snug">{v.hook}</div>
                  <p className="mt-1 whitespace-pre-line break-words text-[14px] text-ink-2">{v.script}</p>
                  {v.onScreenText && (
                    <p className="mt-1.5 text-[13px]">
                      <span className="text-muted">On-screen text: </span>
                      {v.onScreenText}
                    </p>
                  )}
                </div>
              </div>
            </li>
          ))}
        </ol>
      </div>
    </article>
  );
}
