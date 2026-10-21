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
    .map((e) => e.replace(/^[._%+-]+/, "").replace(/[.,;:]+$/, "").toLowerCase())
    .filter((e) => !ROLE_PREFIX.test(e))
    .sort((a, b) => businessRank(b) - businessRank(a));
}

// Addresses that show up in link-in-bio and website markup but aren't the creator's.
const ASSET_TLD = /\.(png|jpe?g|gif|webp|svg|avif|ico|css|js|json|mp4|woff2?)$/i;
const VENDOR_DOMAIN =
  /@([a-z0-9-]+\.)*(linktr\.ee|linktree\.com|beacons\.ai|stan\.store|komi\.io|sentry\.io|wixpress\.com|wix\.com|squarespace\.com|shopify\.com|godaddy\.com|cloudflare\.com|w3\.org|schema\.org|email\.com|domain\.com|yourdomain\.com|mysite\.com|user\.com|test\.com|company\.com|website\.com|sample\.com)$/i;
// Pages built for exactly this: a creator's links plus a contact button.
const LINK_IN_BIO_HOST =
  /(^|\.)(linktr\.ee|linktree\.com|beacons\.ai|stan\.store|komi\.io|lnk\.bio|bio\.link|campsite\.bio|hoo\.be|msha\.ke|tap\.bio|snipfeed\.co|linkin\.bio|carrd\.co|solo\.to|allmylinks\.com|linkpop\.com|taplink\.cc|bento\.me|withkoji\.com)$/i;

/**
 * Contact emails on a link-in-bio page or website: mailto: links and plain addresses in the markup.
 * Skips obfuscation matching (too loose for whole pages) and vendor/asset addresses.
 */
export function emailsFromPage(html: string): string[] {
  const src = html.replace(/&#0*64;|&#x0*40;|%40|\\u0040/gi, "@");
  const found = new Set<string>();
  for (const m of src.matchAll(/mailto:([^"'?\s<>]+)/gi)) {
    try {
      found.add(decodeURIComponent(m[1]));
    } catch {
      found.add(m[1]);
    }
  }
  for (const m of src.matchAll(EMAIL_RE)) found.add(m[0]);
  return [...found]
    .map((e) => e.replace(/^[._%+-]+/, "").replace(/[.,;:]+$/, "").toLowerCase())
    .filter((e) => /^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/.test(e) && !ASSET_TLD.test(e) && !VENDOR_DOMAIN.test(e) && !ROLE_PREFIX.test(e) && !isReservedAddress(e))
    .sort((a, b) => businessRank(b) - businessRank(a));
}

/** Do two strings share a run of at least n characters? ("cynthiacontentco", "thatgirlcynthiaa") → true */
export function sharesChunk(a: string, b: string, n = 5) {
  for (let i = 0; i + n <= a.length; i++) if (b.includes(a.slice(i, i + n))) return true;
  return false;
}

/**
 * The creator's own emails from a page their bio links to. Anything goes on link-in-bio pages; on
 * other sites an address counts only if it resembles the handle, or sits on the site's own domain
 * and that domain resembles the handle (their personal site). A bio link to a survey or a store
 * shouldn't hand us someone else's address.
 */
export function creatorEmailsFromPage(html: string, pageUrl: string, handle: string): string[] {
  const host = new URL(pageUrl).hostname.toLowerCase().replace(/^www\./, "");
  const emails = emailsFromPage(html);
  if (LINK_IN_BIO_HOST.test(host)) return emails;
  const site = host.split(".").slice(-2).join(".");
  const key = handle.toLowerCase().replace(/[^a-z0-9]/g, "");
  const ownSite = sharesChunk(site.split(".")[0], key);
  return emails.filter((e) => {
    const [local, domain] = e.split("@");
    if (ownSite && (domain === site || domain.endsWith(`.${site}`))) return true;
    return sharesChunk(local.replace(/[^a-z0-9]/g, ""), key);
  });
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

/** Reserved, undeliverable domains (RFC 2606 / RFC 6761). Demo creators use these so nobody real is emailed. */
export const isReservedAddress = (email: string) => /@([a-z0-9-]+\.)*(example\.(com|net|org)|test|invalid|localhost)$/i.test(email.trim());
