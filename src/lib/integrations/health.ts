import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { MODEL } from "@/lib/ai";

export type Check = { name: string; status: "ok" | "warn" | "fail" | "off"; detail: string };

const domainOf = (addr: string | undefined) => addr?.match(/@([^>\s]+)>?\s*$/)?.[1]?.toLowerCase();

/** Read-only calls that prove each key works, without sending anything or spending quota. */
export async function checkIntegrations(): Promise<Check[]> {
  return Promise.all([checkClaude(), checkResend(), checkReplyTo(), checkYouTube()]);
}

async function checkClaude(): Promise<Check> {
  const name = "Claude (AI writing)";
  if (!process.env.ANTHROPIC_API_KEY) return { name, status: "off", detail: "ANTHROPIC_API_KEY isn't set — openers and replies use templates." };
  try {
    const m = await new Anthropic().models.retrieve(MODEL);
    return { name, status: "ok", detail: `Key works. Using ${m.display_name ?? m.id}.` };
  } catch (e) {
    return { name, status: "fail", detail: `Claude rejected the key or model: ${e instanceof Error ? e.message : e}` };
  }
}

async function checkResend(): Promise<Check> {
  const name = "Resend (sending)";
  if (!process.env.RESEND_API_KEY) return { name, status: "off", detail: "RESEND_API_KEY isn't set — emails are simulated." };
  const from = process.env.EMAIL_FROM;
  if (!from) return { name, status: "fail", detail: "EMAIL_FROM isn't set. Use a format like: Risus at YourApp <risus@yourdomain.com>" };
  const fromDomain = domainOf(from);
  if (!fromDomain) return { name, status: "fail", detail: `EMAIL_FROM doesn't contain an email address: "${from}"` };
  const res = await fetch("https://api.resend.com/domains", { headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}` } });
  if (res.status === 401 || res.status === 403) {
    const j = await res.json().catch(() => ({}));
    if (String(j?.name ?? j?.message ?? "").includes("restricted")) {
      return { name, status: "warn", detail: `The key is "sending access" only. It can send from ${fromDomain}, but reading creator replies needs a Full access key.` };
    }
    return { name, status: "fail", detail: "Resend rejected RESEND_API_KEY. Create a new key in Resend → API Keys." };
  }
  if (!res.ok) return { name, status: "fail", detail: `Resend returned ${res.status}.` };
  const { data = [] } = (await res.json()) as { data?: { name: string; status: string }[] };
  const d = data.find((x) => fromDomain === x.name || fromDomain.endsWith(`.${x.name}`));
  if (!d) return { name, status: "fail", detail: `${fromDomain} isn't added in Resend → Domains, so sends from it will be rejected.` };
  if (d.status !== "verified") return { name, status: "warn", detail: `${d.name} is "${d.status}" in Resend. Add the DNS records Resend shows, then click Verify.` };
  return { name, status: "ok", detail: `Key works and ${d.name} is verified. Sending from ${from}.` };
}

async function checkReplyTo(): Promise<Check> {
  const name = "Creator replies (Resend receiving)";
  const replyTo = process.env.EMAIL_REPLY_TO?.trim();
  if (!replyTo) return { name, status: "warn", detail: "EMAIL_REPLY_TO isn't set — replies go to the sender email in Settings, not into Roster." };
  const signed = Boolean(process.env.RESEND_WEBHOOK_SECRET);
  const resendApp = /\.resend\.app$/i.test(domainOf(replyTo) ?? "");
  return {
    name,
    status: signed ? "ok" : "warn",
    detail: `Replies go to ${replyTo}${resendApp ? " (Resend receiving address)" : ""}. ${signed ? "Webhook signature checking is on." : "Set RESEND_WEBHOOK_SECRET so only Resend can post replies."}`,
  };
}

async function checkYouTube(): Promise<Check> {
  const name = "YouTube discovery";
  const key = process.env.YOUTUBE_API_KEY;
  if (!key) return { name, status: "off", detail: "YOUTUBE_API_KEY isn't set — discovery uses demo data." };
  // videoCategories.list costs 1 quota unit (a search costs 100).
  const res = await fetch(`https://www.googleapis.com/youtube/v3/videoCategories?part=snippet&regionCode=US&key=${encodeURIComponent(key)}`);
  if (res.ok) return { name, status: "ok", detail: "Key works. Daily quota is 10,000 units; one keyword search uses about 100–150." };
  const j = await res.json().catch(() => ({}));
  const reason = j?.error?.errors?.[0]?.reason ?? j?.error?.status ?? res.status;
  const hint = reason === "accessNotConfigured" || reason === "SERVICE_DISABLED" ? "Enable YouTube Data API v3 for this key's Google Cloud project." : reason === "keyInvalid" || reason === "API_KEY_INVALID" ? "The key is invalid — copy it again from Google Cloud → Credentials." : reason === "ipRefererBlocked" || reason === "API_KEY_HTTP_REFERRER_BLOCKED" ? "The key has website or IP restrictions that block servers. Restrict it by API (YouTube Data API v3) instead." : "";
  return { name, status: "fail", detail: `YouTube rejected the key (${reason}). ${hint}`.trim() };
}
