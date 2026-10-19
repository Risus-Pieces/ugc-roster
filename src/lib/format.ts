export const usd = (cents: number, digits = 0) =>
  (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: digits, maximumFractionDigits: digits });

export const usd2 = (cents: number) => usd(cents, 2);

export const compact = (n: number) =>
  n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 10_000 ? `${Math.round(n / 1000)}K` : n >= 1000 ? `${(n / 1000).toFixed(1)}K` : `${Math.round(n)}`;

export const pct = (x: number, digits = 1) => `${(x * 100).toFixed(digits)}%`;

export const day = (d: Date | number | null | undefined) =>
  d ? new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "—";

export const dateTime = (d: Date | number | null | undefined) =>
  d ? new Date(d).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "—";

export const isoDate = (d: Date) => d.toISOString().slice(0, 10);

export const relative = (d: Date | number | null | undefined, now = Date.now()) => {
  if (!d) return "—";
  const s = Math.round((now - new Date(d).getTime()) / 1000);
  const abs = Math.abs(s);
  const fmt = (v: number, u: string) => `${v}${u}${s < 0 ? " from now" : " ago"}`;
  if (abs < 60) return "just now";
  if (abs < 3600) return fmt(Math.round(abs / 60), "m");
  if (abs < 86400) return fmt(Math.round(abs / 3600), "h");
  return fmt(Math.round(abs / 86400), "d");
};

/** Current time for server components (rendered per request after `connection()`). */
export const requestTime = () => Date.now();
