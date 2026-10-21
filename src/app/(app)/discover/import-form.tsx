"use client";

import { startTransition, useActionState } from "react";
import Link from "next/link";
import { Badge, PlatformTag, btn, btnPrimary, cx, input, label } from "@/components/ui";
import { compact } from "@/lib/format";
import { importCreatorsAction, type ImportSummary } from "./actions";

const SOURCES = ["Modash", "Influencers.club", "SocialCat", "Heepsy", "Tokfluence", "Spreadsheet", "Other"];
const FIELD_LABEL: Record<string, string> = {
  handle: "Username",
  url: "Profile link",
  name: "Name",
  platform: "Platform",
  followers: "Followers",
  email: "Email",
  avgViews: "Average views",
  engagementRate: "Engagement rate",
  country: "Country",
  bio: "Bio",
  fakeFollowersPct: "Fake followers %",
};

export function ImportForm({ campaigns }: { campaigns: { id: string; name: string; minFollowers: number; maxFollowers: number }[] }) {
  const [state, run, pending] = useActionState<ImportSummary, FormData>(importCreatorsAction, null);
  const plan = state?.plan;
  return (
    <div className="space-y-4">
      <form
        action={run}
        onSubmit={(e) => {
          // Submit without React's automatic form reset so the chosen file survives Preview → Import.
          e.preventDefault();
          const fd = new FormData(e.currentTarget, (e.nativeEvent as SubmitEvent).submitter as HTMLElement | null);
          startTransition(() => run(fd));
        }}
        className="grid gap-3 md:grid-cols-2"
      >
        <label className="block">
          <span className={label}>Campaign</span>
          <select name="campaignId" className={input} required defaultValue={campaigns[0]?.id}>
            {campaigns.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name} ({compact(c.minFollowers)}–{compact(c.maxFollowers)} followers)
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className={label}>Where the list came from</span>
          <select name="source" className={input} defaultValue="Modash">
            {SOURCES.map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className={label}>Platform for rows that don&apos;t say</span>
          <select name="platform" className={input} defaultValue="">
            <option value="">Detect from the file</option>
            <option value="tiktok">TikTok</option>
            <option value="instagram">Instagram</option>
            <option value="youtube">YouTube</option>
          </select>
        </label>
        <label className="block">
          <span className={label}>CSV file</span>
          <input name="file" type="file" accept=".csv,text/csv,.tsv,text/tab-separated-values" className={cx(input, "file:mr-3 file:border-0 file:bg-sunken file:px-2 file:py-1 file:font-bold")} />
        </label>
        <label className="block md:col-span-2">
          <span className={label}>…or paste rows (with a header row)</span>
          <textarea name="csv" rows={4} className={cx(input, "font-mono text-[13px]")} placeholder={"Username,Followers,Email,Profile URL\n@spicysam,8.2K,sam@example.com,https://www.tiktok.com/@spicysam"} />
        </label>
        <label className="flex items-center gap-2 text-[14px] md:col-span-2">
          <input type="checkbox" name="onlyInBand" defaultChecked />
          Only import creators inside the campaign&apos;s follower range
        </label>
        <div className="flex flex-wrap items-center gap-2 md:col-span-2">
          <button type="submit" name="intent" value="preview" disabled={pending} className={btn}>
            {pending ? "Reading…" : "Preview"}
          </button>
          <button type="submit" name="intent" value="import" disabled={pending || !plan?.readyCount} className={btnPrimary}>
            {pending ? "Working…" : plan?.readyCount ? `Import ${plan.readyCount} creators` : "Import"}
          </button>
          <span className="text-[13px] text-muted">Preview first — nothing is saved until you import.</span>
        </div>
      </form>

      {state?.message && <p className={cx("text-[14px] font-bold", state.ok ? "text-profit" : "text-loss")}>{state.message}</p>}
      {state?.created ? (
        <p className="text-[14px]">
          <Link href="/outreach?tab=compose" className="font-bold underline">
            Write openers for them →
          </Link>
        </p>
      ) : null}

      {plan && (
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="border-2 border-line bg-field p-3 text-[14px]">
            <div className="mb-2 font-display text-[16px]">Columns we matched</div>
            <ul className="space-y-0.5">
              {Object.entries(FIELD_LABEL).map(([f, l]) => (
                <li key={f} className="flex justify-between gap-3">
                  <span className="text-ink-2">{l}</span>
                  <span className={plan.mapping[f as keyof typeof plan.mapping] ? "font-bold" : "text-muted"}>{plan.mapping[f as keyof typeof plan.mapping] ?? "not found"}</span>
                </li>
              ))}
            </ul>
            <div className="mt-3 flex flex-wrap gap-1.5">
              <Badge>{plan.total} rows</Badge>
              <Badge tone="profit">{plan.readyCount} new</Badge>
              <Badge tone="info">{plan.withEmail} with email</Badge>
              {plan.duplicates.length > 0 && <Badge tone="tally">{plan.duplicates.length} already in Roster</Badge>}
              {plan.skipped.length > 0 && <Badge tone="loss">{plan.skipped.length} skipped</Badge>}
            </div>
          </div>
          <div className="border-2 border-line bg-field p-3 text-[14px]">
            <div className="mb-2 font-display text-[16px]">First creators</div>
            {plan.sample.length ? (
              <ul className="space-y-1">
                {plan.sample.map((r) => (
                  <li key={r.line} className="flex items-center gap-2">
                    <PlatformTag platform={r.platform ?? ""} />
                    <span className="font-bold">@{r.handle}</span>
                    <span className="num text-ink-2">{r.followers !== null ? compact(r.followers) : "—"}</span>
                    <span className="min-w-0 flex-1 truncate text-right text-muted">{r.email ?? "no email"}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-muted">None.</p>
            )}
          </div>
          {(plan.skipped.length > 0 || plan.duplicates.length > 0) && (
            <details className="border-2 border-line bg-field p-3 text-[14px] lg:col-span-2">
              <summary className="cursor-pointer font-bold">Why some rows won&apos;t be imported</summary>
              <ul className="mt-2 max-h-56 space-y-0.5 overflow-y-auto">
                {plan.duplicates.slice(0, 100).map((d) => (
                  <li key={`d${d.line}`}>
                    Row <span className="num">{d.line}</span> @{d.handle}: already in Roster as {d.existingName}
                  </li>
                ))}
                {plan.skipped.slice(0, 100).map((s) => (
                  <li key={`s${s.line}`}>
                    Row <span className="num">{s.line}</span>
                    {s.handle ? ` @${s.handle}` : ""}: {s.reason}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </div>
      )}
    </div>
  );
}
