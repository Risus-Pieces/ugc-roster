import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";

/** Constant-time string comparison. */
export function safeEqual(a: string, b: string) {
  const A = Buffer.from(a);
  const B = Buffer.from(b);
  return A.length === B.length && timingSafeEqual(A, B);
}

/** Cron endpoints: when CRON_SECRET is set, require `Authorization: Bearer <CRON_SECRET>` (Vercel Cron sends this). */
export function cronAuthorized(req: Request) {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) return true;
  return safeEqual(req.headers.get("authorization") ?? "", `Bearer ${secret}`);
}

/** HMAC-SHA256 hex signature check (e.g. Cal.com's X-Cal-Signature-256). */
export function hmacOk(secret: string, rawBody: string, signature: string | null) {
  if (!signature) return false;
  const expected = createHmac("sha256", secret).update(rawBody).digest("hex");
  return safeEqual(expected, signature.replace(/^sha256=/, "").trim().toLowerCase());
}

export const unauthorized = (hint: string) => Response.json({ ok: false, error: "Unauthorized", hint }, { status: 401 });
export const badRequest = (error: string) => Response.json({ ok: false, error }, { status: 400 });
