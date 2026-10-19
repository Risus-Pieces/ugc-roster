import { timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { and, eq } from "drizzle-orm";
import { db, creatorAccounts, creators } from "@/db";
import { connectedProviders } from "@/lib/integrations/platforms";
import { saveConnection, verifyOAuthState } from "@/lib/services/onboarding";
import { syncAccount } from "@/lib/services/tracking";

const sameNonce = (a: string | undefined, b: string) => {
  if (!a) return false;
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};

function page(message: string, status = 400) {
  const html = `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>Connection failed</title><body style="font-family:system-ui,sans-serif;max-width:32rem;margin:4rem auto;padding:0 1rem;line-height:1.5"><h1 style="font-size:1.25rem">We couldn't connect your account</h1><p>${message}</p></body>`;
  return new NextResponse(html, { status, headers: { "content-type": "text/html; charset=utf-8" } });
}

/**
 * Step 2: the platform sends the creator back here with `code` + `state` (or `error`). Verify the
 * signed state and the nonce cookie, exchange the code, save encrypted tokens, pull stats once,
 * and return the creator to their portal.
 */
export async function GET(req: NextRequest, ctx: { params: Promise<{ platform: string }> }) {
  const { platform } = await ctx.params;
  const origin = (process.env.APP_URL ?? req.nextUrl.origin).replace(/\/$/, "");
  const sp = req.nextUrl.searchParams;

  const verified = verifyOAuthState(sp.get("state"));
  if (!verified || verified.payload.platform !== platform) return page("This login link isn't valid. Go back to your creator page and press the connect button again.");
  const { payload } = verified;
  const creator = await db.query.creators.findFirst({ where: eq(creators.id, payload.creatorId) });
  if (!creator) return page("We couldn't find your creator page. Ask your contact for a new link.", 404);

  const back = (query: string) => {
    const res = NextResponse.redirect(new URL(`/c/${creator.portalToken}?${query}#accounts`, origin));
    res.cookies.set("oauth_nonce", "", { path: `/api/oauth/${platform}`, maxAge: 0 });
    return res;
  };

  // The creator cancelled, or the platform refused.
  const providerError = sp.get("error") ?? sp.get("error_code");
  if (providerError) {
    const denied = /denied|cancel/i.test(`${providerError} ${sp.get("error_reason") ?? ""} ${sp.get("error_description") ?? ""}`);
    if (!denied) console.error(`[oauth] ${platform} returned an error:`, providerError, sp.get("error_description"));
    return back(`error=${denied ? "denied" : "failed"}`);
  }
  if (verified.expired) return back("error=expired");
  if (!connectedProviders[payload.platform].configured()) return back("error=not_configured");
  if (!sameNonce(req.cookies.get("oauth_nonce")?.value, payload.nonce)) return back("error=device");
  const code = sp.get("code");
  if (!code) return back("error=failed");

  try {
    const tokens = await connectedProviders[payload.platform].exchangeCode(code, `${origin}/api/oauth/${payload.platform}/callback`);
    await saveConnection({ creatorId: creator.id, platform: payload.platform, tokens: { accessToken: tokens.accessToken, refreshToken: tokens.refreshToken, expiresAt: tokens.expiresAt } });
  } catch (e) {
    console.error(`[oauth] ${platform} connection failed:`, e);
    return back("error=failed");
  }

  // First sync is best-effort: the account is connected either way and the next scheduled sync retries.
  try {
    const acct = await db.query.creatorAccounts.findFirst({ where: and(eq(creatorAccounts.creatorId, creator.id), eq(creatorAccounts.platform, payload.platform)) });
    if (acct) await syncAccount(acct.id);
  } catch (e) {
    console.error(`[oauth] first ${platform} sync failed:`, e);
  }
  return back(`connected=${payload.platform}`);
}
