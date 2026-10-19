import Link from "next/link";
import { connection } from "next/server";
import { and, desc, eq, gte, inArray, isNull } from "drizzle-orm";
import { db, activity, breakouts, contracts, creators, messages, posts, reviews, statements, taxForms } from "@/db";
import { Card, Grid, PageHeader, Stat, MarginBar, Badge, Meter, btn, cx } from "@/components/ui";
import { Sprite, Villager, type SpriteName } from "@/components/sprites";
import { ActionForm, SubmitButton } from "@/components/client";
import { creatorEconomics } from "@/lib/services/decisions";
import { warmupStatus } from "@/lib/engines/onboarding";
import { compact, usd, usd2, relative, requestTime } from "@/lib/format";
import { syncAllAction, generateBriefsAction } from "@/app/actions/jobs";

export const metadata = { title: "Today" };

const QUEST_ICON: Record<string, SpriteName> = {
  "/review": "magnifier",
  "/outreach": "letter",
  "/creative/breakouts": "star",
  "/payouts": "coin",
  "/onboarding": "scroll",
  "/onboarding?tab=tax": "scroll",
};

export default async function TodayPage() {
  await connection();
  const now = new Date(requestTime());
  const weekAgo = new Date(now.getTime() - 7 * 86_400_000);
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);

  const [pendingReviews, inbox, newBreakouts, draftStatements, unsignedContracts, missingTax, roster, weekPosts, monthStatements, feed, econ] = await Promise.all([
    db.$count(reviews, eq(reviews.status, "pending")),
    db.$count(messages, and(eq(messages.direction, "in"), eq(messages.status, "received"))),
    db.$count(breakouts, eq(breakouts.status, "new")),
    db.$count(statements, eq(statements.status, "draft")),
    db.$count(contracts, inArray(contracts.status, ["draft", "sent"])),
    db.$count(taxForms, eq(taxForms.status, "requested")),
    db.select().from(creators).where(inArray(creators.stage, ["trial", "active"])),
    db.select({ views: posts.views, creatorId: posts.creatorId }).from(posts).where(and(eq(posts.isCampaignPost, true), gte(posts.postedAt, weekAgo), isNull(posts.removedAt))),
    db.select({ total: statements.totalCents, status: statements.status }).from(statements).where(gte(statements.periodStart, monthStart)),
    db.select().from(activity).orderBy(desc(activity.at)).limit(12),
    creatorEconomics(),
  ]);

  const warmups = roster.map((c) => ({ c, w: warmupStatus(c.warmupStartedAt, c.warmupTargetDays) })).filter((x) => x.w.started && !x.w.done);
  const active = roster.filter((c) => c.stage === "active").length;
  const weekViews = weekPosts.reduce((a, p) => a + p.views, 0);
  const spend = monthStatements.reduce((a, s) => a + s.total, 0);
  const judged = econ.filter((e) => e.views > 0 && e.revenuePer1kCents > 0);
  const totalViews = judged.reduce((a, e) => a + e.views, 0);
  const blendedRev = totalViews ? judged.reduce((a, e) => a + e.revenuePer1kCents * e.views, 0) / totalViews : 0;
  const blendedCost = totalViews ? judged.reduce((a, e) => a + e.decision.costPer1kCents * e.views, 0) / totalViews : 0;
  const scale = Math.max(...judged.map((e) => Math.max(e.revenuePer1kCents, e.decision.costPer1kCents)), 1);

  const season = ["Winter", "Winter", "Spring", "Spring", "Spring", "Summer", "Summer", "Summer", "Autumn", "Autumn", "Autumn", "Winter"][now.getMonth()];
  const todo = [
    { n: pendingReviews, label: "drafts waiting for review", href: "/review" },
    { n: inbox, label: "creator replies to answer", href: "/outreach" },
    { n: newBreakouts, label: "breakouts to send to the roster", href: "/creative/breakouts" },
    { n: draftStatements, label: "statements to approve", href: "/payouts" },
    { n: unsignedContracts, label: "contracts not signed yet", href: "/onboarding" },
    { n: missingTax, label: "tax forms missing", href: "/onboarding?tab=tax" },
  ].filter((t) => t.n > 0);

  return (
    <>
      <PageHeader
        icon="sun"
        step={`${season} · day ${now.getDate()}`}
        title="Today"
        description={now.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" })}
        actions={
          <>
            <ActionForm action={syncAllAction}>
              <SubmitButton pendingText="Syncing…">Sync all accounts</SubmitButton>
            </ActionForm>
            <ActionForm action={generateBriefsAction}>
              <SubmitButton variant="primary" pendingText="Writing briefs…">
                Write today&apos;s briefs
              </SubmitButton>
            </ActionForm>
          </>
        }
      />

      <Grid cols={5} className="mb-6">
        <Stat icon="sprout" label="Active creators" value={active} hint={`${roster.length - active} in trial`} />
        <Stat icon="star" label="Videos, last 7 days" value={weekPosts.length} hint={`${new Set(weekPosts.map((p) => p.creatorId)).size} creators posted`} />
        <Stat icon="chart" label="Views, last 7 days" value={compact(weekViews)} />
        <Stat icon="wheat" label="Profit per 1K views" value={usd2(blendedRev - blendedCost)} tone={blendedRev >= blendedCost ? "profit" : "loss"} hint={`${usd2(blendedRev)} revenue − ${usd2(blendedCost)} cost`} />
        <Stat icon="coin" label="Owed this month" value={usd(spend)} hint="draft + approved + paid" />
      </Grid>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
        <div className="space-y-4">
          <Card title="Quest board" action={<span className="text-[12px] font-bold text-muted">{todo.length ? `${todo.length} open` : "all done"}</span>}>
            {todo.length === 0 ? (
              <div className="flex items-center gap-3 text-ink-2">
                <Sprite name="chicken" scale={3} className="bob" />
                Nothing waiting. Check the profit check below for creators to promote or cut.
              </div>
            ) : (
              <ul className="grid gap-2 sm:grid-cols-2">
                {todo.map((t) => (
                  <li key={t.href}>
                    <Link href={t.href} className="flex items-center gap-3 border-2 border-line bg-field px-3 py-2 hover:border-line-strong">
                      <Sprite name={QUEST_ICON[t.href] ?? "scroll"} scale={2} />
                      <span className="flex-1">
                        <span className="num mr-1.5 text-[15px] text-tally">{t.n}</span>
                        {t.label}
                      </span>
                      <span className="font-display text-gold" aria-hidden>
                        !
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card
            title="Profit per 1K views"
            action={
              <Link href="/decisions" className="text-[12px] text-ink-2 hover:text-ink">
                Full profit check →
              </Link>
            }
            flush
          >
            <ul className="divide-y divide-line">
              {judged.slice(0, 5).concat(judged.length > 8 ? judged.slice(-3) : []).map((e, i) => (
                <li key={e.creatorId} className={cx("grid grid-cols-[1fr_auto] items-center gap-4 px-4 py-2 sm:grid-cols-[200px_1fr_90px]", i === 5 && "border-t-2 border-dashed border-line-strong")}>
                  <Link href={`/creators/${e.creatorId}`} className="flex min-w-0 items-center gap-2 font-bold hover:underline">
                    <Villager seed={e.creatorId} scale={2} />
                    <span className="truncate">{e.name}</span>
                  </Link>
                  <div className="hidden sm:block">
                    <MarginBar revenue={e.revenuePer1kCents} cost={e.decision.costPer1kCents} scale={scale} />
                  </div>
                  <Badge tone={e.decision.action === "promote" ? "profit" : e.decision.action === "cut" ? "loss" : "neutral"} className="justify-self-end">
                    {e.decision.action}
                  </Badge>
                </li>
              ))}
            </ul>
          </Card>
        </div>

        <div className="space-y-4">
          {warmups.length > 0 && (
            <Card title="Growing (warm-up)">
              <ul className="space-y-3">
                {warmups.map(({ c, w }) => (
                  <li key={c.id} className="flex items-center gap-3">
                    <Sprite name={w.day / w.targetDays < 0.34 ? "crop0" : w.day / w.targetDays < 0.75 ? "crop1" : "crop2"} scale={3} />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-2">
                        <Link href={`/creators/${c.id}`} className="truncate font-bold hover:underline">
                          {c.name}
                        </Link>
                        <span className="num shrink-0 text-[12px] text-ink-2">
                          day {w.day}/{w.targetDays}
                        </span>
                      </div>
                      <div className="mt-1">
                        <Meter value={w.day} max={w.targetDays} tone="profit" />
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            </Card>
          )}
          <Card title="Village news" flush>
            <ul className="divide-y divide-line">
              {feed.map((a) => (
                <li key={a.id} className="flex gap-3 px-4 py-2 text-[13px]">
                  <span className="num w-14 shrink-0 text-[11px] leading-5 text-muted">{relative(a.at)}</span>
                  {a.creatorId ? (
                    <Link href={`/creators/${a.creatorId}`} className="hover:underline">
                      {a.message}
                    </Link>
                  ) : (
                    <span>{a.message}</span>
                  )}
                </li>
              ))}
            </ul>
          </Card>
          <Link href="/decisions/forecast" className={cx(btn, "w-full")}>
            Forecast creators &amp; budget →
          </Link>
        </div>
      </div>
    </>
  );
}
