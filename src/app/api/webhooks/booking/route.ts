import { and, eq } from "drizzle-orm";
import { db, calls, creators } from "@/db";
import { normalizeEmail } from "@/lib/engines/contact";
import { bookCall } from "@/lib/services/outreach";
import { hmacOk, unauthorized, badRequest } from "../../_lib/auth";

type CalPayload = {
  triggerEvent?: string;
  payload?: {
    startTime?: string;
    attendees?: { email?: string; name?: string }[];
    responses?: { email?: { value?: string } };
    location?: string;
    metadata?: { videoCallUrl?: string };
    videoCallData?: { url?: string };
  };
};

/**
 * Cal.com webhook (event: Booking created). Matches an attendee to a creator by normalized email and
 * records the call. When BOOKING_WEBHOOK_SECRET is set, the X-Cal-Signature-256 HMAC is verified.
 */
export async function POST(req: Request) {
  const raw = await req.text();
  const secret = process.env.BOOKING_WEBHOOK_SECRET?.trim();
  if (secret && !hmacOk(secret, raw, req.headers.get("x-cal-signature-256"))) return unauthorized("X-Cal-Signature-256 doesn't match BOOKING_WEBHOOK_SECRET.");

  let body: CalPayload;
  try {
    body = JSON.parse(raw);
  } catch {
    return badRequest("Body must be JSON.");
  }
  const trigger = body.triggerEvent ?? "";
  if (trigger !== "BOOKING_CREATED" && trigger !== "BOOKING_RESCHEDULED") return Response.json({ ok: true, ignored: trigger || "no triggerEvent" });

  const p = body.payload ?? {};
  const at = p.startTime ? new Date(p.startTime) : null;
  if (!at || Number.isNaN(at.getTime())) return badRequest("payload.startTime is missing or not a date.");

  const emails = [...(p.attendees ?? []).map((a) => a.email), p.responses?.email?.value].map((e) => normalizeEmail(e)).filter((e): e is string => Boolean(e));
  let creator = null;
  for (const e of new Set(emails)) {
    creator = (await db.query.creators.findFirst({ where: eq(creators.emailNormalized, e) })) ?? null;
    if (creator) break;
  }
  if (!creator) return Response.json({ ok: true, matched: false });

  const link = p.metadata?.videoCallUrl ?? p.videoCallData?.url ?? (p.location && /^https?:\/\//.test(p.location) ? p.location : undefined);
  const dupe = await db.query.calls.findFirst({ where: and(eq(calls.creatorId, creator.id), eq(calls.scheduledAt, at)) });
  if (dupe) return Response.json({ ok: true, matched: true, callId: dupe.id, duplicate: true });

  try {
    const c = await bookCall(creator.id, at, link);
    return Response.json({ ok: true, matched: true, callId: c.id });
  } catch (e) {
    console.error("[webhooks/booking]", e);
    return Response.json({ ok: false, error: "Failed to record call" }, { status: 500 });
  }
}
