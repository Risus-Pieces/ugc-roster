import "server-only";
import { isReservedAddress } from "@/lib/engines/contact";
import { rateLimitWaitMs } from "@/lib/engines/outreach";

export type SendResult = { status: "sent" | "simulated" | "failed"; providerMessageId?: string; error?: string };

export function emailLive() {
  return Boolean(process.env.RESEND_API_KEY && process.env.EMAIL_FROM);
}


/**
 * Sends through Resend when RESEND_API_KEY and EMAIL_FROM are set (use a dedicated outreach
 * domain with SPF/DKIM/DMARC so cold email doesn't hurt your main domain). Otherwise the
 * message is recorded as "simulated" so the pipeline still works locally.
 */

export async function sendEmail(p: {
  to: string;
  subject: string;
  text: string;
  replyTo?: string;
  headers?: Record<string, string>;
  /** Resend holds the email until then; leave out to send now. */
  scheduledAt?: Date;
}): Promise<SendResult> {
  // Demo creators use reserved addresses; never hand those to the provider.
  if (!emailLive() || isReservedAddress(p.to)) return { status: "simulated" };
  try {
    for (let attempt = 1; ; attempt++) {
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          from: process.env.EMAIL_FROM,
          to: [p.to],
          subject: p.subject,
          text: p.text,
          reply_to: p.replyTo ?? process.env.EMAIL_REPLY_TO,
          headers: p.headers,
          scheduled_at: p.scheduledAt?.toISOString(),
        }),
      });
      const j = await res.json();
      if (res.ok) return { status: "sent", providerMessageId: j.id };
      const wait = rateLimitWaitMs({ status: res.status, errorName: j.name, retryAfter: res.headers.get("retry-after"), attempt });
      if (wait === null) return { status: "failed", error: j.message ?? JSON.stringify(j) };
      await new Promise((r) => setTimeout(r, wait));
    }
  } catch (e) {
    return { status: "failed", error: e instanceof Error ? e.message : String(e) };
  }
}
