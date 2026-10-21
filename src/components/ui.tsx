import Link from "next/link";
import { clsx } from "clsx";
import type { ReactNode } from "react";
import { compact, usd2 } from "@/lib/format";
import { Sprite, STEP_SPRITES, type SpriteName } from "./sprites";

export const cx = clsx;

// ─── Layout ─────────────────────────────────────────────────────────────────

export function PageHeader({ step, title, description, actions, icon, avatar }: { step?: string; title: string; description?: ReactNode; actions?: ReactNode; icon?: SpriteName; avatar?: ReactNode }) {
  const sprite = icon ?? (step ? STEP_SPRITES[step.slice(0, 2)] : undefined);
  return (
    <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div className="flex min-w-0 items-start gap-3">
        {avatar ? (
          <span className="mt-1 shrink-0">{avatar}</span>
        ) : (
          sprite && (
            <span className="mt-1 inline-flex h-12 w-12 shrink-0 items-center justify-center bg-panel px-frame">
              <Sprite name={sprite} scale={4} />
            </span>
          )
        )}
        <div className="min-w-0">
          <h1 className="font-display text-[32px] font-medium leading-none tracking-[0.01em]">{title}</h1>
          {description && <p className="mt-2 max-w-2xl text-ink-2">{description}</p>}
        </div>
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}

export function Card({ title, action, children, className, flush }: { title?: ReactNode; action?: ReactNode; children: ReactNode; className?: string; flush?: boolean }) {
  return (
    <section className={cx("rounded-lg border border-line bg-panel", className)}>
      {(title || action) && (
        <div className="flex items-center justify-between gap-3 border-b-2 border-line bg-sunken/60 px-5 py-2.5">
          <h2 className="text-[15px] font-extrabold">{title}</h2>
          {action}
        </div>
      )}
      <div className={flush ? "" : "p-5"}>{children}</div>
    </section>
  );
}

export function Stat({ label, value, hint, tone, icon }: { label: string; value: ReactNode; hint?: ReactNode; tone?: "profit" | "loss" | "tally"; icon?: SpriteName }) {
  return (
    <div className="rounded-lg border border-line bg-panel px-4 py-3.5">
      <div className="flex items-center justify-between gap-2 text-[13px] font-semibold text-ink-2">
        {label}
        {icon && <Sprite name={icon} scale={2} />}
      </div>
      <div className={cx("mt-2 font-display text-[28px] leading-none tabular-nums", tone === "profit" && "text-profit", tone === "loss" && "text-loss", tone === "tally" && "text-tally")}>{value}</div>
      {hint && <div className="mt-1.5 text-[13px] text-muted">{hint}</div>}
    </div>
  );
}

export function Grid({ cols = 4, children, className }: { cols?: 2 | 3 | 4 | 5 | 6; children: ReactNode; className?: string }) {
  const c = { 2: "grid-cols-1 md:grid-cols-2", 3: "grid-cols-1 md:grid-cols-3", 4: "grid-cols-2 lg:grid-cols-4", 5: "grid-cols-2 md:grid-cols-3 lg:grid-cols-5", 6: "grid-cols-2 md:grid-cols-3 lg:grid-cols-6" }[cols];
  return <div className={cx("grid gap-3", c, className)}>{children}</div>;
}

export function Empty({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="border-2 border-dashed border-line-strong px-6 py-10 text-center">
      <Sprite name="chicken" scale={4} className="bob mx-auto mb-3" />
      <div className="font-display text-[18px]">{title}</div>
      {children && <div className="mx-auto mt-1 max-w-md text-ink-2">{children}</div>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function Notice({ tone = "info", children }: { tone?: "info" | "tally" | "loss" | "profit"; children: ReactNode }) {
  const t = { info: "bg-info-soft text-info", tally: "bg-tally-soft text-tally", loss: "bg-loss-soft text-loss", profit: "bg-profit-soft text-profit" }[tone];
  return <div className={cx("rounded-md px-3 py-2 text-[14px]", t)}>{children}</div>;
}

// ─── Tables ─────────────────────────────────────────────────────────────────

export function Table({ head, children, className }: { head: (ReactNode | { label: ReactNode; align?: "right" | "left" })[]; children: ReactNode; className?: string }) {
  return (
    <div className={cx("overflow-x-auto", className)}>
      <table className="w-full border-collapse text-[14px]">
        <thead>
          <tr className="border-b-2 border-line text-left text-[13px] text-muted">
            {head.map((h, i) => {
              const cell = h && typeof h === "object" && "label" in h ? h : { label: h, align: "left" as const };
              return (
                <th key={i} className={cx("whitespace-nowrap px-3 py-2.5 font-bold first:pl-4 last:pr-4", cell.align === "right" && "text-right")}>
                  {cell.label}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody className="divide-y divide-line">{children}</tbody>
      </table>
    </div>
  );
}

/** Previous / next links under a long table. `href` builds the URL for a page and keeps the other filters. */
export function Pager({ page, pageSize, total, href }: { page: number; pageSize: number; total: number; href: (page: number) => string }) {
  const pages = Math.ceil(total / pageSize);
  if (pages <= 1) return null;
  const from = (page - 1) * pageSize + 1;
  const to = Math.min(total, page * pageSize);
  const step = (to: number, text: string) =>
    to >= 1 && to <= pages ? (
      <Link href={href(to)} className={cx(btn, btnSm)}>
        {text}
      </Link>
    ) : (
      <span aria-disabled className={cx(btn, btnSm, "pointer-events-none opacity-40")}>
        {text}
      </span>
    );
  return (
    <nav aria-label="Pages" className="flex flex-wrap items-center justify-between gap-3 border-t border-line px-4 py-2.5 text-[13px] text-ink-2">
      <span className="num">
        {from}–{to} of {total.toLocaleString("en-US")}
      </span>
      <span className="flex items-center gap-2">
        {step(page - 1, "Previous")}
        <span className="num">
          Page {page} of {pages}
        </span>
        {step(page + 1, "Next")}
      </span>
    </nav>
  );
}

/** Page number from a search param, clamped to 1…pages. */
export const pageParam = (v: string | string[] | undefined, total: number, pageSize: number) =>
  Math.min(Math.max(1, Math.floor(Number(Array.isArray(v) ? v[0] : v) || 1)), Math.max(1, Math.ceil(total / pageSize)));

export function Td({ children, right, className, mono }: { children?: ReactNode; right?: boolean; className?: string; mono?: boolean }) {
  return <td className={cx("px-3 py-2.5 align-middle first:pl-4 last:pr-4", right && "text-right", mono && "num", className)}>{children}</td>;
}

// ─── Badges ─────────────────────────────────────────────────────────────────

export type Tone = "neutral" | "tally" | "profit" | "loss" | "info";
const TONES: Record<Tone, string> = {
  neutral: "bg-sunken text-ink-2 border-line",
  tally: "bg-tally-soft text-tally border-tally/40",
  profit: "bg-profit-soft text-profit border-profit/40",
  loss: "bg-loss-soft text-loss border-loss/40",
  info: "bg-info-soft text-info border-info/40",
};

export function Badge({ tone = "neutral", children, className }: { tone?: Tone; children: ReactNode; className?: string }) {
  return <span className={cx("inline-flex items-center gap-1 whitespace-nowrap border px-2 py-0.5 text-[13px] font-bold leading-tight", TONES[tone], className)}>{children}</span>;
}

const STAGE_TONE: Record<string, Tone> = { prospect: "neutral", contacted: "info", replied: "tally", trial: "info", active: "profit", cut: "loss" };
export const StageBadge = ({ stage }: { stage: string }) => <Badge tone={STAGE_TONE[stage] ?? "neutral"}>{stage}</Badge>;

export const VerdictBadge = ({ verdict, score }: { verdict: "pass" | "review" | "fail" | string; score?: number }) => (
  <Badge tone={verdict === "pass" ? "profit" : verdict === "review" ? "tally" : "loss"}>
    {verdict === "pass" ? "Real audience" : verdict === "review" ? "Check audience" : "Likely fake"}
    {score !== undefined && <span className="num opacity-70">{score}</span>}
  </Badge>
);

export const ConfidenceBadge = ({ level }: { level: "high" | "medium" | "low" }) => <Badge tone={level === "high" ? "profit" : level === "medium" ? "info" : "neutral"}>{level} confidence</Badge>;

export const CheckBadge = ({ status }: { status: "pass" | "warn" | "fail" }) => <Badge tone={status === "pass" ? "profit" : status === "warn" ? "tally" : "loss"}>{status}</Badge>;

export const PlatformTag = ({ platform }: { platform: string }) => (
  <span className="text-[12px] font-bold text-muted">{platform === "tiktok" ? "TT" : platform === "instagram" ? "IG" : platform === "youtube" ? "YT" : platform}</span>
);

// ─── Signature visuals ──────────────────────────────────────────────────────

/**
 * Margin bar, drawn as a segmented HP bar: the filled length is revenue per 1K views; the first
 * blocks (wood) are what you pay per 1K, the rest (green) is profit. If cost beats revenue, the
 * overhang shows in red. A pale green tail marks the top of the estimate range.
 */
export function MarginBar({ revenue, cost, scale, low, high }: { revenue: number; cost: number; scale: number; low?: number; high?: number }) {
  const N = 14;
  const s = Math.max(scale, 1);
  const profit = revenue - cost;
  const blocks = Array.from({ length: N }, (_, i) => {
    const v = ((i + 0.5) / N) * s;
    if (v <= Math.min(cost, revenue)) return "bg-wood-light";
    if (v <= revenue) return "bg-crop";
    if (v <= cost) return "bg-loss";
    if (high !== undefined && v <= high && (low === undefined || high > revenue)) return "bg-profit-soft";
    return "bg-sunken";
  });
  return (
    <div className="flex min-w-[150px] items-center gap-2">
      <div className="flex flex-1 gap-[2px] bg-line-strong p-[2px]" title={`Revenue ${usd2(revenue)}/1K · Cost ${usd2(cost)}/1K`}>
        {blocks.map((c, i) => (
          <span key={i} className={cx("h-3 flex-1", c)} />
        ))}
      </div>
      <span className={cx("num w-16 text-right text-[13px]", profit >= 0 ? "text-profit" : "text-loss")}>
        {profit >= 0 ? "+" : "−"}
        {usd2(Math.abs(profit))}
      </span>
    </div>
  );
}

/** A 9:16 frame — how short-form video actually looks — with the hook as the overlay text. */
export function VerticalFrame({ hook, views, meta, href, tone, children }: { hook: string; views?: number; meta?: ReactNode; href?: string; tone?: "tally"; children?: ReactNode }) {
  const inner = (
    <div className={cx("group relative flex aspect-[9/16] w-full flex-col justify-between overflow-hidden rounded-lg border p-3", tone === "tally" ? "bg-tally-soft" : "bg-panel")}>
      <div className="pointer-events-none absolute inset-x-0 top-0 h-1.5 bg-[repeating-linear-gradient(90deg,var(--line)_0_6px,transparent_6px_12px)] opacity-70" aria-hidden />
      <div className="font-display text-[17px] font-medium leading-snug">{hook}</div>
      <div className="space-y-1">
        {children}
        <div className="flex items-end justify-between gap-2">
          <div className="min-w-0 truncate text-[12px] text-ink-2">{meta}</div>
          {views !== undefined && (
            <div className="num flex items-center gap-1 text-[14px]">
              <svg width="10" height="10" viewBox="0 0 5 5" aria-hidden className="fill-current" style={{ shapeRendering: "crispEdges" }}>
                <path d="M1 0h1v1h1v1h1v1H3v1H2v1H1z" />
              </svg>
              {compact(views)}
            </div>
          )}
        </div>
      </div>
    </div>
  );
  return href ? (
    <Link href={href} className="block transition-transform hover:-translate-y-1">
      {inner}
    </Link>
  ) : (
    inner
  );
}

/** Segmented progress: one block per unit for small counts (e.g. warm-up days), proportional otherwise. */
export function Meter({ value, max, tone = "ink" }: { value: number; max: number; tone?: "ink" | "profit" | "tally" | "loss" }) {
  const c = { ink: "bg-wood-light", profit: "bg-crop", tally: "bg-gold", loss: "bg-loss" }[tone];
  const n = Number.isInteger(max) && max > 0 && max <= 14 ? max : 12;
  const filled = max > 0 ? Math.round((Math.min(value, max) / max) * n) : 0;
  return (
    <div className="flex w-full gap-[2px] bg-line-strong p-[2px]" role="meter" aria-valuenow={value} aria-valuemin={0} aria-valuemax={max}>
      {Array.from({ length: n }, (_, i) => (
        <span key={i} className={cx("h-2 flex-1", i < filled ? c : "bg-sunken")} />
      ))}
    </div>
  );
}

export function Sparkline({ values, width = 120, height = 28, className }: { values: number[]; width?: number; height?: number; className?: string }) {
  if (values.length < 2) return <svg width={width} height={height} />;
  const max = Math.max(...values);
  const min = Math.min(...values);
  const pts = values.map((v, i) => `${(i / (values.length - 1)) * width},${height - 2 - ((v - min) / (max - min || 1)) * (height - 4)}`).join(" ");
  return (
    <svg width={width} height={height} className={cx("overflow-visible", className)} aria-hidden>
      <polyline points={pts} fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
    </svg>
  );
}

// ─── Controls ───────────────────────────────────────────────────────────────

export const btn =
  "px-btn inline-flex items-center justify-center gap-1.5 whitespace-nowrap border-2 border-line-strong bg-panel px-3.5 py-1.5 text-[14px] font-bold text-ink transition-colors hover:bg-sunken disabled:opacity-50";
export const btnPrimary =
  "px-btn inline-flex items-center justify-center gap-1.5 whitespace-nowrap border-2 border-wood-dark bg-action px-3.5 py-1.5 text-[14px] font-bold text-on-action transition-[filter] hover:brightness-110 disabled:opacity-50";
export const btnDanger =
  "px-btn inline-flex items-center justify-center gap-1.5 whitespace-nowrap border-2 border-loss bg-loss-soft px-3 py-1.5 text-[14px] font-bold text-loss hover:brightness-95 disabled:opacity-50";
export const btnSm = "!px-2 !py-1 !text-[13px]";
export const input = "w-full border-2 border-line bg-field px-3 py-2 text-[14px] text-ink placeholder:text-muted focus:border-line-strong";
export const label = "mb-1 block text-[13px] font-bold text-ink-2";

export function Field({ label: l, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <label className="block">
      <span className={label}>{l}</span>
      {children}
      {hint && <span className="mt-1 block text-[13px] text-muted">{hint}</span>}
    </label>
  );
}

/** Link-based tabs; keep state in the URL. */
export function Tabs({ tabs, active }: { tabs: { key: string; label: ReactNode; href: string; count?: number }[]; active: string }) {
  return (
    <nav className="mb-4 flex gap-1.5 overflow-x-auto border-b-2 border-line-strong">
      {tabs.map((t) => (
        <Link
          key={t.key}
          href={t.href}
          className={cx(
            "-mb-[2px] flex shrink-0 items-center gap-1.5 border-2 border-b-0 px-3.5 py-2 text-[14px] font-bold",
            t.key === active ? "border-line-strong bg-panel text-ink" : "border-transparent bg-sunken/60 text-ink-2 hover:bg-sunken hover:text-ink",
          )}
        >
          {t.label}
          {t.count !== undefined && <span className="num bg-paper px-1.5 text-[12px] text-ink-2">{t.count}</span>}
        </Link>
      ))}
    </nav>
  );
}
