import { defineConfig } from "drizzle-kit";

// Local scripts read the env vars `vercel env pull` wrote; on Vercel they're already set.
try {
  process.loadEnvFile(".env.local");
} catch {}

export default defineConfig({
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  // Schema changes go over the direct (unpooled) connection, per Neon's guidance.
  dbCredentials: { url: (process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL!).replace(/sslmode=(require|prefer|verify-ca)/, "sslmode=verify-full") },
});
