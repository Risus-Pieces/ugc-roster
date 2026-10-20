import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, isPublicPath, isValidSession } from "@/lib/auth";

/**
 * Signs-in gate for the ops console. Creator-facing pages, webhooks, crons (which check
 * CRON_SECRET themselves) and tracking links stay public.
 */
export async function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  if (isPublicPath(pathname)) return NextResponse.next();

  // Local development without a password stays open; production without one is locked.
  if (!process.env.ADMIN_PASSWORD && process.env.NODE_ENV !== "production") return NextResponse.next();

  if (await isValidSession(request.cookies.get(SESSION_COOKIE)?.value)) return NextResponse.next();

  if (request.method !== "GET" && request.method !== "HEAD") {
    return NextResponse.json({ error: "Sign in to use the console." }, { status: 401 });
  }
  const login = new URL("/login", request.url);
  if (pathname !== "/") login.searchParams.set("next", pathname + search);
  return NextResponse.redirect(login);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)"],
};
