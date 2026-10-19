import "server-only";
import { createPrivateKey, sign } from "node:crypto";
import { gunzipSync } from "node:zlib";
import { db, appMetrics, attributionEvents, creators } from "@/db";
import { sql, eq } from "drizzle-orm";

const HOUR = 3_600_000;
const hourStart = (d: Date) => Math.floor(d.getTime() / HOUR) * HOUR;

async function bump(source: "app_store" | "google_play" | "revenuecat", granularity: "hour" | "day", bucketStart: number, delta: { installs?: number; trials?: number; revenueCents?: number }) {
  await db
    .insert(appMetrics)
    .values({ source, granularity, bucketStart: new Date(bucketStart), installs: delta.installs ?? 0, trials: delta.trials ?? 0, revenueCents: delta.revenueCents ?? 0 })
    .onConflictDoUpdate({
      target: [appMetrics.source, appMetrics.granularity, appMetrics.bucketStart],
      set: {
        installs: sql`${appMetrics.installs} + ${delta.installs ?? 0}`,
        trials: sql`${appMetrics.trials} + ${delta.trials ?? 0}`,
        revenueCents: sql`${appMetrics.revenueCents} + ${delta.revenueCents ?? 0}`,
      },
    });
}

/**
 * RevenueCat webhook → hourly revenue/trial buckets, plus direct attribution when the app sets
 * a subscriber attribute (`$campaign`, `creator_code` or `promo_code`) matching a creator's code.
 * Configure in RevenueCat → Integrations → Webhooks with an Authorization header = REVENUECAT_WEBHOOK_SECRET.
 */
export async function ingestRevenueCatEvent(body: { event: Record<string, unknown> }) {
  const e = body.event as {
    type: string;
    event_timestamp_ms: number;
    price_in_purchased_currency?: number;
    price?: number; // USD
    period_type?: string;
    app_user_id?: string;
    subscriber_attributes?: Record<string, { value: string }>;
  };
  const t = new Date(e.event_timestamp_ms);
  const revenueCents = Math.round((e.price ?? 0) * 100);
  const isTrial = e.period_type === "TRIAL";

  if (["INITIAL_PURCHASE", "RENEWAL", "NON_RENEWING_PURCHASE", "PRODUCT_CHANGE"].includes(e.type)) {
    await bump("revenuecat", "hour", hourStart(t), { revenueCents: isTrial ? 0 : revenueCents, trials: isTrial && e.type === "INITIAL_PURCHASE" ? 1 : 0 });
  }

  const attrs = e.subscriber_attributes ?? {};
  const code = (attrs.creator_code?.value ?? attrs.promo_code?.value ?? attrs.$campaign?.value)?.toUpperCase();
  if (code && e.type === "INITIAL_PURCHASE") {
    const creator = await db.query.creators.findFirst({ where: sql`upper(${creators.promoCode}) = ${code}` });
    if (creator) {
      await db.insert(attributionEvents).values({ creatorId: creator.id, kind: "promo_redemption", revenueCents: isTrial ? 0 : revenueCents, appUserId: e.app_user_id, occurredAt: t });
    }
  }
}

/** App Store Connect API JWT (ES256). Needs ASC_ISSUER_ID, ASC_KEY_ID, ASC_PRIVATE_KEY (the .p8 contents). */
function ascToken() {
  const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const now = Math.floor(Date.now() / 1000);
  const head = b64({ alg: "ES256", kid: process.env.ASC_KEY_ID, typ: "JWT" });
  const payload = b64({ iss: process.env.ASC_ISSUER_ID, iat: now, exp: now + 1200, aud: "appstoreconnect-v1" });
  const key = createPrivateKey(process.env.ASC_PRIVATE_KEY!.replace(/\\n/g, "\n"));
  const sig = sign("sha256", Buffer.from(`${head}.${payload}`), { key, dsaEncoding: "ieee-p1363" }).toString("base64url");
  return `${head}.${payload}.${sig}`;
}

export const ascConfigured = () => Boolean(process.env.ASC_ISSUER_ID && process.env.ASC_KEY_ID && process.env.ASC_PRIVATE_KEY && process.env.ASC_VENDOR_NUMBER);

/**
 * Daily Sales & Trends report → first-time downloads and proceeds for one day (Apple
 * publishes daily reports with ~1 day delay, and only at day granularity).
 */
export async function syncAppStoreDay(date: string) {
  if (!ascConfigured()) return { skipped: true };
  const url = new URL("https://api.appstoreconnect.apple.com/v1/salesReports");
  url.search = new URLSearchParams({
    "filter[frequency]": "DAILY",
    "filter[reportType]": "SALES",
    "filter[reportSubType]": "SUMMARY",
    "filter[vendorNumber]": process.env.ASC_VENDOR_NUMBER!,
    "filter[reportDate]": date,
    "filter[version]": "1_1",
  }).toString();
  const res = await fetch(url, { headers: { Authorization: `Bearer ${ascToken()}`, Accept: "application/a-gzip" } });
  if (res.status === 404) return { skipped: true, reason: "report not ready" };
  if (!res.ok) throw new Error(`App Store Connect ${res.status}: ${await res.text()}`);
  const tsv = gunzipSync(Buffer.from(await res.arrayBuffer())).toString("utf8");
  const [header, ...rows] = tsv.trim().split("\n").map((l) => l.split("\t"));
  const col = (n: string) => header.indexOf(n);
  let installs = 0;
  let proceeds = 0;
  for (const r of rows) {
    const type = r[col("Product Type Identifier")];
    const units = Number(r[col("Units")]);
    if (["1", "1F", "1T"].includes(type)) installs += units; // free/paid first-time downloads
    if (r[col("Currency of Proceeds")] === "USD") proceeds += Number(r[col("Developer Proceeds")]) * units;
  }
  await db
    .insert(appMetrics)
    .values({ source: "app_store", granularity: "day", bucketStart: new Date(`${date}T00:00:00Z`), installs, revenueCents: Math.round(proceeds * 100) })
    .onConflictDoUpdate({ target: [appMetrics.source, appMetrics.granularity, appMetrics.bucketStart], set: { installs, revenueCents: Math.round(proceeds * 100) } });
  return { installs, proceedsCents: Math.round(proceeds * 100) };
}

/**
 * Google Play install stats are exported monthly as CSV to your Play Console Cloud Storage
 * bucket (stats/installs/installs_<package>_<YYYYMM>_overview.csv). Upload or point this at
 * that CSV; we take "Daily User Installs" per day.
 */
export async function importGooglePlayCsv(csv: string) {
  const text = csv.replace(/^﻿/, "").replace(/\u0000/g, "");
  const [header, ...rows] = text.trim().split(/\r?\n/).map((l) => l.split(","));
  const dateCol = header.findIndex((h) => /date/i.test(h));
  const instCol = header.findIndex((h) => /daily user installs/i.test(h));
  if (dateCol < 0 || instCol < 0) throw new Error("CSV needs Date and Daily User Installs columns");
  let n = 0;
  for (const r of rows) {
    const installs = Number(r[instCol]);
    if (!r[dateCol] || Number.isNaN(installs)) continue;
    const bucketStart = new Date(`${r[dateCol]}T00:00:00Z`);
    await db
      .insert(appMetrics)
      .values({ source: "google_play", granularity: "day", bucketStart, installs })
      .onConflictDoUpdate({ target: [appMetrics.source, appMetrics.granularity, appMetrics.bucketStart], set: { installs } });
    n++;
  }
  return { days: n };
}

/** Tracked link install/click (from your attribution SDK, MMP postback, or /r/[code] redirect). */
export async function recordLinkEvent(creatorId: string, kind: "link_click" | "link_install", revenueCents = 0) {
  await db.insert(attributionEvents).values({ creatorId, kind, revenueCents, occurredAt: new Date() });
}

/** Tracking links are /r/<PROMOCODE>, so a link click and a code redemption resolve to the same creator. */
export async function creatorByPromoCode(code: string) {
  return db.query.creators.findFirst({ where: eq(sql`upper(${creators.promoCode})`, code.toUpperCase()) });
}
