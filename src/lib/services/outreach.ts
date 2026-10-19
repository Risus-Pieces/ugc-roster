import "server-only";
import { and, desc, eq, inArray } from "drizzle-orm";
import { db, creators, creatorAccounts, messages, posts, calls, referrals, type Stage } from "@/db";
import { writeOpener, triageReply, aiEnabled } from "@/lib/ai";
import { sendEmail, emailLive } from "@/lib/integrations/email";
import { normalizeEmail } from "@/lib/engines/contact";
import { getBrand } from "@/lib/settings";
import { rateCardFor, log } from "./common";
import { generateContract, requestTaxForm } from "./onboarding";

export async function draftOpener(creatorId: string, campaignId?: string | null) {
  const creator = await db.query.creators.findFirst({ where: eq(creators.id, creatorId) });
  if (!creator) throw new Error("Creator not found");
  if (!creator.email) throw new Error(`${creator.name} has no contact email`);
  const [brand, card, account] = await Promise.all([
    getBrand(),
    rateCardFor(creator.rateCardId),
    db.query.creatorAccounts.findFirst({ where: eq(creatorAccounts.creatorId, creatorId), orderBy: desc(creatorAccounts.followers) }),
  ]);
  const recent = await db.select({ caption: posts.caption }).from(posts).where(eq(posts.creatorId, creatorId)).orderBy(desc(posts.postedAt)).limit(5);
  const opener = await writeOpener({
    brand,
    creatorName: creator.name,
    handle: account?.handle ?? "",
    platform: account?.platform ?? "TikTok",
    recentCaptions: recent.map((r) => (r.caption ?? "").replace(/#\w+/g, "").trim()).filter(Boolean),
    baseCents: card.baseCents,
    cpmCents: card.cpmCents,
  });
  const [m] = await db
    .insert(messages)
    .values({ creatorId, campaignId: campaignId ?? null, direction: "out", subject: opener.subject, body: opener.body, status: "draft" })
    .returning();
  return { message: m, source: opener._source, error: opener._error };
}

export async function sendMessage(messageId: string, edits?: { subject?: string; body?: string }) {
  const m = await db.query.messages.findFirst({ where: eq(messages.id, messageId) });
  if (!m) throw new Error("Message not found");
  const creator = await db.query.creators.findFirst({ where: eq(creators.id, m.creatorId) });
  if (!creator?.email) throw new Error("Creator has no email");
  const subject = edits?.subject ?? m.subject ?? "";
  const body = edits?.body ?? m.body;
  const brand = await getBrand();
  const res = await sendEmail({ to: creator.email, subject, text: body, replyTo: brand.senderEmail });
  await db
    .update(messages)
    .set({ subject, body, status: res.status, providerMessageId: res.providerMessageId, sentAt: res.status === "failed" ? null : new Date() })
    .where(eq(messages.id, messageId));
  if (res.status !== "failed" && creator.stage === "prospect") await moveStage(creator.id, "contacted");
  if (res.status === "failed") throw new Error(`Send failed: ${res.error}`);
  return res;
}

/** Inbound reply (from the email webhook or pasted in): classify, draft a response, advance the pipeline. */
export async function ingestReply(p: { from: string; subject?: string; text: string }) {
  const norm = normalizeEmail(p.from.match(/<([^>]+)>/)?.[1] ?? p.from);
  const creator = norm ? await db.query.creators.findFirst({ where: eq(creators.emailNormalized, norm) }) : null;
  if (!creator) return { matched: false as const };
  return recordReply(creator.id, p.text, p.subject);
}

export async function recordReply(creatorId: string, text: string, subject?: string) {
  const creator = await db.query.creators.findFirst({ where: eq(creators.id, creatorId) });
  if (!creator) throw new Error("Creator not found");
  const [brand, card] = await Promise.all([getBrand(), rateCardFor(creator.rateCardId)]);
  const t = await triageReply({ brand, creatorName: creator.name, reply: text, baseCents: card.baseCents, cpmCents: card.cpmCents });
  const [m] = await db
    .insert(messages)
    .values({ creatorId, direction: "in", subject: subject ?? null, body: text, status: "received", classification: t.label, draftReply: t.draft })
    .returning();
  if (["prospect", "contacted"].includes(creator.stage)) await moveStage(creatorId, "replied");
  await log("reply", `${creator.name} replied (${t.label.replace("_", " ")})`, creatorId);
  return { matched: true as const, message: m, source: t._source };
}

export async function sendDraftReply(inboundId: string, body?: string) {
  const inbound = await db.query.messages.findFirst({ where: eq(messages.id, inboundId) });
  if (!inbound) throw new Error("Message not found");
  const creator = await db.query.creators.findFirst({ where: eq(creators.id, inbound.creatorId) });
  if (!creator?.email) throw new Error("Creator has no email");
  const text = body ?? inbound.draftReply ?? "";
  const subject = inbound.subject ? (inbound.subject.startsWith("Re:") ? inbound.subject : `Re: ${inbound.subject}`) : "Re: Paid video collab";
  const res = await sendEmail({ to: creator.email, subject, text });
  await db.insert(messages).values({ creatorId: creator.id, direction: "out", subject, body: text, status: res.status, providerMessageId: res.providerMessageId, sentAt: new Date() });
  await db.update(messages).set({ status: "handled" }).where(eq(messages.id, inboundId));
  if (inbound.classification === "not_interested") await moveStage(creator.id, "cut");
  return res;
}

export async function bookCall(creatorId: string, at: Date, link?: string) {
  const [c] = await db.insert(calls).values({ creatorId, scheduledAt: at, link }).returning();
  await log("call", `Call booked for ${at.toISOString().slice(0, 16).replace("T", " ")}`, creatorId);
  return c;
}

/**
 * Pipeline: contacted → replied → trial → active → cut.
 * Entering trial starts product access + warm-up and generates the contract and tax-form request.
 * Entering active qualifies any pending referral bonus.
 */
export async function moveStage(creatorId: string, stage: Stage) {
  const creator = await db.query.creators.findFirst({ where: eq(creators.id, creatorId) });
  if (!creator || creator.stage === stage) return;
  const now = new Date();
  const patch: Partial<typeof creators.$inferInsert> = { stage, stageChangedAt: now };
  if (stage === "trial") {
    patch.productAccessAt = creator.productAccessAt ?? now;
    patch.warmupStartedAt = creator.warmupStartedAt ?? now;
    if (!creator.promoCode) patch.promoCode = creator.name.split(" ")[0].toUpperCase().replace(/[^A-Z]/g, "").slice(0, 8) + creator.referralCode.slice(0, 3);
  }
  await db.update(creators).set(patch).where(eq(creators.id, creatorId));
  if (stage === "trial") {
    await generateContract(creatorId);
    await requestTaxForm(creatorId);
  }
  if (stage === "active") {
    await db.update(referrals).set({ status: "qualified", qualifiedAt: now }).where(and(eq(referrals.referredId, creatorId), eq(referrals.status, "pending")));
  }
  if (stage === "cut") {
    await db.update(referrals).set({ status: "void" }).where(and(eq(referrals.referredId, creatorId), eq(referrals.status, "pending")));
  }
  await log("stage", `${creator.name}: ${creator.stage} → ${stage}`, creatorId);
}

/** A creator signs up through a friend's referral link (/join/[code]). */
export async function joinViaReferral(p: { code: string; name: string; email: string; handle: string; platform: "tiktok" | "instagram" | "youtube"; country?: string }) {
  const referrer = await db.query.creators.findFirst({ where: eq(creators.referralCode, p.code.toUpperCase()) });
  if (!referrer) throw new Error("Invalid referral link");
  const emailNorm = normalizeEmail(p.email);
  const existing = emailNorm ? await db.query.creators.findFirst({ where: eq(creators.emailNormalized, emailNorm) }) : null;
  if (existing) return { creator: existing, duplicate: true };
  const card = await rateCardFor(referrer.rateCardId);
  const [c] = await db
    .insert(creators)
    .values({ name: p.name, email: p.email, emailNormalized: emailNorm, country: p.country, referredById: referrer.id, stage: "replied", niche: referrer.niche })
    .returning();
  await db.insert(creatorAccounts).values({ creatorId: c.id, platform: p.platform, handle: p.handle.replace(/^@/, "").toLowerCase() }).onConflictDoNothing();
  await db.insert(referrals).values({ referrerId: referrer.id, referredId: c.id, bonusCents: card.referralBonusCents });
  await log("referral", `${p.name} joined via ${referrer.name}'s referral link`, c.id);
  return { creator: c, duplicate: false };
}

export async function creatorsByIds(ids: string[]) {
  if (!ids.length) return [];
  return db.select().from(creators).where(inArray(creators.id, ids));
}

/** Throw away an unsent opener draft. Only drafts can be discarded; sent history is kept. */
export async function discardDraft(messageId: string) {
  const m = await db.query.messages.findFirst({ where: eq(messages.id, messageId) });
  if (!m) throw new Error("Draft not found");
  if (m.status !== "draft") throw new Error("Only unsent drafts can be discarded");
  await db.delete(messages).where(eq(messages.id, messageId));
}

/** Whether email goes out for real (Resend) and whether drafts are written by Claude or templates. */
export function outreachMode() {
  return { emailLive: emailLive(), aiLive: aiEnabled() };
}
