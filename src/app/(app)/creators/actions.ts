"use server";

import { revalidatePath } from "next/cache";
import type { ActionResult } from "@/components/client";
import { STAGES, type Stage } from "@/db";
import { draftOpener, moveStage } from "@/lib/services/outreach";

const fail = (e: unknown): ActionResult => ({ ok: false, message: e instanceof Error ? e.message : String(e) });

export async function moveStageAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  try {
    const creatorId = String(fd.get("creatorId") ?? "");
    const stage = String(fd.get("stage") ?? "") as Stage;
    if (!creatorId) return { ok: false, message: "Missing creator" };
    if (!STAGES.includes(stage)) return { ok: false, message: "Pick a stage" };
    await moveStage(creatorId, stage);
    revalidatePath("/", "layout");
    return {
      ok: true,
      message: stage === "trial" ? "Moved to trial · contract drafted and tax form requested" : stage === "active" ? "Moved to active · any pending referral bonus now qualifies" : `Moved to ${stage}`,
    };
  } catch (e) {
    return fail(e);
  }
}

export async function draftOpenerAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  try {
    const creatorId = String(fd.get("creatorId") ?? "");
    if (!creatorId) return { ok: false, message: "Missing creator" };
    const r = await draftOpener(creatorId);
    revalidatePath("/", "layout");
    return {
      ok: true,
      message: `Opener drafted ${r.source === "ai" ? "with AI" : "from the template"}${r.error ? ` (AI failed: ${r.error})` : ""} — review and send it in Outreach → Compose`,
    };
  } catch (e) {
    return fail(e);
  }
}
