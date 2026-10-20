"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { ActionResult } from "@/components/client";
import { PLATFORMS, type Platform } from "@/db";
import { createCampaign, runDiscovery, type DiscoveryRun } from "@/lib/services/discovery";
import { planImport, runImport, type ImportPlan } from "@/lib/services/importer";
import type { ImportPlatform } from "@/lib/engines/csv-import";

const fail = (e: unknown): ActionResult => ({ ok: false, message: e instanceof Error ? e.message : String(e) });

const str = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim();

function parseKeywords(raw: string) {
  return [
    ...new Set(
      raw
        .split(",")
        .map((k) => k.trim().toLowerCase())
        .filter(Boolean),
    ),
  ];
}

function parsePlatforms(fd: FormData): Platform[] {
  return fd
    .getAll("platforms")
    .map(String)
    .filter((p): p is Platform => (PLATFORMS as readonly string[]).includes(p));
}

export async function createCampaignAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  let id: string;
  try {
    const name = str(fd, "name");
    const niche = str(fd, "niche");
    const keywords = parseKeywords(str(fd, "keywords"));
    const platforms = parsePlatforms(fd);
    const minFollowers = Number(str(fd, "minFollowers") || 2000);
    const maxFollowers = Number(str(fd, "maxFollowers") || 20000);
    if (!name) return { ok: false, message: "Give the campaign a name" };
    if (!niche) return { ok: false, message: "Add a niche, e.g. fitness or meal prep" };
    if (!keywords.length) return { ok: false, message: "Add at least one keyword" };
    if (!platforms.length) return { ok: false, message: "Pick at least one platform" };
    if (!Number.isFinite(minFollowers) || !Number.isFinite(maxFollowers) || minFollowers < 0 || maxFollowers <= minFollowers) return { ok: false, message: "Follower max must be higher than min" };
    const c = await createCampaign({ name, niche, keywords, platforms, minFollowers: Math.round(minFollowers), maxFollowers: Math.round(maxFollowers) });
    id = c.id;
  } catch (e) {
    return fail(e);
  }
  revalidatePath("/discover");
  redirect(`/discover?campaign=${id}`);
}

export type RunResult = (NonNullable<ActionResult> & { run?: DiscoveryRun; band?: string }) | null;

export async function runDiscoveryAction(_: RunResult, fd: FormData): Promise<RunResult> {
  try {
    const campaignId = str(fd, "campaignId");
    if (!campaignId) return { ok: false, message: "Missing campaign" };
    const run = await runDiscovery(campaignId);
    revalidatePath("/", "layout");
    return {
      ok: true,
      message: run.created ? `${run.created} new creators added and scored` : "No new creators — everyone found was already known",
      run,
    };
  } catch (e) {
    return fail(e);
  }
}

/** "Find more like my top 10" → turn the seeds' shared keywords into a new campaign. */
export async function createLookalikeCampaignAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  let id: string;
  try {
    const keywords = parseKeywords(str(fd, "keywords"));
    const platforms = parsePlatforms(fd);
    if (!keywords.length) return { ok: false, message: "No keywords to search with — pick more seed creators" };
    const c = await createCampaign({
      name: str(fd, "name") || "Lookalikes of top creators",
      niche: str(fd, "niche") || "lookalike",
      keywords,
      platforms: platforms.length ? platforms : ["tiktok", "instagram"],
    });
    id = c.id;
  } catch (e) {
    return fail(e);
  }
  revalidatePath("/discover");
  redirect(`/discover?campaign=${id}`);
}

export type ImportSummary = {
  ok: boolean;
  message: string;
  mode?: "preview" | "import";
  created?: number;
  plan?: Omit<ImportPlan, "ready"> & { readyCount: number; sample: ImportPlan["ready"] };
} | null;

const MAX_BYTES = 5 * 1024 * 1024;

export async function importCreatorsAction(_: ImportSummary, fd: FormData): Promise<ImportSummary> {
  try {
    const mode = String(fd.get("intent")) === "import" ? "import" : "preview";
    const file = fd.get("file");
    let csv = String(fd.get("csv") ?? "");
    if (file instanceof File && file.size > 0) {
      if (file.size > MAX_BYTES) return { ok: false, message: "That file is over 5 MB. Split it into smaller exports." };
      csv = await file.text();
    }
    if (!csv.trim()) return { ok: false, message: "Choose a CSV file or paste the rows first." };
    const platform = String(fd.get("platform") ?? "");
    const opts = {
      campaignId: String(fd.get("campaignId") ?? ""),
      source: String(fd.get("source") ?? "Spreadsheet").slice(0, 40) || "Spreadsheet",
      defaultPlatform: (["tiktok", "instagram", "youtube"].includes(platform) ? platform : null) as ImportPlatform | null,
      onlyInBand: fd.get("onlyInBand") === "on",
    };
    const shape = (plan: ImportPlan) => {
      const { ready, ...rest } = plan;
      return { ...rest, readyCount: ready.length, sample: ready.slice(0, 8) };
    };
    if (mode === "preview") {
      const plan = await planImport(csv, opts);
      return {
        ok: true,
        mode,
        plan: shape(plan),
        message: plan.ready.length ? `${plan.ready.length} new creators ready to import (${plan.withEmail} with an email). Nothing has been saved yet.` : "No new creators to import — see the reasons below.",
      };
    }
    const r = await runImport(csv, opts);
    revalidatePath("/", "layout");
    return { ok: r.created > 0, mode, created: r.created, plan: shape(r.plan), message: r.created ? `Imported ${r.created} creators into the campaign. Go to Outreach → Compose to write openers.` : "Nothing was imported — see the reasons below." };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : String(e) };
  }
}
