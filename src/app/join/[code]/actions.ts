"use server";

import { revalidatePath } from "next/cache";
import type { ActionResult } from "@/components/client";
import { PLATFORMS, type Platform } from "@/db";
import { joinViaReferral } from "@/lib/services/outreach";

export type JoinResult = (NonNullable<ActionResult> & { first?: string; email?: string; duplicate?: boolean }) | null;

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const HANDLE = /^[a-z0-9._-]{2,30}$/i;

/** Public sign-up from a creator's referral link (/join/[code]). */
export async function joinAction(_: JoinResult, fd: FormData): Promise<JoinResult> {
  const str = (k: string) => String(fd.get(k) ?? "").trim();
  const code = str("code");
  const name = str("name").replace(/\s+/g, " ");
  const email = str("email").toLowerCase();
  const platform = str("platform") as Platform;
  const handle = str("handle").replace(/^@/, "");
  const country = str("country");
  const first = name.split(" ")[0];

  // Honeypot: real people never see this field.
  if (str("website")) return { ok: true, first, email };

  if (name.length < 2) return { ok: false, message: "Add your name" };
  if (!EMAIL.test(email)) return { ok: false, message: "That email doesn't look right" };
  if (!PLATFORMS.includes(platform)) return { ok: false, message: "Pick where you post" };
  if (!HANDLE.test(handle)) return { ok: false, message: "Add your handle — letters, numbers, dots and underscores" };
  if (country.length > 56) return { ok: false, message: "Country is too long" };

  try {
    const r = await joinViaReferral({ code, name, email, handle, platform, country: country || undefined });
    revalidatePath("/referrals");
    revalidatePath("/pipeline");
    revalidatePath("/creators");
    return { ok: true, first, email, duplicate: r.duplicate };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, message: msg === "Invalid referral link" ? "This invite link isn't valid anymore. Ask your friend for a new one." : "Something went wrong. Please try again." };
  }
}
