"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import type { ActionResult } from "@/components/client";
import { db, messages } from "@/db";
import { bookCall, discardDraft, draftOpener, recordReply, sendDraftReply, sendMessage } from "@/lib/services/outreach";

const fail = (e: unknown): ActionResult => ({ ok: false, message: e instanceof Error ? e.message : String(e) });
const str = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim();
const sentWord = (status: string) => (status === "simulated" ? "simulated (email not configured)" : status);

export async function sendReplyAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  try {
    const inboundId = str(fd, "inboundId");
    const body = str(fd, "body");
    if (!inboundId) return { ok: false, message: "Missing message" };
    if (!body) return { ok: false, message: "Write a reply first" };
    const res = await sendDraftReply(inboundId, body);
    revalidatePath("/", "layout");
    if (res.status === "failed") return { ok: false, message: `Send failed: ${res.error ?? "unknown error"}` };
    return { ok: true, message: `Reply ${sentWord(res.status)}` };
  } catch (e) {
    return fail(e);
  }
}

export async function bookCallAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  try {
    const creatorId = str(fd, "creatorId");
    const at = str(fd, "at");
    const offset = Number(str(fd, "tz") || "NaN");
    if (!creatorId) return { ok: false, message: "Missing creator" };
    if (!at) return { ok: false, message: "Pick a date and time" };
    // datetime-local has no timezone; use the browser's offset when we have it.
    const when = Number.isFinite(offset) ? new Date(new Date(`${at}:00Z`).getTime() + offset * 60_000) : new Date(at);
    if (Number.isNaN(when.getTime())) return { ok: false, message: "That date doesn't look right" };
    await bookCall(creatorId, when, str(fd, "link") || undefined);
    revalidatePath("/outreach");
    revalidatePath("/pipeline");
    const fmt: Intl.DateTimeFormatOptions = { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" };
    // Echo the time back as the user typed it (their wall clock), not the server's.
    const shown = Number.isFinite(offset) ? new Date(when.getTime() - offset * 60_000).toLocaleString("en-US", { ...fmt, timeZone: "UTC" }) : when.toLocaleString("en-US", fmt);
    return { ok: true, message: `Call booked for ${shown}` };
  } catch (e) {
    return fail(e);
  }
}

export async function logReplyAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  try {
    const creatorId = str(fd, "creatorId");
    const text = str(fd, "text");
    if (!creatorId) return { ok: false, message: "Pick who replied" };
    if (!text) return { ok: false, message: "Paste their reply" };
    const r = await recordReply(creatorId, text, str(fd, "subject") || undefined);
    revalidatePath("/", "layout");
    return { ok: true, message: `Logged · classified as ${(r.message.classification ?? "other").replace("_", " ")} · draft ${r.source === "ai" ? "written by AI" : "from template"} is ready above` };
  } catch (e) {
    return fail(e);
  }
}

const MAX_BATCH = 25;

export async function writeOpenersAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  try {
    const ids = [...new Set(fd.getAll("creatorId").map(String).filter(Boolean))];
    const campaignId = str(fd, "campaignId") || null;
    if (!ids.length) return { ok: false, message: "Tick at least one creator" };
    if (ids.length > MAX_BATCH) return { ok: false, message: `Pick up to ${MAX_BATCH} at a time so you can read each one` };
    let ai = 0;
    let template = 0;
    const errors: string[] = [];
    for (const id of ids) {
      try {
        const r = await draftOpener(id, campaignId);
        if (r.source === "ai") ai++;
        else template++;
      } catch (e) {
        errors.push(e instanceof Error ? e.message : String(e));
      }
    }
    revalidatePath("/outreach");
    const done = ai + template;
    const how = ai && template ? `${ai} by AI, ${template} from template` : ai ? "by AI" : "from template";
    return {
      ok: done > 0,
      message: `${done} opener${done === 1 ? "" : "s"} written ${how}${errors.length ? ` · ${errors.length} failed: ${errors[0]}` : ""}. Review them below before sending.`,
    };
  } catch (e) {
    return fail(e);
  }
}

/**
 * One form holds every draft so edits are kept whichever button is pressed.
 * The pressed button's value says what to do: "send:<id>", "discard:<id>" or "send-all".
 */
export async function draftsAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  try {
    const intent = str(fd, "intent");
    const [verb, id] = intent.split(":");
    const edits = (mid: string) => ({ subject: str(fd, `subject:${mid}`) || undefined, body: str(fd, `body:${mid}`) || undefined });

    if (verb === "discard" && id) {
      await discardDraft(id);
      revalidatePath("/outreach");
      return { ok: true, message: "Draft discarded" };
    }
    if (verb === "send" && id) {
      const res = await sendMessage(id, edits(id));
      revalidatePath("/", "layout");
      return { ok: true, message: `Sent · ${sentWord(res.status)}` };
    }
    if (verb === "send-all") {
      const drafts = await db
        .select({ id: messages.id })
        .from(messages)
        .where(and(eq(messages.direction, "out"), eq(messages.status, "draft")));
      let sent = 0;
      const errors: string[] = [];
      let lastStatus = "sent";
      for (const d of drafts) {
        try {
          const res = await sendMessage(d.id, edits(d.id));
          lastStatus = res.status;
          sent++;
        } catch (e) {
          errors.push(e instanceof Error ? e.message : String(e));
        }
      }
      revalidatePath("/", "layout");
      return { ok: sent > 0, message: `${sent} sent${lastStatus === "simulated" ? " (simulated — email not configured)" : ""}${errors.length ? ` · ${errors.length} failed: ${errors[0]}` : ""}` };
    }
    return { ok: false, message: "Nothing to do" };
  } catch (e) {
    return fail(e);
  }
}
