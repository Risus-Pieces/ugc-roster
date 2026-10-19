import { ingestRevenueCatEvent } from "@/lib/integrations/revenue";
import { safeEqual, unauthorized, badRequest } from "../../_lib/auth";

/**
 * RevenueCat → Integrations → Webhooks. Set the Authorization header value to REVENUECAT_WEBHOOK_SECRET
 * (either the bare secret or "Bearer <secret>" is accepted).
 */
export async function POST(req: Request) {
  const secret = process.env.REVENUECAT_WEBHOOK_SECRET?.trim();
  if (secret) {
    const h = req.headers.get("authorization") ?? "";
    if (!safeEqual(h, secret) && !safeEqual(h, `Bearer ${secret}`)) return unauthorized("Authorization header must equal REVENUECAT_WEBHOOK_SECRET.");
  }
  let body: { event?: Record<string, unknown> };
  try {
    body = await req.json();
  } catch {
    return badRequest("Body must be JSON.");
  }
  const e = body?.event;
  if (!e || typeof e !== "object" || typeof e.type !== "string" || typeof e.event_timestamp_ms !== "number") return badRequest("Expected { event: { type, event_timestamp_ms, … } }.");
  try {
    await ingestRevenueCatEvent({ event: e });
    return Response.json({ ok: true, type: e.type });
  } catch (err) {
    console.error("[webhooks/revenuecat]", err);
    return Response.json({ ok: false, error: "Failed to record event" }, { status: 500 }); // RevenueCat retries on 5xx
  }
}
