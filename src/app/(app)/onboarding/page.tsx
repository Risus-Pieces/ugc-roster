import Link from "next/link";
import { connection } from "next/server";
import { desc, inArray } from "drizzle-orm";
import { db, contracts, creatorAccounts, creators, taxForms, PLATFORMS, type Creator, type CreatorAccount } from "@/db";
import { Badge, Card, Empty, Meter, Notice, PageHeader, PlatformTag, StageBadge, Table, Tabs, Td, btn, btnSm, input, label, cx, type Tone } from "@/components/ui";
import { ActionForm, SubmitButton } from "@/components/client";
import { connectedProviders } from "@/lib/integrations/platforms";
import { taxFormFor, warmupStatus } from "@/lib/engines/onboarding";
import { compact, day, dateTime, relative } from "@/lib/format";
import { generateContractAction, requestTaxFormAction, sendContractAction, setTaxStatusAction, startWarmupAction, syncAccountAction } from "./actions";
import { CopyButton } from "./copy-button";
import { requestOrigin } from "./origin";
import { TermsSummary } from "./terms";

export const metadata = { title: "Onboarding" };

const TABS = [
  { key: "contracts", label: "Contracts" },
  { key: "tax", label: "Tax forms" },
  { key: "accounts", label: "Accounts" },
  { key: "warmup", label: "Warm-up" },
] as const;
type TabKey = (typeof TABS)[number]["key"];

type Contract = typeof contracts.$inferSelect;
type TaxForm = typeof taxForms.$inferSelect;

const PLATFORM_NAME = { tiktok: "TikTok", instagram: "Instagram", youtube: "YouTube" } as const;

export default async function OnboardingPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await connection();
  const sp = await searchParams;
  const tab: TabKey = TABS.some((t) => t.key === sp.tab) ? (sp.tab as TabKey) : "contracts";

  const roster = (await db.select().from(creators).where(inArray(creators.stage, ["trial", "active"]))).sort(
    (a, b) => (a.stage === b.stage ? a.name.localeCompare(b.name) : a.stage === "trial" ? -1 : 1), // trial first: they're mid-onboarding
  );
  const ids = roster.map((c) => c.id);
  const [contractRows, taxRows, accountRows, origin] = await Promise.all([
    ids.length ? db.select().from(contracts).where(inArray(contracts.creatorId, ids)).orderBy(desc(contracts.createdAt)) : [],
    ids.length ? db.select().from(taxForms).where(inArray(taxForms.creatorId, ids)).orderBy(desc(taxForms.createdAt)) : [],
    ids.length ? db.select().from(creatorAccounts).where(inArray(creatorAccounts.creatorId, ids)) : [],
    requestOrigin(),
  ]);

  // Current contract = newest non-void; current tax form = newest.
  const contractOf = new Map<string, Contract>();
  for (const k of contractRows) if (k.status !== "void" && !contractOf.has(k.creatorId)) contractOf.set(k.creatorId, k);
  const taxOf = new Map<string, TaxForm>();
  for (const f of taxRows) if (!taxOf.has(f.creatorId)) taxOf.set(f.creatorId, f);
  const accountsOf = new Map<string, CreatorAccount[]>();
  for (const a of accountRows) accountsOf.set(a.creatorId, [...(accountsOf.get(a.creatorId) ?? []), a]);

  const counts: Record<TabKey, number> = {
    contracts: roster.filter((c) => contractOf.get(c.id)?.status !== "signed").length,
    tax: roster.filter((c) => taxOf.get(c.id)?.status !== "verified").length,
    accounts: accountRows.filter((a) => !a.connected).length,
    warmup: roster.filter((c) => {
      const w = warmupStatus(c.warmupStartedAt, c.warmupTargetDays);
      return w.started && !w.done;
    }).length,
  };

  return (
    <>
      <PageHeader
        step="03 · Onboard"
        title="Onboarding"
        description="Contract, tax form, connected accounts and warm-up for every creator in trial or on the roster. Creators do their part from their own portal link."
      />
      <Tabs active={tab} tabs={TABS.map((t) => ({ key: t.key, label: t.label, href: t.key === "contracts" ? "/onboarding" : `/onboarding?tab=${t.key}`, count: counts[t.key] }))} />

      {roster.length === 0 ? (
        <Empty title="Nobody to onboard yet">
          Move a creator to trial from the <Link href="/pipeline" className="underline">pipeline</Link> and they&apos;ll show up here.
        </Empty>
      ) : tab === "contracts" ? (
        <ContractsTab roster={roster} contractOf={contractOf} origin={origin} />
      ) : tab === "tax" ? (
        <TaxTab roster={roster} taxOf={taxOf} origin={origin} />
      ) : tab === "accounts" ? (
        <AccountsTab roster={roster} accountsOf={accountsOf} />
      ) : (
        <WarmupTab roster={roster} />
      )}
    </>
  );
}

// ─── Contracts ──────────────────────────────────────────────────────────────

const CONTRACT_TONE: Record<string, Tone> = { draft: "neutral", sent: "tally", signed: "profit", void: "loss" };

function ContractsTab({ roster, contractOf, origin }: { roster: Creator[]; contractOf: Map<string, Contract>; origin: string }) {
  return (
    <Card flush title="Contracts" action={<span className="hidden text-[12px] text-muted sm:inline">Creators sign in their portal with a typed name and explicit consent</span>}>
      <ul className="divide-y divide-line">
        {roster.map((c) => {
          const k = contractOf.get(c.id);
          return (
            <li key={c.id} className="px-4 py-3">
              <div className="grid gap-x-4 gap-y-2 md:grid-cols-[190px_110px_1fr_auto] md:items-center">
                <div className="flex min-w-0 items-center gap-2">
                  <Link href={`/creators/${c.id}`} className="truncate font-medium hover:underline">
                    {c.name}
                  </Link>
                  <StageBadge stage={c.stage} />
                </div>
                <div className="text-[12px]">
                  {k ? <Badge tone={CONTRACT_TONE[k.status]}>{k.status}</Badge> : <Badge tone="tally">no contract</Badge>}
                  <div className="mt-0.5 text-muted">{k?.status === "signed" ? `signed ${day(k.signedAt)}` : k?.status === "sent" ? `sent ${day(k.sentAt)}` : k ? `written ${day(k.createdAt)}` : "—"}</div>
                </div>
                <div className="min-w-0">{k ? <TermsSummary t={k.terms} /> : <span className="text-[13px] text-muted">Generate a contract from their rate card to get started.</span>}</div>
                <div className="flex flex-wrap items-center gap-2 md:justify-end">
                  {k && (
                    <Link href={`/onboarding/contracts/${k.id}`} className={cx(btn, btnSm)}>
                      View text
                    </Link>
                  )}
                  {k?.status === "draft" && (
                    <ActionForm action={sendContractAction}>
                      <input type="hidden" name="contractId" value={k.id} />
                      <SubmitButton className={btnSm} variant="primary" pendingText="Saving…">
                        Mark sent
                      </SubmitButton>
                    </ActionForm>
                  )}
                  {!k && (
                    <ActionForm action={generateContractAction}>
                      <input type="hidden" name="creatorId" value={c.id} />
                      <SubmitButton className={btnSm} variant="primary" pendingText="Writing…">
                        Generate contract
                      </SubmitButton>
                    </ActionForm>
                  )}
                  {k && k.status !== "signed" && <CopyButton value={`${origin}/c/${c.portalToken}`} label="Copy signing link" />}
                </div>
              </div>
              <details className="group mt-2">
                <summary className="cursor-pointer select-none text-[12px] text-ink-2 hover:text-ink">{k?.status === "signed" ? "Write a new version" : k ? "Edit terms & regenerate" : "Generate with custom terms"}</summary>
                <ActionForm action={generateContractAction} className="mt-2 rounded-md bg-sunken p-3">
                  <input type="hidden" name="creatorId" value={c.id} />
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                    <label className="block">
                      <span className={label}>Usage rights</span>
                      <select name="usageRights" defaultValue={k?.terms.usageRights ?? "paid_ads"} className={input}>
                        <option value="none">None</option>
                        <option value="organic">Organic reposts</option>
                        <option value="paid_ads">Paid ads + reposts</option>
                      </select>
                    </label>
                    <label className="block">
                      <span className={label}>Usage months</span>
                      <input name="usageMonths" type="number" min={0} max={36} defaultValue={k?.terms.usageMonths ?? 6} className={cx(input, "num")} />
                    </label>
                    <label className="block">
                      <span className={label}>Clawback days</span>
                      <input name="clawbackDays" type="number" min={0} max={180} defaultValue={k?.terms.clawbackDays ?? 30} className={cx(input, "num")} />
                    </label>
                    <label className="block">
                      <span className={label}>Term months</span>
                      <input name="termMonths" type="number" min={1} max={24} defaultValue={k?.terms.termMonths ?? 3} className={cx(input, "num")} />
                    </label>
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-3">
                    <SubmitButton className={btnSm} variant="primary" pendingText="Writing…">
                      {k ? "Regenerate contract" : "Generate contract"}
                    </SubmitButton>
                    <span className="text-[12px] text-muted">Pay terms come from the creator&apos;s rate card. {k && k.status !== "signed" ? "The current unsigned version is voided." : ""}</span>
                  </div>
                </ActionForm>
              </details>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

// ─── Tax forms ──────────────────────────────────────────────────────────────

const TAX_TONE: Record<string, Tone> = { requested: "tally", submitted: "info", verified: "profit", rejected: "loss" };
const humanize = (k: string) => k.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());

function TaxTab({ roster, taxOf, origin }: { roster: Creator[]; taxOf: Map<string, TaxForm>; origin: string }) {
  return (
    <div className="space-y-3">
      <Notice>
        US creators fill in a W-9; everyone else a W-8BEN. They submit it from their portal — the tax ID is encrypted on save and only the last 4 digits are ever shown here.
      </Notice>
      <Card flush>
        <Table head={["Creator", "Form", "Status", "Legal name", "Tax ID", "Submitted", "Portal link", ""]}>
          {roster.map((c) => {
            const f = taxOf.get(c.id);
            const link = `${origin}/c/${c.portalToken}#tax`;
            return (
              <tr key={c.id} className="align-top">
                <Td>
                  <Link href={`/creators/${c.id}`} className="font-medium hover:underline">
                    {c.name}
                  </Link>
                  <div className="num text-[11px] text-muted">{c.country ?? "country unknown"}</div>
                </Td>
                <Td mono>{f?.formType ?? taxFormFor(c.country)}</Td>
                <Td>{f ? <Badge tone={TAX_TONE[f.status]}>{f.status}</Badge> : <Badge>not requested</Badge>}</Td>
                <Td className="max-w-[240px]">
                  {f?.legalName ?? <span className="text-muted">—</span>}
                  {f?.data && Object.keys(f.data).length > 0 && (
                    <details className="mt-1">
                      <summary className="cursor-pointer text-[12px] text-ink-2">Details</summary>
                      <dl className="mt-1 space-y-0.5 text-[12px]">
                        {Object.entries(f.data).map(([k, v]) => (
                          <div key={k} className="flex gap-2">
                            <dt className="shrink-0 text-muted">{humanize(k)}</dt>
                            <dd className="min-w-0 break-words">{v || "—"}</dd>
                          </div>
                        ))}
                        {f.signatureName && (
                          <div className="flex gap-2">
                            <dt className="shrink-0 text-muted">Signed as</dt>
                            <dd>{f.signatureName}</dd>
                          </div>
                        )}
                      </dl>
                    </details>
                  )}
                </Td>
                <Td mono>{f?.tinLast4 ? `•••• ${f.tinLast4}` : "—"}</Td>
                <Td className="whitespace-nowrap text-[12px] text-ink-2">{f?.submittedAt ? day(f.submittedAt) : "—"}</Td>
                <Td>
                  {f?.status === "verified" ? <span className="text-[12px] text-muted">Not needed</span> : <CopyButton value={link} />}
                </Td>
                <Td right>
                  <div className="flex justify-end gap-2">
                    {f?.status === "submitted" && (
                      <>
                        <ActionForm action={setTaxStatusAction}>
                          <input type="hidden" name="formId" value={f.id} />
                          <input type="hidden" name="status" value="verified" />
                          <SubmitButton variant="primary" className={btnSm} pendingText="Saving…">
                            Mark verified
                          </SubmitButton>
                        </ActionForm>
                        <ActionForm action={setTaxStatusAction}>
                          <input type="hidden" name="formId" value={f.id} />
                          <input type="hidden" name="status" value="rejected" />
                          <SubmitButton className={btnSm} pendingText="Saving…">
                            Send back
                          </SubmitButton>
                        </ActionForm>
                      </>
                    )}
                    {!f && (
                      <ActionForm action={requestTaxFormAction}>
                        <input type="hidden" name="creatorId" value={c.id} />
                        <SubmitButton className={btnSm} pendingText="Saving…">
                          Request form
                        </SubmitButton>
                      </ActionForm>
                    )}
                  </div>
                </Td>
              </tr>
            );
          })}
        </Table>
      </Card>
    </div>
  );
}

// ─── Accounts ───────────────────────────────────────────────────────────────

function AccountsTab({ roster, accountsOf }: { roster: Creator[]; accountsOf: Map<string, CreatorAccount[]> }) {
  return (
    <div className="space-y-3">
      <Notice>
        Creators connect each account through the platform&apos;s official login from their portal. Views, likes and posts then come straight from the platform API — no screenshots to chase or check for edits.
      </Notice>
      <div className="flex flex-wrap gap-2 text-[12px]">
        {PLATFORMS.map((p) => {
          const live = connectedProviders[p].configured();
          return (
            <span key={p} className="inline-flex items-center gap-1.5 rounded-md border border-line bg-panel px-2 py-1">
              <span className={cx("h-1.5 w-1.5 rounded-full", live ? "bg-profit" : "bg-muted")} aria-hidden />
              {PLATFORM_NAME[p]}: {live ? "official login on" : "API keys not set — demo connections only"}
            </span>
          );
        })}
      </div>
      <Card flush>
        <Table head={["Creator", "Platform", "Handle", { label: "Followers", align: "right" }, "Connection", "Last synced", ""]}>
          {roster.flatMap((c) => {
            const accts = accountsOf.get(c.id) ?? [];
            if (accts.length === 0)
              return [
                <tr key={c.id}>
                  <Td>
                    <Link href={`/creators/${c.id}`} className="font-medium hover:underline">
                      {c.name}
                    </Link>
                  </Td>
                  <Td className="text-muted" />
                  <td colSpan={5} className="px-3 py-2 text-[13px] text-muted">
                    No accounts yet — the creator can connect one from their portal.
                  </td>
                </tr>,
              ];
            return accts.map((a, i) => (
              <tr key={a.id}>
                <Td>
                  {i === 0 && (
                    <Link href={`/creators/${c.id}`} className="font-medium hover:underline">
                      {c.name}
                    </Link>
                  )}
                </Td>
                <Td>
                  <PlatformTag platform={a.platform} />
                </Td>
                <Td>
                  {a.url ? (
                    <a href={a.url} target="_blank" rel="noreferrer noopener" className="hover:underline">
                      @{a.handle}
                    </a>
                  ) : (
                    `@${a.handle}`
                  )}
                </Td>
                <Td right mono>
                  {compact(a.followers)}
                </Td>
                <Td>
                  {a.connected ? (
                    <span className="flex items-center gap-1.5">
                      <Badge tone={a.accessTokenEnc ? "profit" : "info"}>{a.accessTokenEnc ? "Official login" : "Demo connection"}</Badge>
                      <span className="text-[11px] text-muted">{day(a.connectedAt)}</span>
                    </span>
                  ) : (
                    <Badge tone="tally">Not connected</Badge>
                  )}
                </Td>
                <Td className="whitespace-nowrap text-[12px] text-ink-2">
                  <span title={dateTime(a.lastSyncedAt)}>{a.lastSyncedAt ? relative(a.lastSyncedAt) : "never"}</span>
                </Td>
                <Td right>
                  {a.connected && (
                    <ActionForm action={syncAccountAction}>
                      <input type="hidden" name="accountId" value={a.id} />
                      <SubmitButton className={btnSm} pendingText="Syncing…">
                        Sync now
                      </SubmitButton>
                    </ActionForm>
                  )}
                </Td>
              </tr>
            ));
          })}
        </Table>
      </Card>
    </div>
  );
}

// ─── Warm-up ────────────────────────────────────────────────────────────────

function WarmupTab({ roster }: { roster: Creator[] }) {
  return (
    <div className="space-y-3">
      <Notice>
        Roster only counts the days. The warm-up itself is the creator&apos;s job: using the account normally and engaging in the niche before the first sponsored post.
      </Notice>
      <Card flush>
        <ul className="divide-y divide-line">
          {roster.map((c) => {
            const w = warmupStatus(c.warmupStartedAt, c.warmupTargetDays);
            return (
              <li key={c.id} className="grid gap-x-4 gap-y-2 px-4 py-3 md:grid-cols-[200px_1fr_auto] md:items-center">
                <div className="flex min-w-0 items-center gap-2">
                  <Link href={`/creators/${c.id}`} className="truncate font-medium hover:underline">
                    {c.name}
                  </Link>
                  <StageBadge stage={c.stage} />
                </div>
                <div className="min-w-0">
                  <div className="mb-1 flex items-baseline justify-between gap-2 text-[12px]">
                    <span className={cx(w.started && !w.done ? "text-tally" : "text-ink-2")}>
                      {!w.started ? "Not started" : w.done ? `Done — ${w.targetDays} days completed` : `Day ${w.day} of ${w.targetDays}`}
                    </span>
                    <span className="num text-muted">{w.started ? `started ${day(c.warmupStartedAt)}` : ""}</span>
                  </div>
                  <Meter value={w.started ? Math.min(w.day, w.targetDays) : 0} max={w.targetDays} tone={w.done ? "profit" : w.started ? "tally" : "ink"} />
                </div>
                <ActionForm action={startWarmupAction} className="flex items-center gap-2">
                  <input type="hidden" name="creatorId" value={c.id} />
                  <label className="flex items-center gap-1.5 text-[12px] text-ink-2">
                    <span>Target</span>
                    <input name="days" type="number" min={1} max={60} defaultValue={c.warmupTargetDays} className={cx(input, "num w-16")} aria-label="Target days" />
                    <span>days</span>
                  </label>
                  <SubmitButton className={btnSm} pendingText="Saving…">
                    {w.started ? "Restart" : "Start warm-up"}
                  </SubmitButton>
                </ActionForm>
              </li>
            );
          })}
        </ul>
      </Card>
    </div>
  );
}
