"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { db, rateCards, type Milestone, type Tier } from "@/db";
import type { ActionResult } from "@/components/client";

const str = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim();
const num = (v: string) => (v === "" ? NaN : Number(v.replace(/[$,\s]/g, "")));
const cents = (v: string) => Math.round(num(v) * 100);

class Invalid extends Error {}
function need(ok: boolean, msg: string): asserts ok {
  if (!ok) throw new Invalid(msg);
}

/** Create or update a rate card. Money fields arrive in dollars; stored as cents. */
export async function saveRateCardAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  let newId: string | null = null;
  try {
    const id = str(fd, "id");
    const name = str(fd, "name");
    need(name.length > 0, "Give the rate card a name.");

    const dollars = (k: string, label: string, min = 0) => {
      const v = num(str(fd, k));
      need(Number.isFinite(v) && v >= min, `${label} must be a number of at least $${min}.`);
      return Math.round(v * 100);
    };
    const int = (k: string, label: string, min: number, max: number) => {
      const v = num(str(fd, k));
      need(Number.isInteger(v) && v >= min && v <= max, `${label} must be a whole number from ${min.toLocaleString("en-US")} to ${max.toLocaleString("en-US")}.`);
      return v;
    };

    const baseCents = dollars("base", "Base per video");
    const cpmCents = dollars("cpm", "Pay per 1K views");
    const viewWindowDays = int("viewWindowDays", "View window", 1, 30);
    const perVideoCapCents = dollars("perVideoCap", "Per-video cap", 1);
    const monthlyCapCents = dollars("monthlyCap", "Monthly cap", 1);
    const videosPerMonth = int("videosPerMonth", "Videos per month", 1, 300);
    const minViewsForCpm = int("minViews", "Minimum views for per-view pay", 0, 10_000_000);
    const referralBonusCents = dollars("referral", "Referral bonus");
    need(referralBonusCents >= 10_000 && referralBonusCents <= 20_000, "Referral bonus must be between $100 and $200.");

    // Milestones
    const mViews = fd.getAll("milestone_views").map(String);
    const mBonus = fd.getAll("milestone_bonus").map(String);
    const milestones: Milestone[] = [];
    mViews.forEach((v, i) => {
      const b = mBonus[i] ?? "";
      if (!v.trim() && !b.trim()) return;
      const views = num(v);
      const bonusCents = cents(b);
      need(Number.isInteger(views) && views > 0, `Milestone ${i + 1}: enter the view count as a whole number.`);
      need(Number.isFinite(bonusCents) && bonusCents > 0, `Milestone ${i + 1}: enter a bonus above $0.`);
      milestones.push({ views, bonusCents });
    });
    milestones.sort((a, b) => a.views - b.views);
    need(new Set(milestones.map((m) => m.views)).size === milestones.length, "Two milestones have the same view count. Remove one.");

    // Tiers
    const tName = fd.getAll("tier_name").map(String);
    const tMin = fd.getAll("tier_min").map(String);
    const tBase = fd.getAll("tier_base").map(String);
    const tCpm = fd.getAll("tier_cpm").map(String);
    const tiers: Tier[] = [];
    tName.forEach((n, i) => {
      const row = [n, tMin[i] ?? "", tBase[i] ?? "", tCpm[i] ?? ""];
      if (row.every((x) => !x.trim())) return;
      const tier = { name: n.trim(), minTypicalViews: num(tMin[i] ?? ""), baseCents: cents(tBase[i] ?? ""), cpmCents: cents(tCpm[i] ?? "") };
      need(tier.name.length > 0, `Tier ${i + 1}: give it a name.`);
      need(Number.isInteger(tier.minTypicalViews) && tier.minTypicalViews >= 0, `Tier "${tier.name}": typical views must be a whole number.`);
      need(Number.isFinite(tier.baseCents) && tier.baseCents >= 0, `Tier "${tier.name}": enter a base pay.`);
      need(Number.isFinite(tier.cpmCents) && tier.cpmCents >= 0, `Tier "${tier.name}": enter pay per 1K views.`);
      tiers.push(tier);
    });
    tiers.sort((a, b) => a.minTypicalViews - b.minTypicalViews);
    need(new Set(tiers.map((t) => t.name.toLowerCase())).size === tiers.length, "Two tiers share a name. Rename one.");
    need(tiers.every((t) => t.name.toLowerCase() !== "standard"), `"Standard" is the name used when no tier applies. Pick another tier name.`);

    const topBase = Math.max(baseCents, ...tiers.map((t) => t.baseCents));
    need(perVideoCapCents >= topBase, `The per-video cap ($${(perVideoCapCents / 100).toFixed(2)}) is below the highest base pay ($${(topBase / 100).toFixed(2)}), so per-view pay would always be $0. Raise the cap.`);
    need(monthlyCapCents >= perVideoCapCents, "The monthly cap is below the per-video cap. Raise the monthly cap.");

    const values = { name, baseCents, cpmCents, viewWindowDays, perVideoCapCents, monthlyCapCents, videosPerMonth, minViewsForCpm, milestones, tiers, referralBonusCents };
    if (id) {
      const res = await db.update(rateCards).set(values).where(eq(rateCards.id, id)).returning({ id: rateCards.id });
      need(res.length > 0, "This rate card no longer exists. Reload the page.");
    } else {
      const [row] = await db.insert(rateCards).values(values).returning({ id: rateCards.id });
      newId = row.id;
    }
    revalidatePath("/payouts", "layout");
    revalidatePath("/decisions", "layout");
    if (!newId) return { ok: true, message: "Saved. New statements you draft will use these terms; approved and paid statements don't change." };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : String(e) };
  }
  redirect(`/payouts/rate-cards?id=${newId}`);
}
