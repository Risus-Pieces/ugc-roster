"use client";

import Link from "next/link";
import { useActionState, type ReactNode } from "react";
import { SubmitButton } from "@/components/client";
import { cx } from "@/components/ui";
import { runDiscoveryAction, type RunResult } from "./actions";

/** One campaign row: its details, a "Run discovery" button, and the run summary once it finishes. */
export function RunDiscovery({ campaignId, band, resultsHref, children }: { campaignId: string; band: string; resultsHref: string; children: ReactNode }) {
  const [state, action] = useActionState<RunResult, FormData>(runDiscoveryAction, null);
  const run = state?.run;
  const providers = run ? [...new Set(run.providers)] : [];
  const stats = run
    ? [
        { label: "Found", value: run.searched },
        { label: `In ${band} band`, value: run.inBand },
        { label: "New", value: run.created, strong: true },
        { label: "Duplicates skipped", value: run.duplicates },
        { label: "Already in another campaign", value: run.alreadyInOtherCampaign },
        { label: "With email", value: run.withEmail },
      ]
    : [];
  return (
    <div>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">{children}</div>
        <form action={action}>
          <input type="hidden" name="campaignId" value={campaignId} />
          <SubmitButton pendingText="Searching…" className="!py-1 !text-[12px]">
            Run discovery
          </SubmitButton>
        </form>
      </div>
      {state && !state.ok && <p className="mt-2 text-[12px] text-loss">{state.message}</p>}
      {run && (
        <div className="mt-3 rounded-md border border-line bg-sunken p-3">
          <dl className="grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-3 lg:grid-cols-6">
            {stats.map((s) => (
              <div key={s.label}>
                <dt className="text-[11px] leading-tight text-muted">{s.label}</dt>
                <dd className={cx("num text-[17px]", s.strong && "font-medium text-tally")}>{s.value}</dd>
              </div>
            ))}
          </dl>
          <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-[12px] text-ink-2">
            <span>
              Searched with{" "}
              {providers.map((p, i) => (
                <span key={p}>
                  {i > 0 && " · "}
                  <span className="text-ink">{p}</span>
                </span>
              ))}
            </span>
            <Link href={resultsHref} className="text-ink hover:underline">
              See results →
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
