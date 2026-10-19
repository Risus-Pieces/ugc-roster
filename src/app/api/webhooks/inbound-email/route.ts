import { ingestReply } from "@/lib/services/outreach";
import { safeEqual, unauthorized, badRequest } from "../../_lib/auth";

type Parsed = { from: string; subject?: string; text: string };

/**
 * Inbound creator replies. Accepts:
 * - JSON { from, subject, text }
 * - Resend inbound ({ type: "email.received", data: { from, subject, text, html } })
 * - Postmark ({ From, Subject, TextBody }) and form posts (SendGrid / Mailgun: from, subject, text / body-plain)
 * When INBOUND_EMAIL_SECRET is set, send it as `x-webhook-secret`, `Authorization: Bearer …`, or `?secret=`.
 */
export async function POST(req: Request) {
  const secret = process.env.INBOUND_EMAIL_SECRET?.trim();
  if (secret) {
    const url = new URL(req.url);
    const given = req.headers.get("x-webhook-secret") ?? req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? url.searchParams.get("secret") ?? "";
    if (!safeEqual(given, secret)) return unauthorized("Send INBOUND_EMAIL_SECRET as the x-webhook-secret header.");
  }

  let msg: Parsed | null;
  try {
    msg = await parse(req);
  } catch {
    return badRequest("Couldn't read the body. Send JSON { from, subject, text }.");
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

async function parse(req: Request): Promise<Parsed | null> {
  const type = req.headers.get("content-type") ?? "";
  if (type.includes("application/json")) {
    const j = await req.json();
    const d = j?.data && typeof j.data === "object" ? j.data : j; // Resend wraps the email in `data`
    const from = addr(d.from ?? d.From ?? d.sender);
    const text = String(d.text ?? d.TextBody ?? d.plain ?? d["stripped-text"] ?? (d.html ? htmlToText(String(d.html)) : d.HtmlBody ? htmlToText(String(d.HtmlBody)) : ""));
    return { from, subject: d.subject ?? d.Subject ?? undefined, text };
  }
  if (type.includes("form")) {
    const f = await req.formData();
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
