import "server-only";
import { payoutConfigured, type PayoutProvider } from "@/lib/integrations/payouts";

export const PROVIDER_NAME: Record<PayoutProvider, string> = { wise: "Wise", paypal: "PayPal", stripe: "Stripe" };
export const PROVIDER_ENV: Record<PayoutProvider, string> = { wise: "WISE_API_TOKEN + WISE_PROFILE_ID", paypal: "PAYPAL_CLIENT_ID + PAYPAL_CLIENT_SECRET", stripe: "STRIPE_SECRET_KEY" };

export function providerInfo(p: PayoutProvider | null | undefined) {
  if (!p) return null;
  return { key: p, name: PROVIDER_NAME[p], live: payoutConfigured[p](), env: PROVIDER_ENV[p] };
}

export const STATUS_ORDER = ["draft", "approved", "failed", "paid"] as const;
export const STATUS_LABEL: Record<(typeof STATUS_ORDER)[number], string> = { draft: "Drafts — need approval", approved: "Approved — ready to pay", failed: "Failed — needs attention", paid: "Paid" };

/** Period for a month: the 1st through month end, or through today for the current month (view windows can't close in the future). */
export function monthPeriod(month: string, now = new Date()) {
  const [y, m] = month.split("-").map(Number);
  const start = `${month}-01`;
  const last = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
  const today = now.toISOString().slice(0, 10);
  const future = start > today;
  const end = last > today ? today : last;
  return { start, end, monthToDate: last > today && !future, future };
}

export function shiftMonth(month: string, delta: number) {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return d.toISOString().slice(0, 7);
}

export const monthLabel = (month: string) => new Date(`${month}-01T00:00:00Z`).toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
export const shortDate = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
