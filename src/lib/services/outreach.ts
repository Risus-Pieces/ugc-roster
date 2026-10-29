import "server-only";
import { and, desc, eq, gte, inArray, isNull } from "drizzle-orm";
import { db, creators, creatorAccounts, messages, calls, referrals, type Stage } from "@/db";
import { triageReply, aiEnabled } from "@/lib/ai";
import { sendEmail, emailLive } from "@/lib/integrations/email";
import { normalizeEmail } from "@/lib/engines/contact";
import { getBrand, getOps } from "@/lib/settings";
import { complianceFooter, doNotContact, followUpEmail, followUpStatus, openerEmail, withFooter } from "@/lib/engines/outreach";
import { offerLine, offerTerms, perksOf, shortOffer } from "@/lib/engines/offer";
import { rateCardFor, log } from "./common";
import { generateContract, requestTaxForm } from "./onboarding";
import { registerCreatorHandle } from "./signups";

/** Each creator's handle on their biggest account, for {handle} and the greeting. */
async function topHandles(creatorIds: string[]) {
  const rows = creatorIds.length
    ? await db
        .select({ creatorId: creatorAccounts.creatorId, handle: creatorAccounts.handle })
        .from(creatorAccounts)
        .where(inArray(creatorAccounts.creatorId, creatorIds))
        .orderBy(desc(creatorAccounts.followers))
    : [];
  const top = new Map<string, string>();
  for (const r of rows) if (!top.has(r.creatorId)) top.set(r.creatorId, r.handle);
  return top;
}

export async function draftOpener(creatorId: string, campaignId?: string | null) {
  const creator = await db.query.creators.findFirst({ where: eq(creators.id, creatorId) });
  if (!creator) throw new Error("Creator not found");
  if (!creator.email) throw new Error(`${creator.name} has no contact email`);
  const [brand, card, handles] = await Promise.all([getBrand(), rateCardFor(creator.rateCardId), topHandles([creatorId])]);
  const opener = openerEmail(brand, offerLine(card), perksOf(card), { name: creator.name, handle: handles.get(creatorId) });
  const [m] = await db
    .insert(messages)
    .values({ creatorId, campaignId: campaignId ?? null, direction: "out", subject: opener.subject, body: opener.body, status: "draft" })
    .returning();
  return { message: m };
}

/** Replies should land where the app can read them: the Resend receiving address if set, else the sender. */
const replyToAddress = (senderEmail: string) => process.env.EMAIL_REPLY_TO?.trim() || senderEmail;

/** Cold emails (openers + follow-ups) sent since midnight UTC. */
export async function coldEmailsSentToday() {
  const start = new Date();
  start.setUTCHours(0, 0, 0, 0);
  return db.$count(messages, and(eq(messages.direction, "out"), inArray(messages.status, ["sent", "simulated"]), gte(messages.sentAt, start), isNull(messages.classification)));
}

/**
 * Sends a cold email (opener or follow-up) with the compliance footer, after checking the creator
 * hasn't opted out and today's send limit isn't used up.
 */
export async function sendMessage(messageId: string, edits?: { subject?: string; body?: string }) {
  const m = await db.query.messages.findFirst({ where: eq(messages.id, messageId) });
  if (!m) throw new Error("Message not found");
  const creator = await db.query.creators.findFirst({ where: eq(creators.id, m.creatorId) });
  if (!creator?.email) throw new Error("Creator has no email");
  const [brand, ops, history] = await Promise.all([getBrand(), getOps(), db.select().from(messages).where(eq(messages.creatorId, creator.id))]);

  const blocked = doNotContact(creator.stage, history);
  if (blocked) throw new Error(`${creator.name} ${blocked}, so they won't be emailed again.`);
  if (emailLive() && !brand.mailingAddress.trim()) throw new Error("Add your mailing address in Settings → Outreach sender first. US law (CAN-SPAM) requires it in cold email.");
  const sentToday = await coldEmailsSentToday();
  if (sentToday >= ops.outreach.dailySendLimit) throw new Error(`Today's limit of ${ops.outreach.dailySendLimit} cold emails is used up. The rest can go tomorrow, or raise the limit in Settings → Outreach.`);

  const subject = edits?.subject ?? m.subject ?? "";
  const body = withFooter(edits?.body ?? m.body, complianceFooter({ senderName: brand.senderName, brandName: brand.name, mailingAddress: brand.mailingAddress }));
  const res = await sendEmail({ to: creator.email, subject, text: body, replyTo: replyToAddress(brand.senderEmail) });
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
  const t = await triageReply({ brand, creatorName: creator.name, reply: text, terms: offerTerms(card) });
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
  const brand = await getBrand();
  const res = await sendEmail({ to: creator.email, subject, text, replyTo: replyToAddress(brand.senderEmail) });
  // Replies to a creator who wrote in are marked "reply" so they don't count toward the cold-email limit.
  await db.insert(messages).values({ creatorId: creator.id, direction: "out", subject, body: text, status: res.status, classification: "other", providerMessageId: res.providerMessageId, sentAt: new Date() });
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
  // List (or switch off) their /go/ link on the site so signups through it are credited.
  if (stage === "trial" || stage === "cut") await registerCreatorHandle(creatorId);
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

// ─── Follow-ups ─────────────────────────────────────────────────────────────

/** Contacted creators who haven't replied and are due their next follow-up. */
export async function followUpsDue() {
  const ops = await getOps();
  if (!ops.outreach.followUpDays.length) return [];
  const contacted = await db.select().from(creators).where(eq(creators.stage, "contacted"));
  if (!contacted.length) return [];
  const history = await db.select().from(messages).where(inArray(messages.creatorId, contacted.map((c) => c.id)));
  const byCreator = new Map<string, (typeof history)[number][]>();
  for (const m of history) byCreator.set(m.creatorId, [...(byCreator.get(m.creatorId) ?? []), m]);
  const due = [];
  for (const c of contacted) {
    const h = byCreator.get(c.id) ?? [];
    if (doNotContact(c.stage, h)) continue;
    const s = followUpStatus(h, ops.outreach.followUpDays);
    if (s.due) due.push({ creator: c, ...s });
  }
  return due.sort((a, b) => b.daysSinceFirst - a.daysSinceFirst);
}

/** Draft the next follow-up for each creator that's due; drafts then appear in Compose for review. */
export async function draftFollowUps(creatorIds?: string[]) {
  const [all, brand] = await Promise.all([followUpsDue(), getBrand()]);
  const due = creatorIds ? all.filter((d) => creatorIds.includes(d.creator.id)) : all;
  const handles = await topHandles(due.map((d) => d.creator.id));
  let drafted = 0;
  for (const d of due) {
    const card = await rateCardFor(d.creator.rateCardId);
    const body = followUpEmail(brand, d.step, shortOffer(card), { name: d.creator.name, handle: handles.get(d.creator.id) });
    await db.insert(messages).values({ creatorId: d.creator.id, direction: "out", subject: d.subject, body, status: "draft" });
    drafted++;
  }
  return { drafted };
}
