"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { db, creators } from "@/db";
import type { ActionResult } from "@/components/client";
import { decideReview, submitForReview } from "@/lib/services/review";
import { readDraft } from "./draft-fields";

const fail = (e: unknown): ActionResult => ({ ok: false, message: e instanceof Error ? e.message : String(e) });

const DECISIONS = { approved: "Approved — the creator can post it", changes_requested: "Changes requested — the creator will see your notes", rejected: "Rejected" } as const;

export async function decideReviewAction(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  try {
    const reviewId = String(fd.get("reviewId") ?? "");
    const decision = String(fd.get("decision") ?? "") as keyof typeof DECISIONS;
    if (!(decision in DECISIONS)) return { ok: false, message: "Pick Approve, Request changes or Reject" };
    const notes = String(fd.get("notes") ?? "").trim();
    if (decision === "changes_requested" && !notes) return { ok: false, message: "Write what the creator should change before requesting changes" };
    await decideReview(reviewId, decision, notes || undefined);
    revalidatePath("/review");
    revalidatePath("/", "layout");
    return { ok: true, message: DECISIONS[decision] };
  } catch (e) {
    return fail(e);
  }
}

export async function submitOnBehalfAction(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  try {
    const creatorId = String(fd.get("creatorId") ?? "");
    const creator = creatorId ? await db.query.creators.findFirst({ where: eq(creators.id, creatorId) }) : null;
    if (!creator) return { ok: false, message: "Pick the creator this draft is from" };
    const r = await submitForReview({ creatorId, ...readDraft(fd) });
    revalidatePath("/review");
    revalidatePath("/", "layout");
    const flagged = (r.checks ?? []).filter((c) => c.status !== "pass").length;
    return { ok: true, message: `Added to the queue for ${creator.name} — ${r.overall === "pass" ? "all checks passed" : `${flagged} check${flagged === 1 ? "" : "s"} flagged`}` };
  } catch (e) {
    return fail(e);
  }
}
