"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { and, eq } from "drizzle-orm";
import { db, briefs, creatorAccounts } from "@/db";
import type { ActionResult } from "@/components/client";
import { creatorByPortalToken, saveConnection, setPayoutMethod, signContract, submitTaxForm } from "@/lib/services/onboarding";
import { submitForReview } from "@/lib/services/review";
import { syncAccount } from "@/lib/services/tracking";
import { readDraft } from "@/app/(app)/review/draft-fields";

const fail = (e: unknown): ActionResult => ({ ok: false, message: e instanceof Error ? e.message : String(e) });
const str = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim();

function refresh(token: string, ...ops: string[]) {
  revalidatePath(`/c/${token}`);
  for (const p of ops) revalidatePath(p);
}

export async function signContractAction(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  try {
    const token = str(fd, "token");
    const h = await headers();
    const ip = h.get("x-forwarded-for")?.split(",")[0].trim() || h.get("x-real-ip") || "unknown";
    await signContract({
      portalToken: token,
      contractId: str(fd, "contractId"),
      name: str(fd, "name"),
      consent: fd.get("consent") === "on",
      ip,
      userAgent: h.get("user-agent") ?? "unknown",
    });
    refresh(token, "/onboarding");
    return { ok: true, message: "Signed. A copy stays on this page." };
  } catch (e) {
    return fail(e);
  }
}

const W9_CLASSES = ["individual", "c_corp", "s_corp", "partnership", "trust", "llc", "other"];

export async function submitTaxFormAction(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  try {
    const token = str(fd, "token");
    const formType = str(fd, "formType") === "W-9" ? "W-9" : "W-8BEN";
    const legalName = str(fd, "legalName");
    const signatureName = str(fd, "signatureName");
    const tin = str(fd, "tin");
    if (legalName.length < 2) return { ok: false, message: "Enter your full legal name" };
    if (fd.get("certify") !== "on") return { ok: false, message: "Tick the certification box to confirm the information is correct" };
    if (signatureName.length < 2) return { ok: false, message: "Type your full legal name in the signature box" };

    let data: Record<string, string>;
    if (formType === "W-9") {
      const classification = str(fd, "classification");
      if (!W9_CLASSES.includes(classification)) return { ok: false, message: "Choose your federal tax classification" };
      if (!str(fd, "address") || !str(fd, "cityStateZip")) return { ok: false, message: "Enter your full US address, including city, state and ZIP" };
      if (tin.replace(/\D/g, "").length !== 9) return { ok: false, message: "Your SSN or EIN should be 9 digits" };
      data = { businessName: str(fd, "businessName"), classification, address: str(fd, "address"), cityStateZip: str(fd, "cityStateZip"), certified: "yes" };
    } else {
      const noTin = fd.get("noForeignTin") === "on";
      if (!str(fd, "citizenship")) return { ok: false, message: "Enter your country of citizenship" };
      if (!str(fd, "address") || !str(fd, "cityPostal") || !str(fd, "residenceCountry")) return { ok: false, message: "Enter your full permanent address, including country" };
      if (!/^\d{4}-\d{2}-\d{2}$/.test(str(fd, "dateOfBirth"))) return { ok: false, message: "Enter your date of birth" };
      if (!tin && !noTin) return { ok: false, message: "Enter your foreign tax ID, or tick the box if your country doesn't issue one" };
      data = {
        citizenship: str(fd, "citizenship"),
        address: str(fd, "address"),
        cityPostal: str(fd, "cityPostal"),
        residenceCountry: str(fd, "residenceCountry"),
        dateOfBirth: str(fd, "dateOfBirth"),
        treatyCountry: str(fd, "treatyCountry"),
        foreignTinNotRequired: noTin && !tin ? "yes" : "no",
        certified: "yes",
      };
    }
    await submitTaxForm({ portalToken: token, formType, legalName, tin, signatureName, data });
    refresh(token, "/onboarding");
    return { ok: true, message: `${formType} submitted. We'll check it and let you know.` };
  } catch (e) {
    return fail(e);
  }
}

export async function connectDemoAction(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  try {
    const token = str(fd, "token");
    const creator = await creatorByPortalToken(token);
    if (!creator) return { ok: false, message: "This link isn't valid anymore — ask your contact for a new one" };
    const platform = str(fd, "platform");
    if (platform !== "tiktok" && platform !== "instagram" && platform !== "youtube") return { ok: false, message: "Pick a platform" };
    const acct = await db.query.creatorAccounts.findFirst({ where: and(eq(creatorAccounts.creatorId, creator.id), eq(creatorAccounts.platform, platform)) });
    if (!acct) return { ok: false, message: "We don't have an account on file for this platform yet" };
    await saveConnection({ creatorId: creator.id, platform, demo: true });
    let synced = "";
    try {
      const r = await syncAccount(acct.id);
      synced = ` · ${r.newPosts + r.snapshots > 0 ? "stats updated" : "stats checked"}`;
    } catch {
      synced = " · stats will update on the next sync";
    }
    refresh(token, "/onboarding");
    return { ok: true, message: `Connected @${acct.handle}${synced}` };
  } catch (e) {
    return fail(e);
  }
}

export async function setPayoutAction(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  try {
    const token = str(fd, "token");
    const provider = str(fd, "provider");
    if (provider !== "wise" && provider !== "paypal" && provider !== "stripe") return { ok: false, message: "Choose how you want to be paid" };
    await setPayoutMethod({ portalToken: token, provider, destination: str(fd, "destination") });
    refresh(token, "/payouts");
    return { ok: true, message: "Payout method saved" };
  } catch (e) {
    return fail(e);
  }
}

export async function submitDraftAction(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  try {
    const token = str(fd, "token");
    const creator = await creatorByPortalToken(token);
    if (!creator) return { ok: false, message: "This link isn't valid anymore — ask your contact for a new one" };
    const draft = readDraft(fd);
    // Only link briefs that belong to this creator.
    const briefId = str(fd, "briefId");
    const brief = briefId ? await db.query.briefs.findFirst({ where: and(eq(briefs.id, briefId), eq(briefs.creatorId, creator.id)) }) : null;
    const r = await submitForReview({ creatorId: creator.id, briefId: brief?.id ?? null, ...draft });
    refresh(token, "/review", "/creative/briefs");
    revalidatePath("/", "layout");
    const flagged = (r.checks ?? []).filter((c) => c.status !== "pass").length;
    return {
      ok: true,
      message: flagged ? `Submitted. ${flagged} check${flagged === 1 ? "" : "s"} need a look — see below. Don't post until it's approved.` : "Submitted — all checks passed. Don't post until it's approved.",
    };
  } catch (e) {
    return fail(e);
  }
}
