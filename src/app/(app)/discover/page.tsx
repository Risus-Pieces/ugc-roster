import Link from "next/link";
import Form from "next/form";
import { connection } from "next/server";
import { desc, inArray } from "drizzle-orm";
import { db, campaigns, campaignCreators, creators, creatorAccounts, PLATFORMS, type Platform } from "@/db";
import { Badge, Card, Empty, Field, Meter, Notice, PageHeader, PlatformTag, StageBadge, Table, Tabs, Td, btn, btnSm, cx, input, label } from "@/components/ui";
import { ActionForm, SubmitButton } from "@/components/client";
import { discoveryProviders, findLookalikes } from "@/lib/services/discovery";
import { latestScores } from "@/lib/services/common";
import { compact, pct, usd } from "@/lib/format";
import { createCampaignAction, createLookalikeCampaignAction } from "./actions";
import { RunDiscovery } from "./run-discovery";
import { Authenticity, EmailCell, Handles, groupBy, kfmt, many, one, viralDependence, type SearchParams } from "../creators/bits";

export const metadata = { title: "Discover" };

const PLATFORM_NAME: Record<Platform, string> = { tiktok: "TikTok", instagram: "Instagram", youtube: "YouTube" };

// Bios carry contact emails ("collabs: maya [at] gmail [dot] com"), which leak into shared terms.
const NOT_KEYWORDS = new Set(["com", "co", "net", "org", "gmail", "outlook", "icloud", "hotmail", "yahoo", "dot", "collabs", "business", "email", "dm"]);

export default async function DiscoverPage({ searchParams }: { searchParams: SearchParams }) {
  await connection();
  const sp = await searchParams;
  const tab = one(sp.tab) === "lookalikes" ? "lookalikes" : "campaigns";
  return (
    <>
      <PageHeader step="01 · Find" title="Discover" description="We judge creators on typical views: the median of recent posts and their 5 worst videos — not their one viral hit." />
      <Tabs
        active={tab}
        tabs={[
          { key: "campaigns", label: "Campaigns", href: "/discover" },
          { key: "lookalikes", label: "Find more like my top 10", href: "/discover?tab=lookalikes" },
        ]}
      />
      {tab === "campaigns" ? <CampaignsTab sp={sp} /> : <LookalikesTab sp={sp} />}
    </>
  );
}

// ─── Campaigns + results ────────────────────────────────────────────────────

type SP = Awaited<SearchParams>;

const SORTS = {
  median: { label: "Median views" },
  worst5: { label: "Worst 5 avg" },
  max: { label: "Max views" },
  er: { label: "ER" },
  followers: { label: "Followers" },
  base: { label: "Base / video" },
} as const;
type SortKey = keyof typeof SORTS;

async function CampaignsTab({ sp }: { sp: SP }) {
  const [all, links, emails] = await Promise.all([
    db.select().from(campaigns).orderBy(desc(campaigns.createdAt)),
    db.select({ campaignId: campaignCreators.campaignId, creatorId: campaignCreators.creatorId }).from(campaignCreators),
    db.select({ id: creators.id, email: creators.email }).from(creators),
  ]);
  const hasEmail = new Set(emails.filter((e) => e.email).map((e) => e.id));
  const byCampaign = groupBy(links, (l) => l.campaignId);
  const selected = all.find((c) => c.id === one(sp.campaign)) ?? all[0];

  return (
    <div className="space-y-4">
      <div className="grid gap-4 lg:grid-cols-[1fr_340px]">
        <Card title="Campaigns" action={<span className="num text-[12px] text-muted">{all.length}</span>} flush>
          {all.length === 0 ? (
            <div className="p-4">
              <Empty title="No campaigns yet">Create one with a niche and a few keywords, then run discovery to pull in creators.</Empty>
            </div>
          ) : (
            <ul className="divide-y divide-line">
              {all.map((c) => {
                const members = byCampaign.get(c.id) ?? [];
                const withEmail = members.filter((m) => hasEmail.has(m.creatorId)).length;
                const band = `${kfmt(c.minFollowers)}–${kfmt(c.maxFollowers)}`;
                return (
                  <li key={c.id} className={cx("px-4 py-3", c.id === selected?.id && "bg-sunken/60")}>
                    <RunDiscovery campaignId={c.id} band={band} resultsHref={`/discover?campaign=${c.id}`}>
                      <div className="flex flex-wrap items-baseline gap-x-2">
                        <Link href={`/discover?campaign=${c.id}`} className="font-medium hover:underline">
                          {c.name}
                        </Link>
                        <span className="text-[12px] text-muted">{c.niche}</span>
                        {c.status !== "active" && <Badge>{c.status}</Badge>}
                      </div>
                      <div className="mt-1 flex flex-wrap gap-1">
                        {c.keywords.map((k) => (
                          <Badge key={k}>{k}</Badge>
                        ))}
                      </div>
                      <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-[12px] text-ink-2">
                        <span className="flex flex-wrap gap-x-2">
                          {discoveryProviders(c.platforms).map((p) => (
                            <span key={p.platform} className="flex items-center gap-1">
                              <PlatformTag platform={p.platform} />
                              <span className={p.live ? "text-profit" : "text-muted"}>{p.live ? p.name : "demo"}</span>
                            </span>
                          ))}
                        </span>
                        <span className="num">{band} followers</span>
                        <span className="num">
                          {members.length} creators · {withEmail} with email
                        </span>
                      </div>
                    </RunDiscovery>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>

        <NewCampaignCard />
      </div>

      {selected && <Results campaign={selected} creatorIds={(byCampaign.get(selected.id) ?? []).map((l) => l.creatorId)} sp={sp} />}
    </div>
  );
}

function NewCampaignCard() {
  const providers = discoveryProviders(PLATFORMS);
  return (
    <Card title="New campaign">
      <ActionForm action={createCampaignAction} className="space-y-3">
        <Field label="Name">
          <input name="name" required className={input} placeholder="Meal prep — November" />
        </Field>
        <Field label="Niche">
          <input name="niche" required className={input} placeholder="meal prep" />
        </Field>
        <Field label="Keywords" hint="Comma-separated. Each keyword is searched on each platform.">
          <input name="keywords" required className={input} placeholder="meal prep, high protein, calorie counting" />
        </Field>
        <fieldset>
          <legend className={label}>Platforms</legend>
          <div className="flex flex-wrap gap-x-4 gap-y-1">
            {PLATFORMS.map((p) => (
              <label key={p} className="flex items-center gap-1.5 text-[13px]">
                <input type="checkbox" name="platforms" value={p} defaultChecked />
                {PLATFORM_NAME[p]}
              </label>
            ))}
          </div>
        </fieldset>
        <div className="grid grid-cols-2 gap-2">
          <Field label="Min followers">
            <input type="number" name="minFollowers" defaultValue={2000} min={0} step={100} className={cx(input, "num")} />
          </Field>
          <Field label="Max followers">
            <input type="number" name="maxFollowers" defaultValue={20000} min={0} step={100} className={cx(input, "num")} />
          </Field>
        </div>
        <p className="text-[12px] text-muted">
          2K–20K is the sweet spot: big enough to get views, small enough to say yes to a fair flat rate.{" "}
          {providers.map((p) => `${PLATFORM_NAME[p.platform]}: ${p.live ? p.name : "demo data"}`).join(" · ")}. Only YouTube has official keyword search (set YOUTUBE_API_KEY).
        </p>
        <SubmitButton variant="primary" pendingText="Creating…">
          Create campaign
        </SubmitButton>
      </ActionForm>
    </Card>
  );
}

async function Results({ campaign, creatorIds, sp }: { campaign: typeof campaigns.$inferSelect; creatorIds: string[]; sp: SP }) {
  const sort: SortKey = (one(sp.sort) as SortKey) in SORTS ? (one(sp.sort) as SortKey) : "median";
  const hideFake = one(sp.fake) === "hide";
  const hideNoEmail = one(sp.noemail) === "hide";

  const [cs, accts, scores] = creatorIds.length
    ? await Promise.all([
        db.select().from(creators).where(inArray(creators.id, creatorIds)),
        db.select().from(creatorAccounts).where(inArray(creatorAccounts.creatorId, creatorIds)),
        latestScores(creatorIds),
      ])
    : [[], [], new Map()];
  const acctBy = groupBy(accts, (a) => a.creatorId);
  const rows = cs.map((c) => {
    const accounts = acctBy.get(c.id) ?? [];
    return { c, accounts, followers: Math.max(0, ...accounts.map((a) => a.followers)), s: scores.get(c.id) };
  });
  type Row = (typeof rows)[number];
  const value: Record<SortKey, (r: Row) => number> = {
    median: (r) => r.s?.medianViews ?? -1,
    worst5: (r) => r.s?.worst5AvgViews ?? -1,
    max: (r) => r.s?.maxViews ?? -1,
    er: (r) => r.s?.engagementRate ?? -1,
    followers: (r) => r.followers,
    base: (r) => r.s?.suggestedBaseCents ?? -1,
  };
  const shown = rows
    .filter((r) => !hideFake || r.s?.authenticityVerdict !== "fail")
    .filter((r) => !hideNoEmail || r.c.email)
    .sort((a, b) => value[sort](b) - value[sort](a));

  const href = (patch: Record<string, string | undefined>) => {
    const q = new URLSearchParams();
    const merged: Record<string, string | undefined> = {
      campaign: campaign.id,
      sort: sort === "median" ? undefined : sort,
      fake: hideFake ? "hide" : undefined,
      noemail: hideNoEmail ? "hide" : undefined,
      ...patch,
    };
    for (const [k, v] of Object.entries(merged)) if (v) q.set(k, v);
    return `/discover?${q}`;
  };
  const head = (k: SortKey) => (
    <Link href={href({ sort: k === "median" ? undefined : k })} scroll={false} className={cx("hover:text-ink", sort === k && "text-ink")}>
      {SORTS[k].label}
      {sort === k && " ↓"}
    </Link>
  );
  const chip = (on: boolean, text: string, patch: Record<string, string | undefined>) => (
    <Link href={href(patch)} scroll={false} className={cx(btn, btnSm, on && "!border-ink")}>
      <span aria-hidden className={cx("inline-block h-2.5 w-2.5 rounded-sm border", on ? "border-ink bg-ink" : "border-line-strong")} />
      {text}
    </Link>
  );
  const fakeCount = rows.filter((r) => r.s?.authenticityVerdict === "fail").length;
  const noEmailCount = rows.filter((r) => !r.c.email).length;

  return (
    <Card
      title={
        <>
          Results <span className="font-normal text-muted">· {campaign.name}</span>
        </>
      }
      action={
        <span className="num text-[12px] text-muted">
          {shown.length} of {rows.length}
        </span>
      }
      flush
    >
      <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-2">
        {chip(hideFake, `Hide likely fake (${fakeCount})`, { fake: hideFake ? undefined : "hide" })}
        {chip(hideNoEmail, `Hide no email (${noEmailCount})`, { noemail: hideNoEmail ? undefined : "hide" })}
        <span className="ml-auto text-[12px] text-muted">Max views is shown for context only — pay and ranking use median and worst 5.</span>
      </div>
      {rows.length === 0 ? (
        <div className="p-4">
          <Empty title="No creators in this campaign yet">
            Run discovery above to search {campaign.platforms.map((p) => PLATFORM_NAME[p]).join(", ")} for “{campaign.keywords.join("”, “")}”.
          </Empty>
        </div>
      ) : shown.length === 0 ? (
        <div className="p-4">
          <Empty title="Every creator is hidden by the filters">Turn off a filter above to see them.</Empty>
        </div>
      ) : (
        <Table
          head={[
            "Creator",
            "Handles",
            { label: head("followers"), align: "right" },
            { label: head("median"), align: "right" },
            { label: head("worst5"), align: "right" },
            { label: head("max"), align: "right" },
            { label: head("er"), align: "right" },
            "Audience",
            "Email",
            { label: head("base"), align: "right" },
            "Stage",
          ]}
        >
          {shown.map(({ c, accounts, followers, s }) => {
            const dep = s ? viralDependence(s) : 0;
            return (
              <tr key={c.id} className="align-top">
                <Td>
                  <Link href={`/creators/${c.id}`} className="whitespace-nowrap font-medium hover:underline">
                    {c.name}
                  </Link>
                  {c.country && <div className="num text-[11px] text-muted">{c.country}</div>}
                </Td>
                <Td>
                  <Handles accounts={accounts} />
                </Td>
                <Td right mono>
                  {followers ? compact(followers) : "—"}
                </Td>
                <Td right mono className="font-medium">
                  {s ? compact(s.medianViews) : "—"}
                </Td>
                <Td right mono>
                  {s ? compact(s.worst5AvgViews) : "—"}
                </Td>
                <Td right mono>
                  {s ? (
                    <>
                      <span className="text-ink-2">{compact(s.maxViews)}</span>
                      <div className={cx("whitespace-nowrap text-[11px]", dep >= 10 ? "text-tally" : "text-muted")} title="Max views ÷ median views — how much one hit inflates their profile">
                        {dep.toFixed(1)}× median
                      </div>
                    </>
                  ) : (
                    "—"
                  )}
                </Td>
                <Td right mono>
                  {s ? pct(s.engagementRate) : "—"}
                </Td>
                <Td>
                  <Authenticity score={s} />
                </Td>
                <Td>
                  <EmailCell email={c.email} />
                </Td>
                <Td right mono>
                  {s ? usd(s.suggestedBaseCents) : "—"}
                </Td>
                <Td>
                  <StageBadge stage={c.stage} />
                </Td>
              </tr>
            );
          })}
        </Table>
      )}
    </Card>
  );
}

// ─── Find more like my top 10 ───────────────────────────────────────────────

async function LookalikesTab({ sp }: { sp: SP }) {
  const chosen = many(sp.seed);
  const [r, roster] = await Promise.all([
    findLookalikes(chosen.length ? chosen : undefined, 25),
    db
      .select()
      .from(creators)
      .where(inArray(creators.stage, ["trial", "active"])),
  ]);
  const ids = [...new Set([...roster.map((c) => c.id), ...r.results.map((x) => x.id), ...r.seeds.map((s) => s.id)])];
  const [scores, accts] = await Promise.all([
    latestScores(roster.map((c) => c.id)),
    ids.length ? db.select().from(creatorAccounts).where(inArray(creatorAccounts.creatorId, ids)) : Promise.resolve([]),
  ]);
  const acctBy = groupBy(accts, (a) => a.creatorId);
  const seedIds = new Set(r.seeds.map((s) => s.id));
  const keywords = r.keywords.filter((k) => !NOT_KEYWORDS.has(k));
  const rosterSorted = [...roster].sort((a, b) => (scores.get(b.id)?.medianViews ?? -1) - (scores.get(a.id)?.medianViews ?? -1));

  const niches = groupBy(
    r.seeds.filter((s) => s.niche),
    (s) => s.niche!,
  );
  const niche = [...niches.entries()].sort((a, b) => b[1].length - a[1].length)[0]?.[0] ?? "lookalike";
  const seedPlatforms = [...new Set(r.seeds.flatMap((s) => (acctBy.get(s.id) ?? []).map((a) => a.platform)))];
  const today = new Date().toLocaleDateString("en-US", { month: "short", day: "numeric" });

  return (
    <div className="grid gap-4 lg:grid-cols-[300px_1fr]">
      <Card
        title="Seed creators"
        action={
          <span className="num text-[12px] text-muted">
            {r.seeds.length} of {roster.length}
          </span>
        }
        flush
      >
        {roster.length === 0 ? (
          <div className="p-4">
            <Empty title="No roster yet">Move creators to trial or active, then come back to find more like them.</Empty>
          </div>
        ) : (
          <Form action="/discover" scroll={false} key={[...seedIds].join(",")}>
            <input type="hidden" name="tab" value="lookalikes" />
            <p className="border-b border-line px-4 py-2 text-[12px] text-muted">
              {chosen.length ? "Your picks." : "Default: your 10 roster creators with the best typical views."} Change the ticks to match a different group.
            </p>
            <ul className="max-h-[520px] divide-y divide-line overflow-y-auto">
              {rosterSorted.map((c) => (
                <li key={c.id}>
                  <label className="flex cursor-pointer items-center gap-2 px-4 py-1.5 hover:bg-sunken/60">
                    <input type="checkbox" name="seed" value={c.id} defaultChecked={seedIds.has(c.id)} />
                    <span className="min-w-0 flex-1 truncate">{c.name}</span>
                    <StageBadge stage={c.stage} />
                    <span className="num w-12 text-right text-[12px] text-ink-2">{scores.get(c.id) ? compact(scores.get(c.id)!.medianViews) : "—"}</span>
                  </label>
                </li>
              ))}
            </ul>
            <div className="flex flex-wrap gap-2 border-t border-line px-4 py-2.5">
              <button type="submit" className={cx(btn, btnSm)}>
                Use ticked seeds
              </button>
              <Link href="/discover?tab=lookalikes" className={cx(btn, btnSm)}>
                Reset to top 10
              </Link>
            </div>
          </Form>
        )}
      </Card>

      <div className="min-w-0 space-y-4">
        <Notice>
          Similarity blends topic overlap with your seeds&apos; bios and captions (45%), typical views (25%), audience size (15%) and engagement rate (15%). Prospects whose audience looks fake are
          left out.
        </Notice>

        <Card title="Suggested search keywords">
          {keywords.length === 0 ? (
            <p className="text-ink-2">Not enough shared words across these seeds to suggest keywords. Tick seeds from the same niche.</p>
          ) : (
            <ActionForm action={createLookalikeCampaignAction} className="space-y-3">
              <div className="flex flex-wrap gap-1">
                {keywords.map((k) => (
                  <Badge key={k} tone="info">
                    {k}
                  </Badge>
                ))}
              </div>
              <input type="hidden" name="keywords" value={keywords.join(", ")} />
              <input type="hidden" name="niche" value={niche} />
              {(seedPlatforms.length ? seedPlatforms : ["tiktok", "instagram"]).map((p) => (
                <input key={p} type="hidden" name="platforms" value={p} />
              ))}
              <div className="flex flex-wrap items-end gap-2">
                <div className="min-w-[220px] flex-1">
                  <Field label="Campaign name">
                    <input name="name" className={input} defaultValue={`Lookalikes of top ${r.seeds.length} — ${today}`} />
                  </Field>
                </div>
                <SubmitButton variant="primary" pendingText="Creating…">
                  Create campaign from keywords
                </SubmitButton>
              </div>
              <p className="text-[12px] text-muted">
                Searches {seedPlatforms.length ? seedPlatforms.map((p) => PLATFORM_NAME[p]).join(", ") : "TikTok, Instagram"} in the 2K–20K band. Run discovery on it next.
              </p>
            </ActionForm>
          )}
        </Card>

        <Card title="Lookalike prospects" action={<span className="num text-[12px] text-muted">{r.results.length}</span>} flush>
          {r.results.length === 0 ? (
            <div className="p-4">
              <Empty title="No scored prospects to compare">Run discovery on a campaign to pull in prospects, then check back.</Empty>
            </div>
          ) : (
            <Table
              head={[
                "#",
                "Creator",
                "Handles",
                { label: "Followers", align: "right" },
                { label: "Median views", align: "right" },
                { label: "ER", align: "right" },
                { label: "Topic match", align: "right" },
                "Similarity",
                "Audience",
                "Email",
                "Stage",
              ]}
            >
              {r.results.map((x, i) => (
                <tr key={x.id} className="align-top">
                  <Td mono className="text-muted">
                    {i + 1}
                  </Td>
                  <Td>
                    <Link href={`/creators/${x.id}`} className="whitespace-nowrap font-medium hover:underline">
                      {x.creator.name}
                    </Link>
                  </Td>
                  <Td>
                    <Handles accounts={acctBy.get(x.id) ?? []} />
                  </Td>
                  <Td right mono>
                    {compact(Math.max(0, ...(acctBy.get(x.id) ?? []).map((a) => a.followers)))}
                  </Td>
                  <Td right mono className="font-medium">
                    {compact(x.score.medianViews)}
                  </Td>
                  <Td right mono>
                    {pct(x.score.engagementRate)}
                  </Td>
                  <Td right mono>
                    {pct(x.topic, 0)}
                  </Td>
                  <Td>
                    <div className="flex w-28 items-center gap-2">
                      <Meter value={x.similarity} max={1} tone={x.similarity >= 0.6 ? "profit" : "ink"} />
                      <span className="num w-9 text-right text-[12px]">{pct(x.similarity, 0)}</span>
                    </div>
                  </Td>
                  <Td>
                    <Authenticity score={x.score} />
                  </Td>
                  <Td>
                    <EmailCell email={x.creator.email} />
                  </Td>
                  <Td>
                    <StageBadge stage={x.creator.stage} />
                  </Td>
                </tr>
              ))}
            </Table>
          )}
        </Card>
      </div>
    </div>
  );
}
