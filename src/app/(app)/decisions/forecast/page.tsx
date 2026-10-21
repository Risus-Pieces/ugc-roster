import { Suspense } from "react";
import Loading from "@/app/(app)/loading";
import Link from "next/link";
import { connection } from "next/server";
import { Card, Grid, PageHeader, Stat, Notice, Field, input, btn, btnPrimary, cx } from "@/components/ui";
import { rosterForecast, funnelActuals } from "@/lib/services/decisions";
import { forecast } from "@/lib/engines/forecast";
import { rulesOf } from "@/lib/services/common";
import { compact, usd, usd2, pct } from "@/lib/format";

export const metadata = { title: "Forecast" };

type SP = { videos?: string; ppd?: string; views?: string; rev?: string; reply?: string; trial?: string; activation?: string };
const DEFAULT_FUNNEL = { replyRate: 0.15, trialRate: 0.4, activationRate: 0.5 };

/** Parse a positive number from the query; blank or invalid means "use the roster number". */
const num = (v: string | undefined, min: number, max: number) => {
  if (v === undefined || v.trim() === "") return undefined;
  const n = Number(v.replace(/[$,%\s]/g, ""));
  return Number.isFinite(n) && n >= min && n <= max ? n : undefined;
};

/** Own Suspense boundary: same-route navigations (tabs, filters) re-render below the (app) loading boundary. */
export default function ForecastPage(props: { searchParams: Promise<SP> }) {
  return (
    <Suspense fallback={<Loading />}>
      <ForecastPageContent {...props} />
    </Suspense>
  );
}

async function ForecastPageContent({ searchParams }: { searchParams: Promise<SP> }) {
  await connection();
  const sp = await searchParams;
  const target = Math.round(num(sp.videos, 1, 100_000) ?? 150);
  const [actual, funnel] = await Promise.all([rosterForecast(target), funnelActuals()]);

  const o = {
    ppd: num(sp.ppd, 0.1, 20),
    views: num(sp.views, 1, 100_000_000),
    rev: num(sp.rev, 0, 100_000),
    reply: num(sp.reply, 0.1, 100),
    trial: num(sp.trial, 0.1, 100),
    activation: num(sp.activation, 0.1, 100),
  };
  const enoughFunnel = funnel.contacted >= 50;
  const rosterFunnel = {
    replyRate: enoughFunnel && funnel.replyRate ? funnel.replyRate : DEFAULT_FUNNEL.replyRate,
    trialRate: enoughFunnel && funnel.trialRate ? funnel.trialRate : DEFAULT_FUNNEL.trialRate,
    activationRate: enoughFunnel && funnel.activationRate ? funnel.activationRate : DEFAULT_FUNNEL.activationRate,
  };
  const used = {
    postsPerCreatorPerDay: o.ppd ?? actual.inputs.postsPerCreatorPerDay,
    viewsPerVideo: Math.round(o.views ?? actual.inputs.viewsPerVideo),
    revenuePer1kCents: o.rev !== undefined ? Math.round(o.rev * 100) : actual.inputs.revenuePer1kCents,
    replyRate: o.reply !== undefined ? o.reply / 100 : rosterFunnel.replyRate,
    trialRate: o.trial !== undefined ? o.trial / 100 : rosterFunnel.trialRate,
    activationRate: o.activation !== undefined ? o.activation / 100 : rosterFunnel.activationRate,
  };
  const rules = rulesOf(actual.rateCard);
  const r = forecast({ targetVideosPerDay: target, ...used, rules });

  const videosPerCreatorMonth = used.postsPerCreatorPerDay * 30;
  const atQuotaCreators = Math.ceil(target / Math.max(0.1, rules.videosPerMonth / 30));
  const capBinds = r.costPerVideoCents * Math.min(rules.videosPerMonth, videosPerCreatorMonth) > rules.monthlyCapCents;
  const replies = Math.round(r.emailsNeeded * used.replyRate);
  const trials = Math.round(replies * used.trialRate);
  const revPer1kUsed = used.revenuePer1kCents;
  const anyOverride = Object.values(o).some((v) => v !== undefined);
  const LIMITS: [keyof typeof o, string, string][] = [
    ["ppd", "Posts per creator per day", "0.1 to 20"],
    ["views", "Credible views per video", "1 or more"],
    ["rev", "Revenue per 1K views", "$0 or more"],
    ["reply", "Reply %", "0.1 to 100"],
    ["trial", "Trial %", "0.1 to 100"],
    ["activation", "Active %", "0.1 to 100"],
  ];
  const invalid = LIMITS.filter(([k]) => (sp[k] ?? "").trim() !== "" && o[k] === undefined);
  const badTarget = (sp.videos ?? "").trim() !== "" && num(sp.videos, 1, 100_000) === undefined;

  const inputRows: { label: string; value: string; roster: string; source: "override" | "roster" | "default" }[] = [
    { label: "Posts per creator per day", value: String(used.postsPerCreatorPerDay), roster: String(actual.inputs.postsPerCreatorPerDay), source: o.ppd !== undefined ? "override" : "roster" },
    { label: "Credible views per video", value: used.viewsPerVideo.toLocaleString("en-US"), roster: actual.inputs.viewsPerVideo.toLocaleString("en-US"), source: o.views !== undefined ? "override" : "roster" },
    { label: "Revenue per 1K views", value: usd2(revPer1kUsed), roster: usd2(actual.inputs.revenuePer1kCents), source: o.rev !== undefined ? "override" : "roster" },
    { label: "Reply rate", value: pct(used.replyRate), roster: pct(rosterFunnel.replyRate), source: o.reply !== undefined ? "override" : enoughFunnel ? "roster" : "default" },
    { label: "Reply → trial", value: pct(used.trialRate), roster: pct(rosterFunnel.trialRate), source: o.trial !== undefined ? "override" : enoughFunnel ? "roster" : "default" },
    { label: "Trial → active", value: pct(used.activationRate), roster: pct(rosterFunnel.activationRate), source: o.activation !== undefined ? "override" : enoughFunnel ? "roster" : "default" },
  ];

  return (
    <>
      <PageHeader
        step="09 · Decide"
        title="Forecast"
        description="How many creators and how much money a daily video target takes, using your roster's actual numbers. Change any input to see what moves. The URL is shareable."
      />

      <div className="grid gap-4 lg:grid-cols-[320px_minmax(0,1fr)]">
        <Card title="Inputs" className="lg:self-start">
          <form method="get" action="/decisions/forecast" className="space-y-3">
            <Field label="Target videos per day">
              <input name="videos" defaultValue={target} inputMode="numeric" className={cx(input, "num text-[18px]")} />
            </Field>
            <div className="border-t border-line pt-3 text-[13px] text-muted">Leave blank to use roster numbers (shown as placeholders).</div>
            <Field label="Posts per creator per day">
              <input name="ppd" defaultValue={sp.ppd ?? ""} placeholder={String(actual.inputs.postsPerCreatorPerDay)} inputMode="decimal" className={cx(input, "num")} />
            </Field>
            <Field label="Credible views per video">
              <input name="views" defaultValue={sp.views ?? ""} placeholder={String(actual.inputs.viewsPerVideo)} inputMode="numeric" className={cx(input, "num")} />
            </Field>
            <Field label="Revenue per 1K views ($)">
              <input name="rev" defaultValue={sp.rev ?? ""} placeholder={(actual.inputs.revenuePer1kCents / 100).toFixed(2)} inputMode="decimal" className={cx(input, "num")} />
            </Field>
            <div className="grid grid-cols-3 gap-2">
              <Field label="Reply %">
                <input name="reply" defaultValue={sp.reply ?? ""} placeholder={(rosterFunnel.replyRate * 100).toFixed(0)} inputMode="decimal" className={cx(input, "num")} />
              </Field>
              <Field label="Trial %">
                <input name="trial" defaultValue={sp.trial ?? ""} placeholder={(rosterFunnel.trialRate * 100).toFixed(0)} inputMode="decimal" className={cx(input, "num")} />
              </Field>
              <Field label="Active %">
                <input name="activation" defaultValue={sp.activation ?? ""} placeholder={(rosterFunnel.activationRate * 100).toFixed(0)} inputMode="decimal" className={cx(input, "num")} />
              </Field>
            </div>
            <div className="flex gap-2 pt-1">
              <button type="submit" className={btnPrimary}>
                Forecast
              </button>
              {anyOverride && (
                <Link href={`/decisions/forecast?videos=${target}`} className={btn}>
                  Use roster numbers
                </Link>
              )}
            </div>
          </form>
        </Card>

        <div className="min-w-0 space-y-4">
          <div className="rounded-lg border border-line bg-panel px-5 py-5">
            <p className="font-display text-[24px] font-bold leading-snug tracking-[-0.02em] md:text-[28px]">
              {target.toLocaleString("en-US")} videos a day needs about <span className="num">{r.creators.toLocaleString("en-US")}</span> creators and about <span className="num">{usd(r.monthlyCostCents)}</span> a month.
            </p>
            <p className="mt-2 text-ink-2">
              That&apos;s about <span className="num text-ink">{compact(r.monthlyViews)}</span> credible views and <span className="num text-ink">{usd(r.monthlyRevenueCents)}</span> in revenue a month, for a{" "}
              <span className={cx("num font-medium", r.monthlyProfitCents >= 0 ? "text-profit" : "text-loss")}>
                {r.monthlyProfitCents >= 0 ? "profit" : "loss"} of {usd(Math.abs(r.monthlyProfitCents))}
              </span>
              .
            </p>
          </div>

          {(invalid.length > 0 || badTarget) && (
            <Notice tone="loss">
              {badTarget && "Target videos per day must be 1 to 100,000, so 150 was used. "}
              {invalid.map(([, label, range]) => `${label} must be ${range}.`).join(" ")}
              {invalid.length > 0 && " Using the roster number instead."}
            </Notice>
          )}
          {r.quotaLimited && (
            <Notice tone="tally">
              At {used.postsPerCreatorPerDay} posts a day each creator would make {Math.round(videosPerCreatorMonth)} videos a month, above the rate card&apos;s quota of {rules.videosPerMonth}. Videos past the quota earn no base pay, so creators tend to stop there. Raise the quota on the{" "}
              <Link href="/payouts/rate-cards" className="underline">
                rate card
              </Link>{" "}
              or plan on about {atQuotaCreators.toLocaleString("en-US")} creators posting {(rules.videosPerMonth / 30).toFixed(1)} a day.
            </Notice>
          )}
          {capBinds && <Notice tone="info">The monthly cap ({usd(rules.monthlyCapCents)} per creator) limits what each creator earns at these numbers, so cost per video is lower than the per-video rate.</Notice>}
          {revPer1kUsed === 0 && <Notice tone="tally">Revenue per 1K is $0 because there&apos;s no attributed revenue yet. Enter an estimate to see profit.</Notice>}

          <Grid cols={4}>
            <Stat label="Monthly cost" value={usd(r.monthlyCostCents)} hint={`${usd(Math.round(r.monthlyCostCents / Math.max(1, r.creators)))} per creator`} />
            <Stat label="Monthly views" value={compact(r.monthlyViews)} hint={`${r.videosPerMonth.toLocaleString("en-US")} videos`} />
            <Stat label="Monthly revenue" value={usd(r.monthlyRevenueCents)} hint={`at ${usd2(revPer1kUsed)} per 1K`} />
            <Stat label="Monthly profit" value={usd(r.monthlyProfitCents)} tone={r.monthlyProfitCents >= 0 ? "profit" : "loss"} />
            <Stat label="Cost per 1K views" value={usd2(r.costPer1kCents)} hint={`profit ${usd2(revPer1kUsed - r.costPer1kCents)} per 1K`} tone={revPer1kUsed - r.costPer1kCents >= 0 ? undefined : "loss"} />
            <Stat label="Cost per video" value={usd2(r.costPerVideoCents)} hint={`${compact(used.viewsPerVideo)} views on "${actual.rateCard.name}"`} />
            <Stat label="Creators needed" value={r.creators.toLocaleString("en-US")} hint={`${used.postsPerCreatorPerDay} posts a day each`} />
            <Stat label="Outreach emails" value={r.emailsNeeded.toLocaleString("en-US")} hint="to recruit them" />
          </Grid>

          <Card title="Recruiting funnel">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {[
                { label: "Emails sent", n: r.emailsNeeded, hint: "cold outreach" },
                { label: "Replies", n: replies, hint: `${pct(used.replyRate, 0)} of emails` },
                { label: "Trials", n: trials, hint: `${pct(used.trialRate, 0)} of replies` },
                { label: "Active creators", n: r.creators, hint: `${pct(used.activationRate, 0)} of trials` },
              ].map((s) => (
                <div key={s.label} className="rounded-md bg-sunken px-3 py-2.5">
                  <div className="text-[13px] text-muted">{s.label}</div>
                  <div className="font-display text-[20px] font-medium tabular-nums">{s.n.toLocaleString("en-US")}</div>
                  <div className="num text-[12px] text-muted">{s.hint}</div>
                </div>
              ))}
            </div>
            <p className="mt-3 text-[13px] text-muted">
              {enoughFunnel
                ? `Rates from your pipeline: ${funnel.contacted} contacted, ${funnel.replied} replied, ${funnel.trial} started a trial, ${funnel.active} active.`
                : `Your pipeline has ${funnel.contacted} contacted creators, too few to trust (50+ needed), so typical rates are used (15% reply, 40% to trial, 50% to active).`}
            </p>
          </Card>

          <Card title="Inputs used" flush>
            <table className="w-full text-[14px]">
              <thead>
                <tr className="border-b border-line text-left text-[12px] font-semibold text-muted">
                  <th className="px-4 py-2 font-medium">Input</th>
                  <th className="px-3 py-2 text-right font-medium">Used</th>
                  <th className="px-3 py-2 text-right font-medium">Roster</th>
                  <th className="px-4 py-2 font-medium">Source</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {inputRows.map((x) => (
                  <tr key={x.label}>
                    <td className="px-4 py-2">{x.label}</td>
                    <td className="num px-3 py-2 text-right font-medium">{x.value}</td>
                    <td className="num px-3 py-2 text-right text-ink-2">{x.roster}</td>
                    <td className={cx("px-4 py-2 text-[13px]", x.source === "override" ? "text-tally" : "text-muted")}>{x.source === "override" ? "your override" : x.source === "roster" ? "roster, last 30–60 days" : "typical rate"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="border-t border-line px-4 py-2 text-[13px] text-muted">
              Pay comes from the &ldquo;{actual.rateCard.name}&rdquo;{" "}
              <Link href="/payouts/rate-cards" className="underline">
                rate card
              </Link>{" "}
              ({usd2(rules.baseCents)} base + {usd2(rules.cpmCents)}/1K, quota {rules.videosPerMonth} videos, cap {usd(rules.monthlyCapCents)} a month).
            </p>
          </Card>
        </div>
      </div>
    </>
  );
}
