"use server";

import { revalidatePath } from "next/cache";
import type { ActionResult } from "@/components/client";
import { getOps, saveBrand, saveOps, type Brand, type Ops } from "@/lib/settings";
import { importGooglePlayCsv } from "@/lib/integrations/revenue";

const str = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim();
const lines = (fd: FormData, k: string) =>
  String(fd.get(k) ?? "")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
const num = (fd: FormData, k: string) => {
  const v = str(fd, k).replace(/[$,%\s]/g, "");
  return v === "" ? NaN : Number(v);
};

class Invalid extends Error {}
function need(ok: boolean, msg: string): asserts ok {
  if (!ok) throw new Invalid(msg);
}
const isUrl = (s: string) => {
  try {
    const u = new URL(s);
    return u.protocol === "https:" || u.protocol === "http:";
  } catch {
    return false;
  }
};

export async function saveBrandAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  try {
    const b: Brand = {
      name: str(fd, "name"),
      product: str(fd, "product"),
      valueProp: str(fd, "valueProp"),
      appUrl: str(fd, "appUrl"),
      bookingUrl: str(fd, "bookingUrl"),
      senderName: str(fd, "senderName"),
      senderEmail: str(fd, "senderEmail"),
      allowedClaims: lines(fd, "allowedClaims"),
      bannedClaims: lines(fd, "bannedClaims"),
      disclosure: str(fd, "disclosure"),
      targetCpmCents: Math.round(num(fd, "targetCpm") * 100),
      referralBonusCents: Math.round(num(fd, "referralBonus") * 100),
    };
    need(b.name.length > 0, "Enter your brand name.");
    need(b.product.length > 0, "Enter the product name.");
    need(b.valueProp.length > 0, "Describe what the product does in one line.");
    need(isUrl(b.appUrl), "App URL must be a full link starting with https:// (tracking links redirect there).");
    need(!b.bookingUrl || isUrl(b.bookingUrl), "Booking link must be a full link starting with https://, or left blank.");
    need(b.senderName.length > 0, "Enter the sender name creators will see.");
    need(/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(b.senderEmail), "Sender email doesn't look like an email address.");
    need(b.allowedClaims.length > 0, "Add at least one allowed claim, one per line. Briefs and reviews check against this list.");
    need(b.disclosure.length > 0, "Add the disclosure text that goes into every contract.");
    need(Number.isFinite(b.targetCpmCents) && b.targetCpmCents > 0, "Target cost per 1K views must be above $0.");
    need(Number.isFinite(b.referralBonusCents) && b.referralBonusCents >= 10_000 && b.referralBonusCents <= 20_000, "Referral bonus must be between $100 and $200.");
    await saveBrand(b);
    revalidatePath("/", "layout");
    return { ok: true, message: "Brand settings saved." };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : String(e) };
  }
}

export async function saveOpsAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  try {
    const current = await getOps();
    const o: Ops = {
      ...current,
      breakout: {
        minViews: num(fd, "minViews"),
        minEngagementRate: num(fd, "minEr") / 100,
        maxAgeHours: num(fd, "maxAgeHours"),
      },
      testShare: num(fd, "testShare") / 100,
      testFormats: lines(fd, "testFormats"),
      decisionMinPosts: num(fd, "decisionMinPosts"),
      surveyOptions: lines(fd, "surveyOptions"),
    };
    need(Number.isInteger(o.breakout.minViews) && o.breakout.minViews >= 0, "Breakout minimum views must be a whole number.");
    need(Number.isFinite(o.breakout.minEngagementRate) && o.breakout.minEngagementRate > 0 && o.breakout.minEngagementRate < 1, "Breakout minimum engagement rate must be a percentage between 0 and 100.");
    need(Number.isInteger(o.breakout.maxAgeHours) && o.breakout.maxAgeHours >= 1 && o.breakout.maxAgeHours <= 720, "Breakout max age must be 1 to 720 hours.");
    need(Number.isFinite(o.testShare) && o.testShare >= 0 && o.testShare <= 1, "Test share must be 0 to 100%.");
    need(o.testShare === 0 || o.testFormats.length > 0, "Add at least one test format, one per line, or set the test share to 0%.");
    need(Number.isInteger(o.decisionMinPosts) && o.decisionMinPosts >= 5 && o.decisionMinPosts <= 100, "Posts before a keep/cut suggestion must be 5 to 100 (20–30 is typical).");
    need(o.surveyOptions.length > 0, `Add at least one generic survey answer, such as "Other".`);
    await saveOps(o);
    revalidatePath("/", "layout");
    return { ok: true, message: "Operations settings saved." };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : String(e) };
  }
}

export async function importGooglePlayAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  try {
    const file = fd.get("file");
    let csv = str(fd, "csv");
    if (file instanceof File && file.size > 0) {
      if (file.size > 900_000) return { ok: false, message: "That file is over 900 KB. Upload the monthly installs overview CSV (one month per file)." };
      const buf = Buffer.from(await file.arrayBuffer());
      // Play Console exports are UTF-16LE; fall back to UTF-8.
      csv = buf[0] === 0xff && buf[1] === 0xfe ? buf.toString("utf16le") : buf.toString("utf8");
    }
    if (!csv.trim()) return { ok: false, message: "Choose the installs CSV from Play Console, or paste its contents." };
    const r = await importGooglePlayCsv(csv);
    revalidatePath("/", "layout");
    return r.days ? { ok: true, message: `Imported ${r.days} days of Google Play installs.` } : { ok: false, message: "No rows imported. Check the file has Date and Daily User Installs columns." };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : String(e) };
  }
}
