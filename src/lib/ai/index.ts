import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import { classifyReply, type ReplyClass } from "@/lib/engines/reply-classifier";
import type { ComplianceCheck, Variation } from "@/db/schema";
import type { Brand } from "@/lib/settings";

export const MODEL = process.env.CLAUDE_MODEL ?? "claude-opus-5-5";

export function aiEnabled() {
  return Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);
}

let _client: Anthropic | null = null;
const client = () => (_client ??= new Anthropic());

/**
 * One structured call. Short drafting/classification tasks run at low effort; the
 * server-side fallback re-runs a policy-declined request on Anthropic's recommended model.
 */
async function structured<T extends z.ZodType>(opts: {
  system: string;
  prompt: string;
  schema: T;
  effort?: "low" | "medium" | "high";
  maxTokens?: number;
}): Promise<z.infer<T>> {
  const res = await client().beta.messages.parse({
    model: MODEL,
    max_tokens: opts.maxTokens ?? 8000,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    system: opts.system,
    output_config: { effort: opts.effort ?? "low", format: betaZodOutputFormat(opts.schema) },
    messages: [{ role: "user", content: opts.prompt }],
  });
  if (res.stop_reason === "refusal") throw new Error("Claude declined this request");
  if (!res.parsed_output) throw new Error(`No structured output (stop_reason: ${res.stop_reason})`);
  return res.parsed_output as z.infer<T>;
}

/** Run with AI when configured; otherwise (or on failure) use the deterministic fallback. */
async function withFallback<T>(ai: () => Promise<T>, fallback: () => T): Promise<T & { _source: "ai" | "template"; _error?: string }> {
  if (!aiEnabled()) return { ...fallback(), _source: "template" };
  try {
    return { ...(await ai()), _source: "ai" };
  } catch (e) {
    console.error("[ai] falling back to template:", e);
    return { ...fallback(), _source: "template", _error: e instanceof Error ? e.message : String(e) };
  }
}

const usd = (c: number) => `$${(c / 100).toFixed(c % 100 ? 2 : 0)}`;

// ─── Outreach opener ────────────────────────────────────────────────────────

export async function writeOpener(p: {
  brand: Brand;
  creatorName: string;
  handle: string;
  platform: string;
  recentCaptions: string[];
  baseCents: number;
  cpmCents: number;
}) {
  const first = p.creatorName.split(" ")[0];
  return withFallback(
    () =>
      structured({
        system: `You write cold outreach emails from ${p.brand.senderName} at ${p.brand.name} to small UGC creators (2K–20K followers).
Rules: under 90 words. Open with one specific, genuine observation about a recent video (from the captions given) — never generic flattery. State pay up front in the second sentence (base per video plus per-view pay). One line on the product. End with a low-friction question. No emojis, no exclamation marks in the subject, no "I hope this finds you well". Plain text, sign off with the sender's first name.`,
        prompt: `Product: ${p.brand.product} — ${p.brand.valueProp}
Creator: ${p.creatorName} (@${p.handle} on ${p.platform})
Recent video captions:\n${p.recentCaptions.slice(0, 5).map((c) => `- ${c}`).join("\n")}
Offer: ${usd(p.baseCents)} per video + ${usd(p.cpmCents)} per 1,000 views.`,
        schema: z.object({ subject: z.string(), body: z.string() }),
      }),
    () => ({
      subject: `Paid video collab with ${p.brand.name}`,
      body: `Hi ${first},

Saw your recent video${p.recentCaptions[0] ? ` ("${p.recentCaptions[0].slice(0, 60)}")` : ""} — it's exactly the style that works for us.

We pay ${usd(p.baseCents)} per video plus ${usd(p.cpmCents)} per 1,000 views. ${p.brand.name} is ${p.brand.valueProp}.

Want me to send over a sample brief?

${p.brand.senderName.split(" ")[0]}`,
    }),
  );
}

// ─── Follow-ups ─────────────────────────────────────────────────────────────

export async function writeFollowUp(p: { brand: Brand; creatorName: string; step: number; originalBody: string; baseCents: number; cpmCents: number }) {
  const first = p.creatorName.split(" ")[0];
  const sig = p.brand.senderName.split(" ")[0];
  return withFallback(
    () =>
      structured({
        system: `You write short follow-ups to unanswered creator outreach from ${p.brand.senderName} at ${p.brand.name}.
Rules: under 50 words, plain text, no subject line. Don't repeat the first email or guilt-trip ("just bumping this", "did you see my email"). Add one new, concrete reason to reply — follow-up 1: how simple the first video is (they film one short video from a brief, we review it, they post); follow-up 2: a polite last note that makes it easy to say no. Restate pay in one short clause. End with a yes/no question. Sign with "${sig}".`,
        prompt: `Creator: ${p.creatorName}\nFollow-up number: ${p.step}\nPay: ${usd(p.baseCents)} per video + ${usd(p.cpmCents)} per 1,000 views\nFirst email:\n"""${p.originalBody}"""`,
        schema: z.object({ body: z.string() }),
      }),
    () => ({
      body:
        p.step === 1
          ? `Hi ${first}, quick follow-up on this. It's one short video from a brief: you film it, we give a quick review, you post. ${usd(p.baseCents)} per video plus ${usd(p.cpmCents)} per 1,000 views. Want me to send a sample brief?\n\n${sig}`
          : `Hi ${first}, last note from me. If paid videos for ${p.brand.name} aren't a fit right now, no worries at all. If they are, reply "yes" and I'll send the brief.\n\n${sig}`,
    }),
  );
}

// ─── Reply triage ───────────────────────────────────────────────────────────

export async function triageReply(p: { brand: Brand; creatorName: string; reply: string; baseCents: number; cpmCents: number }) {
  const first = p.creatorName.split(" ")[0];
  const template = (label: ReplyClass) => {
    const sig = p.brand.senderName.split(" ")[0];
    const drafts: Record<ReplyClass, string> = {
      interested: `Great to hear, ${first}. Easiest next step is a quick 15-minute call so I can walk you through the brief and how payouts work: ${p.brand.bookingUrl}\n\n${sig}`,
      rates: `Thanks ${first}. Our standard rate is ${usd(p.baseCents)} per approved video plus ${usd(p.cpmCents)} per 1,000 views (first 14 days), with bonuses at view milestones. Creators who perform move up to higher tiers. Happy to talk it through: ${p.brand.bookingUrl}\n\n${sig}`,
      not_interested: `No problem at all, ${first} — thanks for getting back to me. Best of luck with your content.\n\n${sig}`,
      other: `Thanks for the reply, ${first}. Happy to answer any questions — or grab a time here if a quick call is easier: ${p.brand.bookingUrl}\n\n${sig}`,
    };
    return drafts[label];
  };
  return withFallback(
    () =>
      structured({
        system: `You triage replies to creator outreach for ${p.brand.name} and draft the response from ${p.brand.senderName}.
Labels: interested (wants to proceed), rates (asking about pay or negotiating), not_interested (declines), other.
Draft rules: under 80 words, warm and direct. For interested or rates, include the booking link ${p.brand.bookingUrl} to book a call. Our rate: ${usd(p.baseCents)}/video + ${usd(p.cpmCents)} per 1K views; never promise more. For not_interested, a gracious one-liner, no link. Sign with the sender's first name.`,
        prompt: `Creator: ${p.creatorName}\nTheir reply:\n"""${p.reply}"""`,
        schema: z.object({ label: z.enum(["interested", "rates", "not_interested", "other"]), draft: z.string() }),
      }),
    () => {
      const { label } = classifyReply(p.reply);
      return { label, draft: template(label) };
    },
  );
}

// ─── Creative engine ────────────────────────────────────────────────────────

export async function writeVariations(p: { brand: Brand; hook: string; transcript: string; format: string; count: number }) {
  return withFallback(
    () =>
      structured({
        system: `You are a short-form UGC strategist for ${p.brand.name} (${p.brand.product}: ${p.brand.valueProp}).
A video just broke out. Write variations other creators can film today. Each must keep what made it work (the hook mechanism, format, pacing) but use different wording, a different scenario, and a different opening line — never a word-for-word copy. Scripts are 15–35 seconds spoken, first person, natural. Only use claims from this list: ${p.brand.allowedClaims.join("; ")}. Never claim long-term use.`,
        prompt: `Format: ${p.format}\nOriginal hook: ${p.hook}\nOriginal transcript:\n"""${p.transcript}"""\n\nWrite ${p.count} variations.`,
        schema: z.object({
          variations: z.array(z.object({ hook: z.string(), script: z.string(), onScreenText: z.string() })),
        }),
        effort: "medium",
        maxTokens: 12000,
      }),
    () => ({
      variations: Array.from({ length: p.count }, (_, i): Variation => {
        const angles = ["a skeptic's first try", "a busy morning", "a side-by-side comparison", "a friend's reaction", "a mistake I used to make", "a 3-day check-in", "a grocery store moment", "a myth I believed"];
        const angle = angles[i % angles.length];
        return {
          hook: `${p.hook.split(/[.!?]/)[0]} — but ${angle}`,
          script: `[Variation on "${p.format}" told through ${angle}]\nOpen on the hook, show the problem in 3 seconds, show ${p.brand.product} solving it on screen, end with your honest reaction.`,
          onScreenText: angle,
        };
      }),
    }),
  );
}

export async function writeBrief(p: { brand: Brand; creatorName: string; format: string; exampleHook?: string | null; exampleTranscript?: string | null; kind: "proven" | "test" }) {
  return withFallback(
    () =>
      structured({
        system: `You write daily video briefs for UGC creators working with ${p.brand.name} (${p.brand.product}: ${p.brand.valueProp}).
Each brief: one scroll-stopping hook (under 12 words), a 20–35 second first-person script, and a 4–7 step shot list. Allowed claims only: ${p.brand.allowedClaims.join("; ")}. ${p.kind === "proven" ? "This is a proven format — stay close to the structure of the example but write fresh words." : "This is a test of a new format — be inventive within the format."}`,
        prompt: `Creator: ${p.creatorName}\nFormat: ${p.format}\n${p.exampleHook ? `Example hook that worked: ${p.exampleHook}\n` : ""}${p.exampleTranscript ? `Example transcript:\n"""${p.exampleTranscript}"""` : ""}`,
        schema: z.object({ hook: z.string(), script: z.string(), shotList: z.array(z.string()) }),
      }),
    () => ({
      hook: p.exampleHook ? `Write your own hook in the style of: “${p.exampleHook.split(/[.!?]/)[0]}”` : `I tried ${p.brand.product} so you don't have to`,
      script: `Hook (0–3s): say the hook straight to camera.\nProblem (3–8s): the annoying thing ${p.brand.product} fixes.\nDemo (8–25s): show it working on your phone.\nReaction (25–30s): your honest take. Mention the link in bio.`,
      shotList: ["Face-cam hook, tight framing", "B-roll of the problem", "Screen recording of the app", "Over-the-shoulder demo", "Face-cam reaction"],
    }),
  );
}

export async function tagHook(p: { transcript: string; caption: string }) {
  return withFallback(
    () =>
      structured({
        system: `Tag a short-form video for a hook bank. hookText: the first spoken line (or on-screen hook). hookType: one of question, pov, contrarian, story, list, challenge, before_after, tutorial, reaction, stat. format: a short reusable name for the video format (e.g. "Green screen reaction", "POV skit", "Street interview", "Day in my life", "Tier list").`,
        prompt: `Caption: ${p.caption}\nTranscript:\n"""${p.transcript}"""`,
        schema: z.object({ hookText: z.string(), hookType: z.string(), format: z.string() }),
      }),
    () => {
      const first = (p.transcript || p.caption).split(/(?<=[.!?])\s/)[0].slice(0, 120);
      const t = first.toLowerCase();
      const hookType = t.startsWith("pov") ? "pov" : t.includes("?") ? "question" : /^(stop|don't|nobody)/.test(t) ? "contrarian" : /\d/.test(t) ? "list" : "story";
      return { hookText: first, hookType, format: hookType === "pov" ? "POV skit" : "Talking head" };
    },
  );
}

// ─── Compliance (AI pass on top of deterministic checks) ────────────────────

export async function aiComplianceReview(p: { brand: Brand; caption: string; transcript: string; daysWithProduct: number | null }): Promise<ComplianceCheck | null> {
  if (!aiEnabled()) return null;
  try {
    const r = await structured({
      system: `You review UGC posts for ${p.brand.name} before they go live, for FTC and platform compliance. Approved claims: ${p.brand.allowedClaims.join("; ")}. Flag: unapproved or exaggerated product claims (health, earnings, guarantees, superlatives), implied long-term experience the creator can't have (they've had the product ${p.daysWithProduct ?? "an unknown number of"} days), unclear or buried disclosure, and anything misleading. Be specific and brief. status "pass" if nothing material, "warn" if borderline, "fail" if it must change.`,
      prompt: `Caption:\n${p.caption}\n\nTranscript:\n${p.transcript}`,
      schema: z.object({ status: z.enum(["pass", "warn", "fail"]), issues: z.array(z.string()) }),
    });
    return {
      key: "ai_review",
      label: "AI review",
      status: r.status,
      detail: r.issues.length ? r.issues.join(" · ") : "No issues found.",
    };
  } catch (e) {
    console.error("[ai] compliance review failed:", e);
    return { key: "ai_review", label: "AI review", status: "warn", detail: "AI review failed — review manually." };
  }
}
