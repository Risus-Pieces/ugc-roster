"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import type { ActionResult } from "@/components/client";
import { SESSION_COOKIE, SESSION_MAX_AGE, safeEqual, sessionToken } from "@/lib/auth";

/** Only same-site paths are allowed as the post-login destination. */
const safeNext = (next: string) => (next.startsWith("/") && !next.startsWith("//") ? next : "/");

export async function signIn(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  const expected = process.env.ADMIN_PASSWORD;
  if (!expected) return { ok: false, message: "ADMIN_PASSWORD isn't set on this deployment. Add it in Vercel → Settings → Environment Variables, then redeploy." };
  const given = String(fd.get("password") ?? "");
  if (!safeEqual(given, expected)) {
    await new Promise((r) => setTimeout(r, 600)); // slow down guessing
    return { ok: false, message: "That password isn't right." };
  }
  (await cookies()).set(SESSION_COOKIE, await sessionToken(expected), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_MAX_AGE,
  });
  redirect(safeNext(String(fd.get("next") ?? "/")));
}

export async function signOut() {
  (await cookies()).delete(SESSION_COOKIE);
  redirect("/login");
}
