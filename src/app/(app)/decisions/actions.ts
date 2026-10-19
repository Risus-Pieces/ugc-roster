"use server";

import { revalidatePath } from "next/cache";
import type { ActionResult } from "@/components/client";
import { moveStage } from "@/lib/services/outreach";
import { promoteCreator } from "@/lib/services/decisions";

const fail = (e: unknown): ActionResult => ({ ok: false, message: e instanceof Error ? e.message : String(e) });

export async function cutCreatorAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  try {
    const id = String(fd.get("id") ?? "");
    if (!id) return { ok: false, message: "Missing creator." };
    await moveStage(id, "cut");
    revalidatePath("/", "layout");
    return { ok: true, message: `${String(fd.get("name") ?? "Creator")} moved to cut. No new briefs; work already posted still settles on their next statement.` };
  } catch (e) {
    return fail(e);
  }
}

export async function promoteCreatorAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  try {
    const id = String(fd.get("id") ?? "");
    if (!id) return { ok: false, message: "Missing creator." };
    const r = await promoteCreator(id);
    revalidatePath("/", "layout");
    return { ok: true, message: `Promoted from ${r.from} to ${r.to}.` };
  } catch (e) {
    return fail(e);
  }
}
