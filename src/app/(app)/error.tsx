"use client";

import { Sprite } from "@/components/sprites";
import { btn } from "@/components/ui";

export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="rounded-lg border bg-loss-soft p-6">
      <div className="flex items-center gap-3">
        <Sprite name="heart" scale={4} />
        <h2 className="font-display text-[20px] text-loss">This page didn&apos;t load</h2>
      </div>
      <p className="mt-2 text-ink-2">{error.message}</p>
      <button onClick={reset} className={`${btn} mt-4`}>
        Try again
      </button>
    </div>
  );
}
