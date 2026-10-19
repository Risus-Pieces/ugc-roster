import type { ComplianceCheck } from "@/db/schema";
import { mostSimilar } from "./similarity";

export type ComplianceInput = {
  caption: string;
  transcript?: string | null;
  paidPartnershipToggle: boolean;
  containsAiFootage: boolean;
  aiLabelToggle: boolean;
  /** When the creator first got the product (trial start / product access). */
  productAccessAt?: Date | null;
  now?: Date;
  corpus: { id: string; text: string }[];
  bannedClaims?: string[];
};

const DISCLOSURE = /(#ad\b|#sponsored\b|#paidpartnership\b|#partner\b|\bpaid partnership\b|\bsponsored by\b|#\w+partner\b)/i;
const AI_LABEL = /(#aigenerated|#madewithai|#ai\b|\bai[- ]generated\b|\bmade with ai\b)/i;

export const DEFAULT_BANNED_CLAIMS = [
  "guaranteed",
  "100% accurate",
  "cure",
  "cures",
  "clinically proven",
  "doctor recommended",
  "fda approved",
  "lose \\d+ ?(lbs|pounds|kg) in",
  "number one app",
  "#1 app",
  "best app in the world",
  "no side effects",
  "get rich",
];

const UNIT_DAYS: Record<string, number> = { day: 1, week: 7, month: 30, year: 365 };
const NUM_WORDS: Record<string, number> = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, few: 3, couple: 2, several: 3 };

/** Find experience claims like "I've been using this for 3 months" and return the longest, in days. */
export function claimedExperienceDays(text: string): { days: number; phrase: string } | null {
  const re =
    /\b(?:i'?ve been using (?:it|this|this app|[a-z]+)|i'?ve used (?:it|this)|been using (?:it|this)|using (?:it|this) for|for the (?:past|last))\s*(?:for\s*)?(?:the\s*)?(?:(past|last)\s*)?(\d+|a|an|one|two|three|four|five|six|few|couple|several)?\s*(?:of\s*)?(days?|weeks?|months?|years?)/gi;
  let best: { days: number; phrase: string } | null = null;
  for (const m of text.matchAll(re)) {
    const qty = m[2] ? (Number(m[2]) || NUM_WORDS[m[2].toLowerCase()] || 1) : 1;
    const unit = m[3].toLowerCase().replace(/s$/, "");
    const days = qty * UNIT_DAYS[unit];
    if (!best || days > best.days) best = { days, phrase: m[0] };
  }
  return best;
}

/** Deterministic pre-checks run on every submission before a human (or the AI pass) sees it. */
export function runComplianceChecks(input: ComplianceInput): ComplianceCheck[] {
  const now = input.now ?? new Date();
  const text = `${input.caption}\n${input.transcript ?? ""}`;
  const checks: ComplianceCheck[] = [];

  // 1. Paid-partnership disclosure
  const hashtag = DISCLOSURE.test(input.caption);
  checks.push({
    key: "disclosure",
    label: "Paid-partnership disclosure",
    status: input.paidPartnershipToggle ? "pass" : hashtag ? "warn" : "fail",
    detail: input.paidPartnershipToggle
      ? "Platform paid-partnership label is on."
      : hashtag
        ? "Disclosure hashtag found, but the platform's paid-partnership toggle is off. Turn it on."
        : "No paid-partnership toggle and no #ad / #sponsored in the caption.",
  });

  // 2. Claims
  const banned = (input.bannedClaims ?? DEFAULT_BANNED_CLAIMS).filter((p) => new RegExp(`\\b${p}`, "i").test(text));
  checks.push({
    key: "claims",
    label: "Allowed claims",
    status: banned.length ? "fail" : "pass",
    detail: banned.length ? `Disallowed claim(s): ${banned.map((b) => `"${b.replaceAll("\\d+ ?", "N ").replaceAll("\\", "")}"`).join(", ")}` : "No disallowed claims found.",
  });

  // 3. Claimed experience vs actual product access
  const claim = claimedExperienceDays(text);
  if (!claim) {
    checks.push({ key: "experience", label: "Experience claims", status: "pass", detail: "No duration-of-use claims." });
  } else if (!input.productAccessAt) {
    checks.push({
      key: "experience",
      label: "Experience claims",
      status: "warn",
      detail: `Says "${claim.phrase}" but we have no product-access date to verify it.`,
    });
  } else {
    const actualDays = Math.floor((now.getTime() - input.productAccessAt.getTime()) / 86_400_000);
    const ok = claim.days <= actualDays + 2;
    checks.push({
      key: "experience",
      label: "Experience claims",
      status: ok ? "pass" : "fail",
      detail: ok
        ? `Says "${claim.phrase}" — consistent with ${actualDays} days of access.`
        : `Says "${claim.phrase}" (~${claim.days} days) but has only had the product for ${actualDays} days.`,
    });
  }

  // 4. AI footage labeled
  if (!input.containsAiFootage) {
    checks.push({ key: "ai_label", label: "AI footage labeled", status: "pass", detail: "No AI footage declared." });
  } else {
    const labeled = input.aiLabelToggle || AI_LABEL.test(input.caption);
    checks.push({
      key: "ai_label",
      label: "AI footage labeled",
      status: input.aiLabelToggle ? "pass" : labeled ? "warn" : "fail",
      detail: input.aiLabelToggle
        ? "Platform AI-generated content label is on."
        : labeled
          ? "Caption mentions AI, but the platform's AI-content label is off."
          : "Contains AI footage with no AI label.",
    });
  }

  // 5. Too close a copy
  const sim = input.corpus.length ? mostSimilar(text, input.corpus) : { id: "", score: 0 };
  checks.push({
    key: "similarity",
    label: "Originality",
    status: sim.score >= 0.6 ? "fail" : sim.score >= 0.35 ? "warn" : "pass",
    detail:
      sim.score >= 0.35
        ? `${Math.round(sim.score * 100)}% overlap with an existing video (${sim.id.slice(0, 8)}). Rewrite as a variation, not a copy.`
        : `Max overlap with existing videos: ${Math.round(sim.score * 100)}%.`,
  });

  return checks;
}

export function overallStatus(checks: ComplianceCheck[]): "pass" | "warn" | "fail" {
  if (checks.some((c) => c.status === "fail")) return "fail";
  if (checks.some((c) => c.status === "warn")) return "warn";
  return "pass";
}
