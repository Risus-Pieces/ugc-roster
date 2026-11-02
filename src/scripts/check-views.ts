/**
 * Check what creators' recent videos actually get, so Compose can sort and filter on typical (median) views:
 *   tiktok     TikTok creators: per-video views from their public embed
 *   instagram  Instagram creators TikTok didn't score: Business Discovery (needs INSTAGRAM_GRAPH_TOKEN)
 * Prospects with emails go first, then creators already contacted, then with --all anyone without an email.
 * Run it from your own computer: TikTok refuses most cloud servers, so it isn't a cron job.
 *   pnpm check-views [--only tiktok|instagram] [--all] [--limit 50] [--dry-run] [--handles a,b] [--recheck-days 14]
 * Safe to stop and re-run; accounts checked in the last two weeks are skipped. It waits out network drops the same way.
 */
import { pool } from "@/db";
import { networkDropped } from "@/lib/engines/public-views";
import { sleep } from "@/lib/services/email-finder";
import { checkInstagramViews, checkTikTokViews, type CheckViewsResult } from "@/lib/services/view-check";

const NETWORK_WAIT_MS = 120_000;
const MAX_NETWORK_WAITS = 90; // three hours offline in one run

function flag(name: string) {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : undefined;
}

function summary(label: string, r: CheckViewsResult, dryRun: boolean) {
  console.log(`\n${dryRun ? "[dry run] " : ""}${label}: checked ${r.checked} · ${r.scored} scored · ${r.noData} with no view data`);
  if (r.stopped) console.log(`Stopped: ${r.stopped}`);
}

/** A dropped connection can throw from any fetch or database write. What's saved stays saved, so start again from what's left. */
async function throughNetworkDrops(run: () => Promise<CheckViewsResult>) {
  for (let waits = 0; ; waits++) {
    try {
      return await run();
    } catch (e) {
      if (!networkDropped(e) || waits >= MAX_NETWORK_WAITS) throw e;
      console.log(`Network dropped, trying again in ${NETWORK_WAIT_MS / 60_000} minutes`);
      await sleep(NETWORK_WAIT_MS);
    }
  }
}

async function main() {
  const only = flag("only");
  const dryRun = process.argv.includes("--dry-run");
  const opts = {
    limit: flag("limit") ? Number(flag("limit")) : undefined,
    recheckDays: flag("recheck-days") ? Number(flag("recheck-days")) : undefined,
    handles: flag("handles")?.split(",").map((h) => h.trim().replace(/^@/, "").toLowerCase()),
    includeNoEmail: process.argv.includes("--all"),
    dryRun,
    onProgress: (line: string) => console.log(line),
  };
  if (!only || only === "tiktok") summary("TikTok", await throughNetworkDrops(() => checkTikTokViews(opts)), dryRun);
  if (!only || only === "instagram") summary("Instagram", await throughNetworkDrops(() => checkInstagramViews(opts)), dryRun);
  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
