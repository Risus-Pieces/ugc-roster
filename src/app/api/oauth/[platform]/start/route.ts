import { NextResponse, type NextRequest } from "next/server";
import { PLATFORMS, type Platform } from "@/db";
import { connectedProviders } from "@/lib/integrations/platforms";
import { creatorByPortalToken, signOAuthState } from "@/lib/services/onboarding";

/**
 * Step 1 of the official platform login. Validates the creator's portal token, signs a short-lived
 * `state` (creator + platform + nonce + expiry, HMAC-SHA256) and sends them to the platform's own
 * consent screen. The nonce is also set as an httpOnly cookie so the callback only completes in the
 * browser that started it.
 */
export async function GET(req: NextRequest, ctx: { params: Promise<{ platform: string }> }) {
  const { platform } = await ctx.params;
  const origin = (process.env.APP_URL ?? req.nextUrl.origin).replace(/\/$/, "");
  const creator = await creatorByPortalToken(req.nextUrl.searchParams.get("token"));
  if (!creator) return new NextResponse("This link isn't valid. Open your creator page and try again.", { status: 404, headers: { "content-type": "text/plain; charset=utf-8" } });

  const back = (error: string) => NextResponse.redirect(new URL(`/c/${creator.portalToken}?error=${error}#accounts`, origin));
  if (!(PLATFORMS as readonly string[]).includes(platform)) return back("failed");
  const p = platform as Platform;
  const provider = connectedProviders[p];
  if (!provider.configured()) return back("not_configured");

  const { state, nonce } = signOAuthState({ creatorId: creator.id, platform: p });
  let url: string;
  try {
    url = provider.authorizeUrl(state, `${origin}/api/oauth/${p}/callback`);
  } catch (e) {
    console.error(`[oauth] ${p} authorizeUrl failed:`, e);
    return back("failed");
  }
  const res = NextResponse.redirect(url);
  res.cookies.set("oauth_nonce", nonce, { httpOnly: true, sameSite: "lax", secure: origin.startsWith("https://"), path: `/api/oauth/${p}`, maxAge: 10 * 60 });
  return res;
}
