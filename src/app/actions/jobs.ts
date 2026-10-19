"use server";

import { revalidatePath } from "next/cache";
import type { ActionResult } from "@/components/client";
import { syncAll } from "@/lib/services/tracking";
import { generateDailyBriefs, refreshHookBank } from "@/lib/services/creative";

const fail = (e: unknown): ActionResult => ({ ok: false, message: e instanceof Error ? e.message : String(e) });

export async function syncAllAction(): Promise<ActionResult> {
  try {
    const r = await syncAll();
    revalidatePath("/", "layout");
    return { ok: true, message: `Synced ${r.accounts} accounts · ${r.newPosts} new posts · ${r.snapshots} snapshots${r.errors.length ? ` · ${r.errors.length} errors` : ""}` };
  } catch (e) {
    return fail(e);
  }
}

export async function generateBriefsAction(): Promise<ActionResult> {
  try {
    const r = await generateDailyBriefs();
    revalidatePath("/", "layout");
    return { ok: true, message: r.created ? `${r.created} briefs written (${r.proven} proven, ${r.test} test)` : "Everyone already has today's brief" };
  } catch (e) {
    return fail(e);
  }
}

export async function refreshHookBankAction(): Promise<ActionResult> {
  try {
    const r = await refreshHookBank();
    revalidatePath("/creative");
    return { ok: true, message: `${r.added} videos in the top 5% · ${r.tagged} newly tagged` };
  } catch (e) {
    return fail(e);
  }
}
