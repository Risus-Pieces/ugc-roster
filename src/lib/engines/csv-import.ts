/**
 * Import creators from creator-database exports (Modash, Influencers.club, SocialCat, Heepsy,
 * Tokfluence) or a hand-made spreadsheet: CSV parsing, automatic column matching, and value cleanup.
 */

export type ImportPlatform = "tiktok" | "instagram" | "youtube";

export type ImportRow = {
  line: number;
  platform: ImportPlatform | null;
  handle: string | null;
  name: string | null;
  email: string | null;
  followers: number | null;
  avgViews: number | null;
  engagementRate: number | null; // fraction, e.g. 0.045
  country: string | null;
  bio: string | null;
  url: string | null;
  fakeFollowersPct: number | null; // fraction
};

export type Field = Exclude<keyof ImportRow, "line">;

/** RFC 4180-ish parser: quotes, escaped quotes, newlines inside quotes, BOM; detects , ; or tab. */
export function parseCsv(text: string): string[][] {
  const src = text.replace(/^﻿/, "");
  const firstLine = src.split(/\r?\n/, 1)[0] ?? "";
  const delim = [",", ";", "\t"].map((d) => [d, firstLine.split(d).length] as const).sort((a, b) => b[1] - a[1])[0][0];
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"' && src[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cell += ch;
      continue;
    }
    if (ch === '"' && cell === "") quoted = true;
    else if (ch === delim) {
      row.push(cell);
      cell = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && src[i + 1] === "\n") i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else cell += ch;
  }
  if (cell !== "" || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c.trim() !== ""));
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9%]+/g, " ").trim();

// Header names seen in common exports, most specific first.
const SYNONYMS: Record<Field, string[]> = {
  handle: ["username", "user name", "handle", "tiktok username", "instagram username", "ig handle", "tiktok handle", "account", "account name", "channel handle", "creator handle", "influencer username", "profile username", "social handle"],
  url: ["profile url", "profile link", "url", "link", "tiktok url", "instagram url", "account url", "channel url", "profile"],
  name: ["full name", "name", "display name", "influencer name", "creator name", "fullname", "influencer", "creator"],
  platform: ["platform", "network", "social network", "social platform", "channel type"],
  followers: ["followers", "follower count", "followers count", "number of followers", "subscribers", "subscriber count", "audience size", "fans", "total followers"],
  email: ["email", "emails", "email address", "contact email", "business email", "e mail", "public email"],
  avgViews: ["median views", "average views", "avg views", "avg video views", "average video views", "avg reels plays", "average reels plays", "avg plays", "average plays", "views per post", "average views per video", "avg views per video"],
  engagementRate: ["engagement rate", "er", "avg engagement rate", "average engagement rate", "engagement rate %", "engagement"],
  country: ["country", "location", "creator country", "influencer country", "city country"],
  bio: ["bio", "biography", "description", "about"],
  fakeFollowersPct: ["fake followers", "fake followers %", "suspicious followers", "fake follower %", "bot followers"],
};

/** Map each field to a column index by header name; exact synonym match beats partial. */
export function mapColumns(headers: string[]): Partial<Record<Field, number>> {
  const h = headers.map(norm);
  const out: Partial<Record<Field, number>> = {};
  const used = new Set<number>();
  for (const pass of ["exact", "partial"] as const) {
    for (const [field, names] of Object.entries(SYNONYMS) as [Field, string[]][]) {
      if (out[field] !== undefined) continue;
      for (const name of names) {
        const idx = h.findIndex((col, i) => !used.has(i) && (pass === "exact" ? col === name : col.startsWith(name + " ") || col.endsWith(" " + name)));
        if (idx >= 0) {
          out[field] = idx;
          used.add(idx);
          break;
        }
      }
    }
  }
  return out;
}

/** "12.5K" → 12500, "1.2M" → 1200000, "12,345" → 12345. */
export function parseCount(v: string | undefined): number | null {
  if (!v) return null;
  const s = v.trim().replace(/[, ]/g, "").toLowerCase();
  const m = s.match(/^(\d+(?:\.\d+)?)([kmb])?$/);
  if (!m) return null;
  const mult = m[2] === "k" ? 1e3 : m[2] === "m" ? 1e6 : m[2] === "b" ? 1e9 : 1;
  return Math.round(Number(m[1]) * mult);
}

/** "4.5%" → 0.045, "4.5" → 0.045 (treated as a percent), "0.045" → 0.045. */
export function parseRate(v: string | undefined): number | null {
  if (!v) return null;
  const s = v.trim().replace(/[, ]/g, "");
  const m = s.match(/^(\d+(?:\.\d+)?)(%)?$/);
  if (!m) return null;
  const n = Number(m[1]);
  return m[2] || n > 1 ? n / 100 : n;
}

export function platformFrom(value: string | null | undefined): ImportPlatform | null {
  const s = (value ?? "").toLowerCase();
  if (/tiktok|tik tok|\btt\b/.test(s)) return "tiktok";
  if (/instagram|\big\b|insta/.test(s)) return "instagram";
  if (/youtube|\byt\b/.test(s)) return "youtube";
  return null;
}

/** Pull the handle out of a profile URL (tiktok.com/@x, instagram.com/x, youtube.com/@x). */
export function fromProfileUrl(url: string | null | undefined): { platform: ImportPlatform | null; handle: string | null } {
  if (!url) return { platform: null, handle: null };
  const m = url.trim().match(/^(?:https?:\/\/)?(?:www\.|m\.)?(tiktok\.com|instagram\.com|youtube\.com)\/(@?[A-Za-z0-9._-]+)/i);
  if (!m) return { platform: null, handle: null };
  const platform = platformFrom(m[1]);
  const seg = m[2];
  if (["p", "reel", "reels", "explore", "channel", "c", "user", "watch", "shorts", "video"].includes(seg.toLowerCase())) return { platform, handle: null };
  return { platform, handle: seg.replace(/^@/, "").toLowerCase() };
}

const firstEmail = (v: string | undefined) => v?.match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i)?.[0].toLowerCase() ?? null;

export function normalizeRows(rows: string[][], defaultPlatform: ImportPlatform | null) {
  const [header, ...body] = rows;
  const map = mapColumns(header ?? []);
  const get = (r: string[], f: Field) => (map[f] !== undefined ? r[map[f]!]?.trim() || undefined : undefined);
  const out: ImportRow[] = body.map((r, i) => {
    const url = get(r, "url") ?? null;
    const fromUrl = fromProfileUrl(url);
    const rawHandle = get(r, "handle");
    const handleUrl = fromProfileUrl(rawHandle);
    const handle = (handleUrl.handle ?? rawHandle?.replace(/^@/, "").trim().toLowerCase() ?? fromUrl.handle) || null;
    return {
      line: i + 2,
      platform: platformFrom(get(r, "platform")) ?? handleUrl.platform ?? fromUrl.platform ?? defaultPlatform,
      handle: handle && /^[a-z0-9._-]{1,60}$/.test(handle) ? handle : null,
      name: get(r, "name") ?? null,
      email: firstEmail(get(r, "email")),
      followers: parseCount(get(r, "followers")),
      avgViews: parseCount(get(r, "avgViews")),
      engagementRate: parseRate(get(r, "engagementRate")),
      country: get(r, "country") ?? null,
      bio: get(r, "bio") ?? null,
      url,
      fakeFollowersPct: parseRate(get(r, "fakeFollowersPct")),
    };
  });
  return { map, headers: header ?? [], rows: out };
}
