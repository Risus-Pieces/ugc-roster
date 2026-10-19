"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { db, contracts, creatorAccounts, type ContractTerms } from "@/db";
import type { ActionResult } from "@/components/client";
import { generateContract, requestTaxForm, sendContract, setTaxFormStatus, startWarmup } from "@/lib/services/onboarding";
import { syncAccount } from "@/lib/services/tracking";

const fail = (e: unknown): ActionResult => ({ ok: false, message: e instanceof Error ? e.message : String(e) });

function intIn(fd: FormData, key: string, min: number, max: number, what: string) {
  const raw = fd.get(key);
  if (raw === null || raw === "") return undefined;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < min || n > max) throw new Error(`${what} must be a whole number from ${min} to ${max}`);
  return n;
}

export async function generateContractAction(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  try {
    const creatorId = String(fd.get("creatorId") ?? "");
    const overrides: Partial<ContractTerms> = {};
    const usage = fd.get("usageRights");
    if (usage) {
      if (usage !== "none" && usage !== "organic" && usage !== "paid_ads") throw new Error("Pick usage rights: none, organic or paid ads");
      overrides.usageRights = usage;
    }
    const usageMonths = intIn(fd, "usageMonths", 0, 36, "Usage months");
    const clawbackDays = intIn(fd, "clawbackDays", 0, 180, "Clawback days");
    const termMonths = intIn(fd, "termMonths", 1, 24, "Term months");
    if (usageMonths !== undefined) overrides.usageMonths = usageMonths;
    if (clawbackDays !== undefined) overrides.clawbackDays = clawbackDays;
    if (termMonths !== undefined) overrides.termMonths = termMonths;
    if (overrides.usageRights && overrides.usageRights !== "none" && overrides.usageMonths === 0) throw new Error("Set usage months above 0, or choose no usage rights");
    await generateContract(creatorId, overrides);
    revalidatePath("/onboarding");
    revalidatePath("/", "layout");
    return { ok: true, message: "Draft contract written. Read it, then mark it sent." };
  } catch (e) {
    return fail(e);
  }
}

export async function sendContractAction(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  try {
    const id = String(fd.get("contractId") ?? "");
    const c = await db.query.contracts.findFirst({ where: eq(contracts.id, id) });
    if (!c) return { ok: false, message: "Contract not found — refresh the page" };
    if (c.status !== "draft") return { ok: false, message: `This contract is already ${c.status}` };
    await sendContract(id);
    revalidatePath("/onboarding");
    return { ok: true, message: "Marked sent. Share the creator's portal link so they can sign." };
  } catch (e) {
    return fail(e);
  }
}

export async function requestTaxFormAction(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  try {
    const f = await requestTaxForm(String(fd.get("creatorId") ?? ""));
    if (!f) return { ok: false, message: "Creator not found" };
    revalidatePath("/onboarding");
    return { ok: true, message: `${f.formType} requested — send the portal link` };
  } catch (e) {
    return fail(e);
  }
}

export async function setTaxStatusAction(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  try {
    const status = fd.get("status") === "rejected" ? "rejected" : "verified";
    await setTaxFormStatus(String(fd.get("formId") ?? ""), status);
    revalidatePath("/onboarding");
    revalidatePath("/", "layout");
    return { ok: true, message: status === "verified" ? "Verified" : "Sent back — the creator will be asked to resubmit" };
  } catch (e) {
    return fail(e);
  }
}

export async function syncAccountAction(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  try {
    const id = String(fd.get("accountId") ?? "");
    const acct = await db.query.creatorAccounts.findFirst({ where: eq(creatorAccounts.id, id) });
    if (!acct) return { ok: false, message: "Account not found" };
    if (!acct.connected) return { ok: false, message: "Not connected — the creator needs to connect it from their portal first" };
    const r = await syncAccount(id);
    revalidatePath("/onboarding");
    return { ok: true, message: `Synced · ${r.newPosts} new posts · ${r.snapshots} snapshots` };
  } catch (e) {
    return fail(e);
  }
}

export async function startWarmupAction(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  try {
    const days = intIn(fd, "days", 1, 60, "Target days");
    await startWarmup(String(fd.get("creatorId") ?? ""), days);
    revalidatePath("/onboarding");
    revalidatePath("/", "layout");
    return { ok: true, message: `Warm-up started — day 1 of ${days ?? "the target"}` };
  } catch (e) {
    return fail(e);
  }
}
