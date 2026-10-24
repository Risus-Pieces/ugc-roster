import "server-only";
import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { and, desc, eq, inArray } from "drizzle-orm";
import { db, creators, contracts, taxForms, creatorAccounts, type ContractTerms } from "@/db";
import { renderContract, sha256, taxFormFor } from "@/lib/engines/onboarding";
import { encrypt } from "@/lib/integrations/crypto";
import { connectedProviders } from "@/lib/integrations/platforms";
import { getBrand } from "@/lib/settings";
import { rateCardFor, log } from "./common";

export async function generateContract(creatorId: string, overrides: Partial<ContractTerms> = {}) {
  const creator = await db.query.creators.findFirst({ where: eq(creators.id, creatorId) });
  if (!creator) throw new Error("Creator not found");
  const [brand, card] = await Promise.all([getBrand(), rateCardFor(creator.rateCardId)]);
  const terms: ContractTerms = {
    baseCents: card.baseCents,
    cpmCents: card.cpmCents,
    videosPerMonth: card.videosPerMonth,
    viewWindowDays: card.viewWindowDays,
    perVideoCapCents: card.perVideoCapCents,
    monthlyCapCents: card.monthlyCapCents,
    quotaScope: card.quotaScope,
    milestones: card.milestones,
    milestoneMode: card.milestoneMode,
    signupBonusCents: card.signupBonusCents,
    bonusCapCents: card.bonusCapCents,
    perks: card.perks,
    usageRights: "paid_ads",
    usageMonths: 6,
    disclosure: brand.disclosure,
    clawbackDays: 30,
    termMonths: 3,
    ...overrides,
  };
  const body = renderContract({ brand: brand.name, creatorName: creator.name, terms, date: new Date() });
  // Replace any unsigned draft
  await db.update(contracts).set({ status: "void" }).where(and(eq(contracts.creatorId, creatorId), inArray(contracts.status, ["draft", "sent"])));
  const [c] = await db.insert(contracts).values({ creatorId, rateCardId: card.id, terms, body, bodySha256: await sha256(body), status: "draft" }).returning();
  return c;
}

export async function sendContract(contractId: string) {
  await db.update(contracts).set({ status: "sent", sentAt: new Date() }).where(eq(contracts.id, contractId));
}

/** E-signature: typed name + explicit consent, with timestamp, IP, user agent and a hash of the exact text signed. */
export async function signContract(p: { portalToken: string; contractId: string; name: string; ip: string; userAgent: string; consent: boolean }) {
  if (!p.consent) throw new Error("You must agree to sign electronically");
  const creator = await db.query.creators.findFirst({ where: eq(creators.portalToken, p.portalToken) });
  if (!creator) throw new Error("Invalid link");
  const contract = await db.query.contracts.findFirst({ where: and(eq(contracts.id, p.contractId), eq(contracts.creatorId, creator.id)) });
  if (!contract || !["sent", "draft"].includes(contract.status)) throw new Error("This contract can't be signed");
  if ((await sha256(contract.body)) !== contract.bodySha256) throw new Error("Contract text changed — ask for a new link");
  if (p.name.trim().length < 3) throw new Error("Type your full legal name");
  await db
    .update(contracts)
    .set({ status: "signed", signedAt: new Date(), signatureName: p.name.trim(), signatureIp: p.ip, signatureUserAgent: p.userAgent.slice(0, 300) })
    .where(eq(contracts.id, contract.id));
  await db.update(creators).set({ rateCardId: contract.rateCardId ?? creator.rateCardId }).where(eq(creators.id, creator.id));
  await log("contract", `${creator.name} signed their contract`, creator.id);
}

export async function requestTaxForm(creatorId: string) {
  const creator = await db.query.creators.findFirst({ where: eq(creators.id, creatorId) });
  if (!creator) return;
  const existing = await db.query.taxForms.findFirst({ where: and(eq(taxForms.creatorId, creatorId), inArray(taxForms.status, ["requested", "submitted", "verified"])) });
  if (existing) return existing;
  const [f] = await db.insert(taxForms).values({ creatorId, formType: taxFormFor(creator.country) }).returning();
  return f;
}

/** W-9 (US) or W-8BEN (non-US). The TIN/SSN/foreign TIN is encrypted; only the last 4 are kept readable. */
export async function submitTaxForm(p: { portalToken: string; formType: "W-9" | "W-8BEN"; legalName: string; tin: string; signatureName: string; data: Record<string, string> }) {
  const creator = await db.query.creators.findFirst({ where: eq(creators.portalToken, p.portalToken) });
  if (!creator) throw new Error("Invalid link");
  const tin = p.tin.replace(/[^0-9A-Za-z]/g, "");
  if (p.formType === "W-9" && tin.length !== 9) throw new Error("SSN or EIN must be 9 digits");
  if (!p.signatureName.trim()) throw new Error("Signature required");
  const form = await db.query.taxForms.findFirst({ where: eq(taxForms.creatorId, creator.id), orderBy: desc(taxForms.createdAt) });
  const values = {
    formType: p.formType,
    legalName: p.legalName,
    data: p.data,
    tinEnc: tin ? encrypt(tin) : null,
    tinLast4: tin ? tin.slice(-4) : null,
    signatureName: p.signatureName.trim(),
    status: "submitted" as const,
    submittedAt: new Date(),
  };
  if (form && form.status !== "verified") await db.update(taxForms).set(values).where(eq(taxForms.id, form.id));
  else await db.insert(taxForms).values({ creatorId: creator.id, ...values });
  await log("tax", `${creator.name} submitted a ${p.formType}`, creator.id);
}

export async function startWarmup(creatorId: string, days?: number) {
  await db.update(creators).set({ warmupStartedAt: new Date(), ...(days ? { warmupTargetDays: days } : {}) }).where(eq(creators.id, creatorId));
}

/** Save tokens after the official OAuth flow. Demo mode marks the account connected without tokens. */
export async function saveConnection(p: { creatorId: string; platform: "tiktok" | "instagram" | "youtube"; tokens?: { accessToken: string; refreshToken?: string; expiresAt?: Date }; demo?: boolean }) {
  const provider = connectedProviders[p.platform];
  let profile: { handle: string; platformUserId: string; followers: number; bio?: string } | null = null;
  if (p.tokens) profile = await provider.profile(p.tokens.accessToken);

  const existing = await db.query.creatorAccounts.findFirst({ where: and(eq(creatorAccounts.creatorId, p.creatorId), eq(creatorAccounts.platform, p.platform)) });
  const values = {
    connected: true,
    connectedAt: new Date(),
    accessTokenEnc: p.tokens ? encrypt(p.tokens.accessToken) : null,
    refreshTokenEnc: p.tokens?.refreshToken ? encrypt(p.tokens.refreshToken) : null,
    tokenExpiresAt: p.tokens?.expiresAt ?? null,
    ...(profile ? { handle: profile.handle.toLowerCase(), platformUserId: profile.platformUserId, followers: profile.followers, bio: profile.bio } : {}),
  };
  if (existing) await db.update(creatorAccounts).set(values).where(eq(creatorAccounts.id, existing.id));
  else {
    if (!profile) throw new Error("No account to connect");
    await db.insert(creatorAccounts).values({ creatorId: p.creatorId, platform: p.platform, handle: profile.handle.toLowerCase(), ...values });
  }
  await log("connect", `Connected ${p.platform}${p.demo ? " (demo)" : ""}`, p.creatorId);
}

// ─── Creator portal helpers ─────────────────────────────────────────────────

/** Portal tokens are 32 hex chars; anything else is rejected before touching the DB. */
export async function creatorByPortalToken(token: string | null | undefined) {
  if (!token || !/^[a-f0-9]{32}$/i.test(token)) return null;
  return (await db.query.creators.findFirst({ where: eq(creators.portalToken, token) })) ?? null;
}

/**
 * Payout method from the creator portal. PayPal pays to an email, Wise to an existing recipient
 * account id (numeric), Stripe to a connected account id (acct_…).
 */
export async function setPayoutMethod(p: { portalToken: string; provider: "wise" | "paypal" | "stripe"; destination: string }) {
  const creator = await creatorByPortalToken(p.portalToken);
  if (!creator) throw new Error("Invalid link");
  const destination = p.destination.trim();
  if (p.provider === "paypal" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(destination)) throw new Error("Enter the email address on your PayPal account");
  if (p.provider === "wise" && !/^\d{4,}$/.test(destination)) throw new Error("Enter your Wise recipient ID — numbers only");
  if (p.provider === "stripe" && !/^acct_[A-Za-z0-9]{6,}$/.test(destination)) throw new Error("Enter your Stripe connected account ID — it starts with acct_");
  await db.update(creators).set({ payoutProvider: p.provider, payoutDestination: destination }).where(eq(creators.id, creator.id));
  await log("payout", `${creator.name} set their payout method to ${p.provider}`, creator.id);
}

/** Ops review of a submitted tax form. Rejected forms go back to the creator to resubmit. */
export async function setTaxFormStatus(formId: string, status: "verified" | "rejected") {
  const form = await db.query.taxForms.findFirst({ where: eq(taxForms.id, formId) });
  if (!form) throw new Error("Tax form not found");
  if (form.status !== "submitted") throw new Error(`Only submitted forms can be ${status}; this one is ${form.status}`);
  await db.update(taxForms).set({ status }).where(eq(taxForms.id, formId));
  await log("tax", `${form.formType} ${status === "verified" ? "verified" : "sent back for changes"}`, form.creatorId);
}

// ─── OAuth state (signed, short-lived) ──────────────────────────────────────

export type OAuthState = { creatorId: string; platform: "tiktok" | "instagram" | "youtube"; nonce: string; exp: number };

function stateKey() {
  const secret = process.env.ENCRYPTION_KEY;
  if (!secret && process.env.NODE_ENV === "production") throw new Error("ENCRYPTION_KEY is required in production");
  return createHash("sha256").update(`oauth-state:${secret ?? "dev-only-insecure-key"}`).digest();
}

/** state = base64url(JSON payload) + "." + base64url(HMAC-SHA256(payload)). Expires after `ttlMs`. */
export function signOAuthState(p: { creatorId: string; platform: OAuthState["platform"] }, ttlMs = 10 * 60_000) {
  const payload: OAuthState = { ...p, nonce: randomBytes(16).toString("base64url"), exp: Date.now() + ttlMs };
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig = createHmac("sha256", stateKey()).update(body).digest("base64url");
  return { state: `${body}.${sig}`, nonce: payload.nonce };
}

/** Null when the signature or shape is wrong. A correctly signed but stale state comes back with `expired: true`. */
export function verifyOAuthState(state: string | null | undefined): { payload: OAuthState; expired: boolean } | null {
  if (!state) return null;
  const [body, sig] = state.split(".");
  if (!body || !sig) return null;
  const expected = createHmac("sha256", stateKey()).update(body).digest();
  const given = Buffer.from(sig, "base64url");
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  try {
    const p = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as OAuthState;
    if (typeof p.exp !== "number" || !p.creatorId || !p.nonce || !["tiktok", "instagram", "youtube"].includes(p.platform)) return null;
    return { payload: p, expired: p.exp < Date.now() };
  } catch {
    return null;
  }
}
