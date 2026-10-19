"use server";

import { revalidatePath } from "next/cache";
import type { ActionResult } from "@/components/client";
import { approveStatement, approveAllDrafts, payStatement, redraftStatements, reopenFailedStatement } from "@/lib/services/payouts";
import { usd2 } from "@/lib/format";

const fail = (e: unknown): ActionResult => ({ ok: false, message: e instanceof Error ? e.message : String(e) });
const ISO = /^\d{4}-\d{2}-\d{2}$/;

export async function draftStatementsAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  try {
    const start = String(fd.get("start") ?? "");
    const end = String(fd.get("end") ?? "");
    if (!ISO.test(start) || !ISO.test(end)) return { ok: false, message: "Pick a period with a start and end date (YYYY-MM-DD)." };
    if (end < start) return { ok: false, message: "The period ends before it starts. Pick a later end date." };
    const created = await redraftStatements(start, end);
    revalidatePath("/", "layout");
    if (!created.length) return { ok: true, message: "Nothing to draft: no approved campaign posts, closed view windows or referral bonuses in this period." };
    const total = created.reduce((a, s) => a + s.totalCents, 0);
    return { ok: true, message: `Drafted ${created.length} statements totalling ${usd2(total)}. Review them, then approve.` };
  } catch (e) {
    return fail(e);
  }
}

export async function approveAllDraftsAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  try {
    const month = String(fd.get("month") ?? "");
    if (!/^\d{4}-\d{2}$/.test(month)) return { ok: false, message: "Missing month." };
    const n = await approveAllDrafts(month);
    revalidatePath("/", "layout");
    return { ok: true, message: n ? `Approved ${n} statements. Nothing is paid until you press Pay on each one.` : "No drafts to approve." };
  } catch (e) {
    return fail(e);
  }
}

export async function approveStatementAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  try {
    await approveStatement(String(fd.get("id")));
    revalidatePath("/", "layout");
    return { ok: true, message: "Approved. The amount is locked; press Pay to send it." };
  } catch (e) {
    return fail(e);
  }
}

export async function payStatementAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  try {
    const res = await payStatement(String(fd.get("id")));
    revalidatePath("/", "layout");
    return res.status === "simulated"
      ? { ok: true, message: `Recorded as paid (simulated, ref ${res.ref}). No money moved: add provider credentials in Settings to send real payouts.` }
      : { ok: true, message: `Payment sent${res.ref ? ` · ref ${res.ref}` : ""}.` };
  } catch (e) {
    revalidatePath("/", "layout");
    return fail(e);
  }
}

export async function reopenStatementAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  try {
    await reopenFailedStatement(String(fd.get("id")));
    revalidatePath("/", "layout");
    return { ok: true, message: "Moved back to approved. Fix the payout details, then press Pay again." };
  } catch (e) {
    return fail(e);
  }
}
