import "server-only";
import { createHash } from "node:crypto";
import { Pool } from "pg";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { db, attributionEvents, creators } from "@/db";
import { normalizeEmail } from "@/lib/engines/contact";
import { cleanRef, creatorHandle, parseSignupCsv, type SignupRow } from "@/lib/engines/signups";
import { SUPABASE_ROOT_CA } from "@/lib/integrations/supabase-ca";
import { log } from "./common";

export type SignupResult = { added: number; duplicate: number; unknownRef: number; noRef: number; invalid: number; self: number; flagged: number; removed: number; unknownRefs: string[] };

/** Signups are stored as a hash of the normalized email: enough to count each person once, without keeping the address. */
const hashEmail = (email: string) => createHash("sha256").update(`signup:${normalizeEmail(email)}`).digest("hex");

/**
 * Record waitlist signups that came through a creator's link. A signup counts once per person,
 * only with a ref that matches a creator's code, and never for the creator's own email.
 * Pay is worked out later: signups inside a video's view window earn the signup bonus.
 */
export async function recordSignups(rows: Omit<SignupRow, "line">[], now = new Date()): Promise<SignupResult> {
  const r: SignupResult = { added: 0, duplicate: 0, unknownRef: 0, noRef: 0, invalid: 0, self: 0, flagged: 0, removed: 0, unknownRefs: [] };
  // Flagged on the waitlist side: never counted, and taken back out if an earlier sync counted it.
  const flagged = rows.filter((row) => row.flagged && row.email && normalizeEmail(row.email)).map((row) => hashEmail(row.email!));
  r.flagged = flagged.length;
  for (let i = 0; i < flagged.length; i += 500) {
    const gone = await db.delete(attributionEvents).where(and(eq(attributionEvents.kind, "signup"), inArray(attributionEvents.appUserId, flagged.slice(i, i + 500)))).returning({ id: attributionEvents.id });
    r.removed += gone.length;
  }
  const valid = rows.filter((row) => {
    if (row.flagged) return false;
    if (!row.email || !normalizeEmail(row.email)) return r.invalid++, false;
    if (!row.ref) return r.noRef++, false;
    return true;
  });
  if (!valid.length) return r;

  const refs = [...new Set(valid.map((v) => v.ref!))];
  const owners = await db
    .select({ id: creators.id, code: creators.promoCode, email: creators.emailNormalized })
    .from(creators)
    .where(inArray(sql`upper(${creators.promoCode})`, refs));
  const byCode = new Map(owners.map((o) => [o.code!.toUpperCase(), o]));

  const hashes = valid.map((v) => hashEmail(v.email!));
  const seen = new Set<string>();
  for (let i = 0; i < hashes.length; i += 500) {
    const chunk = hashes.slice(i, i + 500);
    const existing = await db.select({ h: attributionEvents.appUserId }).from(attributionEvents).where(and(eq(attributionEvents.kind, "signup"), inArray(attributionEvents.appUserId, chunk)));
    for (const e of existing) if (e.h) seen.add(e.h);
  }

  const inserts: (typeof attributionEvents.$inferInsert)[] = [];
  valid.forEach((v, i) => {
    const owner = byCode.get(v.ref!);
    if (!owner) {
      r.unknownRef++;
      if (r.unknownRefs.length < 10 && !r.unknownRefs.includes(v.ref!)) r.unknownRefs.push(v.ref!);
      return;
    }
    if (owner.email && owner.email === normalizeEmail(v.email)) return void r.self++;
    if (seen.has(hashes[i])) return void r.duplicate++;
    seen.add(hashes[i]);
    inserts.push({ creatorId: owner.id, kind: "signup", appUserId: hashes[i], occurredAt: v.at && v.at <= now ? v.at : now });
  });
  for (let i = 0; i < inserts.length; i += 500) await db.insert(attributionEvents).values(inserts.slice(i, i + 500));
  r.added = inserts.length;
  if (r.added) await log("referral", `Recorded ${r.added} waitlist signups from creator links`);
  return r;
}

/** Import a waitlist export (CSV with email, ref and signup date columns). */
export async function importSignupCsv(csv: string) {
  const { rows, missing } = parseSignupCsv(csv);
  if (missing.length) throw new Error(`The file needs ${missing.join(", ")} column${missing.length > 1 ? "s" : ""}. Rename the column header if it's called something else.`);
  if (!rows.length) throw new Error("The file has a header row but no signups.");
  const undated = rows.filter((row) => !row.at).length;
  if (undated) throw new Error(`${undated} row${undated > 1 ? "s have" : " has"} no readable signup date, so they can't be matched to a video's window. Fix those dates and import again.`);
  return recordSignups(rows);
}

/** Is the Sooz waitlist database connected (the roster_sync login in WAITLIST_DATABASE_URL)? */
export const waitlistSyncConfigured = () => Boolean(process.env.WAITLIST_DATABASE_URL);

async function withWaitlistDb<T>(fn: (pool: Pool) => Promise<T>) {
  const url = process.env.WAITLIST_DATABASE_URL;
  if (!url) throw new Error("Connect the waitlist database first (WAITLIST_DATABASE_URL).");
  // Verify the server against Supabase's CA; an sslmode in the URL would override this, so drop it.
  const connectionString = url.replace(/([?&])sslmode=[^&]*&?/, "$1").replace(/[?&]$/, "");
  const pool = new Pool({ connectionString, ssl: { ca: SUPABASE_ROOT_CA, rejectUnauthorized: true }, max: 1, connectionTimeoutMillis: 15_000 });
  try {
    return await fn(pool);
  } finally {
    await pool.end();
  }
}

/** Marks the influencer rows Roster manages; rows added by hand on the site are never touched. */
const ROSTER_NOTE = "'Paid through Roster'";

/**
 * Keep the site's influencers table in step with Roster: creators on trial or active are listed (and
 * active) under their handle, cut creators are switched off. The site pays nothing itself, so
 * earnings stay disabled there.
 */
async function registerHandles(pool: Pool, ids?: string[]) {
  const roster = await db
    .select({ id: creators.id, name: creators.name, email: creators.email, code: creators.promoCode, stage: creators.stage })
    .from(creators)
    .where(and(inArray(creators.stage, ["trial", "active", "cut"]), sql`${creators.promoCode} is not null`, ids ? inArray(creators.id, ids) : undefined));
  let listed = 0;
  for (const c of roster) {
    const active = c.stage !== "cut";
    if (!active) {
      await pool.query(`update public.influencers set active = false where handle = $1 and commission_note = ${ROSTER_NOTE}`, [creatorHandle(c.code!)]);
      continue;
    }
    await pool.query(
      `insert into public.influencers (handle, name, email, active, earnings_enabled, commission_note)
       values ($1, $2, $3, true, false, ${ROSTER_NOTE})
       on conflict (handle) do update set name = excluded.name, email = excluded.email, active = true
       where influencers.commission_note = ${ROSTER_NOTE}`,
      [creatorHandle(c.code!), c.name.slice(0, 120), c.email],
    );
    listed++;
  }
  return listed;
}

/** List one creator's handle on the site right away (after they move to trial or are cut). Never throws. */
export async function registerCreatorHandle(creatorId: string) {
  if (!waitlistSyncConfigured()) return;
  try {
    await withWaitlistDb((pool) => registerHandles(pool, [creatorId]));
  } catch (e) {
    console.error("[waitlist] couldn't register creator handle", e); // the daily sync retries
  }
}

/**
 * Sync with the Sooz waitlist (Supabase): register creator handles, then pull signups that came through
 * creator links. Reads only email, influencer_handle, created_at and signup_status. Safe to run any time:
 * each person counts once, and a signup flagged since the last run is removed.
 */
export async function syncWaitlist() {
  return withWaitlistDb(async (pool) => {
    const handles = await registerHandles(pool);
    const { rows } = await pool.query<{ email: string; influencer_handle: string; created_at: Date; signup_status: string }>(
      "select email, influencer_handle, created_at, signup_status from public.waitlist where influencer_handle is not null",
    );
    const r = await recordSignups(rows.map((w) => ({ email: w.email, ref: cleanRef(w.influencer_handle), at: w.created_at, flagged: w.signup_status !== "valid" })));
    return { scanned: rows.length, handles, ...r };
  });
}

/** One signup from the waitlist form or an automation (Zapier, Make). */
export async function recordSignup(p: { email: string; ref: string; signedUpAt?: string }) {
  const at = p.signedUpAt ? new Date(p.signedUpAt) : null;
  return recordSignups([{ email: p.email, ref: cleanRef(p.ref), at: at && !Number.isNaN(at.getTime()) ? at : null }]);
}

/** Signups per creator, most first. */
export async function signupTotals() {
  return db
    .select({ creatorId: attributionEvents.creatorId, name: creators.name, code: creators.promoCode, signups: sql<number>`count(*)::int`, last: sql<Date>`max(${attributionEvents.occurredAt})` })
    .from(attributionEvents)
    .innerJoin(creators, eq(creators.id, attributionEvents.creatorId))
    .where(eq(attributionEvents.kind, "signup"))
    .groupBy(attributionEvents.creatorId, creators.name, creators.promoCode)
    .orderBy(desc(sql`count(*)`));
}
