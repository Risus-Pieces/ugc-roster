import { Suspense } from "react";
import Loading from "@/app/(app)/loading";
import Link from "next/link";
import { connection } from "next/server";
import { Card, Grid, PageHeader, Stat, Table, Td, Tabs, Empty, PlatformTag, Meter, cx } from "@/components/ui";
import { ActionForm, SubmitButton } from "@/components/client";
import { leaderboard, recentCampaignPostsWithSnapshots, trackingStatus } from "@/lib/services/tracking";
import { compact, pct, dateTime, relative } from "@/lib/format";
import { syncAllAction } from "@/app/actions/jobs";

export const metadata = { title: "Posts & leaderboard" };

const PERIODS = [7, 30, 90] as const;

const Dash = () => <span className="text-muted">—</span>;
const views = (n: number | null) => (n === null ? <Dash /> : compact(n));

/** Own Suspense boundary: same-route navigations (tabs, filters) re-render below the (app) loading boundary. */
export default function TrackingPage(props: { searchParams: Promise<{ days?: string }> }) {
  return (
    <Suspense fallback={<Loading />}>
      <TrackingPageContent {...props} />
    </Suspense>
  );
}

async function TrackingPageContent({ searchParams }: { searchParams: Promise<{ days?: string }> }) {
  await connection();
  const sp = await searchParams;
  const days = (PERIODS as readonly number[]).includes(Number(sp.days)) ? Number(sp.days) : 30;

  const [board, recent, status] = await Promise.all([leaderboard(days), recentCampaignPostsWithSnapshots(50), trackingStatus()]);

  const t = board.reduce(
    (a, r) => ({ posts: a.posts + r.posts, raw: a.raw + r.views, credible: a.credible + r.credibleViews, bot: a.bot + r.botViews, paid: a.paid + r.paidViews }),
    { posts: 0, raw: 0, credible: 0, bot: 0, paid: 0 },
  );
  const top = Math.max(1, ...board.map((r) => r.credibleViews));

  return (
    <>
      <PageHeader
        step="06 · Track"
        title="Posts & leaderboard"
        description="Every campaign post from connected accounts, ranked on credible views: bot views and paid boosts are removed before anything is counted or paid."
        actions={
          <ActionForm action={syncAllAction}>
            <SubmitButton pendingText="Syncing…">Sync all accounts</SubmitButton>
          </ActionForm>
        }
      />

      <Grid cols={5} className="mb-6">
        <Stat label={`Campaign posts, last ${days} days`} value={t.posts} hint={`${board.length} creators posted`} />
        <Stat label="Credible views" value={compact(t.credible)} hint={`of ${compact(t.raw)} reported`} />
        <Stat label="Bot views removed" value={compact(t.bot)} tone={t.bot > 0 ? "tally" : undefined} hint={t.raw ? `${pct(t.bot / t.raw)} of reported views` : undefined} />
        <Stat label="Paid-boost views removed" value={compact(t.paid)} hint="Spark Ads, Promote, boosts" />
        <Stat label="Connected accounts" value={status.connectedAccounts} hint={status.lastSyncedAt ? `last synced ${relative(status.lastSyncedAt)}` : "never synced"} />
      </Grid>

      <div className="mb-6 grid gap-4 xl:grid-cols-[minmax(0,1fr)_300px]">
        <Card title="Leaderboard" className="min-w-0" flush>
          <div className="px-4 pt-3">
            <div className="overflow-x-auto">
              <Tabs active={String(days)} tabs={PERIODS.map((d) => ({ key: String(d), label: `${d} days`, href: `/tracking?days=${d}` }))} />
            </div>
          </div>
          {board.length === 0 ? (
            <div className="p-4">
              <Empty title={`No campaign posts in the last ${days} days`}>Try a longer period, or press Sync all accounts to pull the latest posts from connected creators.</Empty>
            </div>
          ) : (
            <Table
              head={[
                "#",
                "Creator",
                { label: "Posts", align: "right" },
                { label: "Credible views", align: "right" },
                { label: "Median views", align: "right" },
                { label: "ER", align: "right" },
                { label: "Saves", align: "right" },
                { label: "Shares", align: "right" },
                { label: "Bot views removed", align: "right" },
                { label: "Paid views removed", align: "right" },
              ]}
            >
              {board.map((r, i) => (
                <tr key={r.creatorId} className="hover:bg-sunken/60">
                  <Td mono className="text-muted">
                    {i + 1}
                  </Td>
                  <Td className="whitespace-nowrap">
                    <Link href={`/creators/${r.creatorId}`} className="font-medium hover:underline">
                      {r.name}
                    </Link>
                  </Td>
                  <Td right mono>
                    {r.posts}
                  </Td>
                  <Td right mono>
                    <div className="flex items-center justify-end gap-2">
                      <div className="hidden w-16 sm:block">
                        <Meter value={r.credibleViews} max={top} tone="profit" />
                      </div>
                      {compact(r.credibleViews)}
                    </div>
                  </Td>
                  <Td right mono>
                    {compact(r.medianViews)}
                  </Td>
                  <Td right mono>
                    {pct(r.engagementRate)}
                  </Td>
                  <Td right mono>
                    {compact(r.saves)}
                  </Td>
                  <Td right mono>
                    {compact(r.shares)}
                  </Td>
                  <Td right mono className={cx(r.botViews > 0 ? "text-tally" : "text-muted")}>
                    {r.botViews > 0 ? `−${compact(r.botViews)}` : "0"}
                  </Td>
                  <Td right mono className="text-muted">
                    {r.paidViews > 0 ? `−${compact(r.paidViews)}` : "0"}
                  </Td>
                </tr>
              ))}
            </Table>
          )}
        </Card>

        <Card title="How tracking works">
          <ul className="space-y-3 text-[14px] text-ink-2">
            <li>
              <span className="font-medium text-ink">New posts are found automatically.</span> Every connected account is checked on each sync (every 6 hours, or when you press Sync). Posts with a paid-partnership label or #ad after the creator got product access count as campaign posts.
            </li>
            <li>
              <span className="font-medium text-ink">Views are recorded at day 1, 7 and 14.</span> Pay and the leaderboard use the day-14 number (or the latest mark reached), so a slow starter isn&apos;t judged on day one.
            </li>
            <li>
              <span className="font-medium text-ink">Bot views and paid boosts are filtered out.</span> Boosted views come off using the platform&apos;s paid/organic split. If engagement is far below the creator&apos;s normal rate, we only credit the views that engagement can support.
            </li>
          </ul>
        </Card>
      </div>

      <Card title="Recent campaign posts" action={<span className="text-[13px] text-muted">Latest {recent.length} · credible views</span>} flush>
        {recent.length === 0 ? (
          <div className="p-4">
            <Empty title="No campaign posts yet">Posts appear here once a creator in trial or active posts with the paid-partnership label. Connect their accounts during onboarding, then press Sync all accounts.</Empty>
          </div>
        ) : (
          <Table
            head={[
              "Creator",
              "",
              "Posted",
              "Caption",
              { label: "Day 1", align: "right" },
              { label: "Day 7", align: "right" },
              { label: "Day 14", align: "right" },
              { label: "ER", align: "right" },
              { label: "Saves", align: "right" },
              { label: "Shares", align: "right" },
              { label: "Bot / paid removed", align: "right" },
              "",
            ]}
          >
            {recent.map(({ post: p, creatorName, day1, day7, day14, engagementRate, botViews, paidViews }) => (
              <tr key={p.id} className={cx("hover:bg-sunken/60", p.removedAt && "opacity-60")}>
                <Td className="whitespace-nowrap">
                  {p.creatorId ? (
                    <Link href={`/creators/${p.creatorId}`} className="font-medium hover:underline">
                      {creatorName}
                    </Link>
                  ) : (
                    creatorName
                  )}
                </Td>
                <Td>
                  <PlatformTag platform={p.platform} />
                </Td>
                <Td mono className="whitespace-nowrap text-[13px] text-ink-2">
                  {dateTime(p.postedAt)}
                </Td>
                <Td>
                  <div className="max-w-[280px] truncate text-ink-2" title={p.caption ?? ""}>
                    {p.removedAt && <span className="mr-1 text-loss">Removed ·</span>}
                    {p.caption || <span className="text-muted">No caption</span>}
                  </div>
                </Td>
                <Td right mono>
                  {views(day1)}
                </Td>
                <Td right mono>
                  {views(day7)}
                </Td>
                <Td right mono className="font-medium">
                  {views(day14)}
                </Td>
                <Td right mono>
                  {pct(engagementRate)}
                </Td>
                <Td right mono>
                  {compact(p.saves)}
                </Td>
                <Td right mono>
                  {compact(p.shares)}
                </Td>
                <Td right mono className="whitespace-nowrap text-muted">
                  <span className={cx(botViews > 0 && "text-tally")}>{botViews > 0 ? `−${compact(botViews)}` : "0"}</span>
                  {" / "}
                  {paidViews > 0 ? `−${compact(paidViews)}` : "0"}
                </Td>
                <Td right>
                  {p.url ? (
                    <a href={p.url} target="_blank" rel="noopener noreferrer" className="whitespace-nowrap text-[13px] text-ink-2 hover:text-ink">
                      Open ↗
                    </a>
                  ) : (
                    <Dash />
                  )}
                </Td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
    </>
  );
}
