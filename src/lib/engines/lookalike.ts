import { round } from "./stats";

export type LookalikeProfile = {
  id: string;
  followers: number;
  medianViews: number;
  engagementRate: number;
  text: string; // bio + recent captions
};

const STOP = new Set(
  "the and for with this that from your you are was have just about what when they them their there into more like here will what's it's i'm dont don't been very also over then than only some make made get got com gmail outlook icloud hotmail yahoo email collab collabs business dm".split(
    " ",
  ),
);

export function terms(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/\S+@\S+/g, " ")
    .replace(/\[(at|dot)\]|\((at|dot)\)/g, " ")
    .replace(/[^\p{L}\p{N}#\s]/gu, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOP.has(w) && !/^\d+$/.test(w));
}

function tf(text: string): Map<string, number> {
  const m = new Map<string, number>();
  for (const t of terms(text)) m.set(t, (m.get(t) ?? 0) + 1);
  return m;
}

function cosine(a: Map<string, number>, b: Map<string, number>) {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (const [k, v] of a) {
    na += v * v;
    const bv = b.get(k);
    if (bv) dot += v * bv;
  }
  for (const v of b.values()) nb += v * v;
  return na && nb ? dot / Math.sqrt(na * nb) : 0;
}

/** Similarity in [0,1] on a log scale, so 5K vs 10K followers is as far apart as 10K vs 20K. */
function logCloseness(a: number, b: number, spread = 1.5) {
  if (a <= 0 || b <= 0) return 0;
  return Math.max(0, 1 - Math.abs(Math.log10(a) - Math.log10(b)) / spread);
}

/**
 * "Find more like my top 10": build a centroid from your best creators and rank candidates
 * by topic overlap (TF cosine), audience size, typical views and engagement.
 */
export function rankLookalikes(seeds: LookalikeProfile[], candidates: LookalikeProfile[], limit = 25) {
  if (seeds.length === 0) return [];
  const seedIds = new Set(seeds.map((s) => s.id));
  const centroidText = new Map<string, number>();
  for (const s of seeds) for (const [k, v] of tf(s.text)) centroidText.set(k, (centroidText.get(k) ?? 0) + v);
  const geo = (xs: number[]) => Math.exp(xs.reduce((a, x) => a + Math.log(Math.max(1, x)), 0) / xs.length);
  const cFollowers = geo(seeds.map((s) => s.followers));
  const cViews = geo(seeds.map((s) => s.medianViews));
  const cEr = seeds.reduce((a, s) => a + s.engagementRate, 0) / seeds.length;

  return candidates
    .filter((c) => !seedIds.has(c.id))
    .map((c) => {
      const topic = cosine(centroidText, tf(c.text));
      const size = logCloseness(c.followers, cFollowers);
      const views = logCloseness(c.medianViews, cViews);
      const er = cEr > 0 ? Math.max(0, 1 - Math.abs(c.engagementRate - cEr) / cEr) : 0;
      const similarity = 0.45 * topic + 0.15 * size + 0.25 * views + 0.15 * er;
      return { id: c.id, similarity: round(similarity, 3), topic: round(topic, 3) };
    })
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, limit);
}

/** Top distinguishing terms across seed creators — used as new search keywords. */
export function seedKeywords(seeds: LookalikeProfile[], n = 8): string[] {
  const counts = new Map<string, number>();
  for (const s of seeds) for (const t of new Set(terms(s.text))) counts.set(t, (counts.get(t) ?? 0) + 1);
  return [...counts.entries()]
    .filter(([, c]) => c >= Math.max(2, Math.ceil(seeds.length * 0.3)))
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([t]) => t);
}
