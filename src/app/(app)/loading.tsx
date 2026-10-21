import { Sprite } from "@/components/sprites";

export default function Loading() {
  return (
    <div className="space-y-4" aria-busy="true" aria-label="Loading">
      <div className="flex items-center gap-3">
        <Sprite name="chicken" scale={4} className="bob" />
        <span className="font-display text-[17px] text-ink-2">Gathering eggs…</span>
      </div>
      <div className="grid animate-pulse grid-cols-2 gap-3 lg:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <div key={i} className="h-20 rounded-lg border border-line bg-panel" />
        ))}
      </div>
      <div className="h-80 animate-pulse rounded-lg border border-line bg-panel" />
    </div>
  );
}
