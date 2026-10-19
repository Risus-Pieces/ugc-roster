function words(text: string) {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter(Boolean);
}

/** Word n-gram shingles. 3-grams catch copied phrasing while ignoring shared single words. */
export function shingles(text: string, n = 3): Set<string> {
  const w = words(text);
  const out = new Set<string>();
  if (w.length < n) {
    if (w.length) out.add(w.join(" "));
    return out;
  }
  for (let i = 0; i <= w.length - n; i++) out.add(w.slice(i, i + n).join(" "));
  return out;
}

export function jaccard(a: Set<string>, b: Set<string>) {
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  return inter / (a.size + b.size - inter);
}

/**
 * Containment: what share of `a`'s shingles appear in `b`. Better than Jaccard when a short
 * script copies a chunk of a longer one.
 */
export function containment(a: Set<string>, b: Set<string>) {
  if (a.size === 0) return 0;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  return inter / a.size;
}

export function mostSimilar(text: string, corpus: { id: string; text: string }[]) {
  const s = shingles(text);
  let best = { id: "", score: 0 };
  for (const doc of corpus) {
    const score = Math.max(jaccard(s, shingles(doc.text)), containment(s, shingles(doc.text)) * 0.9);
    if (score > best.score) best = { id: doc.id, score };
  }
  return best;
}
