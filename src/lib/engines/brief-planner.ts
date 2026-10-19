export type FormatStat = { format: string; hookType?: string | null; posts: number; medianViews: number; examplePostId?: string };

export type BriefAssignment = {
  creatorId: string;
  kind: "proven" | "test";
  format: string;
  sourcePostId?: string;
};

/** Small deterministic hash so the same creator/day always gets the same assignment. */
function hash(s: string) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return (h >>> 0) / 2 ** 32;
}

/**
 * Daily brief allocation: ~80% of creators work on proven formats (weighted by performance),
 * ~20% test new ones. Deterministic per day so re-running doesn't reshuffle assignments.
 */
export function planBriefs(
  creatorIds: string[],
  proven: FormatStat[],
  testFormats: string[],
  date: string,
  testShare = 0.2,
): BriefAssignment[] {
  if (creatorIds.length === 0) return [];
  const ordered = [...creatorIds].sort((a, b) => hash(a + date) - hash(b + date));
  const testCount = testFormats.length ? Math.round(ordered.length * testShare) : 0;
  const weights = proven.map((f) => Math.sqrt(Math.max(1, f.medianViews)));
  const totalW = weights.reduce((a, b) => a + b, 0);

  return ordered.map((creatorId, i) => {
    if (i < testCount || proven.length === 0) {
      const format = testFormats[Math.floor(hash(creatorId + date + "t") * testFormats.length)] ?? "Open format";
      return { creatorId, kind: "test" as const, format };
    }
    // Weighted pick of a proven format
    let r = hash(creatorId + date + "p") * totalW;
    let pick = proven[0];
    for (let k = 0; k < proven.length; k++) {
      r -= weights[k];
      if (r <= 0) {
        pick = proven[k];
        break;
      }
    }
    return { creatorId, kind: "proven" as const, format: pick.format, sourcePostId: pick.examplePostId };
  });
}
