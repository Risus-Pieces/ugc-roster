import type { ConnectedProvider, DiscoveredPost } from "./types";

const GRAPH = "https://graph.instagram.com/v23.0";

/**
 * Instagram API with Instagram Login (professional accounts).
 * Scopes: instagram_business_basic, instagram_business_manage_insights.
 * Keyword discovery isn't available officially; Business Discovery only looks up known usernames.
 */
export const instagramConnected: ConnectedProvider = {
  platform: "instagram",
  configured: () => Boolean(process.env.INSTAGRAM_APP_ID && process.env.INSTAGRAM_APP_SECRET),
  authorizeUrl(state, redirectUri) {
    const u = new URL("https://www.instagram.com/oauth/authorize");
    u.search = new URLSearchParams({
      client_id: process.env.INSTAGRAM_APP_ID!,
      redirect_uri: redirectUri,
      response_type: "code",
      scope: "instagram_business_basic,instagram_business_manage_insights",
      state,
    }).toString();
    return u.toString();
  },
  async exchangeCode(code, redirectUri) {
    const res = await fetch("https://api.instagram.com/oauth/access_token", {
      method: "POST",
      body: new URLSearchParams({
        client_id: process.env.INSTAGRAM_APP_ID!,
        client_secret: process.env.INSTAGRAM_APP_SECRET!,
        grant_type: "authorization_code",
        redirect_uri: redirectUri,
        code,
      }),
    });
    const short = await res.json();
    if (!res.ok) throw new Error(`Instagram token exchange failed: ${JSON.stringify(short)}`);
    // Swap for a 60-day long-lived token
    const ll = await fetch(`https://graph.instagram.com/access_token?grant_type=ig_exchange_token&client_secret=${process.env.INSTAGRAM_APP_SECRET}&access_token=${short.access_token}`);
    const t = await ll.json();
    if (!ll.ok) throw new Error(`Instagram long-lived token failed: ${JSON.stringify(t)}`);
    return { accessToken: t.access_token, expiresAt: new Date(Date.now() + t.expires_in * 1000), platformUserId: String(short.user_id) };
  },
  async refresh(token) {
    const res = await fetch(`https://graph.instagram.com/refresh_access_token?grant_type=ig_refresh_token&access_token=${token}`);
    const t = await res.json();
    if (!res.ok) throw new Error(`Instagram refresh failed: ${JSON.stringify(t)}`);
    return { accessToken: t.access_token, expiresAt: new Date(Date.now() + t.expires_in * 1000) };
  },
  async profile(token) {
    const res = await fetch(`${GRAPH}/me?fields=user_id,username,name,biography,followers_count&access_token=${token}`);
    const u = await res.json();
    if (!res.ok) throw new Error(`Instagram profile failed: ${JSON.stringify(u)}`);
    return { handle: u.username, platformUserId: String(u.user_id), followers: u.followers_count ?? 0, bio: u.biography, name: u.name };
  },
  async recentPosts(token) {
    const res = await fetch(`${GRAPH}/me/media?fields=id,caption,media_type,media_product_type,permalink,timestamp,like_count,comments_count&limit=30&access_token=${token}`);
    const j = await res.json();
    if (!res.ok) throw new Error(`Instagram media failed: ${JSON.stringify(j)}`);
    const posts: DiscoveredPost[] = [];
    for (const m of j.data ?? []) {
      if (m.media_type !== "VIDEO" && m.media_product_type !== "REELS") continue;
      let views = 0,
        shares = 0,
        saves = 0;
      const ins = await fetch(`${GRAPH}/${m.id}/insights?metric=views,shares,saved&access_token=${token}`);
      if (ins.ok) {
        const data = (await ins.json()).data as { name: string; values: { value: number }[] }[];
        for (const d of data) {
          const v = d.values?.[0]?.value ?? 0;
          if (d.name === "views") views = v;
          if (d.name === "shares") shares = v;
          if (d.name === "saved") saves = v;
        }
      }
      posts.push({
        externalId: m.id,
        url: m.permalink,
        caption: m.caption ?? "",
        postedAt: new Date(m.timestamp),
        views,
        likes: m.like_count ?? 0,
        comments: m.comments_count ?? 0,
        shares,
        saves,
      });
    }
    return posts;
  },
};
