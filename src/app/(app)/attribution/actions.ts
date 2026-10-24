"use server";

import { revalidatePath } from "next/cache";
import type { ActionResult } from "@/components/client";
import { importSignupCsv, syncWaitlist, type SignupResult } from "@/lib/services/signups";

const MAX_BYTES = 5 * 1024 * 1024;

export async function importSignupsAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  try {
    const file = fd.get("file");
    let csv = String(fd.get("csv") ?? "");
    if (file instanceof File && file.size > 0) {
      if (file.size > MAX_BYTES) return { ok: false, message: "That file is over 5 MB. Split it into smaller exports." };
      csv = await file.text();
    }
    if (!csv.trim()) return { ok: false, message: "Choose your waitlist export or paste the rows first." };
    const r = await importSignupCsv(csv);
    revalidatePath("/attribution");
    return { ok: r.added > 0, message: summary(r) };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : String(e) };
  }
}

export async function syncWaitlistAction(): Promise<ActionResult> {
  try {
    const r = await syncWaitlist();
    revalidatePath("/attribution");
    return { ok: true, message: `Checked ${r.scanned} signups from creator links. ${summary(r)}` };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : String(e) };
  }
}

function summary(r: SignupResult) {
  const skipped = [
    r.duplicate && `${r.duplicate} already counted`,
    r.noRef && `${r.noRef} without a creator code (signed up directly)`,
    r.unknownRef && `${r.unknownRef} with a code that isn't a creator's (${r.unknownRefs.join(", ")})`,
    r.self && `${r.self} from the creator's own email`,
    r.invalid && `${r.invalid} without a valid email`,
    r.flagged && `${r.flagged} flagged on the waitlist${r.removed ? ` (${r.removed} taken back out)` : ""}`,
  ].filter(Boolean);
  return `Added ${r.added} signups from creator links.${skipped.length ? ` Skipped ${skipped.join(", ")}.` : ""}`;
}
