export type ReplyClass = "interested" | "rates" | "not_interested" | "other";

const NOT_INTERESTED = [
  /\bnot (interested|a fit|for me|right now)\b/i,
  /\bno,? thanks?\b/i,
  /\b(unsubscribe|remove me|stop emailing|please stop)\b/i,
  /\b(i'?ll|i will|gonna) pass\b/i,
  /\bdon'?t (do|accept) (brand deals|sponsorships|ugc)\b/i,
  /\bnot taking (on )?(new )?(partnerships|deals|collabs)\b/i,
];
const RATES = [
  /\b(rates?|pricing|price|budget|compensation|how much|per video|per post|flat fee|cpm|payment terms|what.{0,10}pay)\b/i,
  /\$\s?\d/,
  /\bmy (rate|fee|media kit)\b/i,
];
const INTERESTED = [
  /\b(interested|i'?m in|count me in|sounds (good|great|fun|awesome)|love to|would love|happy to|let'?s (do it|chat|talk|go)|i'?m down|sign me up|yes|yeah|absolutely|definitely|for sure)\b/i,
  /\b(send|share) (me )?(the )?(details|brief|contract|info)\b/i,
  /\bwhen can (we|i) start\b/i,
];

/**
 * Rule-based fallback for sorting outreach replies. The AI classifier is used when
 * configured; this keeps the inbox usable without it and serves as a sanity check.
 */
export function classifyReply(text: string): { label: ReplyClass; confidence: number } {
  // Ignore quoted history in replies
  const body = text.split(/\n\s*(?:on .+wrote:|>|-{2,}\s*original message)/i)[0];
  if (NOT_INTERESTED.some((r) => r.test(body))) return { label: "not_interested", confidence: 0.85 };
  const rates = RATES.some((r) => r.test(body));
  const interested = INTERESTED.some((r) => r.test(body));
  if (rates) return { label: "rates", confidence: interested ? 0.8 : 0.75 };
  if (interested) return { label: "interested", confidence: 0.75 };
  return { label: "other", confidence: 0.4 };
}
