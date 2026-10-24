/**
 * Creator links and waitlist signups. The Sooz site's creator link is <site>/go/<handle>: it stores the
 * handle in a 30-day cookie and tags the waitlist signup's `influencer_handle`. (`?ref=` on the site is
 * the friend-referral program, so creator links must never use it.) A creator's handle is their
 * Roster promo code in lower case.
 */
import { parseCsv } from "./csv-import";

export type SignupRow = { line: number; email: string | null; ref: string | null; at: Date | null; flagged?: boolean };

export const creatorHandle = (promoCode: string) => promoCode.toLowerCase();

/** The link a creator puts in their bio: https://drinksooz.com/go/<handle>. */
export function creatorLink(siteUrl: string, promoCode: string) {
  let origin: string;
  try {
    origin = new URL(siteUrl).origin;
  } catch {
    origin = siteUrl.replace(/\/+$/, "");
  }
  return `${origin}/go/${creatorHandle(promoCode)}`;
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const HEADERS = {
  email: ["email", "email address", "e mail", "your email"],
  // The Sooz waitlist table's column first; "ref slug" / "referred by slug" there belong to the friend-referral program.
  ref: ["influencer handle", "influencer", "via", "ref", "referral", "referral code", "ref code", "creator code", "promo code", "code", "utm campaign", "utm_campaign", "referrer", "creator"],
  at: ["signed up", "signed up at", "signup date", "created", "created at", "date", "timestamp", "submitted at", "submission date", "time", "joined", "joined at"],
  status: ["signup status", "status"],
};
const FRIEND_REFERRAL = new Set(["ref slug", "referred by slug", "ref name", "referral count", "discount code"]);

function column(headers: string[], names: string[]) {
  const h = headers.map((x) => (FRIEND_REFERRAL.has(norm(x)) ? "" : norm(x)));
  for (const n of names.map(norm)) {
    const i = h.indexOf(n);
    if (i >= 0) return i;
  }
  for (const n of names.map(norm)) {
    const i = h.findIndex((col) => col.startsWith(`${n} `) || col.endsWith(` ${n}`));
    if (i >= 0) return i;
  }
  return -1;
}

/** "2026-10-21", "10/21/2026 3:04 PM", ISO timestamps and Unix seconds/milliseconds. */
export function parseSignupDate(v: string | undefined): Date | null {
  const s = (v ?? "").trim();
  if (!s) return null;
  if (/^\d{10}$/.test(s)) return new Date(Number(s) * 1000);
  if (/^\d{13}$/.test(s)) return new Date(Number(s));
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** A ref code as stored on creators (upper case, letters/digits/dash/underscore). Accepts a pasted ?ref= URL too. */
export function cleanRef(v: string | undefined): string | null {
  let s = (v ?? "").trim();
  const fromUrl = s.match(/[?&]ref=([^&#\s]+)/i);
  if (fromUrl) s = decodeURIComponent(fromUrl[1]);
  s = s.toUpperCase().replace(/[^A-Z0-9_-]/g, "").slice(0, 40);
  return s || null;
}

export function parseSignupCsv(text: string): { rows: SignupRow[]; missing: ("email" | "ref" | "signup date")[] } {
  const [header = [], ...body] = parseCsv(text);
  const col = { email: column(header, HEADERS.email), ref: column(header, HEADERS.ref), at: column(header, HEADERS.at), status: column(header, HEADERS.status) };
  const missing = [col.email < 0 && "email", col.ref < 0 && "ref", col.at < 0 && "signup date"].filter(Boolean) as ("email" | "ref" | "signup date")[];
  const email = (r: string[]) => r[col.email]?.match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i)?.[0].toLowerCase() ?? null;
  return {
    missing,
    rows: body.map((r, i) => ({
      line: i + 2,
      email: col.email >= 0 ? email(r) : null,
      ref: col.ref >= 0 ? cleanRef(r[col.ref]) : null,
      at: col.at >= 0 ? parseSignupDate(r[col.at]) : null,
      // The Sooz waitlist marks suspect signups "flagged"; anything but valid (or blank) doesn't count.
      flagged: col.status >= 0 && !["", "valid"].includes((r[col.status] ?? "").trim().toLowerCase()),
    })),
  };
}
