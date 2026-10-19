import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { attachDatabasePool } from "@vercel/functions";
import * as schema from "./schema";

// Neon over node-postgres. On Vercel Fluid compute, attachDatabasePool keeps the instance alive
// just long enough to close idle connections cleanly. DATABASE_URL is Neon's pooled endpoint.
const globalForDb = globalThis as unknown as { pgPool?: Pool };

function createPool() {
  // pg connects lazily, so a missing URL only fails when a query runs (builds without a database still work).
  if (!process.env.DATABASE_URL) console.warn("DATABASE_URL is not set. Run `vercel env pull` to fetch it.");
  const pool = new Pool({ connectionString: process.env.DATABASE_URL && strictSsl(process.env.DATABASE_URL), max: 10, idleTimeoutMillis: 5_000 });
  attachDatabasePool(pool);
  return pool;
}

/** Neon's URLs say sslmode=require, which pg already treats as verify-full; say so explicitly. */
export function strictSsl(url: string) {
  return url.replace(/sslmode=(require|prefer|verify-ca)/, "sslmode=verify-full");
}

const pool = globalForDb.pgPool ?? createPool();
if (process.env.NODE_ENV !== "production") globalForDb.pgPool = pool;

export const db = drizzle(pool, { schema });
export { pool };
export * from "./schema";
