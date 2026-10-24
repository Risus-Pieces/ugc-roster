import "server-only";
import { createHash } from "node:crypto";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { db, attributionEvents, creators } from "@/db";
import { normalizeEmail } from "@/lib/engines/contact";
import { cleanRef, parseSignupCsv, type SignupRow } from "@/lib/engines/signups";
import { log } from "./common";

export type SignupResult = { added: number; duplicate: number; unknownRef: number; noRef: number; invalid: number; self: number; unknownRefs: string[] };

/** Signups are stored as a hash of the normalized email: enough to count each person once, without keeping the address. */
const hashEmail = (email: string) => createHash("sha256").update(`signup:${normalizeEmail(email)}`).digest("hex");

/**
 * Record waitlist signups that came through a creator's link. A signup counts once per person,
 * only with a ref that matches a creator's code, and never for the creator's own email.
 * Pay is worked out later: signups inside a video's view window earn the signup bonus.
 */
export async function recordSignups(rows: Omit<SignupRow, "line">[], now = new Date()): Promise<SignupResult> {
  const r: SignupResult = { added: 0, duplicate: 0, unknownRef: 0, noRef: 0, invalid: 0, self: 0, unknownRefs: [] };
  const valid = rows.filter((row) => {
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
