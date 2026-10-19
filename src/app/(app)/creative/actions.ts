"use server";

import { revalidatePath } from "next/cache";
import type { ActionResult } from "@/components/client";
import { addCompetitorPost, createBreakout, dismissBreakout, sendBreakout } from "@/lib/services/creative";

const fail = (e: unknown): ActionResult => ({ ok: false, message: e instanceof Error ? e.message : String(e) });

function count(fd: FormData, key: string, what: string, required = false) {
  const raw = String(fd.get(key) ?? "").replace(/[,\s]/g, "");
  if (!raw) {
    if (required) throw new Error(`Add the ${what}`);
    return 0;
  }
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) throw new Error(`${what[0].toUpperCase()}${what.slice(1)} must be a number`);
  return Math.round(n);
}

export async function addCompetitorAction(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  try {
    const competitorName = String(fd.get("competitorName") ?? "").trim();
    const platform = String(fd.get("platform") ?? "");
    const url = String(fd.get("url") ?? "").trim();
    const caption = String(fd.get("caption") ?? "").trim();
    const transcript = String(fd.get("transcript") ?? "").trim();
    if (!competitorName) return { ok: false, message: "Add the competitor's name or handle" };
    if (platform !== "tiktok" && platform !== "instagram" && platform !== "youtube") return { ok: false, message: "Pick a platform" };
    if (!/^https?:\/\//i.test(url)) return { ok: false, message: "Paste the full video link, starting with https://" };
    if (!transcript && !caption) return { ok: false, message: "Add the transcript or at least the caption so the hook can be tagged" };
    const p = await addCompetitorPost({
      competitorName,
      platform,
      url,
      caption,
      transcript,
      views: count(fd, "views", "views", true),
      likes: count(fd, "likes", "likes"),
      comments: count(fd, "comments", "comments"),
      shares: count(fd, "shares", "shares"),
    });
    revalidatePath("/creative");
    return { ok: true, message: `Added to the hook bank — tagged "${p.hookType}" · ${p.format}` };
  } catch (e) {
    return fail(e);
  }
}

export async function writeVariationsAction(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  try {
    const postId = String(fd.get("postId") ?? "");
    const n = Math.min(10, Math.max(5, Number(fd.get("count") ?? 6) || 6));
    const b = await createBreakout(postId, n);
    revalidatePath("/creative", "layout");
    revalidatePath("/", "layout");
    return { ok: true, message: `${b.variations.length} variations written — review and send them from Breakouts` };
  } catch (e) {
    return fail(e);
  }
}

export async function sendBreakoutAction(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  try {
    const r = await sendBreakout(String(fd.get("breakoutId") ?? ""));
    revalidatePath("/creative", "layout");
    revalidatePath("/", "layout");
    return { ok: true, message: r.sentTo ? `Sent to ${r.sentTo} creators as today's breakout brief` : "No other creators on the roster to send to" };
  } catch (e) {
    return fail(e);
  }
}

export async function dismissBreakoutAction(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  try {
    await dismissBreakout(String(fd.get("breakoutId") ?? ""));
    revalidatePath("/creative", "layout");
    revalidatePath("/", "layout");
    return { ok: true, message: "Dismissed" };
  } catch (e) {
    return fail(e);
  }
}
