/** Cold-email rules: compliance footer, do-not-contact, and the follow-up schedule. */

export type MessageLite = {
  direction: "out" | "in";
  status: string;
  subject?: string | null;
  body?: string;
  classification?: string | null;
  sentAt?: Date | null;
  createdAt: Date;
};

const OPT_OUT = /\b(unsubscribe|remove me|stop emailing|don'?t (email|contact) me|take me off|opt.?out)\b/i;
const FOOTER_MARK = "If you'd rather not hear from us";

/**
 * CAN-SPAM: commercial email needs the sender's postal address and a working way to opt out.
 * Opting out by reply is allowed, and we honour it automatically (see doNotContact).
 */
export function complianceFooter(p: { senderName: string; brandName: string; mailingAddress?: string }) {
  const who = [p.senderName, p.brandName, p.mailingAddress?.trim()].filter(Boolean).join(" · ");
  return `\n\n—\n${who}\n${FOOTER_MARK}, reply "no thanks" and we won't email you again.`;
}

export function withFooter(body: string, footer: string) {
  return body.includes(FOOTER_MARK) ? body : body.trimEnd() + footer;
}

/** Never email someone who's been cut, said no, or asked to stop. */
export function doNotContact(stage: string, history: MessageLite[]): string | null {
  if (stage === "cut") return "was cut from the program";
  const inbound = history.filter((m) => m.direction === "in");
  if (inbound.some((m) => m.classification === "not_interested")) return "said they're not interested";
  if (inbound.some((m) => OPT_OUT.test(m.body ?? ""))) return "asked not to be emailed";
  return null;
}

const DAY = 86_400_000;
const sentTime = (m: MessageLite) => (m.sentAt ?? m.createdAt).getTime();

/**
 * Follow-ups go out on a schedule measured from the first email (default day 4 and day 9), keep the
 * planned spacing after the previous email, and only while the creator hasn't replied and nothing
 * is already drafted.
 */
export function followUpStatus(history: MessageLite[], scheduleDays: number[], now = new Date()) {
  const sent = history.filter((m) => m.direction === "out" && (m.status === "sent" || m.status === "simulated")).sort((a, b) => sentTime(a) - sentTime(b));
  const none = { due: false as const };
  if (!sent.length) return none;
  if (history.some((m) => m.direction === "in")) return none;
  if (history.some((m) => m.direction === "out" && m.status === "draft")) return none;
  const step = sent.length; // 1 = first follow-up
  if (step > scheduleDays.length) return none;
  const first = sentTime(sent[0]);
  const last = sentTime(sent[sent.length - 1]);
  // On schedule from the first email, but never sooner than the planned gap after the previous one.
  const gap = scheduleDays[step - 1] - (step > 1 ? scheduleDays[step - 2] : 0);
  const dueAt = Math.max(first + scheduleDays[step - 1] * DAY, last + gap * DAY);
  if (now.getTime() < dueAt) return { due: false as const, nextAt: new Date(dueAt), step };
  const original = sent[0];
  return {
    due: true as const,
    step,
    of: scheduleDays.length,
    daysSinceFirst: Math.floor((now.getTime() - first) / DAY),
    subject: original.subject?.startsWith("Re:") ? original.subject : `Re: ${original.subject ?? "Paid video collab"}`,
    originalBody: original.body ?? "",
  };
}

type Sender = { name: string; senderName: string; openerSubject?: string; openerBody?: string };
export type Recipient = { name: string; handle?: string | null };
const firstName = (s: string) => s.trim().split(/\s+/)[0] ?? "";

// First words that mean the "name" on file is a channel name ("Spice Combo", "The Adaptive Maritimer", "Lil Mk").
const NOT_A_NAME = new Set(["the", "a", "we", "my", "our", "its", "im", "chef", "mr", "mrs", "ms", "dr", "lil", "big", "king", "queen", "official", "spicy", "spice", "food", "foodie", "foodies", "eats", "kitchen", "mukbang", "asmr", "pov", "tv", "team", "just", "real", "hot"]);
// Words anywhere in the name that mean it's a channel ("Munching with Marina", "Ami Recommends").
// Food words inside a run-together name. Narrower than the handle list so names like Yumi or Noodle stay.
const CHANNEL_IN_WORD = /(grub|eats|eatz|food|bites|kitchen|cook|chef|mukbang|snack|spicy|munch|hungr|recipe|bbq|grill)/i;
const CHANNEL_WORD = /\b(with|eats?|kitchen|recipes?|cooks?|cooking|foodie|food|mukbang|reviews?|recommends|bbq|official|tv|channel)\b/i;

/**
 * What to call a creator in "Hey {name}!": their first name when the name on file looks like one
 * ("Carmen Roman" → Carmen, "Stef and Nat" stays whole), otherwise @handle ("🏆 We Love Ranking Real 🥰").
 */
export function greetingName(r: Recipient) {
  const handle = r.handle?.replace(/^@/, "").trim();
  const fallback = handle ? `@${handle}` : "there";
  if (/[_\d.@]/.test(r.name) || CHANNEL_WORD.test(r.name)) return fallback; // handle-like ("Fullmoon_chadani") or a channel
  const clean = r.name.replace(/[^\p{L}\p{M}\s'’&-]/gu, " ").replace(/\s+/g, " ").trim();
  const words = clean.split(" ").filter(Boolean);
  if (!words.length || NOT_A_NAME.has(words[0].toLowerCase().replace(/['’]/g, ""))) return fallback;
  if (words.length <= 4 && words.some((w) => /^(and|&)$/i.test(w))) return clean; // a duo
  if (CHANNEL_IN_WORD.test(words[0])) return fallback; // "Grublife", "Bites by Danielle"
  let first = words[0];
  if (/^\p{Lu}{2,}$/u.test(first)) first = first[0] + first.slice(1).toLowerCase(); // NOODLE → Noodle
  if (!/^\p{L}[\p{Ll}\p{M}'’-]{1,11}$/u.test(first)) return fallback; // POVKitchen, single letters, run-ons like Jennylaprincess
  return first[0].toUpperCase() + first.slice(1);
}

/** Fill {name} and {handle} (the bare handle; write @{handle} for the at sign). */
export function fillPlaceholders(text: string, r: Recipient) {
  const handle = r.handle?.replace(/^@/, "").trim();
  const name = greetingName(r);
  return text
    .replace(/@?\{\s*handle\s*\}/gi, (m) => (handle ? (m.startsWith("@") ? `@${handle}` : handle) : name))
    .replace(/\{\s*name\s*\}/gi, name);
}

/**
 * The first email to a creator: the text saved in Settings with {name} and {handle} filled in, otherwise
 * sent as written (the opt-out footer is added on send). Blank settings fall back to a plain email.
 */
export function openerEmail(brand: Sender, offer: string, perks: string[], to: Recipient) {
  const subject = brand.openerSubject?.trim() || `Paid video collab with ${brand.name}`;
  const saved = brand.openerBody?.replace(/\r\n?/g, "\n").trim();
  const perkLine = perks.length ? ` You'd also get ${perks.map((p) => p.replace(/^./, (c) => c.toLowerCase())).join(" and ")}.` : "";
  const body = saved || `Hey {name}!\n\nLove your videos.\n\nWe'd pay ${offer}.${perkLine}\n\nWant me to send over the details?\n\n${firstName(brand.senderName)}`;
  return { subject: fillPlaceholders(subject, to), body: fillPlaceholders(body, to) };
}

/** Follow-up 1 is a cheerful nudge with the deal in a breath; follow-up 2 makes it easy to say no. */
export function followUpEmail(brand: Sender, step: number, shortOffer: string, to: Recipient) {
  const name = greetingName(to);
  const sig = firstName(brand.senderName);
  return step === 1
    ? `Hey ${name}! Popping back in case this got buried. It's ${shortOffer}, and the drink's on us. Want me to send over the details?\n\n${sig}`
    : `Hey ${name}, last note from me! If a spicy collab isn't your thing right now, totally fine. If it is, just reply "yes" and I'll send everything over.\n\n${sig}`;
}

// ─── Send window ────────────────────────────────────────────────────────────

/** Cold emails go out one at a time, a few random minutes apart, during the working day in Central time. */
export const SEND_WINDOW = { timeZone: "America/Chicago", startHour: 9, endHour: 18, minGapMinutes: 2, maxGapMinutes: 5 };

function centralParts(d: Date) {
  const f = new Intl.DateTimeFormat("en-US", { timeZone: SEND_WINDOW.timeZone, hourCycle: "h23", year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric", second: "numeric" });
  const p = Object.fromEntries(f.formatToParts(d).map((x) => [x.type, Number(x.value)]));
  return { year: p.year, month: p.month, day: p.day, hour: p.hour, minute: p.minute, second: p.second };
}

/** The moment a Central wall clock reads this hour. `day` can overflow into the next month. */
function centralTime(year: number, month: number, day: number, hour: number) {
  const wall = Date.UTC(year, month - 1, day, hour);
  let at = wall;
  // Measure the zone's offset at the answer, not the guess: they differ across a clock change.
  for (let i = 0; i < 2; i++) {
    const c = centralParts(new Date(at));
    at = wall - (Date.UTC(c.year, c.month - 1, c.day, c.hour, c.minute, c.second) - at);
  }
  return new Date(at);
}

/** The Central calendar day containing `d`, which is what the daily send limit counts. */
export function sendDayBounds(d: Date) {
  const c = centralParts(d);
  return { start: centralTime(c.year, c.month, c.day, 0), end: centralTime(c.year, c.month, c.day + 1, 0) };
}

/** When the next cold email should go out: 2-5 random minutes after the last one, inside the window. */
export function nextSendSlot(p: { last: Date | null; now: Date; random?: () => number }) {
  const random = p.random ?? Math.random;
  const gap = () => (SEND_WINDOW.minGapMinutes + random() * (SEND_WINDOW.maxGapMinutes - SEND_WINDOW.minGapMinutes)) * 60_000;
  const slot = Math.max(p.now.getTime(), p.last?.getTime() ?? 0) + gap();
  const c = centralParts(new Date(slot));
  const open = centralTime(c.year, c.month, c.day, SEND_WINDOW.startHour).getTime();
  if (slot < open) return new Date(open + gap());
  if (slot < centralTime(c.year, c.month, c.day, SEND_WINDOW.endHour).getTime()) return new Date(slot);
  return new Date(centralTime(c.year, c.month, c.day + 1, SEND_WINDOW.startHour).getTime() + gap());
}

/** "Mon 9:14 AM Central" */
export const centralLabel = (d: Date) => `${new Intl.DateTimeFormat("en-US", { timeZone: SEND_WINDOW.timeZone, weekday: "short", hour: "numeric", minute: "2-digit" }).format(d)} Central`;

const RATE_LIMIT_ATTEMPTS = 4;

/**
 * How long to wait before retrying a rejected send, or null not to retry. Only the per-second rate limit
 * clears by waiting; a used-up daily or monthly quota comes back as a 429 too and would just fail again.
 */
export function rateLimitWaitMs(p: { status: number; errorName?: string; retryAfter?: string | null; attempt: number }) {
  if (p.status !== 429 || p.attempt >= RATE_LIMIT_ATTEMPTS || /quota/i.test(p.errorName ?? "")) return null;
  const seconds = Number(p.retryAfter);
  return Math.min(seconds > 0 ? seconds * 1000 : 2 ** (p.attempt - 1) * 1000, 10_000);
}

// ─── Test emails ────────────────────────────────────────────────────────────

const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Addresses typed into a box, split on commas, semicolons, spaces or new lines. */
export function parseEmailList(text: string) {
  const parts = [...new Set(text.split(/[\s,;]+/).map((s) => s.trim().toLowerCase()).filter(Boolean))];
  return { valid: parts.filter((e) => EMAIL_SHAPE.test(e)), invalid: parts.filter((e) => !EMAIL_SHAPE.test(e)) };
}

// ─── Views bar ──────────────────────────────────────────────────────────────

/**
 * Where a creator sits against the "minimum typical views" bar. Typical means the median of real posts,
 * so a score with no posts behind it (imported averages) counts as unscored.
 */
export function viewsBarStatus(score: { sampleSize: number; medianViews: number } | null | undefined, bar: number) {
  if (!score || score.sampleSize === 0) return "unscored" as const;
  return score.medianViews >= bar ? ("above" as const) : ("below" as const);
}
