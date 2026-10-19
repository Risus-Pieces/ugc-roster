import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { desc, eq } from "drizzle-orm";
import { db, breakouts, creators, posts } from "@/db";
import { Badge, Card, Grid, PageHeader, PlatformTag, Stat, VerticalFrame, input, label, cx } from "@/components/ui";
import { ActionForm, SubmitButton } from "@/components/client";
import { engagementRate } from "@/lib/engines/breakout";
import { compact, dateTime, day, pct } from "@/lib/format";
import { writeVariationsAction } from "../actions";

export const metadata = { title: "Video" };

export default async function HookPostPage({ params }: { params: Promise<{ postId: string }> }) {
  await connection();
  const { postId } = await params;
  const p = await db.query.posts.findFirst({ where: eq(posts.id, postId) });
  if (!p) notFound();
  const [creator, priorBreakouts] = await Promise.all([
    p.creatorId ? db.query.creators.findFirst({ where: eq(creators.id, p.creatorId) }) : undefined,
    db.select().from(breakouts).where(eq(breakouts.postId, p.id)).orderBy(desc(breakouts.detectedAt)),
  ]);
  const who = p.source === "competitor" ? (p.competitorName ?? "Competitor") : (creator?.name ?? "Roster creator");
  const er = engagementRate(p);

  return (
    <>
      <div className="mb-2 text-[12px]">
        <Link href="/creative" className="text-ink-2 hover:text-ink">
          ← Hook bank
        </Link>
      </div>
      <PageHeader
        title={p.hookText ?? (p.caption ?? "Untitled video").split("\n")[0]}
        description={
          <span className="flex flex-wrap items-center gap-2 text-[13px]">
            {p.source === "competitor" ? <Badge tone="info">competitor</Badge> : creator ? <Link href={`/creators/${creator.id}`} className="hover:underline">{creator.name}</Link> : null}
            {p.source === "competitor" && <span>{who}</span>}
            <PlatformTag platform={p.platform} />
            <span>· posted {day(p.postedAt)}</span>
            {p.format && <Badge>{p.format}</Badge>}
            {p.hookType && <Badge>{p.hookType.replace("_", " ")} hook</Badge>}
            {!p.inHookBank && <Badge tone="tally">not in hook bank</Badge>}
          </span>
        }
      />

      <div className="grid gap-4 md:grid-cols-[220px_1fr]">
        <div className="mx-auto w-full max-w-[220px] space-y-3">
          <VerticalFrame hook={p.hookText ?? (p.caption ?? "").split("\n")[0]} views={p.views} meta={`${who} · ${p.format ?? "untagged"}`} />
          {p.url && (
            <a href={p.url} target="_blank" rel="noreferrer noopener" className="block text-center text-[12px] text-info hover:underline">
              Open original ↗
            </a>
          )}
        </div>

        <div className="min-w-0 space-y-4">
          <Grid cols={5}>
            <Stat label="Views" value={compact(p.views)} />
            <Stat label="Engagement" value={pct(er)} hint="likes+comments+shares+saves ÷ views" />
            <Stat label="Likes" value={compact(p.likes)} />
            <Stat label="Comments" value={compact(p.comments)} />
            <Stat label="Shares" value={compact(p.shares)} hint={p.saves ? `${compact(p.saves)} saves` : undefined} />
          </Grid>

          <div className="grid gap-4 lg:grid-cols-[1fr_300px]">
            <div className="min-w-0 space-y-4">
              <Card title="Transcript">
                {p.transcript ? <p className="whitespace-pre-line break-words leading-relaxed">{p.transcript}</p> : <p className="text-[13px] text-muted">No transcript for this video.</p>}
              </Card>
              {p.caption && (
                <Card title="Caption">
                  <p className="whitespace-pre-line break-words text-ink-2">{p.caption}</p>
                </Card>
              )}
            </div>

            <div className="space-y-4">
              <Card title="Write variations">
                <p className="mb-3 text-[13px] text-ink-2">Rewrites that keep the hook mechanism, format and pacing — with new wording and a new scenario, never a word-for-word copy.</p>
                <ActionForm action={writeVariationsAction}>
                  <input type="hidden" name="postId" value={p.id} />
                  <div className="flex items-end gap-2">
                    <label className="block w-24">
                      <span className={label}>How many</span>
                      <select name="count" defaultValue="6" className={cx(input, "num")}>
                        {[5, 6, 7, 8, 9, 10].map((n) => (
                          <option key={n} value={n}>
                            {n}
                          </option>
                        ))}
                      </select>
                    </label>
                    <SubmitButton variant="primary" className="flex-1" pendingText="Writing…">
                      Write variations
                    </SubmitButton>
                  </div>
                </ActionForm>
              </Card>

              {priorBreakouts.length > 0 && (
                <Card title="Variations already written" flush>
                  <ul className="divide-y divide-line text-[13px]">
                    {priorBreakouts.map((b) => (
                      <li key={b.id} className="flex items-center justify-between gap-2 px-4 py-2">
                        <span>
                          <span className="num">{b.variations.length}</span> variations · {dateTime(b.detectedAt)}
                        </span>
                        <Link href={`/creative/breakouts#${b.id}`} className="flex items-center gap-1.5 hover:underline">
                          <Badge tone={b.status === "new" ? "tally" : b.status === "sent" ? "profit" : "neutral"}>{b.status}</Badge>→
                        </Link>
                      </li>
                    ))}
                  </ul>
                </Card>
              )}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
