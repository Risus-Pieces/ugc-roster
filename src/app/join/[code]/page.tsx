import { Suspense } from "react";
import type { Metadata } from "next";
import { connection } from "next/server";
import { eq } from "drizzle-orm";
import { db, creators } from "@/db";
import { rateCardFor } from "@/lib/services/common";
import { getBrand } from "@/lib/settings";
import { compact, usd, usd2 } from "@/lib/format";
import { JoinForm } from "./join-form";

export const metadata: Metadata = { title: { absolute: "You're invited" }, robots: { index: false, follow: false } };

/** Public page behind a creator's referral link. The shell is static; the invite streams in. */
export default function JoinPage({ params }: { params: Promise<{ code: string }> }) {
  return (
    <main className="min-h-screen px-4 py-8 sm:py-14">
      <div className="board mx-auto w-full max-w-md px-6 py-7">
        <Suspense fallback={<InviteSkeleton />}>
          <Invite params={params} />
        </Suspense>
      </div>
    </main>
  );
}

async function Invite({ params }: { params: Promise<{ code: string }> }) {
  await connection();
  const { code } = await params;
  const [referrer, brand] = await Promise.all([db.query.creators.findFirst({ where: eq(creators.referralCode, code.toUpperCase()) }), getBrand()]);

  if (!referrer) {
    return (
      <>
        <BrandMark name={brand.name} />
        <div className="rounded-lg border border-line bg-panel p-5">
          <h1 className="font-display text-[22px] font-bold tracking-[-0.02em]">This invite link isn&apos;t valid</h1>
          <p className="mt-2 text-ink-2">Check that you copied the whole link, or ask the friend who sent it for a new one.</p>
        </div>
      </>
    );
  }

  const card = await rateCardFor(referrer.rateCardId);
  const first = referrer.name.split(" ")[0];
  const milestones = [...card.milestones].sort((a, b) => a.views - b.views);

  return (
    <>
      <BrandMark name={brand.name} />
      <h1 className="font-display text-[26px] font-bold leading-tight tracking-[-0.02em]">
        {first} invited you to make paid videos for {brand.name}
      </h1>
      <p className="mt-2 text-ink-2">
        {brand.product} is {brand.valueProp}. We pay small creators a flat rate per video plus extra for views — no follower minimum to apply.
      </p>

      <section className="mt-5 rounded-lg border border-line bg-panel" aria-label="The offer">
        <dl className="divide-y divide-line">
          <div className="flex items-baseline justify-between gap-3 px-4 py-3">
            <dt className="text-ink-2">Per approved video</dt>
            <dd className="num text-[20px] font-medium">{usd(card.baseCents)}</dd>
          </div>
          <div className="flex items-baseline justify-between gap-3 px-4 py-3">
            <dt className="text-ink-2">
              Per 1,000 views
              <span className="block text-[12px] text-muted">views in the first {card.viewWindowDays} days</span>
            </dt>
            <dd className="num text-[20px] font-medium">+{usd2(card.cpmCents)}</dd>
          </div>
          {milestones.length > 0 && (
            <div className="flex items-baseline justify-between gap-3 px-4 py-3">
              <dt className="text-ink-2">Bonuses</dt>
              <dd className="num text-right text-[13px]">
                {milestones.map((m) => (
                  <div key={m.views}>
                    {usd(m.bonusCents)} at {compact(m.views)} views
                  </div>
                ))}
              </dd>
            </div>
          )}
        </dl>
        <p className="border-t border-line px-4 py-2.5 text-[12px] text-muted">Paid monthly by Wise, PayPal or bank transfer. Up to {usd(card.perVideoCapCents)} per video.</p>
      </section>

      <ol className="mt-5 space-y-1.5 text-[13px] text-ink-2">
        {["Tell us where you post.", "We send a sample brief and a link for a quick call.", "Get the app, post, and get paid for every approved video."].map((s, i) => (
          <li key={s} className="flex gap-2.5">
            <span className="num flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-sunken text-[11px] text-ink">{i + 1}</span>
            {s}
          </li>
        ))}
      </ol>

      <div className="mt-6">
        <JoinForm code={referrer.referralCode} inviter={first} />
      </div>
    </>
  );
}

function BrandMark({ name }: { name: string }) {
  return (
    <div className="mb-6 flex items-center gap-2">
      <span className="inline-flex h-2.5 w-2.5 rounded-full bg-tally" aria-hidden />
      <span className="font-display text-[17px] font-bold tracking-[-0.02em]">{name}</span>
    </div>
  );
}

function InviteSkeleton() {
  return (
    <div className="animate-pulse space-y-4" aria-busy="true" aria-label="Loading invite">
      <div className="h-4 w-24 rounded bg-sunken" />
      <div className="h-8 w-full rounded bg-sunken" />
      <div className="h-4 w-3/4 rounded bg-sunken" />
      <div className="h-40 rounded-lg border border-line bg-panel" />
      <div className="h-72 rounded-lg border border-line bg-panel" />
    </div>
  );
}
