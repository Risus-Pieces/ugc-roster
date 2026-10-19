import type { ContractTerms } from "@/db";
import { usd, usd2 } from "@/lib/format";

/** Whole dollars when there are no cents ($25), otherwise two decimals ($0.75). */
export const money = (c: number) => (c % 100 ? usd2(c) : usd(c));

const USAGE: Record<ContractTerms["usageRights"], string> = { none: "none", organic: "organic", paid_ads: "paid ads" };

export function TermsSummary({ t }: { t: ContractTerms }) {
  const items: [string, string][] = [
    ["Rate", `${money(t.baseCents)}/video`],
    ["Per view", `${usd2(t.cpmCents)}/1K`],
    ["Quota", `${t.videosPerMonth}/mo`],
    ["Window", `${t.viewWindowDays}d`],
    ["Caps", `${money(t.perVideoCapCents)}/video · ${money(t.monthlyCapCents)}/mo`],
    ["Usage", t.usageRights === "none" ? "none" : `${USAGE[t.usageRights]} ${t.usageMonths} mo`],
    ["Clawback", `${t.clawbackDays}d`],
    ["Term", `${t.termMonths} mo`],
  ];
  return (
    <dl className="flex flex-wrap gap-x-4 gap-y-1 text-[12px]">
      {items.map(([k, v]) => (
        <div key={k} className="flex gap-1">
          <dt className="text-muted">{k}</dt>
          <dd className="num text-ink">{v}</dd>
        </div>
      ))}
    </dl>
  );
}
