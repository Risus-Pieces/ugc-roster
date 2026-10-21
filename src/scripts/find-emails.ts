/**
 * Find contact emails creators published themselves, for creators in Roster without one:
 *   1. TikTok creators: their bio, then their bio link (Linktree, Beacons, a personal site).
 *   2. Instagram creators: the TikTok with the same handle, if the name matches.
 * Run it from your own computer: TikTok refuses most cloud servers, so it isn't a cron job.
 *   pnpm find-emails [--only tiktok|instagram] [--limit 50] [--dry-run]
 * Safe to stop and re-run; TikTok creators already checked are skipped.
 */
import { pool } from "@/db";
import { findInstagramEmailsViaTikTok, findTikTokEmails, type FindEmailsResult } from "@/lib/services/email-finder";

function flag(name: string) {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : undefined;
}

function summary(label: string, r: FindEmailsResult, dryRun: boolean) {
  const lines = [`\n${dryRun ? "[dry run] " : ""}${label}: checked ${r.checked} · ${r.fromBio} emails from bios · ${r.fromLink} from bio links · ${r.noEmail} without an email`];
  if (r.gone) lines.push(`${r.gone} ${label === "Instagram" ? "have no TikTok with the same handle" : "not found or private"}`);
  if (r.differentPerson) lines.push(`${r.differentPerson} skipped: same handle on TikTok but a different name`);
  if (r.sameEmailAs.length) lines.push(`${r.sameEmailAs.length} share an email with a creator already in Roster (likely the same person):\n${r.sameEmailAs.map((d) => `  @${d.handle} → ${d.existing}`).join("\n")}`);
  if (r.stopped) lines.push(`Stopped early: ${r.stopped}`);
  console.log(lines.join("\n"));
}

async function main() {
  const only = flag("only");
  const limit = flag("limit") ? Number(flag("limit")) : undefined;
  const dryRun = process.argv.includes("--dry-run");
  const opts = { limit, dryRun, onProgress: (line: string) => console.log(line) };
  if (only !== "instagram") {
    const r = await findTikTokEmails(opts);
    summary("TikTok", r, dryRun);
    if (r.stopped) return pool.end();
  }
  if (only !== "tiktok") summary("Instagram", await findInstagramEmailsViaTikTok(opts), dryRun);
  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
