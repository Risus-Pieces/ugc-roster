import "server-only";
import { and, eq, ne, or, isNotNull } from "drizzle-orm";
import { db, reviews, creators, posts, briefs } from "@/db";
import { runComplianceChecks, overallStatus } from "@/lib/engines/compliance";
import { aiComplianceReview } from "@/lib/ai";
import { getBrand } from "@/lib/settings";
import { log, DAY } from "./common";

export type Submission = {
  creatorId: string;
  briefId?: string | null;
  platform: "tiktok" | "instagram" | "youtube";
  draftUrl?: string | null;
  caption: string;
  transcript?: string | null;
  paidPartnershipToggle: boolean;
  containsAiFootage: boolean;
  aiLabelToggle: boolean;
};

/** Every draft goes through deterministic checks + an AI pass, then waits in the review queue. */
export async function submitForReview(s: Submission) {
  const creator = await db.query.creators.findFirst({ where: eq(creators.id, s.creatorId) });
  if (!creator) throw new Error("Creator not found");
  const brand = await getBrand();

  // Corpus for originality: hook bank + other creators' posts
  const corpus = (
    await db
      .select({ id: posts.id, caption: posts.caption, transcript: posts.transcript, creatorId: posts.creatorId })
      .from(posts)
      .where(and(or(eq(posts.inHookBank, true), eq(posts.isCampaignPost, true)), isNotNull(posts.transcript)))
  )
    .filter((p) => p.creatorId !== s.creatorId)
    .map((p) => ({ id: p.id, text: `${p.caption ?? ""} ${p.transcript ?? ""}` }));

  const checks = runComplianceChecks({ ...s, productAccessAt: creator.productAccessAt, corpus, bannedClaims: brand.bannedClaims });
  const daysWithProduct = creator.productAccessAt ? Math.floor((Date.now() - creator.productAccessAt.getTime()) / DAY) : null;
  const ai = await aiComplianceReview({ brand, caption: s.caption, transcript: s.transcript ?? "", daysWithProduct });
  if (ai) checks.push(ai);

  const [r] = await db
    .insert(reviews)
    .values({ ...s, checks, overall: overallStatus(checks) })
    .returning();
  if (s.briefId) await db.update(briefs).set({ status: "submitted" }).where(eq(briefs.id, s.briefId));
  await log("review", `${creator.name} submitted a draft (${r.overall})`, creator.id);
  return r;
}

export async function decideReview(reviewId: string, status: "approved" | "changes_requested" | "rejected", notes?: string) {
  const r = await db.query.reviews.findFirst({ where: eq(reviews.id, reviewId) });
  if (!r) throw new Error("Review not found");
  await db.update(reviews).set({ status, reviewerNotes: notes ?? null, decidedAt: new Date() }).where(eq(reviews.id, reviewId));
  if (status === "approved" && r.briefId) await db.update(briefs).set({ status: "done" }).where(eq(briefs.id, r.briefId));
  await log("review", `Draft ${status.replace("_", " ")}`, r.creatorId);
}

/**
 * Link a live post to its approved review (by URL or caption match) so payouts only cover
 * approved content.
 */
export async function linkPostToReview(postId: string) {
  const p = await db.query.posts.findFirst({ where: eq(posts.id, postId) });
  if (!p?.creatorId || p.reviewId) return;
  const approved = await db.select().from(reviews).where(and(eq(reviews.creatorId, p.creatorId), eq(reviews.status, "approved")));
  const used = new Set((await db.select({ reviewId: posts.reviewId }).from(posts).where(and(eq(posts.creatorId, p.creatorId), ne(posts.id, p.id)))).map((x) => x.reviewId));
  const norm = (s: string | null) => (s ?? "").toLowerCase().replace(/\s+/g, " ").trim();
  const match = approved.find((r) => !used.has(r.id) && ((r.draftUrl && r.draftUrl === p.url) || norm(r.caption) === norm(p.caption)));
  if (match) await db.update(posts).set({ reviewId: match.id }).where(eq(posts.id, p.id));
}
