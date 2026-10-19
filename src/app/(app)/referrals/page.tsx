import Link from "next/link";
import { connection } from "next/server";
import { desc, inArray } from "drizzle-orm";
import { db, creators, rateCards, referrals } from "@/db";
import { Badge, Card, Empty, Grid, Notice, PageHeader, StageBadge, Stat, Table, Td, type Tone } from "@/components/ui";
import { defaultRateCard } from "@/lib/services/common";
import { day, usd } from "@/lib/format";
import { groupBy } from "../creators/bits";

export const metadata = { title: "Referrals" };

const STATUS_TONE: Record<string, Tone> = { pending: "neutral", qualified: "tally", paid: "profit", void: "loss" };

export default async function ReferralsPage() {
  await connection();
  const [roster, rows, cards, fallback] = await Promise.all([
    db
      .select()
      .from(creators)
      .where(inArray(creators.stage, ["trial", "active"])),
    db.select().from(referrals).orderBy(desc(referrals.createdAt)),
    db.select().from(rateCards),
    defaultRateCard(),
  ]);
  const peopleIds = [...new Set(rows.flatMap((r) => [r.referrerId, r.referredId]))];
  const people = peopleIds.length ? await db.select({ id: creators.id, name: creators.name, stage: creators.stage }).from(creators).where(inArray(creators.id, peopleIds)) : [];
  const personBy = new Map(people.map((p) => [p.id, p]));
  const cardBy = new Map(cards.map((c) => [c.id, c]));
  const bonusFor = (rateCardId: string | null) => (rateCardId ? cardBy.get(rateCardId) : undefined)?.referralBonusCents ?? fallback.referralBonusCents;
  const byReferrer = groupBy(rows, (r) => r.referrerId);

  const sum = (status: string, list = rows) => list.filter((r) => r.status === status).reduce((a, r) => a + r.bonusCents, 0);
  const count = (status: string) => rows.filter((r) => r.status === status).length;
  const bonuses = [...new Set([fallback.referralBonusCents, ...cards.map((c) => c.referralBonusCents)])].sort((a, b) => a - b);
  const bonusRange = bonuses.length > 1 ? `${usd(bonuses[0])}–${usd(bonuses.at(-1)!)}` : usd(bonuses[0]);

  const perCreator = roster
    .map((c) => {
      const list = byReferrer.get(c.id) ?? [];
      return { c, list, pending: sum("pending", list), qualified: sum("qualified", list), paid: sum("paid", list) };
    })
    .sort((a, b) => b.list.length - a.list.length || a.c.name.localeCompare(b.c.name));

  return (
    <>
      <PageHeader step="02 · Reach" title="Referrals" description="Your creators recruit their friends. Good creators tend to know other good creators." />

      <div className="mb-4">
        <Notice>
          Every creator gets a personal link to share. When a friend signs up through it and later becomes <b className="font-medium">active</b>, the referrer&apos;s {bonusRange} bonus (set per rate
          card) qualifies and is paid on their next statement. If the friend is cut first, the bonus is void.
        </Notice>
      </div>

      <Grid cols={4} className="mb-6">
        <Stat label="Creators referred" value={rows.length} hint={`${rows.filter((r) => personBy.get(r.referredId)?.stage === "active").length} now active`} />
        <Stat label="Pending" value={usd(sum("pending"))} hint={`${count("pending")} waiting to go active`} />
        <Stat label="Qualified, unpaid" value={usd(sum("qualified"))} hint={`${count("qualified")} on the next statement`} tone={count("qualified") ? "tally" : undefined} />
        <Stat label="Paid" value={usd(sum("paid"))} hint={`${count("paid")} bonuses`} />
      </Grid>

      <div className="space-y-4">
        <Card title="Roster links" action={<span className="num text-[12px] text-muted">{roster.length} creators</span>} flush>
          {perCreator.length === 0 ? (
            <div className="p-4">
              <Empty title="No roster yet">Creators get a referral link once they&apos;re in trial or active.</Empty>
            </div>
          ) : (
            <Table
              head={[
                "Creator",
                "Referral link",
                { label: "Bonus each", align: "right" },
                { label: "Referred", align: "right" },
                { label: "Pending", align: "right" },
                { label: "Qualified", align: "right" },
                { label: "Paid", align: "right" },
              ]}
            >
              {perCreator.map(({ c, list, pending, qualified, paid }) => (
                <tr key={c.id}>
                  <Td>
                    <div className="flex items-center gap-2">
                      <Link href={`/creators/${c.id}`} className="whitespace-nowrap font-medium hover:underline">
                        {c.name}
                      </Link>
                      <StageBadge stage={c.stage} />
                    </div>
                  </Td>
                  <Td>
                    <a href={`/join/${c.referralCode}`} target="_blank" rel="noreferrer" className="num select-all whitespace-nowrap text-[12px] text-ink-2 hover:text-ink hover:underline">
                      /join/{c.referralCode}
                    </a>
                  </Td>
                  <Td right mono className="text-ink-2">
                    {usd(bonusFor(c.rateCardId))}
                  </Td>
                  <Td right mono className={list.length ? "font-medium" : "text-muted"}>
                    {list.length}
                  </Td>
                  <Td right mono className={pending ? "" : "text-muted"}>
                    {pending ? usd(pending) : "—"}
                  </Td>
                  <Td right mono className={qualified ? "text-tally" : "text-muted"}>
                    {qualified ? usd(qualified) : "—"}
                  </Td>
                  <Td right mono className={paid ? "" : "text-muted"}>
                    {paid ? usd(paid) : "—"}
                  </Td>
                </tr>
              ))}
            </Table>
          )}
        </Card>

        <Card title="All referrals" action={<span className="num text-[12px] text-muted">{rows.length}</span>} flush>
          {rows.length === 0 ? (
            <div className="p-4">
              <Empty title="No referrals yet">Share a creator&apos;s link from the table above — sign-ups land in the pipeline as replied.</Empty>
            </div>
          ) : (
            <Table head={["Joined", "Referrer", "Referred", "Status", { label: "Bonus", align: "right" }, "Qualified"]}>
              {rows.map((r) => {
                const referrer = personBy.get(r.referrerId);
                const referred = personBy.get(r.referredId);
                return (
                  <tr key={r.id}>
                    <Td mono className="whitespace-nowrap text-ink-2">
                      {day(r.createdAt)}
                    </Td>
                    <Td>
                      <Link href={`/creators/${r.referrerId}`} className="whitespace-nowrap hover:underline">
                        {referrer?.name ?? "—"}
                      </Link>
                    </Td>
                    <Td>
                      <div className="flex items-center gap-2">
                        <Link href={`/creators/${r.referredId}`} className="whitespace-nowrap font-medium hover:underline">
                          {referred?.name ?? "—"}
                        </Link>
                        {referred && <StageBadge stage={referred.stage} />}
                      </div>
                    </Td>
                    <Td>
                      <Badge tone={STATUS_TONE[r.status]}>{r.status}</Badge>
                    </Td>
                    <Td right mono className={r.status === "void" ? "text-muted line-through" : ""}>
                      {usd(r.bonusCents)}
                    </Td>
                    <Td mono className="text-ink-2">
                      {r.qualifiedAt ? day(r.qualifiedAt) : "—"}
                    </Td>
                  </tr>
                );
              })}
            </Table>
          )}
        </Card>
      </div>
    </>
  );
}
