import { Suspense } from "react";
import Loading from "@/app/(app)/loading";
import { connection } from "next/server";
import { and, desc, eq } from "drizzle-orm";
import { db, appMetrics } from "@/db";
import { Card, PageHeader, Tabs, Field, Notice, Badge, input, cx } from "@/components/ui";
import { KeepForm, KeepSubmit } from "@/components/client";
import { getBrand, getOps } from "@/lib/settings";
import { aiEnabled, MODEL } from "@/lib/ai";
import { emailLive } from "@/lib/integrations/email";
import { payoutConfigured } from "@/lib/integrations/payouts";
import { ascConfigured } from "@/lib/integrations/revenue";
import { connectedProviders } from "@/lib/integrations/platforms";
import { day } from "@/lib/format";
import { saveBrandAction, saveOpsAction, importGooglePlayAction } from "./actions";
import { publicOrigin } from "./origin";
import { CheckConnections } from "./check-connections";

export const metadata = { title: "Settings & integrations" };

type Tab = "brand" | "ops" | "integrations";
const area = cx(input, "min-h-[96px] leading-relaxed");

/** Own Suspense boundary: same-route navigations (tabs, filters) re-render below the (app) loading boundary. */
export default function SettingsPage(props: { searchParams: Promise<{ tab?: string }> }) {
  return (
    <Suspense fallback={<Loading />}>
      <SettingsPageContent {...props} />
    </Suspense>
  );
}

async function SettingsPageContent({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  await connection();
  const sp = await searchParams;
  const tab: Tab = sp.tab === "ops" || sp.tab === "integrations" ? sp.tab : "brand";

  return (
    <>
      <PageHeader title="Settings & integrations" description="Your brand and claims, the rules the app runs on, and which outside services are connected." />
      <div className="overflow-x-auto">
        <Tabs
          active={tab}
          tabs={[
            { key: "brand", label: "Brand", href: "/settings" },
            { key: "ops", label: "Operations", href: "/settings?tab=ops" },
            { key: "integrations", label: "Integrations", href: "/settings?tab=integrations" },
          ]}
        />
      </div>
      {tab === "brand" && <BrandForm />}
      {tab === "ops" && <OpsForm />}
      {tab === "integrations" && <Integrations />}
    </>
  );
}

// ─── Brand ──────────────────────────────────────────────────────────────────

async function BrandForm() {
  const b = await getBrand();
  return (
    <KeepForm action={saveBrandAction} className="max-w-4xl space-y-4">
      <Card title="Product">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Brand name">
            <input name="name" defaultValue={b.name} className={input} required />
          </Field>
          <Field label="Product">
            <input name="product" defaultValue={b.product} className={input} required />
          </Field>
          <div className="sm:col-span-2">
            <Field label="Value proposition" hint="One line, used in outreach and briefs. Example: an app that counts calories from a photo of your meal.">
              <input name="valueProp" defaultValue={b.valueProp} className={input} required />
            </Field>
          </div>
          <Field label="App URL" hint="Tracking links (/r/CODE) redirect here with ?ref=CODE.">
            <input name="appUrl" type="url" defaultValue={b.appUrl} className={input} required />
          </Field>
          <Field label="Booking link" hint="Your Calendly link, offered to creators who reply.">
            <input name="bookingUrl" type="url" defaultValue={b.bookingUrl} className={input} />
          </Field>
        </div>
      </Card>

      <Card title="Outreach sender">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Sender name">
            <input name="senderName" defaultValue={b.senderName} className={input} required />
          </Field>
          <Field label="Sender email" hint="Where replies go if EMAIL_REPLY_TO isn't set. Sending itself uses EMAIL_FROM on your outreach domain.">
            <input name="senderEmail" type="email" defaultValue={b.senderEmail} className={input} required />
          </Field>
          <div className="sm:col-span-2">
            <Field label="Mailing address" hint="Required by US anti-spam law (CAN-SPAM) in every cold email. Added to a footer with an opt-out line. A PO box or registered agent address works.">
              <input name="mailingAddress" defaultValue={b.mailingAddress} placeholder="123 Main St, Suite 4, Austin, TX 78701" className={input} />
            </Field>
          </div>
        </div>
      </Card>

      <Card title="Claims and disclosure">
        <div className="grid gap-3 md:grid-cols-2">
          <Field label="Allowed claims" hint="One per line. Briefs only use these; reviews flag anything else.">
            <textarea name="allowedClaims" defaultValue={b.allowedClaims.join("\n")} className={area} rows={6} />
          </Field>
          <Field label="Banned claims" hint="One per line. A draft that says any of these fails review.">
            <textarea name="bannedClaims" defaultValue={b.bannedClaims.join("\n")} className={area} rows={6} />
          </Field>
          <div className="md:col-span-2">
            <Field label="Disclosure text" hint="Goes into every contract.">
              <textarea name="disclosure" defaultValue={b.disclosure} className={area} rows={3} />
            </Field>
          </div>
        </div>
      </Card>

      <Card title="Pricing">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Target cost per 1K views ($)" hint="Suggested base pay = a creator's floor views (worst 5 posts) × this. Lower means cheaper offers.">
            <input name="targetCpm" defaultValue={(b.targetCpmCents / 100).toFixed(2)} inputMode="decimal" className={cx(input, "num")} />
          </Field>
          <Field label="Referral bonus ($)" hint="$100–$200. Default for new rate cards; the amount paid comes from the referrer's rate card.">
            <input name="referralBonus" defaultValue={(b.referralBonusCents / 100).toFixed(0)} inputMode="decimal" className={cx(input, "num")} />
          </Field>
        </div>
      </Card>

      <KeepSubmit variant="primary" pendingText="Saving…">
        Save brand settings
      </KeepSubmit>
    </KeepForm>
  );
}

// ─── Ops ────────────────────────────────────────────────────────────────────

async function OpsForm() {
  const o = await getOps();
  return (
    <KeepForm action={saveOpsAction} className="max-w-4xl space-y-4">
      <Card title="Breakout alerts">
        <p className="mb-3 text-[12px] text-muted">A campaign post that clears all three is flagged as a breakout, and variations go to the roster while the trend is fresh.</p>
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Minimum views">
            <input name="minViews" defaultValue={o.breakout.minViews} inputMode="numeric" className={cx(input, "num")} />
          </Field>
          <Field label="Minimum engagement rate (%)">
            <input name="minEr" defaultValue={+(o.breakout.minEngagementRate * 100).toFixed(2)} inputMode="decimal" className={cx(input, "num")} />
          </Field>
          <Field label="Max post age (hours)">
            <input name="maxAgeHours" defaultValue={o.breakout.maxAgeHours} inputMode="numeric" className={cx(input, "num")} />
          </Field>
        </div>
      </Card>

      <Card title="Outreach">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Cold emails per day" hint="Openers + follow-ups. Start around 30–50 on a new domain and raise it slowly.">
            <input name="dailySendLimit" defaultValue={o.outreach.dailySendLimit} inputMode="numeric" className={cx(input, "num")} />
          </Field>
          <Field label="Follow-up days" hint="Days after the first email, comma-separated. Stops as soon as they reply. Example: 4, 9">
            <input name="followUpDays" defaultValue={o.outreach.followUpDays.join(", ")} className={cx(input, "num")} />
          </Field>
        </div>
      </Card>

      <Card title="Daily briefs">
        <div className="grid gap-3 md:grid-cols-[200px_1fr]">
          <Field label="Test share (%)" hint="Share of briefs that try a new format; the rest reuse proven hooks.">
            <input name="testShare" defaultValue={Math.round(o.testShare * 100)} inputMode="numeric" className={cx(input, "num")} />
          </Field>
          <Field label="Test formats" hint="One per line.">
            <textarea name="testFormats" defaultValue={o.testFormats.join("\n")} className={area} rows={5} />
          </Field>
        </div>
      </Card>

      <Card title="Decisions and attribution">
        <div className="grid gap-3 md:grid-cols-[200px_1fr]">
          <Field label="Posts before a suggestion" hint="Keep, cut or promote appears after this many posts. 20–30 is typical.">
            <input name="decisionMinPosts" defaultValue={o.decisionMinPosts} inputMode="numeric" className={cx(input, "num")} />
          </Field>
          <Field label="Generic survey answers" hint="One per line. Shown after creator names in “Where did you hear about us?”.">
            <textarea name="surveyOptions" defaultValue={o.surveyOptions.join("\n")} className={area} rows={6} />
          </Field>
        </div>
      </Card>

      <KeepSubmit variant="primary" pendingText="Saving…">
        Save operations settings
      </KeepSubmit>
    </KeepForm>
  );
}

// ─── Integrations ───────────────────────────────────────────────────────────

const has = (k: string) => Boolean(process.env[k]?.trim());

type Integration = {
  name: string;
  what: string;
  env: { key: string; optional?: boolean }[];
  status: { label: string; tone: "profit" | "neutral" | "tally" | "info" };
  note?: React.ReactNode;
};

async function Integrations() {
  const [origin, play, rc] = await Promise.all([
    publicOrigin(),
    db.select({ t: appMetrics.bucketStart }).from(appMetrics).where(and(eq(appMetrics.source, "google_play"), eq(appMetrics.granularity, "day"))).orderBy(desc(appMetrics.bucketStart)),
    db.select({ t: appMetrics.bucketStart }).from(appMetrics).where(eq(appMetrics.source, "revenuecat")).orderBy(desc(appMetrics.bucketStart)).limit(1),
  ]);
  const live = { label: "Live", tone: "profit" as const };
  const env = (...keys: string[]) => keys.map((k) => (k.endsWith("?") ? { key: k.slice(0, -1), optional: true } : { key: k }));
  const paypalMode = process.env.PAYPAL_ENV === "live" ? "live" : "sandbox";

  const rows: Integration[] = [
    { name: "Claude AI", what: "Writes outreach, reply drafts, briefs and compliance reviews.", env: env("ANTHROPIC_API_KEY", "CLAUDE_MODEL?"), status: aiEnabled() ? live : { label: "Templates", tone: "neutral" }, note: aiEnabled() ? <>Model: <span className="num">{MODEL}</span></> : "Falls back to built-in templates." },
    { name: "YouTube discovery", what: "Finds creators by keyword on YouTube.", env: env("YOUTUBE_API_KEY"), status: has("YOUTUBE_API_KEY") ? live : { label: "Demo data", tone: "neutral" } },
    { name: "TikTok login", what: "Creators connect TikTok so stats come from the platform.", env: env("TIKTOK_CLIENT_KEY", "TIKTOK_CLIENT_SECRET"), status: connectedProviders.tiktok.configured() ? live : { label: "Demo connect", tone: "neutral" }, note: <Url>{`${origin}/api/oauth/tiktok/callback`}</Url> },
    { name: "Instagram login", what: "Creators connect Instagram (professional accounts).", env: env("INSTAGRAM_APP_ID", "INSTAGRAM_APP_SECRET"), status: connectedProviders.instagram.configured() ? live : { label: "Demo connect", tone: "neutral" }, note: <Url>{`${origin}/api/oauth/instagram/callback`}</Url> },
    { name: "Google / YouTube login", what: "Creators connect their YouTube channel.", env: env("GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET"), status: connectedProviders.youtube.configured() ? live : { label: "Demo connect", tone: "neutral" }, note: <Url>{`${origin}/api/oauth/youtube/callback`}</Url> },
    { name: "Email (Resend)", what: "Sends outreach and replies. Use a separate outreach domain with SPF, DKIM and DMARC.", env: env("RESEND_API_KEY", "EMAIL_FROM", "EMAIL_REPLY_TO?", "RESEND_WEBHOOK_SECRET?"), status: emailLive() ? live : { label: "Simulated", tone: "neutral" }, note: emailLive() ? undefined : "Messages are logged, not sent." },
    { name: "Inbound email", what: "Creator replies forwarded here are classified and matched by email.", env: env("INBOUND_EMAIL_SECRET?"), status: has("INBOUND_EMAIL_SECRET") ? { label: "Secured", tone: "profit" } : { label: "Open", tone: "tally" }, note: <Url>{`POST ${origin}/api/webhooks/inbound-email`}</Url> },
    { name: "Booking (Calendly)", what: "Booked intro calls show up on the creator.", env: env("BOOKING_WEBHOOK_SECRET?"), status: has("BOOKING_WEBHOOK_SECRET") ? { label: "Secured", tone: "profit" } : { label: "Open", tone: "tally" }, note: <Url>{`POST ${origin}/api/webhooks/booking`}</Url> },
    { name: "RevenueCat webhook", what: "Hourly revenue and trials, plus promo-code matches from subscriber attributes.", env: env("REVENUECAT_WEBHOOK_SECRET"), status: has("REVENUECAT_WEBHOOK_SECRET") ? { label: "Secured", tone: "profit" } : { label: "Open", tone: "tally" }, note: <><Url>{`POST ${origin}/api/webhooks/revenuecat`}</Url><div className="mt-0.5">{rc[0] ? `Last data ${day(rc[0].t)}` : "No events yet"}</div></> },
    { name: "App Store Connect", what: "Daily first-time downloads and proceeds (pulled by the daily job).", env: env("ASC_ISSUER_ID", "ASC_KEY_ID", "ASC_PRIVATE_KEY", "ASC_VENDOR_NUMBER"), status: ascConfigured() ? live : { label: "Not connected", tone: "neutral" } },
    { name: "Google Play", what: "Daily installs from the Play Console CSV export.", env: [], status: play.length ? { label: "Imported", tone: "profit" } : { label: "No data", tone: "neutral" }, note: play.length ? `${play.length} days, latest ${day(play[0].t)}` : "Import a CSV below." },
    { name: "Wise", what: "Payouts to bank accounts in most countries.", env: env("WISE_API_TOKEN", "WISE_PROFILE_ID", "WISE_ENV?"), status: payoutConfigured.wise() ? live : { label: "Simulated", tone: "neutral" }, note: payoutConfigured.wise() ? (process.env.WISE_ENV === "live" ? "Live account" : "Sandbox") : undefined },
    { name: "PayPal", what: "Payouts to PayPal email. Reported by PayPal on a 1099-K.", env: env("PAYPAL_CLIENT_ID", "PAYPAL_CLIENT_SECRET", "PAYPAL_ENV?"), status: payoutConfigured.paypal() ? live : { label: "Simulated", tone: "neutral" }, note: payoutConfigured.paypal() ? `${paypalMode === "live" ? "Live" : "Sandbox"} (PAYPAL_ENV=live sends real money)` : undefined },
    { name: "Stripe", what: "Transfers to creators' Stripe Connect accounts.", env: env("STRIPE_SECRET_KEY"), status: payoutConfigured.stripe() ? live : { label: "Simulated", tone: "neutral" } },
    { name: "Encryption", what: "Encrypts OAuth tokens and tax IDs at rest.", env: env("ENCRYPTION_KEY"), status: has("ENCRYPTION_KEY") ? { label: "Set", tone: "profit" } : { label: "Dev key", tone: "tally" }, note: has("ENCRYPTION_KEY") ? undefined : "Required in production. Don't change it once data is stored." },
    { name: "Cron", what: "Syncs accounts every 6 hours; daily briefs, hook bank and App Store pull at 13:00 UTC.", env: env("CRON_SECRET"), status: has("CRON_SECRET") ? { label: "Secured", tone: "profit" } : { label: "Open", tone: "tally" }, note: <><Url>{`GET ${origin}/api/cron/sync`}</Url><Url>{`GET ${origin}/api/cron/daily`}</Url></> },
    { name: "Database", what: "Neon Postgres, provisioned through the Vercel Marketplace.", env: env("DATABASE_URL", "DATABASE_URL_UNPOOLED"), status: has("DATABASE_URL") ? { label: "Connected", tone: "profit" } : { label: "Missing", tone: "tally" }, note: has("DATABASE_URL") ? undefined : "Run vercel env pull" },
    { name: "Public URL", what: "Base for tracking links, webhooks and OAuth redirects.", env: env("APP_URL?"), status: has("APP_URL") ? { label: "Set", tone: "profit" } : { label: "From request", tone: "neutral" }, note: <span className="num">{origin}</span> },
  ];
  const liveCount = rows.filter((r) => r.status.tone === "profit").length;

  return (
    <div className="space-y-4">
      <Notice tone="info">
        {liveCount} of {rows.length} connected. Anything not connected runs in demo or simulated mode so the whole app still works. Add keys as environment variables and redeploy; values are never shown here, only whether they&apos;re set.
      </Notice>

      <Card title="Check that your keys work">
        <CheckConnections />
      </Card>

      <Card title="Integration status" flush>
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-[13px]">
            <thead>
              <tr className="border-b border-line text-left text-[11px] uppercase tracking-[0.08em] text-muted">
                <th className="px-4 py-2 font-medium">Integration</th>
                <th className="px-3 py-2 font-medium">Status</th>
                <th className="px-3 py-2 font-medium">Environment variables</th>
                <th className="px-4 py-2 font-medium">Details</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {rows.map((r) => (
                <tr key={r.name} className="align-top">
                  <td className="px-4 py-2.5">
                    <div className="font-medium">{r.name}</div>
                    <div className="max-w-[280px] text-[12px] text-ink-2">{r.what}</div>
                  </td>
                  <td className="px-3 py-2.5">
                    <Badge tone={r.status.tone}>{r.status.label}</Badge>
                  </td>
                  <td className="px-3 py-2.5">
                    {r.env.length === 0 ? (
                      <span className="text-[12px] text-muted">None (CSV import)</span>
                    ) : (
                      <ul className="space-y-0.5">
                        {r.env.map((e) => (
                          <li key={e.key} className="flex items-center gap-1.5 whitespace-nowrap">
                            <span className={cx("h-1.5 w-1.5 rounded-full", has(e.key) ? "bg-profit" : e.optional ? "bg-line-strong" : "bg-tally")} aria-hidden />
                            <span className="num text-[12px]">{e.key}</span>
                            <span className="text-[11px] text-muted">{has(e.key) ? "set" : e.optional ? "optional" : "not set"}</span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-[12px] text-ink-2">{r.note}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Webhooks to configure" className="min-w-0">
          <dl className="space-y-3 text-[13px]">
            <Hook title="RevenueCat" url={`${origin}/api/webhooks/revenuecat`}>
              RevenueCat → Integrations → Webhooks. Set the Authorization header to your REVENUECAT_WEBHOOK_SECRET. Set a <span className="num">creator_code</span> subscriber attribute in the app to match purchases to promo codes.
            </Hook>
            <Hook title="Creator replies (Resend)" url={`${origin}/api/webhooks/inbound-email`}>
              Resend → Webhooks → Add endpoint, event <span className="num">email.received</span>. Copy its signing secret into RESEND_WEBHOOK_SECRET. Set EMAIL_REPLY_TO to an address on your Resend receiving domain so replies arrive here, get sorted, and get a drafted answer.
            </Hook>
            <Hook title="Calendly bookings" url={`${origin}/api/webhooks/booking`}>
              Needs a paid Calendly plan. Create a webhook subscription for <span className="num">invitee.created</span> (Calendly → Integrations → API and webhooks) with a signing key, and put that key in BOOKING_WEBHOOK_SECRET. On the free plan, log calls from the Replies tab instead.
            </Hook>
            <Hook title="Tracking links" url={`${origin}/r/PROMOCODE`}>
              Logs a click and redirects to your app URL with <span className="num">?ref=PROMOCODE</span> and UTM tags.
            </Hook>
            <Hook title="Cron (Vercel)" url={`${origin}/api/cron/sync · /api/cron/daily`}>
              Scheduled in vercel.json. Vercel sends <span className="num">Authorization: Bearer CRON_SECRET</span> automatically once CRON_SECRET is set.
            </Hook>
          </dl>
        </Card>

        <Card title="In-app survey API" className="min-w-0">
          <p className="mb-2 text-[13px] text-ink-2">Ask &ldquo;Where did you hear about us?&rdquo; during onboarding. Fetch the options (creator order is shuffled per request), then post the answer. CORS is open so the app or website can call it directly.</p>
          <pre className="num overflow-x-auto rounded-md bg-sunken p-3 text-[12px] leading-relaxed">{`GET ${origin}/api/survey
→ { "question": "Where did you hear about us?",
    "options": [
      { "label": "Sofia Kim", "creatorId": "c_123…", "type": "creator" },
      { "label": "Instagram", "creatorId": null, "type": "generic" }
    ] }

POST ${origin}/api/survey
Content-Type: application/json
{ "creatorId": "c_123…", "answer": "Sofia Kim", "appUserId": "rc_abc" }
→ { "ok": true }`}</pre>
          <p className="mt-2 text-[12px] text-muted">Send the RevenueCat app user ID as appUserId so a survey answer can be tied to a subscriber later. Generic answers send creatorId null.</p>
        </Card>
      </div>

      <Card title="Import Google Play installs">
        <KeepForm action={importGooglePlayAction} resetOnSuccess className="space-y-3">
          <p className="text-[13px] text-ink-2">
            Play Console exports installs monthly to its Cloud Storage bucket as <span className="num break-all">stats/installs/installs_&lt;package&gt;_&lt;YYYYMM&gt;_overview.csv</span>. Upload that file (or paste it). Re-importing a month overwrites those days.
          </p>
          <div className="grid gap-3 md:grid-cols-[1fr_1fr]">
            <Field label="CSV file">
              <input name="file" type="file" accept=".csv,text/csv" className={cx(input, "py-1")} />
            </Field>
            <Field label="…or paste CSV">
              <textarea name="csv" rows={3} placeholder={"Date,Package Name,Daily User Installs,…\n2026-10-01,com.example.app,412,…"} className={cx(input, "num text-[12px]")} />
            </Field>
          </div>
          <KeepSubmit pendingText="Importing…">Import installs</KeepSubmit>
        </KeepForm>
      </Card>
    </div>
  );
}

function Url({ children }: { children: string }) {
  return <div className="num select-all break-all text-[11px] text-ink-2">{children}</div>;
}

function Hook({ title, url, children }: { title: string; url: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="font-medium">{title}</dt>
      <dd className="num select-all break-all text-[12px] text-ink">{url}</dd>
      <dd className="mt-0.5 text-[12px] text-ink-2">{children}</dd>
    </div>
  );
}
