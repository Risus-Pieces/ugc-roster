import { syncAll, detectBreakouts } from "@/lib/services/tracking";
import { cronAuthorized, unauthorized } from "../../_lib/auth";

export const maxDuration = 300;

/** Every 6 hours: pull new posts + day-1/7/14 snapshots on every connected account, then flag breakouts. */
export async function GET(req: Request) {
  if (!cronAuthorized(req)) return unauthorized("Send Authorization: Bearer <CRON_SECRET>.");
  const started = Date.now();
  try {
    const sync = await syncAll();
    const breakouts = await detectBreakouts();
    return Response.json({ ok: true, ...sync, breakouts: breakouts.length, ms: Date.now() - started }, { status: sync.errors.length && !sync.accounts ? 500 : 200 });
  } catch (e) {
    console.error("[cron/sync]", e);
    return Response.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
