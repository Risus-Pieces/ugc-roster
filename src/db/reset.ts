/**
 * Empties every table and re-seeds demo data. Destructive: local development and production share
 * the Neon database unless you point DATABASE_URL at a separate Neon branch, so this refuses to run
 * without --yes.
 */
import { sql } from "drizzle-orm";
import { db, pool } from "./index";

async function main() {
  const host = new URL(process.env.DATABASE_URL!).hostname;
  if (!process.argv.includes("--yes")) {
    console.error(`This deletes ALL data in ${host.split(".")[0]} (${host.split(".").slice(1, 3).join(".")}).\nRe-run with: pnpm db:reset --yes`);
    process.exit(1);
  }
  const tables = await db.execute<{ tablename: string }>(sql`select tablename from pg_tables where schemaname = 'public'`);
  const names = tables.rows.map((r) => `"${r.tablename}"`);
  if (names.length) await db.execute(sql.raw(`truncate ${names.join(", ")} restart identity cascade`));
  console.log(`Emptied ${names.length} tables.`);
  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
