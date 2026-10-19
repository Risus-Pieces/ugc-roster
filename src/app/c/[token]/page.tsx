import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { and, desc, eq } from "drizzle-orm";
import { db, briefs, contracts, creatorAccounts, referrals, reviews, statements, taxForms, PLATFORMS, type Platform } from "@/db";
import { Badge, CheckBadge, Meter, Notice, cx, btnPrimary, input, label, type Tone } from "@/components/ui";
import { creatorByPortalToken } from "@/lib/services/onboarding";
import { rateCardFor } from "@/lib/services/common";
import { connectedProviders } from "@/lib/integrations/platforms";
import { taxFormFor, warmupStatus } from "@/lib/engines/onboarding";
import { getBrand } from "@/lib/settings";
import { compact, day, isoDate, relative, usd, usd2 } from "@/lib/format";
import { Markdown } from "@/app/(app)/onboarding/markdown";
import { CopyButton } from "@/app/(app)/onboarding/copy-button";
import { requestOrigin } from "@/app/(app)/onboarding/origin";
import { DraftFields } from "@/app/(app)/review/draft-fields";
import { KeepForm, KeepSubmit, ActionForm, SubmitButton } from "@/components/client";
import { connectDemoAction, setPayoutAction, signContractAction, submitDraftAction, submitTaxFormAction } from "./actions";
import { TaxForm } from "./tax-form";

// Private, token-bearing page: keep it out of search and don't leak the URL to other sites.
export const metadata: Metadata = { title: { absolute: "Your creator page" }, robots: { index: false, follow: false }, referrer: "same-origin" };

const NAME: Record<Platform, string> = { tiktok: "TikTok", instagram: "Instagram", youtube: "YouTube" };
const OAUTH_ERRORS: Record<string, string> = {
  denied: "The connection was cancelled. Try again when you're ready.",
  expired: "That login took too long and expired. Please try again.",
  device: "Please start the connection again from this page, on the same phone or browser you finish it on.",
  not_configured: "Logging in with this platform isn't set up yet. Your contact will let you know when it is.",
  failed: "We couldn't finish connecting your account. Please try again in a minute.",
};

const pInput = cx(input, "!py-2.5 !text-[16px]");
const pLabel = cx(label, "!text-[13px]");
const pButton = "w-full !py-2.5 !text-[15px]";

export default async function CreatorPortal({ params, searchParams }: { params: Promise<{ token: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await connection();
  const [{ token }, sp] = await Promise.all([params, searchParams]);
  const creator = await creatorByPortalToken(token);
  if (!creator) notFound();

  const today = isoDate(new Date());
  const [brand, contractRows, taxForm, accounts, todaysBriefs, myReviews, myStatements, card, myReferrals, origin] = await Promise.all([
    getBrand(),
    db.select().from(contracts).where(eq(contracts.creatorId, creator.id)).orderBy(desc(contracts.createdAt)),
    db.query.taxForms.findFirst({ where: eq(taxForms.creatorId, creator.id), orderBy: desc(taxForms.createdAt) }),
    db.select().from(creatorAccounts).where(eq(creatorAccounts.creatorId, creator.id)),
    db.select().from(briefs).where(and(eq(briefs.creatorId, creator.id), eq(briefs.date, today))),
    db.select().from(reviews).where(eq(reviews.creatorId, creator.id)).orderBy(desc(reviews.createdAt)).limit(5),
    db.select().from(statements).where(eq(statements.creatorId, creator.id)).orderBy(desc(statements.periodStart)).limit(6),
    rateCardFor(creator.rateCardId),
    db.select({ status: referrals.status }).from(referrals).where(eq(referrals.referrerId, creator.id)),
    requestOrigin(),
  ]);

  const contract = contractRows.find((k) => k.status !== "void");
  const signed = contract?.status === "signed";
  const taxDone = taxForm?.status === "submitted" || taxForm?.status === "verified";
  const connectedN = accounts.filter((a) => a.connected).length;
  const accountsDone = accounts.length > 0 && connectedN === accounts.length;
  const payoutDone = Boolean(creator.payoutProvider && creator.payoutDestination);
  const w = warmupStatus(creator.warmupStartedAt, creator.warmupTargetDays);
  const first = creator.name.split(" ")[0];
  const defaultTax = taxFormFor(creator.country);
  const citizenship = creator.country ? (new Intl.DisplayNames(["en"], { type: "region" }).of(creator.country.toUpperCase()) ?? creator.country) : undefined;
  const connected = typeof sp.connected === "string" && (PLATFORMS as readonly string[]).includes(sp.connected) ? (sp.connected as Platform) : null;
  const oauthError = typeof sp.error === "string" ? (OAUTH_ERRORS[sp.error] ?? OAUTH_ERRORS.failed) : null;

  const steps = [
    { done: signed, label: "Sign your contract", detail: signed ? `Signed ${day(contract?.signedAt)}` : contract?.status === "sent" ? "Ready to sign" : "Being prepared", href: "#contract" },
    { done: taxDone, label: "Submit your tax form", detail: taxForm?.status === "verified" ? "Verified" : taxForm?.status === "submitted" ? "Submitted — we're checking it" : taxForm?.status === "rejected" ? "Please submit it again" : `${defaultTax} needed`, href: "#tax" },
    { done: accountsDone, label: "Connect your accounts", detail: accounts.length ? `${connectedN} of ${accounts.length} connected` : "No accounts on file yet", href: "#accounts" },
    { done: payoutDone, label: "Set your payout method", detail: payoutDone ? NAME_PAYOUT[creator.payoutProvider!] : "How you want to get paid", href: "#payout" },
    { done: w.done, label: "Warm up your account", detail: !w.started ? "Starts once you're set up" : w.done ? `${w.targetDays} days done` : `Day ${w.day} of ${w.targetDays}`, href: "#warmup" },
  ];
  const doneN = steps.filter((s) => s.done).length;

  return (
    <main className="board mx-3 my-4 max-w-xl px-5 pb-16 pt-7 text-[15px] sm:mx-auto sm:my-8 sm:px-7">
      <header className="mb-5">
        <div className="mb-3 flex items-center gap-2 text-[13px] text-ink-2">
          <span className="h-2 w-2 rounded-full bg-tally" aria-hidden />
          {brand.name} creator program
        </div>
        <h1 className="font-display text-[28px] font-bold leading-tight tracking-[-0.02em]">Hi {first}</h1>
        <p className="mt-1 text-ink-2">
          {doneN === steps.length ? "You're all set. Today's brief and your drafts are below." : "Everything you need for the program lives on this page. Bookmark it — it's your private link."}
        </p>
      </header>

      {connected && (
        <div className="mb-4">
          <Notice tone="profit">{NAME[connected]} connected. Your views now come straight from {NAME[connected]} — no screenshots needed.</Notice>
        </div>
      )}
      {oauthError && (
        <div className="mb-4">
          <Notice tone="loss">{oauthError}</Notice>
        </div>
      )}

      {/* ── Checklist ───────────────────────────────────────────────────── */}
      <Section id="status" title="Your setup" aside={<span className="num text-[13px] text-ink-2">{doneN}/{steps.length}</span>}>
        <Meter value={doneN} max={steps.length} tone={doneN === steps.length ? "profit" : "tally"} />
        <ul className="mt-3 divide-y divide-line">
          {steps.map((s) => (
            <li key={s.label}>
              <a href={s.href} className="flex items-center gap-3 py-2.5">
                <span className={cx("flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-[12px]", s.done ? "border-profit bg-profit text-panel" : "border-line-strong text-muted")} aria-hidden>
                  {s.done ? "✓" : ""}
                </span>
                <span className="min-w-0 flex-1">
                  <span className={cx("block", s.done && "text-ink-2")}>{s.label}</span>
                  <span className="block text-[13px] text-muted">{s.detail}</span>
                </span>
                {!s.done && <span className="text-muted">›</span>}
              </a>
            </li>
          ))}
        </ul>
        {w.started && !w.done && (
          <div id="warmup" className="mt-3 scroll-mt-4 rounded-lg bg-sunken p-3 text-[13px] text-ink-2">
            <div className="mb-1.5 flex justify-between">
              <span className="font-medium text-ink">Warm-up: day {w.day} of {w.targetDays}</span>
              <span className="num">{w.remaining} to go</span>
            </div>
            <Meter value={w.day} max={w.targetDays} tone="tally" />
            <p className="mt-2">Use your account like you normally would and engage with videos in your niche. We just count the days — the warm-up is up to you.</p>
          </div>
        )}
        {(!w.started || w.done) && <span id="warmup" />}
      </Section>

      {/* ── Today's brief ───────────────────────────────────────────────── */}
      <Section id="brief" title={todaysBriefs.length > 1 ? "Today's briefs" : "Today's brief"}>
        {todaysBriefs.length === 0 ? (
          <p className="text-ink-2">No brief for today yet. Check back later today.</p>
        ) : (
          <div className="space-y-5">
            {todaysBriefs.map((b) => (
              <article key={b.id}>
                <div className="mb-1.5 flex flex-wrap items-center gap-2 text-[12px]">
                  <Badge tone={b.kind === "breakout" ? "tally" : b.kind === "test" ? "info" : "neutral"}>{b.kind === "breakout" ? "trending now" : b.kind === "test" ? "new format" : "proven format"}</Badge>
                  <span className="text-ink-2">{b.format}</span>
                  {b.status !== "assigned" && <Badge tone={b.status === "done" ? "profit" : "info"}>{b.status}</Badge>}
                </div>
                <h3 className="font-display text-[19px] font-bold leading-snug tracking-[-0.01em]">&ldquo;{b.hook}&rdquo;</h3>
                <div className="mt-3">
                  <div className={pLabel}>Script</div>
                  <p className="whitespace-pre-line rounded-lg bg-sunken p-3 text-[14px] leading-relaxed">{b.script}</p>
                </div>
                {b.shotList.length > 0 && (
                  <div className="mt-3">
                    <div className={pLabel}>Shot list</div>
                    <ol className="space-y-1.5">
                      {b.shotList.map((s, i) => (
                        <li key={i} className="flex gap-2.5 text-[14px]">
                          <span className="num mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-sunken text-[11px] text-ink-2">{i + 1}</span>
                          <span>{s}</span>
                        </li>
                      ))}
                    </ol>
                  </div>
                )}
              </article>
            ))}
          </div>
        )}
      </Section>

      {/* ── Submit a draft ──────────────────────────────────────────────── */}
      <Section id="submit" title="Submit a draft for review">
        <p className="mb-3 text-[14px] text-ink-2">Send your video before you post it. We check it automatically, then a person approves it. Only approved videos get paid — please don&apos;t post until you hear back.</p>
        <KeepForm action={submitDraftAction} resetOnSuccess>
          <input type="hidden" name="token" value={token} />
          <DraftFields roomy briefs={todaysBriefs.map((b) => ({ id: b.id, label: `Today: ${b.hook.slice(0, 60)}${b.hook.length > 60 ? "…" : ""}` }))} />
          <KeepSubmit variant="primary" className={cx(pButton, "mt-4")} pendingText="Checking your draft…">
            Submit for review
          </KeepSubmit>
        </KeepForm>

        {myReviews.length > 0 && (
          <div className="mt-6">
            <h3 className="mb-2 text-[13px] font-semibold">Your drafts</h3>
            <ul className="space-y-3">
              {myReviews.map((r) => (
                <li key={r.id} className="rounded-lg border border-line p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone={REVIEW_TONE[r.status]}>{REVIEW_LABEL[r.status]}</Badge>
                    <span className="text-[12px] text-muted">
                      {NAME[r.platform]} · sent {relative(r.createdAt)}
                    </span>
                  </div>
                  <p className="mt-1.5 line-clamp-2 break-words text-[14px]">{r.caption}</p>
                  {r.reviewerNotes && (
                    <p className="mt-2 rounded-md bg-tally-soft px-2.5 py-1.5 text-[13px] text-ink">
                      <span className="font-medium">Notes: </span>
                      {r.reviewerNotes}
                    </p>
                  )}
                  {r.checks && r.checks.length > 0 && (
                    <details className="mt-2" open={r.status === "pending"}>
                      <summary className="flex cursor-pointer items-center gap-1.5 text-[13px] text-ink-2">
                        Automatic checks {r.overall && <CheckBadge status={r.overall} />}
                      </summary>
                      <ul className="mt-2 space-y-2">
                        {r.checks.map((c) => (
                          <li key={c.key} className="text-[13px]">
                            <div className="flex items-center justify-between gap-2">
                              <span className="font-medium">{c.label}</span>
                              <CheckBadge status={c.status} />
                            </div>
                            <p className="text-[12px] leading-snug text-ink-2">{c.detail}</p>
                          </li>
                        ))}
                      </ul>
                    </details>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}
      </Section>

      {/* ── Contract ────────────────────────────────────────────────────── */}
      <Section id="contract" title="Your contract" aside={contract && <Badge tone={signed ? "profit" : contract.status === "sent" ? "tally" : "neutral"}>{signed ? "signed" : contract.status === "sent" ? "ready to sign" : "being prepared"}</Badge>}>
        {!contract || contract.status === "draft" ? (
          <p className="text-ink-2">We&apos;re preparing your contract. It&apos;ll show up here to sign — we&apos;ll let you know.</p>
        ) : (
          <>
            <div className="mb-3 grid grid-cols-2 gap-2 text-[13px]">
              <Term k="Per video" v={money(contract.terms.baseCents)} />
              <Term k="Per 1,000 views" v={usd2(contract.terms.cpmCents)} />
              <Term k="Videos per month" v={String(contract.terms.videosPerMonth)} />
              <Term k="Views counted for" v={`${contract.terms.viewWindowDays} days`} />
              <Term k="Max per video" v={money(contract.terms.perVideoCapCents)} />
              <Term k="Max per month" v={money(contract.terms.monthlyCapCents)} />
            </div>
            <details className="rounded-lg border border-line" open={!signed}>
              <summary className="cursor-pointer px-3 py-2.5 text-[14px] font-medium">Read the full contract</summary>
              <div className="max-h-[60vh] overflow-y-auto border-t border-line px-3 py-2 text-[14px]">
                <Markdown source={contract.body} />
              </div>
            </details>
            {signed ? (
              <p className="mt-3 text-[13px] text-ink-2">
                Signed by <span className="font-medium text-ink">{contract.signatureName}</span> on {contract.signedAt?.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}.
              </p>
            ) : (
              <ActionForm action={signContractAction} className="mt-4 space-y-3">
                <input type="hidden" name="token" value={token} />
                <input type="hidden" name="contractId" value={contract.id} />
                <label className="block">
                  <span className={pLabel}>Type your full legal name</span>
                  <input name="name" required minLength={3} autoComplete="name" className={cx(pInput, "font-display !text-[18px]")} />
                </label>
                <label className="flex items-start gap-2.5 text-[14px]">
                  <input type="checkbox" name="consent" required className="mt-0.5 h-5 w-5 shrink-0 accent-[var(--ink)]" />
                  <span>I agree to sign electronically, and that typing my name is my legal signature on this contract.</span>
                </label>
                <SubmitButton variant="primary" className={pButton} pendingText="Signing…">
                  Sign contract
                </SubmitButton>
                <p className="text-[12px] text-muted">We record your name, the time, your IP address and device, and a fingerprint of the exact text you signed.</p>
              </ActionForm>
            )}
          </>
        )}
      </Section>

      {/* ── Tax form ────────────────────────────────────────────────────── */}
      <Section id="tax" title="Tax form" aside={taxForm && taxForm.status !== "requested" && <Badge tone={taxForm.status === "verified" ? "profit" : taxForm.status === "rejected" ? "loss" : "info"}>{taxForm.status}</Badge>}>
        {taxDone && taxForm ? (
          <>
            <p className="text-[14px]">
              {taxForm.formType} submitted {day(taxForm.submittedAt)}
              {taxForm.tinLast4 && (
                <>
                  {" "}
                  · tax ID ending <span className="num">{taxForm.tinLast4}</span>
                </>
              )}
            </p>
            <p className="mt-1 text-[13px] text-ink-2">{taxForm.status === "verified" ? "Verified — you're all set." : "We'll check it shortly. Nothing else to do."}</p>
            {taxForm.status === "submitted" && (
              <details className="mt-3">
                <summary className="cursor-pointer text-[13px] text-ink-2">Made a mistake? Submit it again</summary>
                <div className="mt-3">
                  <TaxForm action={submitTaxFormAction} token={token} defaultType={taxForm.formType} citizenship={citizenship} />
                </div>
              </details>
            )}
          </>
        ) : (
          <>
            {taxForm?.status === "rejected" && (
              <div className="mb-3">
                <Notice tone="loss">We couldn&apos;t verify your last form. Please check the details and submit it again.</Notice>
              </div>
            )}
            <p className="mb-3 text-[14px] text-ink-2">We need this before your first payment. It takes about two minutes.</p>
            <TaxForm action={submitTaxFormAction} token={token} defaultType={defaultTax} citizenship={citizenship} />
          </>
        )}
      </Section>

      {/* ── Accounts ────────────────────────────────────────────────────── */}
      <Section id="accounts" title="Connect your accounts">
        <p className="mb-3 text-[14px] text-ink-2">
          Log in with each platform so we can read your views directly — that&apos;s what your pay is based on, so you never have to send screenshots. We never see your password and can&apos;t post for you.
        </p>
        <ul className="divide-y divide-line">
          {PLATFORMS.map((p) => {
            const acct = accounts.find((a) => a.platform === p);
            const live = connectedProviders[p].configured();
            return (
              <li key={p} className="flex flex-wrap items-center gap-3 py-3">
                <div className="min-w-0 flex-1">
                  <div className="font-medium">{NAME[p]}</div>
                  <div className="text-[13px] text-muted">
                    {acct ? (
                      <>
                        @{acct.handle} · <span className="num">{compact(acct.followers)}</span> followers
                        {acct.connected && <> · synced {acct.lastSyncedAt ? relative(acct.lastSyncedAt) : "soon"}</>}
                      </>
                    ) : (
                      "No account on file"
                    )}
                  </div>
                </div>
                {acct?.connected && !live ? (
                  <Badge tone="profit">Connected</Badge>
                ) : live ? (
                  <a href={`/api/oauth/${p}/start?token=${token}`} className={cx(btnPrimary, "!py-2")}>
                    {acct?.connected ? "Reconnect" : `Log in with ${NAME[p]}`}
                  </a>
                ) : acct ? (
                  <ActionForm action={connectDemoAction}>
                    <input type="hidden" name="token" value={token} />
                    <input type="hidden" name="platform" value={p} />
                    <SubmitButton className="!py-2" pendingText="Connecting…">
                      Connect (demo)
                    </SubmitButton>
                  </ActionForm>
                ) : (
                  <span className="text-[13px] text-muted">Not available yet</span>
                )}
              </li>
            );
          })}
        </ul>
        {PLATFORMS.some((p) => !connectedProviders[p].configured()) && (
          <p className="mt-2 text-[12px] text-muted">
            &ldquo;Demo&rdquo; marks an account as connected without logging in. Real login needs the platform&apos;s API keys, which haven&apos;t been added to this workspace yet.
          </p>
        )}
      </Section>

      {/* ── Payout ──────────────────────────────────────────────────────── */}
      <Section id="payout" title="Payout method">
        {payoutDone && (
          <p className="mb-3 text-[14px]">
            Paid by <span className="font-medium">{NAME_PAYOUT[creator.payoutProvider!]}</span> to <span className="num break-all">{creator.payoutDestination}</span>
          </p>
        )}
        <KeepForm action={setPayoutAction} className="space-y-3">
          <input type="hidden" name="token" value={token} />
          <label className="block">
            <span className={pLabel}>Get paid with</span>
            <select name="provider" defaultValue={creator.payoutProvider ?? "paypal"} className={pInput}>
              <option value="paypal">PayPal</option>
              <option value="wise">Wise</option>
              <option value="stripe">Stripe</option>
            </select>
          </label>
          <label className="block">
            <span className={pLabel}>Where to send it</span>
            <input name="destination" required defaultValue={creator.payoutDestination ?? ""} autoComplete="off" className={pInput} />
            <span className="mt-1 block text-[12px] leading-snug text-muted">PayPal: the email on your PayPal account · Wise: your recipient ID (numbers) · Stripe: your connected account ID (starts with acct_)</span>
          </label>
          <KeepSubmit className={pButton} pendingText="Saving…">
            {payoutDone ? "Update payout method" : "Save payout method"}
          </KeepSubmit>
        </KeepForm>
      </Section>

      {/* ── Referral ────────────────────────────────────────────────────── */}
      <Section id="refer" title="Refer a creator">
        <p className="text-[14px] text-ink-2">
          Earn <span className="num font-medium text-ink">{money(card.referralBonusCents)}</span> for each creator you refer who finishes their trial and joins the program.
        </p>
        <div className="mt-3 flex items-center gap-2 rounded-lg bg-sunken p-2 pl-3">
          <span className="num min-w-0 flex-1 truncate text-[13px]">{`${origin}/join/${creator.referralCode}`}</span>
          <CopyButton value={`${origin}/join/${creator.referralCode}`} small={false} className="!py-2" />
        </div>
        {myReferrals.length > 0 && (
          <p className="mt-2 text-[13px] text-ink-2">
            <span className="num">{myReferrals.length}</span> referred · <span className="num">{myReferrals.filter((r) => r.status === "qualified" || r.status === "paid").length}</span> joined
          </p>
        )}
      </Section>

      {/* ── Statements ──────────────────────────────────────────────────── */}
      <Section id="statements" title="Payments">
        {myStatements.length === 0 ? (
          <p className="text-[14px] text-ink-2">No statements yet. You&apos;ll get one each month for your approved, published videos.</p>
        ) : (
          <ul className="divide-y divide-line">
            {myStatements.map((s) => (
              <li key={s.id} className="flex items-center justify-between gap-3 py-2.5">
                <span className="text-[14px]">
                  {day(new Date(`${s.periodStart}T12:00:00Z`))} – {day(new Date(`${s.periodEnd}T12:00:00Z`))}
                </span>
                <span className="flex items-center gap-2">
                  <span className="num font-medium">{usd2(s.totalCents)}</span>
                  <Badge tone={STATEMENT_TONE[s.status]}>{STATEMENT_LABEL[s.status]}</Badge>
                </span>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <footer className="mt-8 text-center text-[12px] text-muted">
        Questions? Reply to any email from {brand.senderName.split(" ")[0]} at {brand.name}.
      </footer>
    </main>
  );
}

const money = (c: number) => (c % 100 ? usd2(c) : usd(c));
const NAME_PAYOUT: Record<"wise" | "paypal" | "stripe", string> = { wise: "Wise", paypal: "PayPal", stripe: "Stripe" };
const REVIEW_TONE: Record<string, Tone> = { pending: "info", approved: "profit", changes_requested: "tally", rejected: "loss" };
const REVIEW_LABEL: Record<string, string> = { pending: "Waiting for approval", approved: "Approved — go ahead and post", changes_requested: "Changes requested", rejected: "Not approved" };
const STATEMENT_TONE: Record<string, Tone> = { draft: "neutral", approved: "info", paid: "profit", failed: "loss" };
const STATEMENT_LABEL: Record<string, string> = { draft: "being prepared", approved: "approved", paid: "paid", failed: "payment failed" };

function Section({ id, title, aside, children }: { id: string; title: string; aside?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section id={id} className="mb-4 scroll-mt-4 rounded-xl border border-line bg-panel p-4 sm:p-5">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="font-display text-[18px] font-bold tracking-[-0.01em]">{title}</h2>
        {aside}
      </div>
      {children}
    </section>
  );
}

function Term({ k, v }: { k: string; v: string }) {
  return (
    <div className="rounded-lg bg-sunken px-3 py-2">
      <div className="text-[12px] text-muted">{k}</div>
      <div className="num text-[15px] font-medium">{v}</div>
    </div>
  );
}
