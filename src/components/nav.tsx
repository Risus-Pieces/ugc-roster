"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cx } from "./ui";
import { Sprite, STEP_SPRITES } from "./sprites";
import { signOut } from "@/app/login/actions";

// The creator lifecycle is a real sequence, so the groups are numbered.
export const NAV = [
  { step: "01", group: "Find", items: [{ href: "/discover", label: "Discover" }, { href: "/creators", label: "Creators" }] },
  { step: "02", group: "Reach", items: [{ href: "/outreach", label: "Outreach" }, { href: "/pipeline", label: "Pipeline" }, { href: "/referrals", label: "Referrals" }] },
  { step: "03", group: "Onboard", items: [{ href: "/onboarding", label: "Onboarding" }] },
  { step: "04", group: "Create", items: [{ href: "/creative", label: "Hook bank" }, { href: "/creative/breakouts", label: "Breakouts" }, { href: "/creative/briefs", label: "Daily briefs" }] },
  { step: "05", group: "Review", items: [{ href: "/review", label: "Review queue" }] },
  { step: "06", group: "Track", items: [{ href: "/tracking", label: "Posts & leaderboard" }] },
  { step: "07", group: "Attribute", items: [{ href: "/attribution", label: "Attribution" }] },
  { step: "08", group: "Pay", items: [{ href: "/payouts", label: "Statements" }, { href: "/payouts/rate-cards", label: "Rate cards" }, { href: "/payouts/tax", label: "Tax & 1099s" }] },
  { step: "09", group: "Decide", items: [{ href: "/decisions", label: "Profit check" }, { href: "/decisions/forecast", label: "Forecast" }] },
];

const ALL_HREFS = NAV.flatMap((g) => g.items.map((i) => i.href));

/** The most specific nav entry that matches the current path wins. */
function isActive(path: string, href: string) {
  const best = ALL_HREFS.filter((h) => path === h || path.startsWith(h + "/")).sort((a, b) => b.length - a.length)[0];
  return best === href;
}

export function SideNav({ counts }: { counts?: Record<string, number> }) {
  return <NavList path={usePathname()} counts={counts} />;
}

/** Suspense fallback: reading the pathname would itself suspend on dynamic routes, so this one doesn't. */
export function SideNavStatic() {
  return <NavList path="" />;
}

function NavList({ path, counts }: { path: string; counts?: Record<string, number> }) {
  const item = (active: boolean) =>
    cx("flex items-center justify-between px-2 py-1 font-bold", active ? "bg-panel text-ink px-frame" : "text-on-wood hover:bg-wood-dark/50");
  return (
    <nav className="space-y-3 text-[13px]">
      <Link href="/" className={item(path === "/")}>
        <span className="flex items-center gap-2">
          <Sprite name="sun" scale={2} />
          Today
        </span>
      </Link>
      {NAV.map((g) => (
        <div key={g.group}>
          <div className="mb-1 flex items-center gap-2 px-2 font-display text-[12px] uppercase tracking-[0.14em] text-on-wood-2">
            <Sprite name={STEP_SPRITES[g.step]} scale={2} />
            <span>
              {g.step} {g.group}
            </span>
          </div>
          <div className="space-y-0.5 pl-6">
            {g.items.map((i) => {
              const active = isActive(path, i.href);
              const n = counts?.[i.href];
              return (
                <Link key={i.href} href={i.href} className={item(active)}>
                  {i.label}
                  {n ? <span className="num bg-gold px-1.5 text-[12px] text-wood-dark">{n}</span> : null}
                </Link>
              );
            })}
          </div>
        </div>
      ))}
      <div className="border-t-2 border-wood-dark pt-3">
        <Link href="/settings" className={item(path.startsWith("/settings"))}>
          <span className="flex items-center gap-2">
            <Sprite name="hammer" scale={2} />
            Settings & integrations
          </span>
        </Link>
        <form action={signOut}>
          <button type="submit" className="mt-1 w-full px-2 py-1 text-left text-[12px] font-bold text-on-wood-2 hover:text-on-wood">
            Sign out
          </button>
        </form>
      </div>
    </nav>
  );
}
