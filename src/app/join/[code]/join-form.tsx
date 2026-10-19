"use client";

import { useActionState } from "react";
import { SubmitButton } from "@/components/client";
import { cx, input, label } from "@/components/ui";
import { joinAction, type JoinResult } from "./actions";

// 16px on phones so iOS doesn't zoom into the field on focus.
const field = cx(input, "py-2 text-[16px] sm:text-[13px]");

const COUNTRIES: [string, string][] = [
  ["US", "United States"],
  ["CA", "Canada"],
  ["GB", "United Kingdom"],
  ["AU", "Australia"],
  ["IE", "Ireland"],
  ["NZ", "New Zealand"],
  ["DE", "Germany"],
  ["FR", "France"],
  ["ES", "Spain"],
  ["IT", "Italy"],
  ["NL", "Netherlands"],
  ["SE", "Sweden"],
  ["BR", "Brazil"],
  ["MX", "Mexico"],
  ["IN", "India"],
  ["PH", "Philippines"],
  ["NG", "Nigeria"],
  ["ZA", "South Africa"],
];

export function JoinForm({ code, inviter }: { code: string; inviter: string }) {
  const [state, action] = useActionState<JoinResult, FormData>(joinAction, null);

  if (state?.ok) {
    return (
      <div className="rounded-lg border border-line bg-panel p-5" role="status">
        <h2 className="font-display text-[20px] font-bold tracking-[-0.01em]">{state.duplicate ? "You're already on our list" : `You're in, ${state.first}.`}</h2>
        <p className="mt-2 text-ink-2">
          {state.duplicate ? (
            <>We already have {state.email}, so there&apos;s nothing else to do — we&apos;ll be in touch there.</>
          ) : (
            <>
              We&apos;ll email <span className="font-medium text-ink">{state.email}</span> within two business days with a sample brief and a link to book a quick call. {inviter} gets a thank-you once
              you start posting.
            </>
          )}
        </p>
      </div>
    );
  }

  return (
    <form action={action} className="space-y-3 rounded-lg border border-line bg-panel p-5">
      <input type="hidden" name="code" value={code} />
      <div className="hidden" aria-hidden>
        <label>
          Website
          <input name="website" tabIndex={-1} autoComplete="off" />
        </label>
      </div>
      <label className="block">
        <span className={label}>Your name</span>
        <input name="name" required autoComplete="name" className={field} placeholder="Jamie Rivera" />
      </label>
      <label className="block">
        <span className={label}>Email</span>
        <input name="email" type="email" required autoComplete="email" inputMode="email" className={field} placeholder="you@example.com" />
      </label>
      <div className="grid grid-cols-[120px_1fr] gap-2">
        <label className="block">
          <span className={label}>Platform</span>
          <select name="platform" required defaultValue="tiktok" className={field}>
            <option value="tiktok">TikTok</option>
            <option value="instagram">Instagram</option>
            <option value="youtube">YouTube</option>
          </select>
        </label>
        <label className="block">
          <span className={label}>Handle</span>
          <span className="relative block">
            <span className="pointer-events-none absolute inset-y-0 left-2.5 flex items-center text-muted">@</span>
            <input name="handle" required autoCapitalize="none" autoCorrect="off" spellCheck={false} className={cx(field, "pl-6")} placeholder="yourhandle" />
          </span>
        </label>
      </div>
      <label className="block">
        <span className={label}>Country</span>
        <select name="country" defaultValue="" className={field}>
          <option value="">Choose…</option>
          {COUNTRIES.map(([code, name]) => (
            <option key={code} value={code}>
              {name}
            </option>
          ))}
          <option value="Other">Somewhere else</option>
        </select>
      </label>
      {state && !state.ok && <p className="text-[13px] text-loss">{state.message}</p>}
      <SubmitButton variant="primary" pendingText="Sending…" className="w-full !py-2.5 !text-[14px]">
        Join
      </SubmitButton>
      <p className="text-center text-[12px] text-muted">We only use your email to talk about working together.</p>
    </form>
  );
}
