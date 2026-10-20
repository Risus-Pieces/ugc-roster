import { Suspense } from "react";
import { ActionForm, SubmitButton } from "@/components/client";
import { Sprite } from "@/components/sprites";
import { input, label } from "@/components/ui";
import { signIn } from "./actions";

export const metadata = { title: "Sign in" };

async function LoginForm({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams;
  return (
    <ActionForm action={signIn} className="mt-6 space-y-3">
      <input type="hidden" name="next" value={next ?? "/"} />
      <label className="block">
        <span className={label}>Password</span>
        <input name="password" type="password" required autoFocus autoComplete="current-password" className={input} />
      </label>
      <SubmitButton variant="primary" className="w-full" pendingText="Opening the gate…">
        Sign in
      </SubmitButton>
    </ActionForm>
  );
}

export default function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  return (
    <main className="board mx-3 my-16 max-w-sm px-7 py-8 sm:mx-auto">
      <div className="flex items-center gap-3">
        <Sprite name="sprout" scale={4} className="bob" />
        <h1 className="font-display text-[28px] leading-none">Roster</h1>
      </div>
      <p className="mt-3 text-ink-2">The farm gate is closed. Enter the team password to open the console.</p>
      <Suspense fallback={<div className="mt-6 h-24" />}>
        <LoginForm searchParams={searchParams} />
      </Suspense>
    </main>
  );
}
