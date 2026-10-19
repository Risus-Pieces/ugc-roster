import { cv, median, clamp, round } from "./stats";
import type { PostSample } from "./creator-score";

export type AuthenticityInput = {
  followers: number;
  posts: (PostSample & { caption?: string | null; sampleComments?: string[] | null })[];
};

export type AuthenticityResult = {
  score: number; // 0–100
  verdict: "pass" | "review" | "fail";
  flags: string[];
  commentQuality: number; // 0–1
  viewFollowerRatio: number;
  engagementRate: number;
};

const GENERIC = [
  /^(nice|cool|wow|great|love (it|this)|amazing|awesome|beautiful|so good|fire|lit|omg|lol|first)[!. ]*$/i,
  /\b(follow (me|back)|check (my|ur) (page|dm|bio)|dm (me|us)|promo|collab\?|f4f|l4l|sub4sub)\b/i,
  /\b(great (post|content|video)|keep it up|nice (post|content|video))\b/i,
];
const EMOJI_ONLY = /^[\p{Extended_Pictographic}\p{Emoji_Component}\s]+$/u;

function tokens(s: string) {
  return s
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter((w) => w.length > 3);
}

/** Share of comments that are specific to the content (not generic, emoji-only, or duplicated). */
export function commentQuality(comments: string[], caption = ""): { quality: number; duplicateRate: number; genericRate: number } {
  const cleaned = comments.map((c) => c.trim()).filter(Boolean);
  if (cleaned.length === 0) return { quality: 0.5, duplicateRate: 0, genericRate: 0 };

  const counts = new Map<string, number>();
  for (const c of cleaned) counts.set(c.toLowerCase(), (counts.get(c.toLowerCase()) ?? 0) + 1);
  const duplicates = [...counts.values()].filter((n) => n > 1).reduce((a, n) => a + n, 0);

  const captionTokens = new Set(tokens(caption));
  let generic = 0;
  let specific = 0;
  for (const c of cleaned) {
    const isGeneric = EMOJI_ONLY.test(c) || GENERIC.some((re) => re.test(c)) || c.split(/\s+/).length < 2;
    if (isGeneric) generic++;
    else {
      const t = tokens(c);
      // Long comments, questions, or ones that reference the video's topic count as real.
      if (t.length >= 4 || c.includes("?") || t.some((w) => captionTokens.has(w))) specific++;
      else specific += 0.5;
    }
  }
  const duplicateRate = duplicates / cleaned.length;
  const genericRate = generic / cleaned.length;
  const quality = clamp(specific / cleaned.length - duplicateRate * 0.5, 0, 1);
  return { quality: round(quality, 2), duplicateRate: round(duplicateRate, 2), genericRate: round(genericRate, 2) };
}

/**
 * Is the audience real? Combines views vs followers, engagement shape, comment quality
 * and view uniformity into a 0–100 score with human-readable flags.
 */
export function assessAuthenticity({ followers, posts }: AuthenticityInput): AuthenticityResult {
  const flags: string[] = [];
  let score = 100;

  const views = posts.map((p) => p.views);
  const medViews = median(views);
  const viewFollowerRatio = followers > 0 ? medViews / followers : 0;
  const totalViews = views.reduce((a, v) => a + v, 0);
  const likes = posts.reduce((a, p) => a + p.likes, 0);
  const comments = posts.reduce((a, p) => a + p.comments, 0);
  const shares = posts.reduce((a, p) => a + p.shares, 0);
  const engagementRate = totalViews > 0 ? (likes + comments + shares) / totalViews : 0;

  // 1. Views compared to followers
  if (viewFollowerRatio < 0.03) {
    score -= 30;
    flags.push(`Median views are only ${(viewFollowerRatio * 100).toFixed(1)}% of followers — followers may be bought or inactive`);
  } else if (viewFollowerRatio < 0.08) {
    score -= 12;
    flags.push(`Low views-to-followers (${(viewFollowerRatio * 100).toFixed(1)}%)`);
  }

  // 2. Engagement shape
  if (totalViews > 0) {
    if (engagementRate < 0.01) {
      score -= 20;
      flags.push(`Very low engagement (${(engagementRate * 100).toFixed(2)}%) — views may be botted`);
    } else if (engagementRate > 0.3) {
      score -= 15;
      flags.push(`Unusually high engagement (${(engagementRate * 100).toFixed(1)}%) — possible engagement pods or bought likes`);
    }
    if (comments > 0 && likes / comments > 400) {
      score -= 10;
      flags.push(`Likes-to-comments ratio of ${Math.round(likes / comments)}:1 suggests bought likes`);
    }
  }

  // 3. Suspiciously uniform views (bought view packages land on round, similar numbers)
  if (views.length >= 8 && cv(views) < 0.12) {
    score -= 15;
    flags.push("Views are suspiciously uniform across posts");
  }

  // 4. Comment quality
  const allComments = posts.flatMap((p) => p.sampleComments ?? []);
  const captions = posts.map((p) => p.caption ?? "").join(" ");
  const cq = commentQuality(allComments, captions);
  if (allComments.length >= 10) {
    if (cq.quality < 0.25) {
      score -= 20;
      flags.push(`Comments are mostly generic or emoji-only (${Math.round(cq.genericRate * 100)}% generic)`);
    } else if (cq.quality < 0.45) {
      score -= 8;
      flags.push("Comment quality is mixed");
    }
    // Duplicates are measured within each post: bot farms repeat the same comment under one video,
    // while real fans repeating "🔥" across different videos is normal.
    const perPost = posts.map((p) => p.sampleComments ?? []).filter((c) => c.length >= 4).map((c) => commentQuality(c).duplicateRate);
    const dupRate = perPost.length ? perPost.reduce((a, b) => a + b, 0) / perPost.length : 0;
    if (dupRate > 0.25) {
      score -= 10;
      flags.push(`${Math.round(dupRate * 100)}% of comments under each video are duplicates — common bot pattern`);
    }
  } else {
    flags.push("Not enough comments sampled to judge comment quality");
  }

  if (posts.length < 10) flags.push(`Small sample (${posts.length} posts)`);

  score = clamp(Math.round(score), 0, 100);
  const verdict = score >= 75 ? "pass" : score >= 50 ? "review" : "fail";
  return {
    score,
    verdict,
    flags,
    commentQuality: cq.quality,
    viewFollowerRatio: round(viewFollowerRatio, 3),
    engagementRate: round(engagementRate, 4),
  };
}
