import { Suspense } from "react";
import Loading from "@/app/(app)/loading";
import Link from "next/link";
import { connection } from "next/server";
import { asc } from "drizzle-orm";
import { db, creators, rateCards } from "@/db";
import { PageHeader, Tabs, Notice } from "@/components/ui";
import { defaultRateCard } from "@/lib/services/common";
import { getBrand } from "@/lib/settings";
import { RateCardEditor, type CardInput } from "./editor";

export const metadata = { title: "Rate cards" };

/** Own Suspense boundary: same-route navigations (tabs, filters) re-render below the (app) loading boundary. */
export default function RateCardsPage(props: { searchParams: Promise<{ id?: string; new?: string }> }) {
  return (
    <Suspense fallback={<Loading />}>
      <RateCardsPageContent {...props} />
    </Suspense>
  );
}

async function RateCardsPageContent({ searchParams }: { searchParams: Promise<{ id?: string; new?: string }> }) {
  await connection();
  const sp = await searchParams;
  const fallback = await defaultRateCard(); // creates the Standard card if none exist
  const [cards, assigned, brand] = await Promise.all([
    db.select().from(rateCards).orderBy(asc(rateCards.createdAt)),
    db.select({ rateCardId: creators.rateCardId, stage: creators.stage }).from(creators),
    getBrand(),
  ]);
  const isNew = sp.new === "1";
  const selected = cards.find((c) => c.id === sp.id) ?? fallback;
  const roster = assigned.filter((a) => a.stage === "trial" || a.stage === "active");
  const usedBy = (id: string) => roster.filter((a) => (a.rateCardId ?? fallback.id) === id).length;

  const toInput = (c: typeof selected): CardInput => ({
    id: c.id,
    name: c.name,
    baseCents: c.baseCents,
    cpmCents: c.cpmCents,
    viewWindowDays: c.viewWindowDays,
    perVideoCapCents: c.perVideoCapCents,
    monthlyCapCents: c.monthlyCapCents,
    videosPerMonth: c.videosPerMonth,
    minViewsForCpm: c.minViewsForCpm,
    milestones: c.milestones,
    tiers: c.tiers,
    referralBonusCents: c.referralBonusCents,
  });
  // A new card starts as a copy of the selected one, so you only change what differs.
  const editing: CardInput = isNew ? { ...toInput(selected), id: undefined, name: "", referralBonusCents: brand.referralBonusCents } : toInput(selected);

  return (
    <>
      <PageHeader
        step="08 · Pay"
        title="Rate cards"
        description="What creators earn per video: base pay, per-view pay on credible views, milestone bonuses and caps. The preview shows what a video would pay as you edit."
      />
      <div className="overflow-x-auto">
        <Tabs
          active={isNew ? "new" : selected.id}
          tabs={[
            ...cards.map((c) => ({ key: c.id, label: c.name, href: `/payouts/rate-cards?id=${c.id}`, count: usedBy(c.id) })),
            { key: "new", label: "+ New rate card", href: `/payouts/rate-cards?new=1&id=${selected.id}` },
          ]}
        />
      </div>
      <div className="mb-4">
        {isNew ? (
          <Notice tone="info">
            New rate card, prefilled from &ldquo;{selected.name}&rdquo;. Creators stay on their current card until they&apos;re assigned this one.
          </Notice>
        ) : (
          <Notice tone="info">
            {usedBy(selected.id)} creators in trial or active are on &ldquo;{selected.name}&rdquo;{selected.id === fallback.id ? " (the default for anyone without a card)" : ""}. Changes apply to statements you draft from now on; approved and paid statements keep their amounts.{" "}
            <Link href="/payouts" className="underline">
              Statements
            </Link>
          </Notice>
        )}
      </div>
      <RateCardEditor key={isNew ? `new-${selected.id}` : selected.id} card={editing} />
    </>
  );
}
