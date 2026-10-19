"use client";

import { useState } from "react";
import { cx, btn, btnSm } from "@/components/ui";

/** Copies `value` (a path is resolved against the current origin) to the clipboard. */
export function CopyButton({ value, label = "Copy link", className, small = true }: { value: string; label?: string; className?: string; small?: boolean }) {
  const [copied, setCopied] = useState<"ok" | "fail" | null>(null);
  return (
    <button
      type="button"
      className={cx(btn, small && btnSm, className)}
      onClick={async () => {
        const text = value.startsWith("/") ? new URL(value, window.location.origin).toString() : value;
        try {
          await navigator.clipboard.writeText(text);
          setCopied("ok");
        } catch {
          setCopied("fail");
        }
        setTimeout(() => setCopied(null), 1800);
      }}
    >
      {copied === "ok" ? "Copied" : copied === "fail" ? "Copy failed — select the text" : label}
    </button>
  );
}
