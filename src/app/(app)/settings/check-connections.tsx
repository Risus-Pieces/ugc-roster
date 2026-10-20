"use client";

import { useActionState } from "react";
import { Badge, btn, cx } from "@/components/ui";
import { checkConnectionsAction } from "./actions";

const TONE = { ok: "profit", warn: "tally", fail: "loss", off: "neutral" } as const;
const LABEL = { ok: "Working", warn: "Needs attention", fail: "Not working", off: "Not set up" } as const;

export function CheckConnections() {
  const [state, run, pending] = useActionState(checkConnectionsAction, null);
  return (
    <div>
      <form action={run} className="flex items-center gap-3">
        <button type="submit" disabled={pending} className={cx(btn, "px-btn")}>
          {pending ? "Checking…" : "Check connections"}
        </button>
        <span className="text-[12px] text-muted">Makes a read-only call to each service. Nothing is sent.</span>
      </form>
      {state && (
        <ul className="mt-3 divide-y divide-line border-2 border-line bg-field">
          {state.checks.map((c) => (
            <li key={c.name} className="flex flex-wrap items-start gap-x-3 gap-y-1 px-3 py-2 text-[13px]">
              <Badge tone={TONE[c.status]} className="mt-0.5">
                {LABEL[c.status]}
              </Badge>
              <div className="min-w-0 flex-1">
                <div className="font-bold">{c.name}</div>
                <div className="text-ink-2">{c.detail}</div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
