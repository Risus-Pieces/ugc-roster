"use server";

import { revalidatePath } from "next/cache";
import type { ActionResult } from "@/components/client";
import { STAGES, type Stage } from "@/db";
import { moveStage } from "@/lib/services/outreach";

export async function moveStageAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  try {
    const creatorId = String(fd.get("creatorId") ?? "");
    const stage = String(fd.get("stage") ?? "") as Stage;
    if (!creatorId || !STAGES.includes(stage)) return { ok: false, message: "Missing creator or stage" };
    await moveStage(creatorId, stage);
    revalidatePath("/", "layout");
    return { ok: true, message: stage === "trial" ? "Contract drafted, tax form requested" : `Moved to ${stage}` };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : String(e) };
  }
}
