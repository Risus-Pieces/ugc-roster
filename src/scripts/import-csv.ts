/**
 * Import creator CSV exports from the command line, same rules as Discover → Import.
 *   pnpm import-csv --campaign "Spicy food creators" --source Modash file1.csv file2.csv …
 * Add --only-in-band to skip creators outside the campaign's follower range.
 */
import { readFileSync } from "node:fs";
import { basename } from "node:path";
import { eq } from "drizzle-orm";
import { db, pool, campaigns } from "@/db";
import { runImport } from "@/lib/services/importer";

function flag(name: string) {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  const campaignName = flag("campaign");
  const source = flag("source") ?? "Spreadsheet";
  const flagValues = new Set([campaignName, flag("source")]);
  const files = process.argv.slice(2).filter((a) => !a.startsWith("--") && !flagValues.has(a));
  if (!campaignName || !files.length) {
    console.error('Usage: pnpm import-csv --campaign "Campaign name" [--source Modash] [--only-in-band] file.csv …');
    process.exit(1);
  }
  const campaign = await db.query.campaigns.findFirst({ where: eq(campaigns.name, campaignName) });
  if (!campaign) throw new Error(`No campaign named “${campaignName}”.`);

  let total = 0;
  for (const file of files) {
    const { created, emailsAdded, plan } = await runImport(readFileSync(file, "utf8"), { campaignId: campaign.id, source, defaultPlatform: null, onlyInBand: process.argv.includes("--only-in-band") });
    total += created;
    console.log(`${basename(file)}: ${created} added · ${plan.duplicates.length} already in Roster (${emailsAdded} given a missing email) · ${plan.skipped.length} skipped`);
  }
  console.log(`Done: ${total} creators added to ${campaign.name}.`);
  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
