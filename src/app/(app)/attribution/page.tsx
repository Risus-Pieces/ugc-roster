import { Suspense } from "react";
import Loading from "@/app/(app)/loading";
import Link from "next/link";
import { connection } from "next/server";
import { Card, Grid, PageHeader, Stat, Table, Td, Tabs, Empty, Notice, Meter, MarginBar, ConfidenceBadge, StageBadge, cx } from "@/components/ui";
import { attributionReport, loadSeries, surveyBreakdown, codeStats, campaignPostTimes, surveyOptions, type AttributionReport } from "@/lib/services/attribution";
import { spendByCreatorSince } from "@/lib/services/payouts";
import { baselines } from "@/lib/engines/attribution";
import { getOps } from "@/lib/settings";
import { compact, usd, usd2, pct, dateTime, isoDate, requestTime } from "@/lib/format";
import { InstallChart, type ChartBucket, type ChartTick } from "./install-chart";
import { publicOrigin } from "../settings/origin";

export const metadata = { title: "Attribution" };

const DAY = 86_400_000;
const HOUR = 3_600_000;
const WINDOW_DAYS = 60;
const TOP_COLORS = ["var(--info)", "var(--tally)", "var(--profit)"];

type Tab = "overview" | "survey" | "codes";

/** Own Suspense boundary: same-route navigations (tabs, filters) re-render below the (app) loading boundary. */
export default function AttributionPage(props: { searchParams: Promise<{ tab?: string }> }) {
  return (
    <Suspense fallback={<Loading />}>
      <AttributionPageContent {...props} />
    </Suspense>
  );
}

async function AttributionPageContent({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  await connection();
  const sp = await searchParams;
  const tab: Tab = sp.tab === "survey" || sp.tab === "codes" ? sp.tab : "overview";
  const report = await attributionReport(WINDOW_DAYS);
  const t = report.totals;
  const attributedShare = t.revenueCents ? t.attributedRevenueCents / t.revenueCents : 0;

  return (
    <>
      <PageHeader
        step="07 · Attribute"
        title="Attribution"
        description="Which creators actually drive installs and revenue. Three independent methods, blended into one estimate with an honest range."
      />

      <Grid cols={6} className="mb-6">
        <Stat label={`Installs, last ${WINDOW_DAYS} days`} value={compact(t.installs)} />
        <Stat label="Revenue" value={usd(t.revenueCents)} />
        <Stat label="Revenue per install" value={usd2(t.arpuCents)} hint="ARPU" />
        <Stat label="Credited to creators" value={pct(attributedShare, 0)} hint={`${usd(t.attributedRevenueCents)} of revenue`} />
        <Stat label="Survey responses" value={compact(t.surveyResponses)} hint={t.surveyResponses < 30 ? "30+ needed to use" : undefined} tone={t.surveyResponses < 30 ? "tally" : undefined} />
        <Stat label="Data granularity" value={report.granularity === "hour" ? "Hourly" : "Daily"} hint={report.granularity === "hour" ? "RevenueCat / analytics" : "App Store / Play reports"} />
      </Grid>

      <div className="overflow-x-auto">
        <Tabs
          active={tab}
          tabs={[
            { key: "overview", label: "By creator", href: "/attribution", count: report.rows.length },
            { key: "survey", label: "Survey", href: "/attribution?tab=survey" },
            { key: "codes", label: "Codes & links", href: "/attribution?tab=codes" },
          ]}
        />
      </div>

      {tab === "overview" && <Overview report={report} />}
      {tab === "survey" && <Survey />}
      {tab === "codes" && <Codes />}
    </>
  );
}

// ─── By creator ─────────────────────────────────────────────────────────────

async function Overview({ report }: { report: AttributionReport }) {
  const now = requestTime();
  const chartFrom = now - 21 * DAY;
  const [{ series, granularity }, postTimes, spend] = await Promise.all([
    loadSeries(new Date(now - 42 * DAY), new Date(now)), // extra history so baselines line up
    campaignPostTimes(new Date(chartFrom)),
    spendByCreatorSince(isoDate(report.from)),
  ]);

  // Chart: 3-hour buckets for hourly data (legible), days otherwise.
  const base = baselines(series);
  const step = granularity === "hour" ? 3 * HOUR : DAY;
  const grouped = new Map<number, ChartBucket>();
  for (const b of series) {
    if (b.t < chartFrom) continue;
    const k = Math.floor(b.t / step) * step;
    const g = grouped.get(k) ?? { t: k, installs: 0, baseline: 0 };
    g.installs += b.installs;
    g.baseline += base.get(b.t) ?? b.installs;
    grouped.set(k, g);
  }
  const buckets = [...grouped.values()].sort((a, b) => a.t - b.t);

  const rows = report.rows;
  const nameOf = new Map(rows.map((r) => [r.creatorId, r.name]));
  const top = [...rows].sort((a, b) => b.estimate.revenueCents - a.estimate.revenueCents).slice(0, TOP_COLORS.length);
  const colorOf = new Map(top.map((r, i) => [r.creatorId, TOP_COLORS[i]]));
  const ticks: ChartTick[] = postTimes.map((p) => ({
    t: p.postedAt,
    color: (p.creatorId && colorOf.get(p.creatorId)) || "var(--muted)",
    label: `${(p.creatorId && nameOf.get(p.creatorId)) || "Creator"} · ${dateTime(p.postedAt)} · ${compact(p.credibleViews)} credible views`,
  }));

  const costPer1k = (r: (typeof rows)[number]) => (r.views > 0 ? Math.round(((spend.get(r.creatorId) ?? 0) / r.views) * 1000) : 0);
  const scale = Math.max(1, ...rows.map((r) => Math.max(r.revenuePer1kHigh, r.revenuePer1k, costPer1k(r))));

  return (
    <div className="space-y-4">
      <Card
        title={`Installs, last 21 days · per ${granularity === "hour" ? "3 hours" : "day"}`}
        action={
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-ink-2">
            <Legend swatch={<span className="inline-block h-0.5 w-4 bg-ink-2" />}>installs</Legend>
            <Legend swatch={<span className="inline-block w-4 border-t border-dashed border-muted" />}>baseline</Legend>
            <Legend swatch={<span className="inline-block h-2.5 w-3 bg-info opacity-30" />}>lift</Legend>
            {top.map((r, i) => (
              <Legend key={r.creatorId} swatch={<span className="inline-block h-2.5 w-0.5" style={{ background: TOP_COLORS[i] }} />}>
                {r.name}
              </Legend>
            ))}
            <Legend swatch={<span className="inline-block h-2.5 w-px bg-muted" />}>other posts</Legend>
          </div>
        }
      >
        <InstallChart buckets={buckets} ticks={ticks} stepMs={step} granularity={granularity} />
        <p className="mt-2 text-[12px] text-muted">Baseline = median installs in the same hour over the previous 3 weeks. The shaded lift right after a post is credited to the creators who posted, split by their credible views.</p>
      </Card>

      <Card title="Per creator" action={<span className="text-[12px] text-muted">Last {WINDOW_DAYS} days · revenue per 1K with cost per 1K taken out</span>} flush>
        {rows.length === 0 ? (
          <div className="p-4">
            <Empty title="No campaign posts in this window">Attribution needs campaign posts and install data. Sync creator accounts on the Posts page and connect RevenueCat or App Store Connect in Settings.</Empty>
          </div>
        ) : (
          <Table
            head={[
              "Creator",
              { label: "Posts", align: "right" },
              { label: "Credible views", align: "right" },
              { label: "Direct", align: "right" },
              { label: "Survey est.", align: "right" },
              { label: "Lift est.", align: "right" },
              { label: "Est. revenue (range)", align: "right" },
              "Revenue per 1K (range) − cost per 1K",
              "Confidence",
            ]}
          >
            {rows.map((r) => {
              const cost = costPer1k(r);
              return (
                <tr key={r.creatorId} className="align-top hover:bg-sunken/60">
                  <Td className="whitespace-nowrap">
                    <Link href={`/creators/${r.creatorId}`} className="font-medium hover:underline">
                      {r.name}
                    </Link>
                  </Td>
                  <Td right mono>
                    {r.posts}
                  </Td>
                  <Td right mono>
                    {compact(r.views)}
                  </Td>
                  <Td right mono>
                    {Math.round(r.direct.installs)}
                  </Td>
                  <Td right mono>
                    {r.survey ? (
                      <span title={`${r.survey.responses} survey answers named them`}>{Math.round(r.survey.installs)}</span>
                    ) : (
                      <span className="text-muted" title="Needs 30+ survey responses">
                        —
                      </span>
                    )}
                  </Td>
                  <Td right mono>
                    {r.lift ? (
                      Math.round(r.lift.installs)
                    ) : (
                      <span className="text-muted" title="Needs 14+ days of install data">
                        —
                      </span>
                    )}
                  </Td>
                  <Td right mono className="whitespace-nowrap">
                    <div className="font-medium">{usd(r.estimate.revenueCents)}</div>
                    <div className="text-[11px] text-muted">
                      {usd(r.estimate.lowCents)}–{usd(r.estimate.highCents)}
                    </div>
                  </Td>
                  <Td>
                    <MarginBar revenue={r.revenuePer1k} cost={cost} scale={scale} low={r.revenuePer1kLow} high={r.revenuePer1kHigh} />
                    <div className="num mt-0.5 text-[11px] text-muted">
                      {usd2(r.revenuePer1k)} ({usd2(r.revenuePer1kLow)}–{usd2(r.revenuePer1kHigh)}) − {usd2(cost)}
                    </div>
                  </Td>
                  <Td>
                    <details className="group">
                      <summary className="cursor-pointer list-none">
                        <ConfidenceBadge level={r.confidence} />
                        <span className="ml-1 text-[11px] text-muted group-open:hidden">why</span>
                      </summary>
                      <ul className="mt-1.5 max-w-[240px] list-disc space-y-0.5 pl-4 text-[12px] text-ink-2">
                        {r.confidenceReasons.map((x) => (
                          <li key={x}>{x}</li>
                        ))}
                      </ul>
                    </details>
                  </Td>
                </tr>
              );
            })}
          </Table>
        )}
      </Card>

      <Card title="How the estimate works">
        <div className="grid gap-4 text-[13px] text-ink-2 md:grid-cols-2 lg:grid-cols-4">
          <Method n="1" title="Link + promo code (direct)">
            Each creator gets their own promo code and a tracking link (<span className="num">/r/CODE</span>). Every install or redemption through them is counted. This is a floor: most viewers just search the App Store and never use either.
          </Method>
          <Method n="2" title="“Where did you hear about us?”">
            An in-app survey lists creator names next to generic options. A creator&apos;s share of answers is applied to all installs in the period. Used once there are 30+ responses.
          </Method>
          <Method n="3" title="Lift after posts">
            Installs and revenue from App Store Connect, Google Play and RevenueCat are lined up with post times. Installs above the same-hour-last-weeks baseline in the 48 hours after a post are credited to whoever posted.
          </Method>
          <Method n="=" title="Estimate and range">
            Estimate = the higher of direct, or the average of survey and lift. The range spans the methods. Confidence rises with views, post count, direct conversions and how well survey and lift agree.
          </Method>
        </div>
      </Card>
    </div>
  );
}

function Legend({ swatch, children }: { swatch: React.ReactNode; children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
      {swatch}
      {children}
    </span>
  );
}

function Method({ n, title, children }: { n: string; title: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-1 flex items-center gap-2 font-medium text-ink">
        <span className="num flex h-5 w-5 items-center justify-center rounded bg-sunken text-[11px]">{n}</span>
        {title}
      </div>
      <p>{children}</p>
    </div>
  );
}

// ─── Survey ─────────────────────────────────────────────────────────────────

async function Survey() {
  const [b, ops, roster] = await Promise.all([surveyBreakdown(WINDOW_DAYS), getOps(), surveyOptions()]);
  const max = Math.max(1, ...b.creators.map((x) => x.count), ...b.generic.map((x) => x.count));
  const share = (n: number) => (b.total ? pct(n / b.total) : "—");

  if (b.total === 0)
    return (
      <Empty title="No survey answers yet" action={<Link href="/settings?tab=integrations" className="text-[13px] font-medium underline">See survey API usage</Link>}>
        Add the &ldquo;Where did you hear about us?&rdquo; question to onboarding in your app. It calls <span className="num">/api/survey</span> for the options and posts the answer back.
      </Empty>
    );

  return (
    <div className="space-y-4">
      <Grid cols={3}>
        <Stat label={`Responses, last ${WINDOW_DAYS} days`} value={compact(b.total)} />
        <Stat label="Named a creator" value={pct(b.creatorTotal / b.total, 0)} hint={`${compact(b.creatorTotal)} answers`} />
        <Stat label="Creators named" value={b.creators.length} hint={`of ${roster.length} on the survey`} />
      </Grid>
      {b.total < 30 && <Notice tone="tally">Survey estimates switch on at 30 responses. {30 - b.total} more to go.</Notice>}
      <div className="grid gap-4 lg:grid-cols-2 [&>*]:min-w-0">
        <Card title="Named a creator" flush>
          <BreakdownList items={b.creators.map((x) => ({ key: x.creatorId!, label: x.answer, href: `/creators/${x.creatorId}`, count: x.count }))} max={max} share={share} tone="profit" />
        </Card>
        <Card title="Generic answers" action={<Link href="/settings?tab=ops" className="text-[12px] text-ink-2 hover:text-ink">Edit options →</Link>} flush>
          <BreakdownList items={b.generic.map((x) => ({ key: x.answer, label: x.answer, count: x.count }))} max={max} share={share} tone="ink" />
        </Card>
      </div>
      <Card title="What people see">
        <p className="mb-2 text-ink-2">
          &ldquo;Where did you hear about us?&rdquo; — creator order is shuffled for each person so nobody wins by being listed first.
        </p>
        <div className="flex flex-wrap gap-1.5">
          {roster.map((c) => (
            <span key={c.id} className="rounded border border-line bg-sunken px-2 py-0.5 text-[12px]">
              {c.name}
            </span>
          ))}
          {ops.surveyOptions.map((o) => (
            <span key={o} className="rounded border border-dashed border-line-strong px-2 py-0.5 text-[12px] text-ink-2">
              {o}
            </span>
          ))}
        </div>
      </Card>
    </div>
  );
}

function BreakdownList({ items, max, share, tone }: { items: { key: string; label: string; href?: string; count: number }[]; max: number; share: (n: number) => string; tone: "profit" | "ink" }) {
  if (!items.length) return <p className="p-4 text-ink-2">No answers in this group yet.</p>;
  return (
    <ul className="divide-y divide-line">
      {items.map((x) => (
        <li key={x.key} className="grid grid-cols-[minmax(0,1fr)_minmax(60px,140px)_48px_52px] items-center gap-3 px-4 py-1.5 text-[13px]">
          {x.href ? (
            <Link href={x.href} className="truncate hover:underline">
              {x.label}
            </Link>
          ) : (
            <span className="truncate">{x.label}</span>
          )}
          <Meter value={x.count} max={max} tone={tone} />
          <span className="num text-right">{x.count}</span>
          <span className="num text-right text-[12px] text-muted">{share(x.count)}</span>
        </li>
      ))}
    </ul>
  );
}

// ─── Codes & links ──────────────────────────────────────────────────────────

async function Codes() {
  const [rows, origin] = await Promise.all([codeStats(WINDOW_DAYS), publicOrigin()]);
  const tot = rows.reduce((a, r) => ({ clicks: a.clicks + r.clicks, installs: a.installs + r.installs, redemptions: a.redemptions + r.redemptions }), { clicks: 0, installs: 0, redemptions: 0 });

  return (
    <div className="space-y-4">
      <Notice tone="info">
        Codes go in captions and on screen; the link goes in bio. A click on <span className="num">{origin}/r/CODE</span> is logged and forwarded to your app link with <span className="num">?ref=CODE</span>. Pass the code to RevenueCat as the <span className="num">creator_code</span> attribute and purchases are matched automatically.
      </Notice>
      <Card title={`Codes & links · last ${WINDOW_DAYS} days`} action={<span className="num text-[12px] text-muted">{compact(tot.clicks)} clicks · {compact(tot.installs)} link installs · {compact(tot.redemptions)} redemptions</span>} flush>
        {rows.length === 0 ? (
          <div className="p-4">
            <Empty title="No creators in trial or active">Codes are assigned when a creator moves to trial on the Pipeline page.</Empty>
          </div>
        ) : (
          <Table
            head={[
              "Creator",
              "Stage",
              "Promo code",
              "Tracking link",
              { label: "Clicks", align: "right" },
              { label: "Link installs", align: "right" },
              { label: "Click → install", align: "right" },
              { label: "Code redemptions", align: "right" },
              { label: "Direct revenue", align: "right" },
            ]}
          >
            {rows.map((r) => (
              <tr key={r.id} className="hover:bg-sunken/60">
                <Td className="whitespace-nowrap">
                  <Link href={`/creators/${r.id}`} className="font-medium hover:underline">
                    {r.name}
                  </Link>
                </Td>
                <Td>
                  <StageBadge stage={r.stage} />
                </Td>
                <Td mono className="font-medium">
                  {r.promoCode ?? <span className="font-normal text-muted">Not assigned</span>}
                </Td>
                <Td>
                  {r.promoCode ? (
                    <a href={`/r/${r.promoCode}`} target="_blank" rel="noopener noreferrer" className="num select-all whitespace-nowrap text-[12px] text-ink-2 hover:text-ink">
                      {origin}/r/{r.promoCode}
                    </a>
                  ) : (
                    <span className="text-muted">—</span>
                  )}
                </Td>
                <Td right mono>
                  {compact(r.clicks)}
                </Td>
                <Td right mono>
                  {compact(r.installs)}
                </Td>
                <Td right mono className={cx(r.clicks === 0 && "text-muted")}>
                  {r.clicks ? pct(r.installs / r.clicks) : "—"}
                </Td>
                <Td right mono>
                  {compact(r.redemptions)}
                </Td>
                <Td right mono>
                  {usd(r.revenueCents)}
                </Td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
    </div>
  );
}
