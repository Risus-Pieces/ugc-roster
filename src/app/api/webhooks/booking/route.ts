import { and, eq } from "drizzle-orm";
import { db, calls, creators } from "@/db";
import { normalizeEmail } from "@/lib/engines/contact";
import { bookCall } from "@/lib/services/outreach";
import { createHmac } from "node:crypto";
import { hmacOk, safeEqual, unauthorized, badRequest } from "../../_lib/auth";

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

type CalendlyPayload = {
  event?: string;
  payload?: {
    email?: string;
    name?: string;
    scheduled_event?: { start_time?: string; location?: { join_url?: string; location?: string } };
  };
};

/**
 * Booked intro calls. Calendly (event `invitee.created`, needs a paid Calendly plan for webhooks) or
 * Cal.com (`BOOKING_CREATED`). Matches the invitee to a creator by normalized email and records the
 * call. When BOOKING_WEBHOOK_SECRET is set, the provider's signature is verified.
 */
export async function POST(req: Request) {
  const raw = await req.text();
  const secret = process.env.BOOKING_WEBHOOK_SECRET?.trim();
  const calendlySig = req.headers.get("calendly-webhook-signature");
  if (secret) {
    const ok = calendlySig ? calendlyOk(secret, raw, calendlySig) : hmacOk(secret, raw, req.headers.get("x-cal-signature-256"));
    if (!ok) return unauthorized("Webhook signature doesn't match BOOKING_WEBHOOK_SECRET.");
  }

  let body: CalPayload & CalendlyPayload;
  try {
    body = JSON.parse(raw);
  } catch {
    return badRequest("Body must be JSON.");
  }

  if (body.event) {
    if (body.event !== "invitee.created") return Response.json({ ok: true, ignored: body.event });
    const p = (body as CalendlyPayload).payload ?? {};
    const at = p.scheduled_event?.start_time ? new Date(p.scheduled_event.start_time) : null;
    if (!at || Number.isNaN(at.getTime())) return badRequest("payload.scheduled_event.start_time is missing or not a date.");
    const loc = p.scheduled_event?.location;
    return record([p.email], at, loc?.join_url ?? (loc?.location && /^https?:\/\//.test(loc.location) ? loc.location : undefined));
  }
  const trigger = body.triggerEvent ?? "";
  if (trigger !== "BOOKING_CREATED" && trigger !== "BOOKING_RESCHEDULED") return Response.json({ ok: true, ignored: trigger || "no triggerEvent" });

  const p = body.payload ?? {};
  const at = p.startTime ? new Date(p.startTime) : null;
  if (!at || Number.isNaN(at.getTime())) return badRequest("payload.startTime is missing or not a date.");

  const link = p.metadata?.videoCallUrl ?? p.videoCallData?.url ?? (p.location && /^https?:\/\//.test(p.location) ? p.location : undefined);
  return record([...(p.attendees ?? []).map((a) => a.email), p.responses?.email?.value], at, link);
}

async function record(rawEmails: (string | undefined)[], at: Date, link: string | undefined) {
  const emails = rawEmails.map((e) => normalizeEmail(e)).filter((e): e is string => Boolean(e));
  let creator = null;
  for (const e of new Set(emails)) {
    creator = (await db.query.creators.findFirst({ where: eq(creators.emailNormalized, e) })) ?? null;
    if (creator) break;
  }
  if (!creator) return Response.json({ ok: true, matched: false });

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

/** Calendly-Webhook-Signature: "t=<unix>,v1=<hex HMAC-SHA256 of `${t}.${body}`>"; rejects stale timestamps. */
function calendlyOk(secret: string, raw: string, header: string) {
  const parts = Object.fromEntries(header.split(",").map((kv) => kv.trim().split("=") as [string, string]));
  if (!parts.t || !parts.v1) return false;
  if (Math.abs(Date.now() / 1000 - Number(parts.t)) > 3 * 60) return false;
  return safeEqual(createHmac("sha256", secret).update(`${parts.t}.${raw}`).digest("hex"), parts.v1);
}
