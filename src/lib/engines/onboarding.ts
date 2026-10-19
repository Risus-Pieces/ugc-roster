import type { ContractTerms } from "@/db/schema";

const DAY = 86_400_000;

/** Warm-up tracking: the tool only counts the days; the creator does the warm-up. */
export function warmupStatus(startedAt: Date | null | undefined, targetDays: number, now = new Date()) {
  if (!startedAt) return { started: false, day: 0, targetDays, done: false, remaining: targetDays };
  const day = Math.floor((now.getTime() - startedAt.getTime()) / DAY) + 1;
  return { started: true, day, targetDays, done: day > targetDays, remaining: Math.max(0, targetDays - day + 1) };
}

export function taxFormFor(country: string | null | undefined): "W-9" | "W-8BEN" {
  return (country ?? "").toUpperCase() === "US" ? "W-9" : "W-8BEN";
}

const usd = (c: number) => `$${(c / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export function renderContract(p: { brand: string; creatorName: string; terms: ContractTerms; date: Date }) {
  const t = p.terms;
  const usage =
    t.usageRights === "none"
      ? "Brand receives no rights to repost or advertise with the Content beyond sharing links to the original post."
      : t.usageRights === "organic"
        ? `Brand may repost the Content on its own organic channels for ${t.usageMonths} months after publication, with credit to Creator.`
        : `Brand may repost the Content and use it in paid advertising (including Spark Ads / whitelisting) for ${t.usageMonths} months after publication. Creator will provide ad authorization codes on request.`;

  return `# Content Creator Agreement

**Date:** ${p.date.toISOString().slice(0, 10)}
**Brand:** ${p.brand}
**Creator:** ${p.creatorName}

## 1. Services
Creator will produce and publish **${t.videosPerMonth} short-form videos per month** ("Content") on Creator's own accounts, following briefs provided by Brand, for a term of **${t.termMonths} months**. Either party may end this agreement with 7 days' written notice.

## 2. Compensation
- **Base rate:** ${usd(t.baseCents)} per approved, published video, up to the monthly quota.
- **Per-view pay:** ${usd(t.cpmCents)} per 1,000 qualified views.
- **View window:** Only views in the first **${t.viewWindowDays} days** after publication count.
- **Qualified views** exclude views from paid promotion (boosts, Spark Ads) and views identified as automated or fraudulent.
- **Pay cap:** ${usd(t.perVideoCapCents)} per video (base + per-view pay + bonuses) and ${usd(t.monthlyCapCents)} per month.
- Payment is made monthly after Brand approves an itemized statement, via Creator's chosen payout method.

## 3. Approval
Each video must be submitted for review and approved by Brand before publishing. Unapproved videos are not paid.

## 4. Disclosure
${t.disclosure}
Creator will not make claims about the product that Brand has not approved, will not claim to have used the product for longer than they have, and will label any AI-generated or AI-altered footage using the platform's label.

## 5. Usage rights
${usage}

## 6. Clawbacks
Brand may recover payments for a video if, within **${t.clawbackDays} days** of publication, the video is deleted or made private, is published without approval, omits required disclosure, or is found to have used purchased views or engagement.

## 7. Independent contractor
Creator is an independent contractor and is responsible for their own taxes. Creator will provide a completed IRS Form W-9 (US persons) or W-8BEN (non-US persons) before the first payment.

## 8. Electronic signature
The parties agree that typing their name below and clicking "Sign" is a legal signature under the U.S. ESIGN Act and equivalent laws, and consent to receive this agreement electronically.
`;
}

export async function sha256(text: string) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * 1099-NEC threshold: $600 for payments through 2025; $2,000 for payments made in 2026 onward
 * (One Big Beautiful Bill Act), indexed for inflation after 2026. Confirm with your accountant.
 */
export function form1099Threshold(year: number) {
  return year >= 2026 ? 200_000 : 60_000;
}

/**
 * Payments made through a payment settlement entity (e.g. PayPal) are reported by that
 * processor on a 1099-K, so they're excluded from the 1099-NEC you file.
 */
export function needs1099(p: { country: string | null; totalCents: number; tpsoCents: number; year: number }) {
  if ((p.country ?? "").toUpperCase() !== "US") return { required: false, reportableCents: 0 };
  const reportable = p.totalCents - p.tpsoCents;
  return { required: reportable >= form1099Threshold(p.year), reportableCents: reportable };
}
