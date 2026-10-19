import "server-only";
import { and, eq, inArray, isNull, or } from "drizzle-orm";
import { db, posts, breakouts, briefs, creators } from "@/db";
import { writeVariations, writeBrief, tagHook } from "@/lib/ai";
import { topPercent, engagementRate } from "@/lib/engines/breakout";
import { planBriefs, type FormatStat } from "@/lib/engines/brief-planner";
import { median } from "@/lib/engines/stats";
import { getBrand, getOps } from "@/lib/settings";
import { log } from "./common";

/**
 * Hook bank: the top 5% of videos from your roster and from competitors, each transcribed
 * and tagged by hook type and format.
 */
export async function refreshHookBank(pct = 5) {
  const roster = await db.select().from(posts).where(eq(posts.isCampaignPost, true));
  const competitor = await db.select().from(posts).where(eq(posts.source, "competitor"));
  const top = [...topPercent(roster, pct), ...topPercent(competitor, Math.max(pct, 20))];
  let tagged = 0;
  for (const p of top) {
    if (!p.hookType || !p.format || !p.hookText) {
      const t = await tagHook({ transcript: p.transcript ?? "", caption: p.caption ?? "" });
      await db.update(posts).set({ hookText: p.hookText ?? t.hookText, hookType: p.hookType ?? t.hookType, format: p.format ?? t.format, inHookBank: true }).where(eq(posts.id, p.id));
      tagged++;
    } else if (!p.inHookBank) {
      await db.update(posts).set({ inHookBank: true }).where(eq(posts.id, p.id));
    }
  }
  return { added: top.length, tagged };
}

export async function addCompetitorPost(p: { competitorName: string; platform: "tiktok" | "instagram" | "youtube"; url: string; caption: string; transcript: string; views: number; likes?: number; comments?: number; shares?: number; postedAt?: Date }) {
  const t = await tagHook({ transcript: p.transcript, caption: p.caption });
  const [row] = await db
    .insert(posts)
    .values({
      platform: p.platform,
      externalId: `competitor_${crypto.randomUUID()}`,
      url: p.url,
      caption: p.caption,
      transcript: p.transcript,
      postedAt: p.postedAt ?? new Date(),
      source: "competitor",
      competitorName: p.competitorName,
      views: p.views,
      likes: p.likes ?? 0,
      comments: p.comments ?? 0,
      shares: p.shares ?? 0,
      inHookBank: true,
      hookText: t.hookText,
      hookType: t.hookType,
      format: t.format,
    })
    .returning();
  return row;
}

/** A video passed the breakout threshold: write 5–10 variations the same day. */
export async function createBreakout(postId: string, count = 6) {
  const p = await db.query.posts.findFirst({ where: eq(posts.id, postId) });
  if (!p) throw new Error("Post not found");
  const brand = await getBrand();
  let { hookText, format } = p;
  if (!hookText || !format) {
    const t = await tagHook({ transcript: p.transcript ?? "", caption: p.caption ?? "" });
    hookText ??= t.hookText;
    format ??= t.format;
    await db.update(posts).set({ hookText, format, hookType: p.hookType ?? t.hookType, inHookBank: true }).where(eq(posts.id, p.id));
  }
  const v = await writeVariations({ brand, hook: hookText, transcript: p.transcript ?? p.caption ?? "", format, count });
  const [b] = await db.insert(breakouts).values({ postId, views: p.views, engagementRate: engagementRate(p), variations: v.variations }).returning();
  await log("breakout", `Breakout: ${p.views.toLocaleString()} views — ${v.variations.length} variations written`, p.creatorId);
  return b;
}

/** Send a breakout's variations to every active creator as today's breakout brief (round-robin). */
export async function sendBreakout(breakoutId: string) {
  const b = await db.query.breakouts.findFirst({ where: eq(breakouts.id, breakoutId) });
  if (!b) throw new Error("Breakout not found");
  const p = await db.query.posts.findFirst({ where: eq(posts.id, b.postId) });
  const roster = await db.select().from(creators).where(inArray(creators.stage, ["active", "trial"]));
  const date = new Date().toISOString().slice(0, 10);
  let i = 0;
  for (const c of roster) {
    if (c.id === p?.creatorId) continue;
    const v = b.variations[i++ % b.variations.length];
    await db.insert(briefs).values({
      creatorId: c.id,
      date,
      kind: "breakout",
      format: p?.format ?? "Breakout variation",
      hook: v.hook,
      script: v.script,
      shotList: v.onScreenText ? [`On-screen text: ${v.onScreenText}`, "Hook to camera in first 2s", "Demo on phone", "Honest reaction"] : ["Hook to camera", "Demo", "Reaction"],
      sourcePostId: b.postId,
      breakoutId: b.id,
    });
  }
  await db.update(breakouts).set({ status: "sent", sentToCount: i }).where(eq(breakouts.id, breakoutId));
  return { sentTo: i };
}

/** Daily briefs: ~80% proven formats from the hook bank, ~20% new-format tests, each with a script and shot list. */
export async function generateDailyBriefs(date = new Date().toISOString().slice(0, 10)) {
  const [brand, ops] = await Promise.all([getBrand(), getOps()]);
  const roster = await db.select().from(creators).where(inArray(creators.stage, ["active", "trial"]));
  const already = new Set((await db.select({ creatorId: briefs.creatorId }).from(briefs).where(and(eq(briefs.date, date), or(eq(briefs.kind, "proven"), eq(briefs.kind, "test"))))).map((b) => b.creatorId));
  const todo = roster.filter((c) => !already.has(c.id));

  const bank = await db.select().from(posts).where(eq(posts.inHookBank, true));
  const byFormat = new Map<string, typeof bank>();
  for (const p of bank) if (p.format) byFormat.set(p.format, [...(byFormat.get(p.format) ?? []), p]);
  const proven: FormatStat[] = [...byFormat.entries()].map(([format, ps]) => {
    const best = [...ps].sort((a, b) => b.views - a.views)[0];
    return { format, posts: ps.length, medianViews: median(ps.map((p) => p.views)), examplePostId: best.id };
  });

  const plan = planBriefs(todo.map((c) => c.id), proven, ops.testFormats, date, ops.testShare);
  const byId = new Map(todo.map((c) => [c.id, c]));
  const bankById = new Map(bank.map((p) => [p.id, p]));
  let created = 0;
  for (const a of plan) {
    const example = a.sourcePostId ? bankById.get(a.sourcePostId) : undefined;
    const brief = await writeBrief({ brand, creatorName: byId.get(a.creatorId)!.name, format: a.format, exampleHook: example?.hookText, exampleTranscript: example?.transcript, kind: a.kind });
    await db.insert(briefs).values({ creatorId: a.creatorId, date, kind: a.kind, format: a.format, hook: brief.hook, script: brief.script, shotList: brief.shotList, sourcePostId: a.sourcePostId });
    created++;
  }
  await log("briefs", `Generated ${created} briefs for ${date}`);
  return { created, proven: plan.filter((p) => p.kind === "proven").length, test: plan.filter((p) => p.kind === "test").length };
}

export async function untaggedHookBankCount() {
  const rows = await db.select({ id: posts.id }).from(posts).where(and(eq(posts.inHookBank, true), isNull(posts.hookType)));
  return rows.length;
}

/** Hide a breakout alert without sending it. */
export async function dismissBreakout(breakoutId: string) {
  const b = await db.query.breakouts.findFirst({ where: eq(breakouts.id, breakoutId) });
  if (!b) throw new Error("Breakout not found");
  if (b.status === "sent") throw new Error("Already sent to the roster");
  await db.update(breakouts).set({ status: "dismissed" }).where(eq(breakouts.id, breakoutId));
}
