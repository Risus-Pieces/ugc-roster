import { cx } from "@/components/ui";
import { compact, day } from "@/lib/format";
import { median, percentile } from "@/lib/engines/stats";

type Bar = { id: string; views: number; postedAt: Date; isCampaignPost: boolean; caption: string | null };

/**
 * Recent posts as bars with the median marked. The y-axis is capped near the typical range so
 * one viral hit doesn't flatten everything else; off-scale bars are labelled with their real value.
 */
export function ViewsChart({ posts }: { posts: Bar[] }) {
  const n = posts.length;
  if (n === 0) return <p className="text-ink-2">No posts synced yet.</p>;
  const views = posts.map((p) => p.views);
  const med = median(views);
  const max = Math.max(...views);
  const yMax = Math.max(1, Math.min(max, Math.max(med * 3, percentile(views, 90) * 1.1)));
  const h = (v: number) => (Math.min(v, yMax) / yMax) * 86;
  const medPct = h(med);
  const W = n * 10;
  const anyCampaign = posts.some((p) => p.isCampaignPost);
  const anyCapped = max > yMax;

  return (
    <div>
      <div className="relative h-44">
        <svg viewBox={`0 0 ${W} 100`} preserveAspectRatio="none" className="absolute inset-0 h-full w-full" role="img" aria-label={`Views on the last ${n} posts; median ${compact(med)}`}>
          {posts.map((p, i) => {
            const capped = p.views > yMax;
            return (
              <rect
                key={p.id}
                x={i * 10 + 1.5}
                width={7}
                y={100 - h(p.views)}
                height={Math.max(0.6, h(p.views))}
                className={cx(capped ? "fill-tally/70" : p.isCampaignPost ? "fill-info/70" : "fill-ink-2/35")}
              >
                <title>{`${day(p.postedAt)} · ${p.views.toLocaleString("en-US")} views${p.caption ? ` · ${p.caption.slice(0, 60)}` : ""}`}</title>
              </rect>
            );
          })}
          <line x1={0} x2={W} y1={100 - medPct} y2={100 - medPct} className="stroke-tally" strokeWidth={1.5} strokeDasharray="5 4" vectorEffect="non-scaling-stroke" />
        </svg>
        <div className="num pointer-events-none absolute right-0 rounded bg-panel/90 px-1 text-[11px] text-tally" style={{ bottom: `calc(${medPct}% + 2px)` }}>
          median {compact(med)}
        </div>
        {posts.map((p, i) =>
          p.views > yMax ? (
            <div key={p.id} className="num pointer-events-none absolute top-0 -translate-x-1/2 text-[10px] text-tally" style={{ left: `${((i + 0.5) / n) * 100}%` }}>
              {compact(p.views)}↑
            </div>
          ) : null,
        )}
      </div>
      <div className="num mt-1 flex justify-between border-t border-line pt-1 text-[11px] text-muted">
        <span>{day(posts[0].postedAt)}</span>
        <span>{day(posts[n - 1].postedAt)}</span>
      </div>
      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[12px] text-ink-2">
        <Legend className="bg-ink-2/35">post</Legend>
        {anyCampaign && <Legend className="bg-info/70">campaign post</Legend>}
        {anyCapped && <Legend className="bg-tally/70">off the scale — a one-off hit we don&apos;t pay or rank on</Legend>}
      </div>
    </div>
  );
}

function Legend({ className, children }: { className: string; children: React.ReactNode }) {
  return (
    <span className="flex items-center gap-1.5">
      <span aria-hidden className={cx("inline-block h-2.5 w-2.5 rounded-sm", className)} />
      {children}
    </span>
  );
}
