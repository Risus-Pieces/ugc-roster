/**
 * Per-video views from TikTok's public creator embed (tiktok.com/embed/@handle), the widget other
 * sites use to show a creator's recent videos. It lists about 12 videos with their play counts.
 */
import { typicalViews, type TypicalViews } from "./creator-score";

export type EmbedVideo = { id: string; views: number; postedAt: Date; pinned: boolean };
export type EmbedProfile = { found: boolean; privateAccount: boolean; followers: number | null; videos: EmbedVideo[] };

const NETWORK_CODES = new Set(["ENOTFOUND", "EAI_AGAIN", "ECONNRESET", "ECONNREFUSED", "ETIMEDOUT", "ENETUNREACH", "EHOSTUNREACH", "EPIPE", "UND_ERR_CONNECT_TIMEOUT", "UND_ERR_SOCKET"]);

/** Did the connection itself fail? fetch and the database wrap the real error, so it's checked down the chain of causes. */
export function networkDropped(e: unknown): boolean {
  for (let err = e; err instanceof Error; err = err.cause) {
    if (err.name === "TimeoutError" || NETWORK_CODES.has((err as NodeJS.ErrnoException).code ?? "") || err.message.includes("Connection terminated")) return true;
  }
  return false;
}

/** TikTok video IDs start with the upload time: the top bits are Unix seconds. */
export const postDateFromVideoId = (id: string) => new Date(Number(BigInt(id) >> BigInt(32)) * 1000);

type RawVideo = { id?: string; playCount?: number; privateItem?: boolean };

/** Null means the page wasn't the embed at all (a refusal or challenge page), which isn't the same as no videos. */
export function parseTikTokEmbed(html: string): EmbedProfile | null {
  const script = html.match(/<script[^>]*id="__FRONTITY_CONNECT_STATE__"[^>]*>([\s\S]*?)<\/script>/);
  if (!script) return null;
  let pages: Record<string, { errorStatus?: number; userInfo?: { followerCount?: number; privateAccount?: boolean }; videoList?: RawVideo[] }>;
  try {
    pages = JSON.parse(script[1]).source.data;
  } catch {
    return null;
  }
  const page = Object.entries(pages).find(([path]) => path.startsWith("/embed/@"))?.[1];
  if (!page) return null;
  if (page.errorStatus) return { found: false, privateAccount: false, followers: null, videos: [] };
  const listed = (page.videoList ?? [])
    .filter((v) => v.id && /^\d+$/.test(v.id) && typeof v.playCount === "number" && !v.privateItem)
    .map((v) => ({ id: v.id!, views: v.playCount!, postedAt: postDateFromVideoId(v.id!) }));
  // Pinned videos aren't labelled, but they sit in front of the newest-first list.
  const newest = listed.reduce((best, v, i) => (v.postedAt > listed[best].postedAt ? i : best), 0);
  return {
    found: true,
    privateAccount: Boolean(page.userInfo?.privateAccount),
    followers: page.userInfo?.followerCount ?? null,
    videos: listed.map((v, i) => ({ ...v, pinned: i < newest })),
  };
}

const ENOUGH_SETTLED_VIDEOS = 5;
const YOUNGEST_USABLE_DAYS = 0.5;

/**
 * typicalViews() ignores videos under 3 days old because their views are still climbing, but the embed
 * only reaches back a dozen videos, so a busy poster may have few that old. Then use what's at least
 * 12 hours old and say so. Pinned videos are always left out: they're picked for being hits.
 */
export function typicalFromVideos(videos: EmbedVideo[], now = new Date()): { typical: TypicalViews; includesNewVideos: boolean } {
  const posts = videos.filter((v) => !v.pinned).map((v) => ({ views: v.views, likes: 0, comments: 0, shares: 0, postedAt: v.postedAt }));
  const settled = typicalViews(posts, { now });
  if (settled.sampleSize >= ENOUGH_SETTLED_VIDEOS) return { typical: settled, includesNewVideos: false };
  const recent = typicalViews(posts, { now, minAgeDays: YOUNGEST_USABLE_DAYS });
  return recent.sampleSize > settled.sampleSize ? { typical: recent, includesNewVideos: true } : { typical: settled, includesNewVideos: false };
}
