import { Badge, PlatformTag, VerdictBadge, type Tone } from "@/components/ui";
import type { CreatorScore } from "@/db/schema";

/** Small presentational helpers shared by the Find / Reach pages. */

export type SearchParams = Promise<{ [key: string]: string | string[] | undefined }>;

export const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
export const many = (v: string | string[] | undefined) => (v === undefined ? [] : Array.isArray(v) ? v : [v]);

/** 2000 → "2K", 12500 → "12.5K" — for follower bands. */
export const kfmt = (n: number) => (n >= 1000 ? `${+(n / 1000).toFixed(1)}K` : `${n}`);

const CLASS_TONE: Record<string, Tone> = { interested: "profit", rates: "tally", not_interested: "loss", other: "neutral" };
export const ClassBadge = ({ c }: { c: string | null | undefined }) => (c ? <Badge tone={CLASS_TONE[c] ?? "neutral"}>{c.replace("_", " ")}</Badge> : null);

const STATUS_TONE: Record<string, Tone> = { draft: "neutral", sent: "profit", simulated: "info", failed: "loss", received: "tally", handled: "neutral" };
export const MsgStatusBadge = ({ status }: { status: string }) => <Badge tone={STATUS_TONE[status] ?? "neutral"}>{status}</Badge>;

export function Handles({ accounts }: { accounts: { platform: string; handle: string }[] }) {
  if (!accounts.length) return <span className="text-muted">—</span>;
  return (
    <span className="flex flex-col gap-0.5">
      {accounts.map((a) => (
        <span key={a.platform + a.handle} className="flex items-center gap-1.5 whitespace-nowrap">
          <PlatformTag platform={a.platform} />
          <span className="text-ink-2">@{a.handle}</span>
        </span>
      ))}
    </span>
  );
}

export function EmailCell({ email }: { email: string | null }) {
  return email ? <span className="whitespace-nowrap text-ink-2">{email}</span> : <span className="whitespace-nowrap text-muted">no email</span>;
}

/** Group rows by a key — for loading related rows in bulk and mapping them in JS. */
export function groupBy<T, K>(rows: T[], key: (r: T) => K) {
  const m = new Map<K, T[]>();
  for (const r of rows) {
    const k = key(r);
    const list = m.get(k);
    if (list) list.push(r);
    else m.set(k, [r]);
  }
  return m;
}

/** Authenticity verdict; the flags behind it show on hover and expand on click. */
export function Authenticity({ score }: { score?: Pick<CreatorScore, "authenticityVerdict" | "authenticityScore" | "authenticityFlags"> | null }) {
  if (!score) return <span className="whitespace-nowrap text-[13px] text-muted">not scored</span>;
  const flags = score.authenticityFlags ?? [];
  if (!flags.length) return <VerdictBadge verdict={score.authenticityVerdict} score={score.authenticityScore} />;
  return (
    <details title={flags.join(" · ")}>
      <summary className="flex cursor-pointer list-none items-center gap-1.5 [&::-webkit-details-marker]:hidden">
        <VerdictBadge verdict={score.authenticityVerdict} score={score.authenticityScore} />
        <span className="num whitespace-nowrap text-[12px] text-muted">
          {flags.length} flag{flags.length > 1 ? "s" : ""}
        </span>
      </summary>
      <ul className="mt-1 max-w-[280px] list-disc space-y-0.5 pl-4 text-[13px] text-ink-2">
        {flags.map((f) => (
          <li key={f}>{f}</li>
        ))}
      </ul>
    </details>
  );
}

/** How much a creator's reputation leans on one hit: max views ÷ median views. */
export const viralDependence = (s: Pick<CreatorScore, "maxViews" | "medianViews">) => (s.medianViews > 0 ? s.maxViews / s.medianViews : 0);

/** Request time. Pages call this after `await connection()`, so it's evaluated once per request. */
export { requestTime } from "@/lib/format";
