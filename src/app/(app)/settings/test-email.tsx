"use client";

import { useRef, useState, useTransition, type KeyboardEvent } from "react";
import { Badge, btn, cx, input, label } from "@/components/ui";
import { sendTestEmailAction } from "./actions";

const TONE = { sent: "profit", simulated: "neutral", failed: "loss" } as const;

/** Lives inside the Brand form: a nameless input and a plain button, so neither saves the settings. */
export function TestEmail() {
  const box = useRef<HTMLInputElement>(null);
  const [pending, start] = useTransition();
  const [outcome, setOutcome] = useState<Awaited<ReturnType<typeof sendTestEmailAction>> | null>(null);

  const send = () =>
    start(async () => {
      const form = box.current?.form;
      const text = form ? new FormData(form) : null;
      setOutcome(await sendTestEmailAction({ addresses: box.current?.value ?? "", subject: String(text?.get("openerSubject") ?? ""), body: String(text?.get("openerBody") ?? "") }));
    });
  const onEnter = (e: KeyboardEvent) => {
    if (e.key !== "Enter") return;
    e.preventDefault();
    send();
  };

  return (
    <div>
      <label htmlFor="test-email" className={label}>
        Send a test
      </label>
      <div className="flex flex-wrap items-center gap-2">
        <input ref={box} id="test-email" type="text" inputMode="email" onKeyDown={onEnter} placeholder="you@gmail.com, you@outlook.com" className={cx(input, "min-w-[240px] flex-1")} />
        <button type="button" onClick={send} disabled={pending} className={cx(btn, "px-btn")}>
          {pending ? "Sending…" : "Send test"}
        </button>
      </div>
      <p className="mt-1 text-[13px] text-muted">Sends what&apos;s in the boxes above right now, with a sample name and handle and the footer. It doesn&apos;t count toward your daily limit.</p>
      {outcome?.message && <p className="mt-2 text-[14px] text-loss">{outcome.message}</p>}
      {!!outcome?.results.length && (
        <ul className="mt-2 divide-y divide-line border-2 border-line bg-field">
          {outcome.results.map((r) => (
            <li key={r.address} className="flex flex-wrap items-start gap-x-3 gap-y-1 px-3 py-2 text-[14px]">
              <Badge tone={TONE[r.status]}>{r.status}</Badge>
              <span className="min-w-0 break-all">{r.address}</span>
              {r.error && <span className="w-full text-loss">{r.error}</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
