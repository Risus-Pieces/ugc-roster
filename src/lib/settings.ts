import { eq } from "drizzle-orm";
import { db, settings } from "@/db";
import { DEFAULT_BREAKOUT, type BreakoutConfig } from "@/lib/engines/breakout";
import { DEFAULT_BANNED_CLAIMS } from "@/lib/engines/compliance";

export type Brand = {
  name: string;
  product: string;
  valueProp: string;
  appUrl: string;
  bookingUrl: string;
  senderName: string;
  senderEmail: string;
  /** Postal address for the cold-email footer (CAN-SPAM). */
  mailingAddress: string;
  allowedClaims: string[];
  bannedClaims: string[];
  disclosure: string;
  targetCpmCents: number; // used to price creators off their floor
  referralBonusCents: number;
};

export type Ops = {
  breakout: BreakoutConfig;
  testShare: number; // share of daily briefs that test new formats
  testFormats: string[];
  decisionMinPosts: number;
  surveyOptions: string[]; // non-creator answers in the in-app survey
  outreach: {
    /** Max cold emails (openers + follow-ups) per day; protects a new sending domain. */
    dailySendLimit: number;
    /** Follow-ups sent this many days after the first email, while there's no reply. */
    followUpDays: number[];
  };
  arpuOverrideCents?: number;
};

export const DEFAULT_BRAND: Brand = {
  name: "Snapcal",
  product: "Snapcal",
  valueProp: "an app that counts calories from a photo of your meal",
  appUrl: "https://example.com/app",
  bookingUrl: "https://calendly.com/risuszhao",
  senderName: "Alex Rivera",
  senderEmail: "alex@example.com",
  mailingAddress: "",
  allowedClaims: [
    "Estimates calories and macros from a photo",
    "Logging a meal takes a few seconds",
    "Free to download with an optional subscription",
    "Helps you stay consistent with tracking",
  ],
  bannedClaims: DEFAULT_BANNED_CLAIMS,
  disclosure:
    "Creator will turn on the platform's paid-partnership label (TikTok \"Content Disclosure\", Instagram \"Paid partnership\", YouTube \"Includes paid promotion\") on every video and will not hide or remove it.",
  targetCpmCents: 1000,
  referralBonusCents: 15000,
};

export const DEFAULT_OPS: Ops = {
  breakout: DEFAULT_BREAKOUT,
  testShare: 0.2,
  testFormats: ["Street interview", "Tier list", "Duet / stitch reaction", "Expectation vs reality", "Silent tutorial with captions"],
  decisionMinPosts: 20,
  surveyOptions: ["TikTok (no specific creator)", "Instagram", "YouTube", "App Store search", "Friend or family", "Other"],
  outreach: { dailySendLimit: 40, followUpDays: [4, 9] },
};

async function getSetting<T>(key: string, fallback: T): Promise<T> {
  const row = await db.query.settings.findFirst({ where: eq(settings.key, key) });
  return row ? { ...fallback, ...(row.value as T) } : fallback;
}

async function putSetting(key: string, value: unknown) {
  await db.insert(settings).values({ key, value }).onConflictDoUpdate({ target: settings.key, set: { value } });
}

export const getBrand = () => getSetting<Brand>("brand", DEFAULT_BRAND);
export const saveBrand = (b: Brand) => putSetting("brand", b);
export const getOps = () => getSetting<Ops>("ops", DEFAULT_OPS);
export const saveOps = (o: Ops) => putSetting("ops", o);
