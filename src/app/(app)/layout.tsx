import { Suspense } from "react";
import Link from "next/link";
import { connection } from "next/server";
import { eq, and, inArray } from "drizzle-orm";
import { db, reviews, messages, breakouts, statements } from "@/db";
import { SideNav, SideNavStatic } from "@/components/nav";
import { Sprite } from "@/components/sprites";

async function NavWithCounts() {
  await connection();
  const [pending, inbox, fresh, drafts] = await Promise.all([
    db.$count(reviews, eq(reviews.status, "pending")),
    db.$count(messages, and(eq(messages.direction, "in"), eq(messages.status, "received"))),
    db.$count(breakouts, eq(breakouts.status, "new")),
    db.$count(statements, inArray(statements.status, ["draft", "approved"])),
  ]);
  return <SideNav counts={{ "/review": pending, "/outreach": inbox, "/creative/breakouts": fresh, "/payouts": drafts }} />;
}

function Brand() {
  return (
    <Link href="/" className="mb-5 flex items-center gap-2 px-2">
      <Sprite name="sprout" scale={3} className="bob" />
      <span className="font-display text-[22px] font-medium tracking-[0.02em] text-on-wood">Roster</span>
    </Link>
  );
}

export default function AppLayout({ children }: LayoutProps<"/">) {
  const nav = (
    <Suspense fallback={<SideNavStatic />}>
      <NavWithCounts />
    </Suspense>
  );
  return (
    <div className="flex min-h-screen">
      <aside className="planks sticky top-0 hidden h-screen w-60 shrink-0 overflow-y-auto border-r-4 border-wood-dark px-3 py-5 md:block">
        <Brand />
        {nav}
      </aside>
      <div className="min-w-0 flex-1">
        <details className="planks border-b-4 border-wood-dark px-4 py-3 md:hidden">
          <summary className="flex cursor-pointer list-none items-center justify-between">
            <Brand />
            <span className="font-display text-[15px] text-on-wood">Menu</span>
          </summary>
          <div className="pt-3">{nav}</div>
        </details>
        <div className="p-3 sm:p-6">
          <main className="board mx-auto max-w-[1280px] px-5 py-6 md:px-9 md:py-8">{children}</main>
        </div>
      </div>
    </div>
  );
}
