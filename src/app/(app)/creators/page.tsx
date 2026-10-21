import Link from "next/link";
import Form from "next/form";
import { connection } from "next/server";
import { desc } from "drizzle-orm";
import { db, campaigns, campaignCreators, creators, creatorAccounts, STAGES } from "@/db";
import { Badge, Card, Empty, PageHeader, Pager, StageBadge, Table, Td, btn, btnSm, cx, input, pageParam } from "@/components/ui";
import { latestScores } from "@/lib/services/common";
import { compact } from "@/lib/format";
import { Authenticity, EmailCell, Handles, groupBy, one, type SearchParams } from "./bits";
import { Villager } from "@/components/sprites";

export const metadata = { title: "Creators" };

const PAGE_SIZE = 50;

export default async function CreatorsPage({ searchParams }: { searchParams: SearchParams }) {
  await connection();
  const sp = await searchParams;
  const q = (one(sp.q) ?? "").trim();
  const stageParam = one(sp.stage);
  const stage = STAGES.find((s) => s === stageParam);
  const withEmail = one(sp.email) === "with";

  const [all, accts, scores, links, camps] = await Promise.all([
    db.select().from(creators).orderBy(desc(creators.createdAt)),
    db.select({ creatorId: creatorAccounts.creatorId, platform: creatorAccounts.platform, handle: creatorAccounts.handle, followers: creatorAccounts.followers }).from(creatorAccounts),
    latestScores(),
    db.select().from(campaignCreators),
    db.select({ id: campaigns.id, name: campaigns.name }).from(campaigns),
  ]);
  const acctBy = groupBy(accts, (a) => a.creatorId);
  const campName = new Map(camps.map((c) => [c.id, c.name]));
  const campsBy = groupBy(links, (l) => l.creatorId);
  // With a single campaign the column would repeat its name on every row.
  const manyCampaigns = camps.length > 1;

  const needle = q.toLowerCase().replace(/^@/, "");
  const matchesQ = (c: (typeof all)[number]) =>
    !needle || c.name.toLowerCase().includes(needle) || (c.email ?? "").toLowerCase().includes(needle) || (acctBy.get(c.id) ?? []).some((a) => a.handle.toLowerCase().includes(needle));

  const searched = all.filter((c) => matchesQ(c) && (!withEmail || c.email));
  const counts = new Map<string, number>();
  for (const c of searched) counts.set(c.stage, (counts.get(c.stage) ?? 0) + 1);
  const filtered = searched.filter((c) => !stage || c.stage === stage).sort((a, b) => (scores.get(b.id)?.medianViews ?? -1) - (scores.get(a.id)?.medianViews ?? -1));
  const page = pageParam(sp.page, filtered.length, PAGE_SIZE);
  const shown = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const emailCount = all.filter((c) => c.email && matchesQ(c) && (!stage || c.stage === stage)).length;

  const href = (s: string | null | undefined = stage, opts: { email?: boolean; page?: number } = {}) => {
    const p = new URLSearchParams();
    if (q) p.set("q", q);
    if (s) p.set("stage", s);
    if (opts.email ?? withEmail) p.set("email", "with");
    if (opts.page && opts.page > 1) p.set("page", String(opts.page));
    const str = p.toString();
    return str ? `/creators?${str}` : "/creators";
  };

  return (
    <>
      <PageHeader step="01 · Find" title="Creators" description="Everyone you've found, contacted or signed, ranked by typical (median) views." />

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Form action="/creators" className="flex min-w-[260px] flex-1 gap-2 sm:max-w-md">
          {stage && <input type="hidden" name="stage" value={stage} />}
          {withEmail && <input type="hidden" name="email" value="with" />}
          <input name="q" defaultValue={q} placeholder="Search name, @handle or email" className={input} aria-label="Search creators" />
          <button type="submit" className={btn}>
            Search
          </button>
        </Form>
        <nav className="flex flex-wrap gap-1" aria-label="Filter by stage">
          <Link href={href(null)} className={cx(btn, btnSm, !stage && "!border-ink !bg-sunken")}>
            All <span className="num text-muted">{searched.length}</span>
          </Link>
          {STAGES.map((s) => (
            <Link key={s} href={href(s)} className={cx(btn, btnSm, stage === s && "!border-ink !bg-sunken")}>
              {s} <span className="num text-muted">{counts.get(s) ?? 0}</span>
            </Link>
          ))}
        </nav>
        <Link href={href(stage, { email: !withEmail })} className={cx(btn, btnSm, withEmail && "!border-ink !bg-sunken")} aria-pressed={withEmail}>
          <span aria-hidden className={cx("inline-block h-2.5 w-2.5 border", withEmail ? "border-ink bg-ink" : "border-line-strong")} />
          Only with email <span className="num text-muted">{emailCount}</span>
        </Link>
      </div>

      <Card flush>
        {shown.length === 0 ? (
          <div className="p-4">
            <Empty
              title={q || stage || withEmail ? "No creators match" : "No creators yet"}
              action={
                q || stage || withEmail ? (
                  <Link href="/creators" className={btn}>
                    Clear filters
                  </Link>
                ) : (
                  <Link href="/discover" className={btn}>
                    Run discovery
                  </Link>
                )
              }
            >
              {q || stage || withEmail ? "Try a shorter search, another stage, or turn off “Only with email”." : "Create a campaign in Discover and run it to pull in creators."}
            </Empty>
          </div>
        ) : (
          <Table head={["Name", "Stage", "Platforms", { label: "Followers", align: "right" }, { label: "Median views", align: "right" }, "Audience", "Email", ...(manyCampaigns ? ["Campaigns"] : [])]}>
            {shown.map((c) => {
              const accounts = acctBy.get(c.id) ?? [];
              const s = scores.get(c.id);
              const cIds = (campsBy.get(c.id) ?? []).map((l) => l.campaignId);
              return (
                <tr key={c.id} className="align-top">
                  <Td>
                    <div className="flex items-start gap-2">
                      <Villager seed={c.id} scale={2} />
                      <div>
                        <Link href={`/creators/${c.id}`} className="whitespace-nowrap font-bold hover:underline">
                          {c.name}
                        </Link>
                        {c.country && <div className="num text-[12px] text-muted">{c.country}</div>}
                      </div>
                    </div>
                  </Td>
                  <Td>
                    <StageBadge stage={c.stage} />
                  </Td>
                  <Td>
                    <Handles accounts={accounts} />
                  </Td>
                  <Td right mono>
                    {accounts.length ? compact(Math.max(...accounts.map((a) => a.followers))) : "—"}
                  </Td>
                  <Td right mono className="font-medium">
                    {s ? compact(s.medianViews) : "—"}
                  </Td>
                  <Td>
                    <Authenticity score={s} />
                  </Td>
                  <Td>
                    <EmailCell email={c.email} />
                  </Td>
                  {manyCampaigns && (
                    <Td>
                      <div className="flex max-w-[240px] flex-wrap gap-1">
                        {cIds.length ? cIds.map((id) => <Badge key={id}>{campName.get(id) ?? "—"}</Badge>) : <span className="text-[13px] text-muted">{c.referredById ? "referral" : "—"}</span>}
                      </div>
                    </Td>
                  )}
                </tr>
              );
            })}
          </Table>
        )}
        <Pager page={page} pageSize={PAGE_SIZE} total={filtered.length} href={(n) => href(stage, { page: n })} />
      </Card>
    </>
  );
}
