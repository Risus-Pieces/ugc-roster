import { NextResponse, type NextRequest } from "next/server";
import { creatorByPromoCode, recordLinkEvent } from "@/lib/integrations/revenue";
import { getBrand } from "@/lib/settings";
import { creatorLink } from "@/lib/engines/signups";

// Link unfurlers and crawlers shouldn't count as clicks.
const BOT = /bot|crawl|spider|slurp|preview|facebookexternalhit|embedly|whatsapp|telegram|discord|skype|curl\/|wget|python-requests|headless/i;

/**
 * Tracking link /r/<PROMOCODE>: log a click for the creator and forward to their site link
 * (<app URL>/go/<code>), which tags the waitlist signup. Never ?ref=: on the Sooz site that's the
 * friend-referral program. Unknown codes go to the app URL, untagged.
 */
export async function GET(req: NextRequest, ctx: { params: Promise<{ code: string }> }) {
  return handle(req, ctx, true);
}

export async function HEAD(req: NextRequest, ctx: { params: Promise<{ code: string }> }) {
  return handle(req, ctx, false);
}

async function handle(req: NextRequest, ctx: { params: Promise<{ code: string }> }, count: boolean) {
  const { code } = await ctx.params;
  const brand = await getBrand();
  let dest: URL;
  try {
    dest = new URL(brand.appUrl);
  } catch {
    dest = new URL("/", req.nextUrl.origin);
  }

  const clean = code.trim().toUpperCase().replace(/[^A-Z0-9_-]/g, "").slice(0, 40);
  const creator = clean ? await creatorByPromoCode(clean) : undefined;
  if (creator?.promoCode) {
    dest = new URL(creatorLink(dest.toString(), creator.promoCode));
    if (count && !BOT.test(req.headers.get("user-agent") ?? "")) {
      try {
        await recordLinkEvent(creator.id, "link_click");
      } catch (e) {
        console.error("[r] failed to record click", e); // never block the redirect
      }
    }
  }
  const res = NextResponse.redirect(dest, 302);
  res.headers.set("Cache-Control", "no-store");
  return res;
}
