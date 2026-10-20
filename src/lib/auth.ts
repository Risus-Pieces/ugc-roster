/**
 * Single-password gate for the ops console. The session cookie is an HMAC of a fixed label keyed by
 * ADMIN_PASSWORD, so it can't be forged and rotating the password signs everyone out.
 * Uses Web Crypto so it runs in the proxy and in server actions alike.
 */
export const SESSION_COOKIE = "roster_admin";
export const SESSION_MAX_AGE = 60 * 60 * 24 * 30;

/** Paths that must stay reachable without signing in (creators, webhooks, crons, tracking links). */
export const PUBLIC_PREFIXES = ["/login", "/c/", "/join/", "/r/", "/api/survey", "/api/webhooks/", "/api/cron/", "/api/oauth/"];

export const isPublicPath = (path: string) => PUBLIC_PREFIXES.some((p) => path === p.replace(/\/$/, "") || path.startsWith(p));

async function hmacHex(key: string, message: string) {
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(key), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(message));
  return Array.from(new Uint8Array(sig), (b) => b.toString(16).padStart(2, "0")).join("");
}

export const sessionToken = (password: string) => hmacHex(password, "roster-admin-session-v1");

/** Constant-time string comparison. */
export function safeEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function isValidSession(cookie: string | undefined) {
  const password = process.env.ADMIN_PASSWORD;
  if (!password || !cookie) return false;
  return safeEqual(cookie, await sessionToken(password));
}
