import { refreshHookBank, generateDailyBriefs } from "@/lib/services/creative";
import { ascConfigured, syncAppStoreDay } from "@/lib/integrations/revenue";
import { cronAuthorized, unauthorized } from "../../_lib/auth";

export const maxDuration = 300;

/** Daily (13:00 UTC): refresh the hook bank, write today's briefs, pull yesterday's App Store report. */
export async function GET(req: Request) {
  if (!cronAuthorized(req)) return unauthorized("Send Authorization: Bearer <CRON_SECRET>.");
  const started = Date.now();
  const errors: string[] = [];
  const step = async <T,>(name: string, fn: () => Promise<T>) => {
    try {
      return await fn();
    } catch (e) {
      console.error(`[cron/daily] ${name}`, e);
      errors.push(`${name}: ${e instanceof Error ? e.message : String(e)}`);
      return null;
    }
  };

  const hookBank = await step("hook bank", () => refreshHookBank());
  const briefs = await step("briefs", () => generateDailyBriefs());
  const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
  const appStore = ascConfigured() ? await step("app store", () => syncAppStoreDay(yesterday)) : { skipped: true, reason: "App Store Connect not configured" };

  return Response.json({ ok: errors.length === 0, hookBank, briefs, appStore: { date: yesterday, ...appStore }, errors, ms: Date.now() - started }, { status: errors.length ? 500 : 200 });
}
