/**
 * Read the public parts of a creator's profile page (what any logged-out visitor sees):
 * bio, bio link, display name and follower count.
 */
import { sharesChunk } from "./contact";

export type PublicProfile = {
  found: boolean;
  name: string | null;
  bio: string;
  bioLink: string | null;
  followers: number | null;
};

/** TikTok embeds the profile as JSON in a rehydration script. Returns null when the page has no profile data (blocked or changed). */
export function parseTikTokProfile(html: string): PublicProfile | null {
  const m = html.match(/<script id="__UNIVERSAL_DATA_FOR_REHYDRATION__"[^>]*>([\s\S]*?)<\/script>/);
  if (!m) return null;
  let data: unknown;
  try {
    data = JSON.parse(m[1]);
  } catch {
    return null;
  }
  const detail = (data as { __DEFAULT_SCOPE__?: Record<string, { statusCode?: number; userInfo?: TikTokUserInfo }> }).__DEFAULT_SCOPE__?.["webapp.user-detail"];
  if (!detail) return null;
  const user = detail.userInfo?.user;
  // 10221/10222: account doesn't exist or is private; 10202: banned
  if (!user?.uniqueId) return { found: false, name: null, bio: "", bioLink: null, followers: null };
  const followers = Number(detail.userInfo?.stats?.followerCount ?? detail.userInfo?.statsV2?.followerCount);
  return {
    found: true,
    name: user.nickname || null,
    bio: user.signature ?? "",
    bioLink: user.bioLink?.link || null,
    followers: Number.isFinite(followers) ? followers : null,
  };
}

type TikTokUserInfo = {
  user?: { uniqueId?: string; nickname?: string; signature?: string; bioLink?: { link?: string } };
  stats?: { followerCount?: number };
  statsV2?: { followerCount?: string };
};

/**
 * Same handle on two platforms: is it the same creator, or a stranger who took the handle?
 * Compares display names (letters and digits only): equal, one inside the other ("Brou" in
 * "Brou Quinn"), or a shared run of 5+ characters ("Ruben Garcia" / "Ruben Reviews").
 */
export function looksLikeSamePerson(nameA: string | null, nameB: string | null): boolean {
  const clean = (s: string | null) => (s ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
  const a = clean(nameA);
  const b = clean(nameB);
  if (!a || !b) return false;
  if (a === b) return true;
  if (Math.min(a.length, b.length) >= 4 && (a.includes(b) || b.includes(a))) return true;
  return a.length >= 5 && b.length >= 5 && sharesChunk(a, b);
}

/** Does the email's local part resemble the handle or name? ("thatsandwichdude@gmail.com", "thatsandwichdude") → true */
export function emailLooksLike(email: string, ...names: (string | null)[]): boolean {
  const local = email.split("@")[0].toLowerCase().replace(/[^a-z0-9]/g, "");
  return names.some((n) => {
    const key = (n ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
    return key.length >= 5 && local.length >= 5 && sharesChunk(local, key);
  });
}

/** Bio links worth opening for a contact email: link-in-bio pages and personal sites, not stores or other socials. */
export function worthOpening(link: string | null): string | null {
  if (!link) return null;
  const url = /^https?:\/\//i.test(link) ? link : `https://${link}`;
  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
  if (/(^|\.)(tiktok|instagram|youtube|youtu|facebook|x|twitter|twitch|snapchat|amazon|amzn|spotify|apple|discord|onlyfans|fansly|venmo|cash|paypal)\.(com|be|to|tv|gg|app|me)$/.test(host)) return null;
  return url;
}
