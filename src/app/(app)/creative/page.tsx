import Link from "next/link";
import { connection } from "next/server";
import { and, desc, eq, isNull } from "drizzle-orm";
import { db, creators, posts } from "@/db";
import { Badge, Card, Empty, PageHeader, PlatformTag, Table, Td, VerticalFrame, cx } from "@/components/ui";
import { ActionForm, SubmitButton } from "@/components/client";
import { refreshHookBankAction } from "@/app/actions/jobs";
import { median } from "@/lib/engines/stats";
import { compact } from "@/lib/format";
import { CompetitorForm } from "./competitor-form";

export const metadata = { title: "Hook bank" };

type Filters = { source?: string; format?: string; hook?: string };

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) || undefined;

export default async function HookBankPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await connection();
  const sp = await searchParams;
  const f: Filters = { source: one(sp.source), format: one(sp.format), hook: one(sp.hook) };
  if (f.source !== "roster" && f.source !== "competitor") f.source = undefined;

  const bank = await db
    .select({
      id: posts.id,
      source: posts.source,
      platform: posts.platform,
      hookText: posts.hookText,
      hookType: posts.hookType,
      format: posts.format,
      caption: posts.caption,
      views: posts.views,
      competitorName: posts.competitorName,
      creatorName: creators.name,
    })
    .from(posts)
    .leftJoin(creators, eq(creators.id, posts.creatorId))
    .where(and(eq(posts.inHookBank, true), isNull(posts.removedAt)))
    .orderBy(desc(posts.views));

  // Format summary follows the source filter; the grid follows all three.
  const bySource = bank.filter((p) => !f.source || p.source === f.source);
  const shown = bySource.filter((p) => (!f.format || p.format === f.format) && (!f.hook || p.hookType === f.hook));
  const formats = [...groupBy(bySource, (p) => p.format ?? "Untagged")]
    .map(([format, ps]) => ({ format, n: ps.length, med: median(ps.map((p) => p.views)), competitor: ps.filter((p) => p.source === "competitor").length }))
    .sort((a, b) => b.med - a.med);
  const hookTypes = [...groupBy(bySource, (p) => p.hookType ?? "untagged")].map(([h, ps]) => ({ h, n: ps.length })).sort((a, b) => b.n - a.n);
  const rosterN = bank.filter((p) => p.source !== "competitor").length;

  const href = (patch: Filters) => {
    const next = { ...f, ...patch };
    const q = new URLSearchParams(Object.entries(next).filter((e): e is [string, string] => Boolean(e[1])));
    return q.size ? `/creative?${q}` : "/creative";
  };

  return (
    <>
      <PageHeader
        step="04 · Create"
        title="Hook bank"
        description="The top 5% of videos from your roster and from competitors, transcribed and tagged by hook and format. Daily briefs are built from what's here."
        actions={
          <ActionForm action={refreshHookBankAction}>
            <SubmitButton variant="primary" pendingText="Refreshing…">
              Refresh hook bank
            </SubmitButton>
          </ActionForm>
        }
      />

      <div className="grid gap-4 xl:grid-cols-[1fr_340px]">
        <div className="min-w-0 space-y-4">
          <div className="space-y-2 rounded-lg border border-line bg-panel px-4 py-3">
            <FilterRow label="Source">
              <Chip href={href({ source: undefined })} active={!f.source}>
                All <span className="num">{bank.length}</span>
              </Chip>
              <Chip href={href({ source: "roster" })} active={f.source === "roster"}>
                Roster <span className="num">{rosterN}</span>
              </Chip>
              <Chip href={href({ source: "competitor" })} active={f.source === "competitor"}>
                Competitors <span className="num">{bank.length - rosterN}</span>
              </Chip>
            </FilterRow>
            <FilterRow label="Format">
              <Chip href={href({ format: undefined })} active={!f.format}>
                All
              </Chip>
              {formats.map((x) => (
                <Chip key={x.format} href={href({ format: x.format })} active={f.format === x.format}>
                  {x.format} <span className="num">{x.n}</span>
                </Chip>
              ))}
            </FilterRow>
            <FilterRow label="Hook">
              <Chip href={href({ hook: undefined })} active={!f.hook}>
                All
              </Chip>
              {hookTypes.map((x) => (
                <Chip key={x.h} href={href({ hook: x.h })} active={f.hook === x.h}>
                  {x.h.replace("_", " ")} <span className="num">{x.n}</span>
                </Chip>
              ))}
            </FilterRow>
          </div>

          {shown.length === 0 ? (
            <Empty
              title={bank.length ? "Nothing matches these filters" : "The hook bank is empty"}
              action={
                bank.length ? (
                  <Link href="/creative" className="text-[14px] underline">
                    Clear filters
                  </Link>
                ) : undefined
              }
            >
              {bank.length ? "Try another format or hook type." : "Refresh the hook bank to pull in your roster's top 5%, or add a competitor video."}
            </Empty>
          ) : (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 2xl:grid-cols-5">
              {shown.map((p) => (
                <VerticalFrame
                  key={p.id}
                  href={`/creative/${p.id}`}
                  hook={p.hookText ?? (p.caption ?? "").split("\n")[0]}
                  views={p.views}
                  meta={
                    <>
                      {p.source === "competitor" ? (p.competitorName ?? "Competitor") : (p.creatorName ?? "Roster")} · {p.format ?? "untagged"}
                    </>
                  }
                >
                  <div className="flex flex-wrap items-center gap-1">
                    {p.source === "competitor" && <Badge tone="info">competitor</Badge>}
                    {p.hookType && <Badge>{p.hookType.replace("_", " ")}</Badge>}
                    <PlatformTag platform={p.platform} />
                  </div>
                </VerticalFrame>
              ))}
            </div>
          )}
        </div>

        <div className="space-y-4">
          <Card title="Formats" flush action={<span className="text-[12px] text-muted">by median views</span>}>
            {formats.length === 0 ? (
              <p className="px-4 py-3 text-[14px] text-muted">No formats tagged yet.</p>
            ) : (
              <Table head={["Format", { label: "Videos", align: "right" }, { label: "Median", align: "right" }]}>
                {formats.map((x) => (
                  <tr key={x.format} className={cx(f.format === x.format && "bg-sunken")}>
                    <Td>
                      <Link href={href({ format: f.format === x.format ? undefined : x.format })} className="hover:underline">
                        {x.format}
                      </Link>
                      {x.competitor > 0 && <span className="ml-1 text-[12px] text-muted">({x.competitor} comp.)</span>}
                    </Td>
                    <Td right mono>
                      {x.n}
                    </Td>
                    <Td right mono>
                      {compact(x.med)}
                    </Td>
                  </tr>
                ))}
              </Table>
            )}
          </Card>

          <Card title="Add competitor video">
            <p className="mb-3 text-[14px] text-ink-2">Paste a competitor video that&apos;s working. It&apos;s tagged by hook and format and joins the bank, so briefs can borrow the structure — never the words.</p>
            <CompetitorForm />
          </Card>
        </div>
      </div>
    </>
  );
}

function groupBy<T>(items: T[], key: (t: T) => string) {
  const m = new Map<string, T[]>();
  for (const it of items) m.set(key(it), [...(m.get(key(it)) ?? []), it]);
  return m;
}

function FilterRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="w-14 shrink-0 text-[12px] font-semibold text-muted">{label}</span>
      {children}
    </div>
  );
}

function Chip({ href, active, children }: { href: string; active: boolean; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      scroll={false}
      className={cx("inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[13px]", active ? "border-ink bg-ink text-panel" : "border-line bg-panel text-ink-2 hover:border-line-strong hover:text-ink")}
    >
      {children}
    </Link>
  );
}
