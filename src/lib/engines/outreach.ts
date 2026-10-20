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
