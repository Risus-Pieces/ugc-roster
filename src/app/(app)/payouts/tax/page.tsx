import { Suspense } from "react";
import Loading from "@/app/(app)/loading";
import Link from "next/link";
import { connection } from "next/server";
import { Card, Grid, PageHeader, Stat, Table, Td, Badge, Notice, Empty, btn, btnSm, cx } from "@/components/ui";
import { form1099Summary } from "@/lib/services/payouts";
import { usd, usd2 } from "@/lib/format";

export const metadata = { title: "Tax & 1099s" };

/** Own Suspense boundary: same-route navigations (tabs, filters) re-render below the (app) loading boundary. */
export default function TaxPage(props: { searchParams: Promise<{ year?: string }> }) {
  return (
    <Suspense fallback={<Loading />}>
      <TaxPageContent {...props} />
    </Suspense>
  );
}

async function TaxPageContent({ searchParams }: { searchParams: Promise<{ year?: string }> }) {
  await connection();
  const sp = await searchParams;
  const current = new Date().getUTCFullYear();
  const y = Number(sp.year);
  const year = Number.isInteger(y) && y >= 2020 && y <= current ? y : current;
  const { threshold, rows } = await form1099Summary(year);

  const us = rows.filter((r) => (r.creator.country ?? "").toUpperCase() === "US");
  const required = rows.filter((r) => r.required);
  const missingW9 = required.filter((r) => !r.w9 || !r.w9.tinLast4);
  const total = rows.reduce((a, r) => a + r.totalCents, 0);
  const reportable = required.reduce((a, r) => a + r.reportableCents, 0);
  const years = [current, current - 1, current - 2];

  return (
    <>
      <PageHeader
        step="08 · Pay"
        title="Tax & 1099s"
        description={`Who needs a 1099-NEC for payments made in ${year}, from paid statements.`}
        actions={
          <>
            {years.map((yy) => (
              <Link key={yy} href={`/payouts/tax?year=${yy}`} className={cx(btn, btnSm, yy === year && "bg-sunken")}>
                {yy}
              </Link>
            ))}
            <a href={`/payouts/tax/export?year=${year}`} className={cx(btn, btnSm)} download>
              Export CSV ({required.length})
            </a>
          </>
        }
      />

      <Grid cols={5} className="mb-6">
        <Stat label={`Threshold for ${year}`} value={usd(threshold)} hint={year >= 2026 ? "$2,000 from 2026" : "$600 through 2025"} />
        <Stat label="1099-NECs required" value={required.length} tone={required.length ? "tally" : undefined} hint={usd(reportable) + " reportable"} />
        <Stat label="Missing W-9" value={missingW9.length} tone={missingW9.length ? "loss" : undefined} hint="among required" />
        <Stat label="Creators paid" value={rows.length} hint={`${us.length} in the US`} />
        <Stat label={`Paid in ${year}`} value={usd(total)} />
      </Grid>

      {missingW9.length > 0 && (
        <div className="mb-4">
          <Notice tone="loss">
            {missingW9.map((r) => r.creator.name).join(", ")} {missingW9.length === 1 ? "needs" : "need"} a 1099 but {missingW9.length === 1 ? "has" : "have"} no W-9 with a taxpayer ID on file. Request one from the{" "}
            <Link href="/onboarding?tab=tax" className="underline">
              Onboarding page
            </Link>{" "}
            before January 31.
          </Notice>
        </div>
      )}

      <Card title={`Payments in ${year}`} flush>
        {rows.length === 0 ? (
          <div className="p-4">
            <Empty title={`No paid statements in ${year}`}>Only paid statements count. Approve and pay statements on the Statements page, or pick another year.</Empty>
          </div>
        ) : (
          <Table
            head={["Creator", "Country", { label: "Total paid", align: "right" }, { label: "Via PayPal (1099-K)", align: "right" }, { label: "Reportable", align: "right" }, "1099-NEC", "Tax form"]}
          >
            {rows.map((r) => {
              const isUS = (r.creator.country ?? "").toUpperCase() === "US";
              return (
                <tr key={r.creator.id} className="hover:bg-sunken/60">
                  <Td className="whitespace-nowrap">
                    <Link href={`/creators/${r.creator.id}`} className="font-medium hover:underline">
                      {r.creator.name}
                    </Link>
                    {r.w9?.legalName && r.w9.legalName !== r.creator.name && <div className="text-[13px] text-muted">{r.w9.legalName}</div>}
                  </Td>
                  <Td mono className="text-ink-2">
                    {r.creator.country ?? "—"}
                  </Td>
                  <Td right mono>
                    {usd2(r.totalCents)}
                  </Td>
                  <Td right mono className={cx(r.tpsoCents === 0 && "text-muted")}>
                    {r.tpsoCents ? `−${usd2(r.tpsoCents)}` : "—"}
                  </Td>
                  <Td right mono className={cx(!isUS && "text-muted")}>
                    {isUS ? usd2(r.reportableCents) : "—"}
                  </Td>
                  <Td>
                    {r.required ? (
                      <Badge tone="tally">Required</Badge>
                    ) : (
                      <span className="text-[13px] text-muted">{!isUS ? "No (non-US)" : `No, under ${usd(threshold)}`}</span>
                    )}
                  </Td>
                  <Td className="whitespace-nowrap">
                    {!isUS ? (
                      <span className="text-[13px] text-ink-2">Non-US (W-8BEN) · no 1099</span>
                    ) : r.w9 ? (
                      <span className="text-[13px]">
                        W-9 <span className="num">{r.w9.tinLast4 ? `•••${r.w9.tinLast4}` : "no TIN"}</span> <span className="text-muted">· {r.w9.status}</span>
                      </span>
                    ) : (
                      <span className={cx("text-[13px]", r.required ? "text-loss" : "text-tally")}>No W-9 on file</span>
                    )}
                  </Td>
                </tr>
              );
            })}
          </Table>
        )}
      </Card>

      <Card title="Before you file" className="mt-4">
        <ul className="list-disc space-y-1.5 pl-5 text-[14px] text-ink-2">
          <li>
            A 1099-NEC is needed for each US creator you paid {usd(threshold)} or more in {year} ({year >= 2026 ? "the threshold rose from $600 to $2,000 for payments made from 2026" : "the threshold is $600 for payments made through 2025"}). File with the IRS and send copies to creators by January 31.
          </li>
          <li>Payments sent through PayPal are reported by PayPal on a 1099-K, so they&apos;re subtracted here and left off your 1099-NEC. Wise and Stripe payouts are yours to report.</li>
          <li>Creators outside the US submit a W-8BEN instead of a W-9 and don&apos;t get a 1099.</li>
          <li>The CSV has legal name, the last 4 digits of the taxpayer ID, address and reportable amount. Full TINs stay encrypted and are never exported.</li>
          <li>This is a working list, not tax advice. Confirm thresholds, state filing rules and edge cases with your accountant.</li>
        </ul>
        <div className="mt-3">
          <a href={`/payouts/tax/export?year=${year}&all=1`} className="text-[13px] text-ink-2 underline hover:text-ink" download>
            Export every creator paid in {year}, not just required ones
          </a>
        </div>
      </Card>
    </>
  );
}
