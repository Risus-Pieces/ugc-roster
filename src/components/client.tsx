"use client";

import { useFormStatus } from "react-dom";
import { createContext, startTransition, use, useActionState, useEffect, useRef, type ReactNode } from "react";
import { cx, btn, btnPrimary, btnDanger } from "./ui";

/** Submit button that shows a pending state while its form's server action runs. */
export function SubmitButton({ children, pendingText, variant = "default", className, ...rest }: { children: ReactNode; pendingText?: string; variant?: "default" | "primary"; className?: string } & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending || rest.disabled} className={cx(variant === "primary" ? btnPrimary : btn, className)} {...rest}>
      {pending ? (pendingText ?? "Working…") : children}
    </button>
  );
}

export type ActionResult = { ok: boolean; message?: string } | null;

/**
 * A form bound to a server action that returns { ok, message }. Shows the message inline,
 * which is how every action in the app reports success or explains a failure.
 */
export function ActionForm({
  action,
  children,
  className,
  resetOnSuccess,
}: {
  action: (prev: ActionResult, fd: FormData) => Promise<ActionResult>;
  children: ReactNode;
  className?: string;
  resetOnSuccess?: boolean;
}) {
  const [state, formAction] = useActionState(action, null);
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state?.ok && resetOnSuccess) ref.current?.reset();
  }, [state, resetOnSuccess]);
  return (
    <form ref={ref} action={formAction} className={className}>
      {children}
      {state?.message && <p className={cx("mt-2 text-[13px]", state.ok ? "text-profit" : "text-loss")}>{state.message}</p>}
    </form>
  );
}

const Pending = createContext(false);

/**
 * Like <ActionForm>, but keeps what the person typed when the action returns an error.
 * A plain form action makes React reset every field after each submit, which loses a long
 * tax form or draft over one typo. Use <KeepSubmit> inside it for the pending state.
 */
export function KeepForm({
  action,
  children,
  className,
  resetOnSuccess,
}: {
  action: (prev: ActionResult, fd: FormData) => Promise<ActionResult>;
  children: ReactNode;
  className?: string;
  resetOnSuccess?: boolean;
}) {
  const [state, formAction, pending] = useActionState(action, null);
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state?.ok && resetOnSuccess) ref.current?.reset();
  }, [state, resetOnSuccess]);
  return (
    <form
      ref={ref}
      className={className}
      // `action` makes SSR render a POST, so a submit before hydration never falls back to a native GET
      // that would put fields (e.g. a tax ID) in the URL. After hydration, onSubmit's preventDefault +
      // startTransition means React doesn't run its own form handling, so there's no automatic reset.
      // Don't add `method` — React warns when action is a function.
      action={formAction}
      onSubmit={(e) => {
        e.preventDefault();
        const submitter = (e.nativeEvent as SubmitEvent).submitter as HTMLElement | null;
        const fd = new FormData(e.currentTarget, submitter);
        startTransition(() => formAction(fd));
      }}
    >
      <Pending value={pending}>{children}</Pending>
      {state?.message && (
        <p role="status" className={cx("mt-2 text-[13px]", state.ok ? "text-profit" : "text-loss")}>
          {state.message}
        </p>
      )}
    </form>
  );
}

export function KeepSubmit({
  children,
  pendingText,
  variant = "default",
  className,
  ...rest
}: { children: ReactNode; pendingText?: string; variant?: "default" | "primary" | "danger"; className?: string } & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  const pending = use(Pending);
  const base = variant === "primary" ? btnPrimary : variant === "danger" ? btnDanger : btn;
  return (
    <button type="submit" disabled={pending || rest.disabled} className={cx(base, className)} {...rest}>
      {pending ? (pendingText ?? "Working…") : children}
    </button>
  );
}
