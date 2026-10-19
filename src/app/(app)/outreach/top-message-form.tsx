"use client";

import { useActionState, type ReactNode } from "react";
import type { ActionResult } from "@/components/client";
import { cx } from "@/components/ui";

/**
 * Like ActionForm, but the result sits at the top and sticks while you scroll —
 * for long forms (a list of drafts) where a message under the last field would be off-screen.
 */
export function TopMessageForm({ action, children, className }: { action: (prev: ActionResult, fd: FormData) => Promise<ActionResult>; children: ReactNode; className?: string }) {
  const [state, formAction] = useActionState(action, null);
  return (
    <form action={formAction} className={className}>
      {state?.message && (
        <p role="status" className={cx("sticky top-0 z-10 border-b border-line px-4 py-2 text-[12px]", state.ok ? "bg-profit-soft text-profit" : "bg-loss-soft text-loss")}>
          {state.message}
        </p>
      )}
      {children}
    </form>
  );
}
