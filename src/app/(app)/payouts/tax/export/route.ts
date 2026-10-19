import type { NextRequest } from "next/server";
import { form1099Summary } from "@/lib/services/payouts";

/** 1099 working list as CSV. Only the last 4 of the TIN ever leaves the database. */
export async function GET(request: NextRequest) {
  const current = new Date().getUTCFullYear();
  const y = Number(request.nextUrl.searchParams.get("year"));
  const year = Number.isInteger(y) && y >= 2020 && y <= current ? y : current;
  const all = request.nextUrl.searchParams.get("all") === "1";

  const { threshold, rows } = await form1099Summary(year);
  const list = all ? rows : rows.filter((r) => r.required);

  const head = ["legal_name", "creator_name", "email", "tin_last4", "address", "address2", "city", "state", "zip", "country", "total_paid_usd", "paid_via_paypal_usd", "reportable_usd", "threshold_usd", "form_1099_nec_required", "tax_form_status"];
  const lines = list.map((r) => {
    const f = r.w9?.data ?? {};
    const pick = (...keys: string[]) => keys.map((k) => f[k]).find((v) => v !== undefined && v !== "") ?? "";
    return [
      r.w9?.legalName ?? r.creator.name,
      r.creator.name,
      r.creator.email ?? "",
      r.w9?.tinLast4 ?? "",
      pick("address", "address1", "street", "line1"),
      pick("address2", "line2", "apt"),
      pick("city"),
      pick("state", "region"),
      pick("zip", "postalCode", "postal_code", "zipCode"),
      pick("country") || r.creator.country || "",
      dollars(r.totalCents),
      dollars(r.tpsoCents),
      dollars(r.reportableCents),
      dollars(threshold),
      r.required ? "yes" : "no",
      (r.creator.country ?? "").toUpperCase() !== "US" ? "not needed (non-US, W-8BEN)" : (r.w9?.status ?? "missing"),
    ];
  });

  const csv = [head, ...lines].map((row) => row.map(cell).join(",")).join("\r\n") + "\r\n";
  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="1099-${year}${all ? "-all" : ""}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}

const dollars = (c: number) => (c / 100).toFixed(2);

/** RFC 4180 quoting, plus a leading quote on formula-like values so spreadsheets don't execute them. */
function cell(v: string) {
  let s = String(v ?? "");
  if (/^[=+\-@\t\r]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
