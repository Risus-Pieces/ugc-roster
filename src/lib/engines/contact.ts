const EMAIL_RE = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi;
// Creators obfuscate to dodge scrapers: "name [at] gmail [dot] com", "name(at)gmail.com"
const OBFUSCATED_RE =
  /([a-z0-9._%+-]+)\s*(?:\[at\]|\(at\)|\{at\}|\sat\s|@)\s*([a-z0-9-]+)\s*(?:\[dot\]|\(dot\)|\{dot\}|\sdot\s|\.)\s*([a-z]{2,})(?:\s*(?:\[dot\]|\(dot\)|\sdot\s|\.)\s*([a-z]{2,}))?/gi;

const ROLE_PREFIX = /^(noreply|no-reply|donotreply|support|help|info@tiktok|abuse)/i;

/** Pull contact emails out of a bio, including common obfuscations. Business emails are ranked first. */
export function extractEmails(bio: string | null | undefined): string[] {
  if (!bio) return [];
  const found = new Set<string>();
  for (const m of bio.matchAll(EMAIL_RE)) found.add(m[0]);
  for (const m of bio.matchAll(OBFUSCATED_RE)) {
    const [, user, domain, tld, tld2] = m;
    found.add(`${user}@${domain}.${tld}${tld2 ? "." + tld2 : ""}`);
  }
  return [...found]
    .map((e) => e.replace(/[.,;:]+$/, "").toLowerCase())
    .filter((e) => !ROLE_PREFIX.test(e))
    .sort((a, b) => businessRank(b) - businessRank(a));
}

function businessRank(email: string) {
  const local = email.split("@")[0];
  return /(collab|business|biz|partner|brand|work|booking|mgmt|management|contact|pr)/.test(local) ? 1 : 0;
}

/**
 * Canonical form for de-duplication across campaigns:
 * lowercases, strips +tags, and removes dots for Gmail (where they're ignored).
 */
export function normalizeEmail(email: string | null | undefined): string | null {
  if (!email) return null;
  const [rawLocal, rawDomain] = email.trim().toLowerCase().split("@");
  if (!rawLocal || !rawDomain) return null;
  const domain = rawDomain === "googlemail.com" ? "gmail.com" : rawDomain;
  let local = rawLocal.split("+")[0];
  if (domain === "gmail.com") local = local.replaceAll(".", "");
  return `${local}@${domain}`;
}

export function normalizeHandle(handle: string) {
  return handle.trim().replace(/^@/, "").toLowerCase();
}
