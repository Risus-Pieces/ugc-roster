"use client";

import { useState } from "react";
import { cx, input, label } from "@/components/ui";
import { KeepForm, KeepSubmit, type ActionResult } from "@/components/client";

const inp = cx(input, "!py-2.5 !text-[16px]");
const lab = cx(label, "!text-[13px]");

function F({ l, hint, children }: { l: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className={lab}>{l}</span>
      {children}
      {hint && <span className="mt-1 block text-[12px] text-muted">{hint}</span>}
    </label>
  );
}

/** W-9 for US persons, W-8BEN for everyone else. Defaults from the creator's country; they can switch. */
export function TaxForm({ action, token, defaultType, citizenship }: { action: (p: ActionResult, fd: FormData) => Promise<ActionResult>; token: string; defaultType: "W-9" | "W-8BEN"; citizenship?: string }) {
  const [type, setType] = useState<"W-9" | "W-8BEN">(defaultType);
  return (
    <KeepForm action={action} resetOnSuccess className="space-y-3">
      <input type="hidden" name="token" value={token} />
      <input type="hidden" name="formType" value={type} />

      <div role="radiogroup" aria-label="Which form" className="grid grid-cols-2 gap-1 rounded-lg bg-sunken p-1">
        {(
          [
            ["W-9", "I'm a US person"],
            ["W-8BEN", "I'm not a US person"],
          ] as const
        ).map(([t, l]) => (
          <button
            key={t}
            type="button"
            role="radio"
            aria-checked={type === t}
            onClick={() => setType(t)}
            className={cx("rounded-md px-3 py-2 text-left text-[14px] transition-colors", type === t ? "bg-panel font-medium shadow-sm" : "text-ink-2 hover:text-ink")}
          >
            <span className="num block text-[12px] text-muted">{t}</span>
            {l}
          </button>
        ))}
      </div>
      <p className="text-[12px] text-muted">
        {type === "W-9" ? "US citizens and residents (including green card holders) fill in a W-9." : "Everyone outside the US fills in a W-8BEN, so payments aren't taxed by the US."}
      </p>

      {type === "W-9" ? (
        <>
          <F l="Name (as shown on your income tax return)">
            <input name="legalName" required autoComplete="name" className={inp} />
          </F>
          <F l="Business name (optional)" hint="Only if you get paid through a business or LLC.">
            <input name="businessName" autoComplete="organization" className={inp} />
          </F>
          <F l="Federal tax classification">
            <select name="classification" required defaultValue="individual" className={inp}>
              <option value="individual">Individual / sole proprietor / single-member LLC</option>
              <option value="c_corp">C corporation</option>
              <option value="s_corp">S corporation</option>
              <option value="partnership">Partnership</option>
              <option value="trust">Trust / estate</option>
              <option value="llc">LLC (taxed as C corp, S corp or partnership)</option>
              <option value="other">Other</option>
            </select>
          </F>
          <F l="Street address">
            <input name="address" required autoComplete="street-address" className={inp} />
          </F>
          <F l="City, state and ZIP">
            <input name="cityStateZip" required placeholder="Austin, TX 78701" className={inp} />
          </F>
          <F l="SSN or EIN" hint="9 digits. It's encrypted as soon as you submit — we only ever show the last 4.">
            <input name="tin" required inputMode="numeric" autoComplete="off" pattern="[0-9 \-]{9,11}" placeholder="123-45-6789" className={cx(inp, "num")} />
          </F>
        </>
      ) : (
        <>
          <F l="Full legal name">
            <input name="legalName" required autoComplete="name" className={inp} />
          </F>
          <F l="Country of citizenship">
            <input name="citizenship" required defaultValue={citizenship} autoComplete="country-name" className={inp} />
          </F>
          <F l="Permanent residence address" hint="Street and number. Not a PO box or a care-of address.">
            <input name="address" required autoComplete="street-address" className={inp} />
          </F>
          <div className="grid gap-3 sm:grid-cols-2">
            <F l="City, region and postal code">
              <input name="cityPostal" required className={inp} />
            </F>
            <F l="Country of residence">
              <input name="residenceCountry" required defaultValue={citizenship} autoComplete="country-name" className={inp} />
            </F>
          </div>
          <F l="Foreign tax ID" hint="Your tax number at home (e.g. TIN, NIN, UTR). Encrypted on submit — we only show the last 4.">
            <input name="tin" inputMode="text" autoComplete="off" className={cx(inp, "num")} />
          </F>
          <label className="flex items-start gap-2.5 text-[14px]">
            <input type="checkbox" name="noForeignTin" className="mt-0.5 h-5 w-5 shrink-0 accent-[var(--ink)]" />
            <span>My country doesn&apos;t issue tax IDs to individuals</span>
          </label>
          <div className="grid gap-3 sm:grid-cols-2">
            <F l="Date of birth">
              <input name="dateOfBirth" type="date" required autoComplete="bday" className={cx(inp, "num")} />
            </F>
            <F l="Treaty country (optional)" hint="Only if you claim tax treaty benefits.">
              <input name="treatyCountry" className={inp} />
            </F>
          </div>
        </>
      )}

      <label className="flex items-start gap-2.5 rounded-md bg-sunken p-3 text-[13px] leading-snug">
        <input type="checkbox" name="certify" required className="mt-0.5 h-5 w-5 shrink-0 accent-[var(--ink)]" />
        <span>
          {type === "W-9"
            ? "Under penalties of perjury, I certify that the number shown is my correct taxpayer identification number, that I am not subject to backup withholding, and that I am a US citizen or other US person."
            : "Under penalties of perjury, I certify that I am the beneficial owner of the income this form relates to, that I am not a US person, and that the information on this form is true, correct and complete."}
        </span>
      </label>
      <F l="Signature — type your full legal name">
        <input name="signatureName" required autoComplete="name" className={inp} />
      </F>
      <KeepSubmit variant="primary" className="w-full !py-2.5 !text-[15px]" pendingText="Submitting…">
        Submit {type}
      </KeepSubmit>
    </KeepForm>
  );
}
