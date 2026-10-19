import "server-only";

export type PayoutProvider = "wise" | "paypal" | "stripe";
export type PayoutRequest = { statementId: string; amountCents: number; currency: "USD"; destination: string; recipientName: string; note: string };
export type PayoutResult = { status: "paid" | "simulated" | "failed"; ref?: string; error?: string };

export const payoutConfigured: Record<PayoutProvider, () => boolean> = {
  wise: () => Boolean(process.env.WISE_API_TOKEN && process.env.WISE_PROFILE_ID),
  paypal: () => Boolean(process.env.PAYPAL_CLIENT_ID && process.env.PAYPAL_CLIENT_SECRET),
  stripe: () => Boolean(process.env.STRIPE_SECRET_KEY),
};

/**
 * Sends an approved statement. Each call is idempotent on statementId so a retry
 * never double-pays. Without credentials the payout is recorded as simulated.
 */
export async function sendPayout(provider: PayoutProvider, req: PayoutRequest): Promise<PayoutResult> {
  if (!payoutConfigured[provider]()) return { status: "simulated", ref: `sim_${req.statementId.slice(0, 8)}` };
  try {
    if (provider === "paypal") return await paypal(req);
    if (provider === "stripe") return await stripe(req);
    return await wise(req);
  } catch (e) {
    return { status: "failed", error: e instanceof Error ? e.message : String(e) };
  }
}

// PayPal Payouts API — destination is the creator's PayPal email.
async function paypal(req: PayoutRequest): Promise<PayoutResult> {
  const base = process.env.PAYPAL_ENV === "live" ? "https://api-m.paypal.com" : "https://api-m.sandbox.paypal.com";
  const auth = await fetch(`${base}/v1/oauth2/token`, {
    method: "POST",
    headers: { Authorization: `Basic ${Buffer.from(`${process.env.PAYPAL_CLIENT_ID}:${process.env.PAYPAL_CLIENT_SECRET}`).toString("base64")}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: "grant_type=client_credentials",
  }).then((r) => r.json());
  const res = await fetch(`${base}/v1/payments/payouts`, {
    method: "POST",
    headers: { Authorization: `Bearer ${auth.access_token}`, "Content-Type": "application/json", "PayPal-Request-Id": req.statementId },
    body: JSON.stringify({
      sender_batch_header: { sender_batch_id: req.statementId, email_subject: "You have a payout", email_message: req.note },
      items: [{ recipient_type: "EMAIL", receiver: req.destination, amount: { value: (req.amountCents / 100).toFixed(2), currency: req.currency }, sender_item_id: req.statementId, note: req.note }],
    }),
  });
  const j = await res.json();
  if (!res.ok) return { status: "failed", error: j.message ?? JSON.stringify(j) };
  return { status: "paid", ref: j.batch_header?.payout_batch_id };
}

// Stripe Connect — destination is the creator's connected account id (acct_...).
async function stripe(req: PayoutRequest): Promise<PayoutResult> {
  const res = await fetch("https://api.stripe.com/v1/transfers", {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.STRIPE_SECRET_KEY}`, "Content-Type": "application/x-www-form-urlencoded", "Idempotency-Key": req.statementId },
    body: new URLSearchParams({ amount: String(req.amountCents), currency: "usd", destination: req.destination, description: req.note, "metadata[statement_id]": req.statementId }),
  });
  const j = await res.json();
  if (!res.ok) return { status: "failed", error: j.error?.message ?? JSON.stringify(j) };
  return { status: "paid", ref: j.id };
}

// Wise — destination is an existing Wise recipient account id. Quote → transfer → fund from balance.
async function wise(req: PayoutRequest): Promise<PayoutResult> {
  const base = process.env.WISE_ENV === "live" ? "https://api.wise.com" : "https://api.sandbox.transferwise.tech";
  const headers = { Authorization: `Bearer ${process.env.WISE_API_TOKEN}`, "Content-Type": "application/json" };
  const profile = process.env.WISE_PROFILE_ID;
  const quote = await fetch(`${base}/v3/profiles/${profile}/quotes`, {
    method: "POST",
    headers,
    body: JSON.stringify({ sourceCurrency: "USD", targetCurrency: process.env.WISE_TARGET_CURRENCY ?? "USD", sourceAmount: req.amountCents / 100, targetAccount: Number(req.destination) }),
  }).then((r) => r.json());
  if (!quote.id) return { status: "failed", error: `Wise quote failed: ${JSON.stringify(quote)}` };
  const transfer = await fetch(`${base}/v1/transfers`, {
    method: "POST",
    headers,
    body: JSON.stringify({ targetAccount: Number(req.destination), quoteUuid: quote.id, customerTransactionId: crypto.randomUUID(), details: { reference: req.note.slice(0, 35) } }),
  }).then((r) => r.json());
  if (!transfer.id) return { status: "failed", error: `Wise transfer failed: ${JSON.stringify(transfer)}` };
  const fund = await fetch(`${base}/v3/profiles/${profile}/transfers/${transfer.id}/payments`, { method: "POST", headers, body: JSON.stringify({ type: "BALANCE" }) }).then((r) => r.json());
  if (fund.status !== "COMPLETED") return { status: "failed", ref: String(transfer.id), error: `Wise funding: ${fund.errorCode ?? fund.status}` };
  return { status: "paid", ref: String(transfer.id) };
}
