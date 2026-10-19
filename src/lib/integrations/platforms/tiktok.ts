import type { ConnectedProvider, DiscoveredPost } from "./types";

/**
 * TikTok Login Kit (v2) + Display API. Scopes: user.info.basic, user.info.stats, video.list.
 * Keyword discovery isn't offered to commercial apps (the Research API is academic-only), so
 * discovery uses the TikTok One / Creator Marketplace API if you're a partner, or a data vendor.
 */
export const tiktokConnected: ConnectedProvider = {
  platform: "tiktok",
  configured: () => Boolean(process.env.TIKTOK_CLIENT_KEY && process.env.TIKTOK_CLIENT_SECRET),
  authorizeUrl(state, redirectUri) {
    const u = new URL("https://www.tiktok.com/v2/auth/authorize/");
    u.search = new URLSearchParams({
      client_key: process.env.TIKTOK_CLIENT_KEY!,
      scope: "user.info.basic,user.info.profile,user.info.stats,video.list",
      response_type: "code",
      redirect_uri: redirectUri,
      state,
    }).toString();
    return u.toString();
  },
  async exchangeCode(code, redirectUri) {
    const res = await fetch("https://open.tiktokapis.com/v2/oauth/token/", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_key: process.env.TIKTOK_CLIENT_KEY!,
        client_secret: process.env.TIKTOK_CLIENT_SECRET!,
        code,
        grant_type: "authorization_code",
        redirect_uri: redirectUri,
      }),
    });
    const t = await res.json();
    if (!res.ok || t.error) throw new Error(`TikTok token exchange failed: ${JSON.stringify(t)}`);
    return { accessToken: t.access_token, refreshToken: t.refresh_token, expiresAt: new Date(Date.now() + t.expires_in * 1000), platformUserId: t.open_id };
  },
  async refresh(refreshToken) {
    const res = await fetch("https://open.tiktokapis.com/v2/oauth/token/", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ client_key: process.env.TIKTOK_CLIENT_KEY!, client_secret: process.env.TIKTOK_CLIENT_SECRET!, grant_type: "refresh_token", refresh_token: refreshToken }),
    });
    const t = await res.json();
    if (!res.ok || t.error) throw new Error(`TikTok refresh failed: ${JSON.stringify(t)}`);
    return { accessToken: t.access_token, refreshToken: t.refresh_token, expiresAt: new Date(Date.now() + t.expires_in * 1000) };
  },
  async profile(token) {
    const res = await fetch("https://open.tiktokapis.com/v2/user/info/?fields=open_id,username,display_name,bio_description,follower_count", {
      headers: { Authorization: `Bearer ${token}` },
    });
    const j = await res.json();
    if (!res.ok || j.error?.code !== "ok") throw new Error(`TikTok user info failed: ${JSON.stringify(j.error)}`);
    const u = j.data.user;
    return { handle: u.username, platformUserId: u.open_id, followers: u.follower_count ?? 0, bio: u.bio_description, name: u.display_name };
  },
  async recentPosts(token) {
    const posts: DiscoveredPost[] = [];
    let cursor: number | undefined;
    for (let page = 0; page < 3; page++) {
      const res = await fetch(
        "https://open.tiktokapis.com/v2/video/list/?fields=id,title,video_description,create_time,share_url,view_count,like_count,comment_count,share_count",
        { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ max_count: 20, cursor }) },
      );
      const j = await res.json();
      if (!res.ok || j.error?.code !== "ok") throw new Error(`TikTok video list failed: ${JSON.stringify(j.error)}`);
      for (const v of j.data.videos ?? []) {
        posts.push({
          externalId: v.id,
          url: v.share_url,
          caption: v.video_description || v.title || "",
          postedAt: new Date(v.create_time * 1000),
          views: v.view_count ?? 0,
          likes: v.like_count ?? 0,
          comments: v.comment_count ?? 0,
          shares: v.share_count ?? 0,
          saves: 0, // not exposed by the Display API
        });
      }
      if (!j.data.has_more) break;
      cursor = j.data.cursor;
    }
    return posts;
  },
};
