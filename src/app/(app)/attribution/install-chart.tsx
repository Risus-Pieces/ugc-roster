import { compact } from "@/lib/format";

export type ChartBucket = { t: number; installs: number; baseline: number };
export type ChartTick = { t: number; color: string; label: string };

const W = 960;
const H = 260;
const PAD = { l: 40, r: 12, t: 12, b: 56 };
const LANE = 14; // post-tick lane height under the x-axis

/**
 * Installs over time with the same-hour-last-weeks baseline and the excess above it shaded.
 * Campaign posts are marked as ticks in a lane under the axis so lift lines up with post times.
 */
export function InstallChart({ buckets, ticks, stepMs, granularity }: { buckets: ChartBucket[]; ticks: ChartTick[]; stepMs: number; granularity: "hour" | "day" }) {
  if (buckets.length < 2) return <p className="text-ink-2">Not enough install data yet. Connect RevenueCat or App Store Connect in Settings.</p>;
  const t0 = buckets[0].t;
  const t1 = buckets[buckets.length - 1].t + stepMs;
  const max = Math.max(1, ...buckets.map((b) => Math.max(b.installs, b.baseline)));
  const niceMax = niceCeil(max);
  const plotH = H - PAD.t - PAD.b;
  const x = (t: number) => PAD.l + ((t - t0) / (t1 - t0)) * (W - PAD.l - PAD.r);
  const y = (v: number) => PAD.t + plotH - (v / niceMax) * plotH;
  const mid = (b: ChartBucket) => x(b.t + stepMs / 2);

  const line = buckets.map((b) => `${mid(b).toFixed(1)},${y(b.installs).toFixed(1)}`).join(" ");
  const base = buckets.map((b) => `${mid(b).toFixed(1)},${y(b.baseline).toFixed(1)}`).join(" ");
  // Excess area: between baseline and installs wherever installs are above baseline.
  const excess =
    buckets.map((b, i) => `${i ? "L" : "M"}${mid(b).toFixed(1)},${y(Math.max(b.installs, b.baseline)).toFixed(1)}`).join(" ") +
    " " +
    [...buckets]
      .reverse()
      .map((b) => `L${mid(b).toFixed(1)},${y(b.baseline).toFixed(1)}`)
      .join(" ") +
    " Z";

  const gridVals = [0, niceMax / 2, niceMax];
  const DAY = 86_400_000;
  const firstDay = Math.ceil(t0 / DAY) * DAY;
  const dayCount = Math.round((t1 - t0) / DAY);
  const every = dayCount > 14 ? 3 : dayCount > 7 ? 2 : 1;
  const dayTicks: number[] = [];
  for (let t = firstDay, i = 0; t < t1; t += DAY, i++) if (i % every === 0) dayTicks.push(t);
  const axisY = PAD.t + plotH;
  const laneY = axisY + 22;

  return (
    <div className="overflow-x-auto">
      <svg viewBox={`0 0 ${W} ${H}`} className="block w-full min-w-[640px]" role="img" aria-label={`Installs per ${granularity === "hour" ? "3 hours" : "day"} with baseline and campaign post times`}>
        {gridVals.map((v) => (
          <g key={v}>
            <line x1={PAD.l} x2={W - PAD.r} y1={y(v)} y2={y(v)} stroke="var(--line)" strokeWidth={1} />
            <text x={PAD.l - 6} y={y(v) + 3.5} textAnchor="end" fontSize={10} fill="var(--muted)" className="num">
              {compact(v)}
            </text>
          </g>
        ))}
        <path d={excess} fill="var(--info)" opacity={0.18} />
        <polyline points={base} fill="none" stroke="var(--muted)" strokeWidth={1.25} strokeDasharray="4 3" />
        <polyline points={line} fill="none" stroke="var(--ink-2)" strokeWidth={1.5} strokeLinejoin="round" />

        {dayTicks.map((t) => (
          <g key={t}>
            <line x1={x(t)} x2={x(t)} y1={axisY} y2={axisY + 4} stroke="var(--line-strong)" />
            <text x={x(t)} y={axisY + 15} textAnchor="middle" fontSize={10} fill="var(--muted)" className="num">
              {new Date(t).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" })}
            </text>
          </g>
        ))}

        <text x={PAD.l - 6} y={laneY + LANE / 2 + 3.5} textAnchor="end" fontSize={10} fill="var(--muted)">
          posts
        </text>
        <rect x={PAD.l} y={laneY} width={W - PAD.l - PAD.r} height={LANE} fill="var(--sunken)" rx={2} />
        {ticks
          .filter((k) => k.t >= t0 && k.t <= t1)
          .sort((a, b) => (a.color === "var(--muted)" ? -1 : 0) - (b.color === "var(--muted)" ? -1 : 0))
          .map((k, i) => (
            <line key={i} x1={x(k.t)} x2={x(k.t)} y1={laneY + 1} y2={laneY + LANE - 1} stroke={k.color} strokeWidth={k.color === "var(--muted)" ? 1 : 2} opacity={k.color === "var(--muted)" ? 0.55 : 1}>
              <title>{k.label}</title>
            </line>
          ))}
      </svg>
    </div>
  );
}

function niceCeil(v: number) {
  const p = Math.pow(10, Math.floor(Math.log10(v)));
  const m = v / p;
  return (m <= 1 ? 1 : m <= 2 ? 2 : m <= 2.5 ? 2.5 : m <= 5 ? 5 : 10) * p;
}
