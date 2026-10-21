/**
 * Find contact emails creators published themselves, for creators in Roster without one:
 *   tiktok     TikTok creators: their bio, then their bio link (Linktree, Beacons, a personal site)
 *   instagram  Instagram creators: bio and website via Instagram's official API (needs INSTAGRAM_GRAPH_TOKEN)
 *   twins      Instagram creators still without one: the TikTok with the same handle, if the name matches
 * Run it from your own computer: TikTok refuses most cloud servers, so it isn't a cron job.
 *   pnpm find-emails [--only tiktok|instagram|twins] [--limit 50] [--dry-run]
 * Safe to stop and re-run; accounts already checked on TikTok or Instagram are skipped.
 */
import { pool } from "@/db";
import { findInstagramEmails, findInstagramEmailsViaTikTok, findTikTokEmails, type FindEmailsResult } from "@/lib/services/email-finder";

function flag(name: string) {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : undefined;
}

const GONE: Record<string, string> = { TikTok: "not found or private", Instagram: "not found or personal accounts", "Instagram via TikTok": "have no TikTok with the same handle" };

function summary(label: string, r: FindEmailsResult, dryRun: boolean) {
  const lines = [`\n${dryRun ? "[dry run] " : ""}${label}: checked ${r.checked} · ${r.fromBio} emails from bios · ${r.fromLink} from bio links · ${r.noEmail} without an email`];
  if (r.gone) lines.push(`${r.gone} ${GONE[label]}`);
  if (r.differentPerson) lines.push(`${r.differentPerson} skipped: same handle on TikTok but a different name`);
  if (r.sameEmailAs.length) lines.push(`${r.sameEmailAs.length} share an email with a creator already in Roster (likely the same person):\n${r.sameEmailAs.map((d) => `  @${d.handle} → ${d.existing}`).join("\n")}`);
  if (r.stopped) lines.push(`Stopped early: ${r.stopped}`);
  console.log(lines.join("\n"));
  return r;
}

async function main() {
  const only = flag("only");
  const limit = flag("limit") ? Number(flag("limit")) : undefined;
  const dryRun = process.argv.includes("--dry-run");
  const opts = { limit, dryRun, onProgress: (line: string) => console.log(line) };
  const run = (pass: string) => !only || only === pass;

  if (run("tiktok") && summary("TikTok", await findTikTokEmails(opts), dryRun).stopped) return pool.end();
  if (run("instagram")) {
    if (process.env.INSTAGRAM_GRAPH_TOKEN) summary("Instagram", await findInstagramEmails(opts), dryRun);
    else console.log("\nSkipping the Instagram API pass: INSTAGRAM_GRAPH_TOKEN isn't set.");
  }
  if (run("twins")) summary("Instagram via TikTok", await findInstagramEmailsViaTikTok(opts), dryRun);
  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
