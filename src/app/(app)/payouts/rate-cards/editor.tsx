"use client";

import { useState } from "react";
import { ActionForm, SubmitButton } from "@/components/client";
import { Card, Field, input, btn, btnSm, cx } from "@/components/ui";
import { expectedCostPerVideo, performancePay, resolveTier, type RateCardRules } from "@/lib/engines/rate-card";
import { offerTerms } from "@/lib/engines/offer";
import { usd2, compact } from "@/lib/format";
import { saveRateCardAction } from "./actions";

export type CardInput = {
  id?: string;
  name: string;
  baseCents: number;
  cpmCents: number;
  viewWindowDays: number;
  perVideoCapCents: number;
  monthlyCapCents: number;
  videosPerMonth: number;
  minViewsForCpm: number;
  milestones: { views: number; bonusCents: number }[];
  tiers: { name: string; minTypicalViews: number; baseCents: number; cpmCents: number }[];
  referralBonusCents: number;
  quotaScope: "month" | "total";
  milestoneMode: "all" | "highest";
  signupBonusCents: number;
  bonusCapCents: number;
  perks: string;
};

const d = (c: number) => (c / 100).toFixed(c % 100 ? 2 : 0);
const n = (s: string) => {
  const v = Number(String(s).replace(/[$,\s]/g, ""));
  return Number.isFinite(v) ? v : 0;
};
const c = (s: string) => Math.round(n(s) * 100);

type MRow = { views: string; bonus: string };
type TRow = { name: string; min: string; base: string; cpm: string };

export function RateCardEditor({ card }: { card: CardInput }) {
  const [f, setF] = useState({
    name: card.name,
    base: d(card.baseCents),
    cpm: d(card.cpmCents),
    viewWindowDays: String(card.viewWindowDays),
    perVideoCap: d(card.perVideoCapCents),
    monthlyCap: d(card.monthlyCapCents),
    videosPerMonth: String(card.videosPerMonth),
    minViews: String(card.minViewsForCpm),
    referral: d(card.referralBonusCents),
    quotaScope: card.quotaScope,
    milestoneMode: card.milestoneMode,
    signupBonus: d(card.signupBonusCents),
    bonusCap: d(card.bonusCapCents),
    perks: card.perks,
  });
  const [milestones, setMilestones] = useState<MRow[]>(card.milestones.map((m) => ({ views: String(m.views), bonus: d(m.bonusCents) })));
  const [tiers, setTiers] = useState<TRow[]>(card.tiers.map((t) => ({ name: t.name, min: String(t.minTypicalViews), base: d(t.baseCents), cpm: d(t.cpmCents) })));
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setF((x) => ({ ...x, [k]: e.target.value }));
  const total = f.quotaScope === "total";

  const rules: RateCardRules = {
    baseCents: c(f.base),
    cpmCents: c(f.cpm),
    viewWindowDays: n(f.viewWindowDays),
    perVideoCapCents: c(f.perVideoCap),
    monthlyCapCents: c(f.monthlyCap),
    videosPerMonth: n(f.videosPerMonth),
    minViewsForCpm: n(f.minViews),
    milestones: milestones.filter((m) => n(m.views) > 0 && c(m.bonus) > 0).map((m) => ({ views: n(m.views), bonusCents: c(m.bonus) })),
    tiers: tiers.filter((t) => t.name.trim()).map((t) => ({ name: t.name.trim(), minTypicalViews: n(t.min), baseCents: c(t.base), cpmCents: c(t.cpm) })),
    quotaScope: total ? "total" : "month",
    milestoneMode: f.milestoneMode === "highest" ? "highest" : "all",
    signupBonusCents: c(f.signupBonus),
    bonusCapCents: c(f.bonusCap),
  };

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
      <ActionForm action={saveRateCardAction} className="min-w-0 space-y-4">
        {card.id && <input type="hidden" name="id" value={card.id} />}
        <Card title="Name">
          <Field label="Rate card name" hint="Creators are assigned a rate card; anyone without one uses the oldest card.">
            <input name="name" value={f.name} onChange={set("name")} className={input} placeholder="e.g. Standard" required />
          </Field>
        </Card>

        <Card title="Pay per video">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Money label="Base per video" name="base" value={f.base} onChange={set("base")} hint={total ? "Paid for each approved video, up to the trial's video count." : "Paid for each approved video, up to the monthly quota."} />
            <Money label="Pay per 1K views" name="cpm" value={f.cpm} onChange={set("cpm")} hint="On credible views only (bots and paid boosts removed)." />
            <Field label="Min views for per-view pay" hint="Below this, the video earns base pay only.">
              <input name="minViews" value={f.minViews} onChange={set("minViews")} inputMode="numeric" className={cx(input, "num")} />
            </Field>
            <Field label="View window (days)" hint="Per-view pay settles when the window closes. Views are recorded at day 1, 7 and 14.">
              <input name="viewWindowDays" value={f.viewWindowDays} onChange={set("viewWindowDays")} inputMode="numeric" className={cx(input, "num")} />
            </Field>
          </div>
        </Card>

        <Card title="Videos and caps">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Base pay covers">
              <select name="quotaScope" value={f.quotaScope} onChange={set("quotaScope")} className={input}>
                <option value="total">A set number of videos in total (a trial)</option>
                <option value="month">Up to a number of videos each month</option>
              </select>
            </Field>
            <Field label={total ? "Videos in total" : "Videos per month"} hint={total ? "Base pay stops after this many approved videos." : "Base pay stops after this many videos in a month."}>
              <input name="videosPerMonth" value={f.videosPerMonth} onChange={set("videosPerMonth")} inputMode="numeric" className={cx(input, "num")} />
            </Field>
            <Money label="Per-video cap" name="perVideoCap" value={f.perVideoCap} onChange={set("perVideoCap")} hint="Most one video can earn, base included. 0 = no cap." />
            <Money label="Monthly cap" name="monthlyCap" value={f.monthlyCap} onChange={set("monthlyCap")} hint="Most one creator can earn in a month, before referral bonuses. 0 = no cap." />
          </div>
        </Card>

        <Card
          title="Milestone bonuses"
          action={
            <button type="button" className={cx(btn, btnSm)} onClick={() => setMilestones((m) => [...m, { views: "", bonus: "" }])}>
              Add milestone
            </button>
          }
        >
          <div className="mb-3 max-w-sm">
            <Field label="How milestones pay">
              <select name="milestoneMode" value={f.milestoneMode} onChange={set("milestoneMode")} className={input}>
                <option value="highest">Only the highest one reached</option>
                <option value="all">Every milestone reached, added together</option>
              </select>
            </Field>
          </div>
          {milestones.length === 0 ? (
            <p className="text-ink-2">No milestones. Add one to pay a one-time bonus when a video passes a view count.</p>
          ) : (
            <div className="space-y-2">
              <div className="grid grid-cols-[1fr_1fr_auto] gap-2 text-[12px] font-semibold text-muted">
                <span>Credible views</span>
                <span>Bonus</span>
                <span className="w-16" />
              </div>
              {milestones.map((m, i) => (
                <div key={i} className="grid grid-cols-[1fr_1fr_auto] items-center gap-2">
                  <input name="milestone_views" value={m.views} onChange={(e) => setMilestones((xs) => xs.map((x, j) => (j === i ? { ...x, views: e.target.value } : x)))} inputMode="numeric" placeholder="100000" className={cx(input, "num")} aria-label={`Milestone ${i + 1} views`} />
                  <DollarInput name="milestone_bonus" value={m.bonus} onChange={(e) => setMilestones((xs) => xs.map((x, j) => (j === i ? { ...x, bonus: e.target.value } : x)))} placeholder="50" aria-label={`Milestone ${i + 1} bonus`} />
                  <button type="button" className={cx(btn, btnSm, "w-16")} onClick={() => setMilestones((xs) => xs.filter((_, j) => j !== i))}>
                    Remove
                  </button>
                </div>
              ))}
            </div>
          )}
        </Card>

        <Card
          title="Tiers"
          action={
            <button type="button" className={cx(btn, btnSm)} onClick={() => setTiers((t) => [...t, { name: "", min: "", base: "", cpm: "" }])}>
              Add tier
            </button>
          }
        >
          <p className="mb-3 text-[13px] text-muted">A creator&apos;s typical (median) credible views decide their tier: the highest tier they qualify for replaces the base and per-1K above. Below every tier, the card&apos;s own rates apply (&ldquo;Standard&rdquo;).</p>
          {tiers.length === 0 ? (
            <p className="text-ink-2">No tiers. Everyone is paid the rates above.</p>
          ) : (
            <div className="space-y-2 overflow-x-auto">
              <div className="grid min-w-[520px] grid-cols-[1.2fr_1fr_1fr_1fr_auto] gap-2 text-[12px] font-semibold text-muted">
                <span>Name</span>
                <span>Min typical views</span>
                <span>Base</span>
                <span>Per 1K</span>
                <span className="w-16" />
              </div>
              {tiers.map((t, i) => {
                const upd = (k: keyof TRow) => (e: React.ChangeEvent<HTMLInputElement>) => setTiers((xs) => xs.map((x, j) => (j === i ? { ...x, [k]: e.target.value } : x)));
                return (
                  <div key={i} className="grid min-w-[520px] grid-cols-[1.2fr_1fr_1fr_1fr_auto] items-center gap-2">
                    <input name="tier_name" value={t.name} onChange={upd("name")} placeholder="Rising" className={input} aria-label={`Tier ${i + 1} name`} />
                    <input name="tier_min" value={t.min} onChange={upd("min")} inputMode="numeric" placeholder="10000" className={cx(input, "num")} aria-label={`Tier ${i + 1} minimum typical views`} />
                    <DollarInput name="tier_base" value={t.base} onChange={upd("base")} placeholder="40" aria-label={`Tier ${i + 1} base`} />
                    <DollarInput name="tier_cpm" value={t.cpm} onChange={upd("cpm")} placeholder="1.20" aria-label={`Tier ${i + 1} per 1K`} />
                    <button type="button" className={cx(btn, btnSm, "w-16")} onClick={() => setTiers((xs) => xs.filter((_, j) => j !== i))}>
                      Remove
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </Card>

        <Card title="Signups and bonus cap">
          <div className="grid gap-3 sm:grid-cols-2">
            <Money label="Per waitlist signup" name="signupBonus" value={f.signupBonus} onChange={set("signupBonus")} hint="For each waitlist signup through the creator's link within the view window after a post. Bring signups in from Attribution. 0 = off." />
            <Money label="Bonus cap per creator" name="bonusCap" value={f.bonusCap} onChange={set("bonusCap")} hint="Most a creator can earn from milestones plus signups, across every statement. Base pay isn't capped by this. 0 = no cap." />
          </div>
        </Card>

        <Card title="Perks">
          <Field label="Perks, one per line" hint="Non-cash extras. They're mentioned in outreach emails and shown in the contract and the creator portal.">
            <textarea name="perks" value={f.perks} onChange={set("perks")} rows={3} className={input} placeholder={"First samples from the first production run\nA Hot Mess Club card"} />
          </Field>
        </Card>

        <Card title="Referrals">
          <div className="max-w-xs">
            <Money label="Referral bonus" name="referral" value={f.referral} onChange={set("referral")} hint="$100–$200, paid to the referrer once the friend they brought in becomes active." />
          </div>
        </Card>

        <div className="flex items-center gap-3">
          <SubmitButton variant="primary" pendingText="Saving…">
            {card.id ? "Save rate card" : "Create rate card"}
          </SubmitButton>
          <span className="text-[13px] text-muted">Applies to statements you draft from now on.</span>
        </div>
      </ActionForm>

      <div className="space-y-4 xl:sticky xl:top-6 xl:self-start">
        <Preview rules={rules} />
        <Card title="How creators read it">
          <p className="mb-2 text-[13px] text-muted">The same wording goes into reply drafts and the creator portal; openers use a one-sentence version.</p>
          <ul className="list-disc space-y-1 pl-5 text-[14px] text-ink-2">
            {offerTerms({ ...rules, perks: f.perks }).map((t) => (
              <li key={t}>{t}</li>
            ))}
          </ul>
        </Card>
      </div>
    </div>
  );
}

function Preview({ rules }: { rules: RateCardRules }) {
  const [views, setViews] = useState("20000");
  const [typical, setTypical] = useState("");
  const [signups, setSignups] = useState("10");
  const v = Math.max(0, Math.round(n(views)));
  const tv = typical.trim() ? Math.max(0, Math.round(n(typical))) : v;
  const su = Math.max(0, Math.round(n(signups)));
  const tier = resolveTier(rules, tv);
  const perf = performancePay(rules, tier.cpmCents, v);
  const signupCents = su * rules.signupBonusCents;
  const bonusCap = rules.bonusCapCents > 0 ? rules.bonusCapCents : Infinity;
  const perVideoCap = rules.perVideoCapCents > 0 ? rules.perVideoCapCents : Infinity;
  const raw = tier.baseCents + perf.cpm + perf.milestoneCents + signupCents;
  const bonuses = Math.min(perf.milestoneCents + signupCents, bonusCap);
  const total = Math.min(perVideoCap, tier.baseCents + perf.cpm + bonuses);
  const per1k = v > 0 ? Math.round((total / v) * 1000) : 0;
  const samples = [1_000, 10_000, 25_000, 100_000, 500_000];
  const count = rules.videosPerMonth;
  const allVideos = Math.min(perVideoCap * count, tier.baseCents * count + perf.cpm * count + Math.min((perf.milestoneCents + signupCents) * count, bonusCap));
  const capped = rules.monthlyCapCents > 0 && rules.quotaScope === "month" ? Math.min(rules.monthlyCapCents, allVideos) : allVideos;

  return (
    <Card title="What would this video pay?">
      <div className="mb-3 grid grid-cols-2 gap-2">
        <Field label="Credible views">
          <input value={views} onChange={(e) => setViews(e.target.value)} inputMode="numeric" className={cx(input, "num")} />
        </Field>
        {rules.signupBonusCents > 0 ? (
          <Field label="Waitlist signups" hint="Through their link, in the window.">
            <input value={signups} onChange={(e) => setSignups(e.target.value)} inputMode="numeric" className={cx(input, "num")} />
          </Field>
        ) : (
          <Field label="Creator's typical views" hint="Sets the tier. Blank = same.">
            <input value={typical} onChange={(e) => setTypical(e.target.value)} inputMode="numeric" placeholder={String(v)} className={cx(input, "num")} />
          </Field>
        )}
      </div>
      <dl className="space-y-1.5 text-[14px]">
        {rules.tiers.length > 0 && <Line label={`Tier: ${tier.name}`} value={`${usd2(tier.baseCents)} + ${usd2(tier.cpmCents)}/1K`} muted />}
        <Line label="Base" value={usd2(tier.baseCents)} />
        {tier.cpmCents > 0 && <Line label={v >= rules.minViewsForCpm ? `${v.toLocaleString("en-US")} views × ${usd2(tier.cpmCents)}/1K` : `Per-view (below ${rules.minViewsForCpm.toLocaleString("en-US")} views)`} value={usd2(perf.cpm)} />}
        {perf.milestones.map((m) => (
          <Line key={m.views} label={`Milestone ${compact(m.views)} views`} value={usd2(m.bonusCents)} />
        ))}
        {signupCents > 0 && <Line label={`${su} signups × ${usd2(rules.signupBonusCents)}`} value={usd2(signupCents)} />}
        {raw > total && <Line label={perf.milestoneCents + signupCents > bonusCap ? `Bonus cap (${usd2(rules.bonusCapCents)})` : `Per-video cap (${usd2(rules.perVideoCapCents)})`} value={`−${usd2(raw - total)}`} tone="loss" />}
        <div className="flex items-baseline justify-between border-t border-line pt-2">
          <dt className="font-medium">This video pays</dt>
          <dd className="font-display text-[20px] font-medium tabular-nums">{usd2(total)}</dd>
        </div>
        <Line label="Cost per 1K views" value={v > 0 ? usd2(per1k) : "—"} muted />
      </dl>

      <div className="mt-4 border-t border-line pt-3">
        <div className="mb-1.5 text-[12px] font-semibold text-muted">At other view counts (no signups)</div>
        <table className="w-full text-[13px]">
          <thead>
            <tr className="text-left text-muted">
              <th className="py-1 font-normal">Views</th>
              <th className="py-1 text-right font-normal">Pays</th>
              <th className="py-1 text-right font-normal">Per 1K</th>
            </tr>
          </thead>
          <tbody className="num">
            {samples.map((s) => {
              const cost = expectedCostPerVideo(rules, s, typical.trim() ? tv : s);
              return (
                <tr key={s} className="border-t border-line">
                  <td className="py-1">{compact(s)}</td>
                  <td className="py-1 text-right">{usd2(cost)}</td>
                  <td className="py-1 text-right text-ink-2">{usd2(Math.round((cost / s) * 1000))}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <p className="mt-2 text-[13px] text-muted">
          {rules.quotaScope === "total" ? `The whole trial (${count} videos like this one)` : `A month at quota (${count} videos like this one)`} costs at most {usd2(capped)}.
        </p>
      </div>
    </Card>
  );
}

function Line({ label, value, muted, tone }: { label: string; value: string; muted?: boolean; tone?: "loss" }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className={cx(muted ? "text-muted" : "text-ink-2")}>{label}</dt>
      <dd className={cx("num", tone === "loss" && "text-loss", muted && "text-muted")}>{value}</dd>
    </div>
  );
}

function DollarInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <div className="relative">
      <span className="pointer-events-none absolute inset-y-0 left-2.5 flex items-center text-[14px] text-muted">$</span>
      <input inputMode="decimal" {...props} className={cx(input, "num pl-5")} />
    </div>
  );
}

function Money({ label, name, value, onChange, hint }: { label: string; name: string; value: string; onChange: (e: React.ChangeEvent<HTMLInputElement>) => void; hint?: string }) {
  return (
    <Field label={label} hint={hint}>
      <DollarInput name={name} value={value} onChange={onChange} />
    </Field>
  );
}
