import type { ConnectedProvider, DiscoveredCreator, DiscoveredPost, DiscoveryProvider } from "./types";

const API = "https://www.googleapis.com/youtube/v3";

async function yt<T>(path: string, params: Record<string, string>, token?: string): Promise<T> {
  const url = new URL(`${API}/${path}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  if (!token) url.searchParams.set("key", process.env.YOUTUBE_API_KEY!);
  const res = await fetch(url, { headers: token ? { Authorization: `Bearer ${token}` } : {}, cache: "no-store" });
  if (!res.ok) throw new Error(`YouTube ${path} ${res.status}: ${await res.text()}`);
  return res.json() as Promise<T>;
}

type VideoItem = {
  id: string;
  snippet: { title: string; description: string; publishedAt: string };
  statistics: { viewCount?: string; likeCount?: string; commentCount?: string };
  paidProductPlacementDetails?: { hasPaidProductPlacement?: boolean };
};

const toPost = (v: VideoItem): DiscoveredPost => ({
  externalId: v.id,
  url: `https://www.youtube.com/watch?v=${v.id}`,
  caption: `${v.snippet.title}\n${v.snippet.description}`.slice(0, 2000),
  postedAt: new Date(v.snippet.publishedAt),
  views: Number(v.statistics.viewCount ?? 0),
  likes: Number(v.statistics.likeCount ?? 0),
  comments: Number(v.statistics.commentCount ?? 0),
  shares: 0, // not exposed by the Data API
  saves: 0,
  isPaidPartnership: v.paidProductPlacementDetails?.hasPaidProductPlacement ?? false,
});

async function recentUploads(channelId: string, token?: string, max = 30) {
  const uploads = "UU" + channelId.slice(2); // uploads playlist id
  const list = await yt<{ items: { contentDetails: { videoId: string } }[] }>("playlistItems", { part: "contentDetails", playlistId: uploads, maxResults: String(max) }, token);
  const ids = list.items.map((i) => i.contentDetails.videoId);
  if (!ids.length) return [];
  const vids = await yt<{ items: VideoItem[] }>("videos", { part: "snippet,statistics,paidProductPlacementDetails", id: ids.join(",") }, token);
  return vids.items.map(toPost);
}

async function topComments(videoId: string): Promise<string[]> {
  try {
    const r = await yt<{ items: { snippet: { topLevelComment: { snippet: { textOriginal: string } } } }[] }>("commentThreads", {
      part: "snippet",
      videoId,
      maxResults: "20",
      order: "relevance",
      textFormat: "plainText",
    });
    return r.items.map((i) => i.snippet.topLevelComment.snippet.textOriginal);
  } catch {
    return []; // comments disabled
  }
}

/**
 * Official keyword discovery via the YouTube Data API (search.list costs 100 quota units;
 * default quota is 10,000/day, so ~80 keyword searches/day after the follow-up calls).
 */
export const youtubeDiscovery: DiscoveryProvider = {
  platform: "youtube",
  name: "YouTube Data API",
  live: true,
  async search(keyword, opts) {
    const search = await yt<{ items: { snippet: { channelId: string } }[] }>("search", {
      part: "snippet",
      q: keyword,
      type: "video",
      videoDuration: "short",
      order: "relevance",
      maxResults: "50",
      publishedAfter: new Date(Date.now() - 60 * 86_400_000).toISOString(),
    });
    const channelIds = [...new Set(search.items.map((i) => i.snippet.channelId))].slice(0, 50);
    if (!channelIds.length) return [];
    const channels = await yt<{
      items: { id: string; snippet: { title: string; description: string; customUrl?: string; country?: string }; statistics: { subscriberCount?: string; hiddenSubscriberCount?: boolean } }[];
    }>("channels", { part: "snippet,statistics", id: channelIds.join(",") });

    const inBand = channels.items.filter((c) => {
      const subs = Number(c.statistics.subscriberCount ?? 0);
      return !c.statistics.hiddenSubscriberCount && subs >= opts.minFollowers && subs <= opts.maxFollowers;
    });

    const out: DiscoveredCreator[] = [];
    for (const c of inBand.slice(0, opts.limit)) {
      const posts = await recentUploads(c.id);
      // Sample comments from 3 recent videos for the authenticity check
      for (const p of posts.slice(0, 3)) p.sampleComments = await topComments(p.externalId);
      out.push({
        platform: "youtube",
        handle: (c.snippet.customUrl ?? c.id).replace(/^@/, ""),
        platformUserId: c.id,
        name: c.snippet.title,
        bio: c.snippet.description,
        followers: Number(c.statistics.subscriberCount ?? 0),
        url: `https://www.youtube.com/channel/${c.id}`,
        country: c.snippet.country,
        posts,
      });
    }
    return out;
  },
};

/** Creator connects with Google sign-in; we read their channel with youtube.readonly. */
export const youtubeConnected: ConnectedProvider = {
  platform: "youtube",
  configured: () => Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET),
  authorizeUrl(state, redirectUri) {
    const u = new URL("https://accounts.google.com/o/oauth2/v2/auth");
    u.search = new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID!,
      redirect_uri: redirectUri,
      response_type: "code",
      scope: "https://www.googleapis.com/auth/youtube.readonly https://www.googleapis.com/auth/yt-analytics.readonly",
      access_type: "offline",
      prompt: "consent",
      state,
    }).toString();
    return u.toString();
  },
  async exchangeCode(code, redirectUri) {
    const res = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ code, client_id: process.env.GOOGLE_CLIENT_ID!, client_secret: process.env.GOOGLE_CLIENT_SECRET!, redirect_uri: redirectUri, grant_type: "authorization_code" }),
    });
    if (!res.ok) throw new Error(`Google token exchange failed: ${await res.text()}`);
    const t = await res.json();
    return { accessToken: t.access_token, refreshToken: t.refresh_token, expiresAt: new Date(Date.now() + t.expires_in * 1000) };
  },
  async refresh(refreshToken) {
    const res = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ refresh_token: refreshToken, client_id: process.env.GOOGLE_CLIENT_ID!, client_secret: process.env.GOOGLE_CLIENT_SECRET!, grant_type: "refresh_token" }),
    });
    if (!res.ok) throw new Error(`Google refresh failed: ${await res.text()}`);
    const t = await res.json();
    return { accessToken: t.access_token, refreshToken, expiresAt: new Date(Date.now() + t.expires_in * 1000) };
  },
  async profile(token) {
    const r = await yt<{ items: { id: string; snippet: { title: string; description: string; customUrl?: string }; statistics: { subscriberCount?: string } }[] }>(
      "channels",
      { part: "snippet,statistics", mine: "true" },
      token,
    );
    const c = r.items[0];
    if (!c) throw new Error("No YouTube channel on this Google account");
    return { handle: (c.snippet.customUrl ?? c.id).replace(/^@/, ""), platformUserId: c.id, followers: Number(c.statistics.subscriberCount ?? 0), bio: c.snippet.description, name: c.snippet.title };
  },
  async recentPosts(token, channelId) {
    const posts = await recentUploads(channelId, token);
    // Paid views: YouTube Analytics traffic source ADVERTISING, per video.
    try {
      const end = new Date().toISOString().slice(0, 10);
      const start = new Date(Date.now() - 60 * 86_400_000).toISOString().slice(0, 10);
      const url = new URL("https://youtubeanalytics.googleapis.com/v2/reports");
      url.search = new URLSearchParams({
        ids: "channel==MINE",
        startDate: start,
        endDate: end,
        metrics: "views,shares",
        dimensions: "video,insightTrafficSourceType",
        filters: `video==${posts.map((p) => p.externalId).join(",")}`,
      }).toString();
      const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
      if (res.ok) {
        const data = (await res.json()) as { rows?: [string, string, number, number][] };
        for (const [video, source, views, shares] of data.rows ?? []) {
          const p = posts.find((x) => x.externalId === video);
          if (!p) continue;
          p.shares += shares;
          if (source === "ADVERTISING") p.paidViews = (p.paidViews ?? 0) + views;
        }
      }
    } catch (e) {
      console.error("[youtube] analytics failed", e);
    }
    return posts;
  },
};
