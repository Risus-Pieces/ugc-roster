import "server-only";
import { isReservedAddress } from "@/lib/engines/contact";

export type SendResult = { status: "sent" | "simulated" | "failed"; providerMessageId?: string; error?: string };

export function emailLive() {
  return Boolean(process.env.RESEND_API_KEY && process.env.EMAIL_FROM);
}


/**
 * Sends through Resend when RESEND_API_KEY and EMAIL_FROM are set (use a dedicated outreach
 * domain with SPF/DKIM/DMARC so cold email doesn't hurt your main domain). Otherwise the
 * message is recorded as "simulated" so the pipeline still works locally.
 */

export async function sendEmail(p: { to: string; subject: string; text: string; replyTo?: string; headers?: Record<string, string> }): Promise<SendResult> {
  // Demo creators use reserved addresses; never hand those to the provider.
  if (!emailLive() || isReservedAddress(p.to)) return { status: "simulated" };
  try {
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
      }),
    });
    const j = await res.json();
    if (!res.ok) return { status: "failed", error: j.message ?? JSON.stringify(j) };
    return { status: "sent", providerMessageId: j.id };
  } catch (e) {
    return { status: "failed", error: e instanceof Error ? e.message : String(e) };
  }
}
