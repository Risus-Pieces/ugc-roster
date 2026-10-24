import { timingSafeEqual } from "node:crypto";
import { recordSignup } from "@/lib/services/signups";

/**
 * Waitlist signup from a creator's link, for form tools and automations (Zapier, Make):
 *   POST /api/signups  Authorization: Bearer <SIGNUP_WEBHOOK_SECRET>
 *   { "email": "...", "ref": "CODE", "signedUpAt": "2026-10-21T15:04:00Z" }
 * Server-to-server only: a secret in a browser form would let anyone add signups.
 */
export async function POST(req: Request) {
  const secret = process.env.SIGNUP_WEBHOOK_SECRET;
  if (!secret) return Response.json({ ok: false, error: "Signups webhook is off. Set SIGNUP_WEBHOOK_SECRET to turn it on." }, { status: 503 });
  const given = Buffer.from((req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, ""));
  const want = Buffer.from(secret);
  if (given.length !== want.length || !timingSafeEqual(given, want)) return Response.json({ ok: false, error: "Wrong or missing secret." }, { status: 401 });

  let body: { email?: unknown; ref?: unknown; signedUpAt?: unknown };
  try {
    body = await req.json();
  } catch {
    return Response.json({ ok: false, error: 'Body must be JSON: { "email", "ref", "signedUpAt"? }' }, { status: 400 });
  }
  if (typeof body.email !== "string" || typeof body.ref !== "string") return Response.json({ ok: false, error: "email and ref are required strings." }, { status: 400 });
  const r = await recordSignup({ email: body.email, ref: body.ref, signedUpAt: typeof body.signedUpAt === "string" ? body.signedUpAt : undefined });
  const status = r.added ? "added" : r.duplicate ? "duplicate" : r.self ? "creator's own email" : r.unknownRef ? "unknown ref" : r.noRef ? "missing ref" : "invalid email";
  return Response.json({ ok: r.added > 0, status });
}
