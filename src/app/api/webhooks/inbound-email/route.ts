import { createHmac } from "node:crypto";
import { ingestReply } from "@/lib/services/outreach";
import { safeEqual, unauthorized, badRequest } from "../../_lib/auth";

type Parsed = { from: string; subject?: string; text: string };

/**
 * Inbound creator replies. Accepts:
 * - Resend receiving: the `email.received` webhook carries metadata only, so the body is fetched from
 *   GET /emails/receiving/{email_id}. Signed with Svix; verified when RESEND_WEBHOOK_SECRET is set.
 * - JSON { from, subject, text }
 * - Postmark ({ From, Subject, TextBody }) and form posts (SendGrid / Mailgun: from, subject, text / body-plain)
 * For non-Resend senders, set INBOUND_EMAIL_SECRET and send it as `x-webhook-secret`, `Authorization: Bearer …`, or `?secret=`.
 */
export async function POST(req: Request) {
  const raw = await req.text();
  const svixId = req.headers.get("svix-id");
  const resendSecret = process.env.RESEND_WEBHOOK_SECRET?.trim();
  if (svixId && resendSecret) {
    if (!verifySvix(resendSecret, svixId, req.headers.get("svix-timestamp"), req.headers.get("svix-signature"), raw)) return unauthorized("Svix signature doesn't match RESEND_WEBHOOK_SECRET.");
  } else if (resendSecret && !process.env.INBOUND_EMAIL_SECRET) {
    return unauthorized("Expected a signed Resend webhook.");
  }
  const secret = process.env.INBOUND_EMAIL_SECRET?.trim();
  if (secret && !(svixId && resendSecret)) {
    const url = new URL(req.url);
    const given = req.headers.get("x-webhook-secret") ?? req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? url.searchParams.get("secret") ?? "";
    if (!safeEqual(given, secret)) return unauthorized("Send INBOUND_EMAIL_SECRET as the x-webhook-secret header.");
  }

  let msg: Parsed | null;
  try {
    msg = await parse(raw, req.headers.get("content-type") ?? "");
  } catch (e) {
    const why = e instanceof Error && /RESEND|Resend/.test(e.message) ? e.message : "Couldn't read the body. Send JSON { from, subject, text }.";
    return badRequest(why);
  }
  if (!msg?.from || !msg.text.trim()) return badRequest("Missing from or text.");

  try {
    const r = await ingestReply({ from: msg.from, subject: msg.subject, text: stripQuoted(msg.text) });
    // 200 even when unmatched so the provider doesn't retry an email from someone who isn't a creator.
    return Response.json(r.matched ? { ok: true, matched: true, creatorId: r.message.creatorId, classification: r.message.classification } : { ok: true, matched: false });
  } catch (e) {
    console.error("[webhooks/inbound-email]", e);
    return Response.json({ ok: false, error: "Failed to record reply" }, { status: 500 });
  }
}

async function parse(raw: string, type: string): Promise<Parsed | null> {
  if (type.includes("application/json")) {
    const j = JSON.parse(raw);
    const d = j?.data && typeof j.data === "object" ? j.data : j; // Resend wraps the email in `data`
    if (j?.type === "email.received" && d.email_id && !d.text && !d.html) {
      const full = await fetchResendReceived(String(d.email_id));
      return { from: addr(full.from ?? d.from), subject: full.subject ?? d.subject ?? undefined, text: full.text ?? (full.html ? htmlToText(full.html) : "") };
    }
    const from = addr(d.from ?? d.From ?? d.sender);
    const text = String(d.text ?? d.TextBody ?? d.plain ?? d["stripped-text"] ?? (d.html ? htmlToText(String(d.html)) : d.HtmlBody ? htmlToText(String(d.HtmlBody)) : ""));
    return { from, subject: d.subject ?? d.Subject ?? undefined, text };
  }
  if (type.includes("form")) {
    const f = new URLSearchParams(raw);
    const g = (k: string) => (typeof f.get(k) === "string" ? (f.get(k) as string) : "");
    const text = g("stripped-text") || g("text") || g("body-plain") || htmlToText(g("html") || g("body-html"));
    return { from: g("from") || g("sender"), subject: g("subject") || undefined, text };
  }
  return null;
}

/** "Name <a@b.com>", { email, name }, or [{ email }] → a string ingestReply can normalize. */
function addr(v: unknown): string {
  if (!v) return "";
  if (typeof v === "string") return v;
  if (Array.isArray(v)) return addr(v[0]);
  if (typeof v === "object") {
    const o = v as Record<string, unknown>;
    return String(o.email ?? o.address ?? o.Email ?? "");
  }
  return "";
}

function htmlToText(html: string) {
  return html
    .replace(/<(br|\/p|\/div)\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .trim();
}

/** Drop the quoted thread so the classifier only sees what the creator wrote. */
function stripQuoted(text: string) {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const out: string[] = [];
  for (const l of lines) {
    if (/^On .+wrote:\s*$/.test(l.trim()) || /^-{2,}\s*Original Message/i.test(l.trim()) || /^From: .+/.test(l.trim())) break;
    if (l.trim().startsWith(">")) continue;
    out.push(l);
  }
  const s = out.join("\n").trim();
  return s || text.trim();
}

/** Resend's webhook omits the body; fetch it with the API key. */
async function fetchResendReceived(id: string): Promise<{ from?: string; subject?: string; text?: string | null; html?: string | null }> {
  if (!process.env.RESEND_API_KEY) throw new Error("RESEND_API_KEY is needed to read received emails");
  const res = await fetch(`https://api.resend.com/emails/receiving/${encodeURIComponent(id)}`, { headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}` } });
  if (!res.ok) throw new Error(`Resend receiving API ${res.status}`);
  return res.json();
}

/** Svix signature: base64 HMAC-SHA256 of "id.timestamp.body" with the whsec_ secret; rejects stale timestamps. */
function verifySvix(secret: string, id: string, timestamp: string | null, signatures: string | null, body: string) {
  if (!timestamp || !signatures) return false;
  if (Math.abs(Date.now() / 1000 - Number(timestamp)) > 5 * 60) return false;
  const key = Buffer.from(secret.replace(/^whsec_/, ""), "base64");
  const expected = createHmac("sha256", key).update(`${id}.${timestamp}.${body}`).digest("base64");
  return signatures.split(" ").some((s) => safeEqual(s.replace(/^v1,/, ""), expected));
}
