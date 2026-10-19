import { cx, input, label } from "@/components/ui";

/**
 * The fields of a draft submission, shared by the review queue ("on a creator's behalf") and
 * the creator portal. Field names match what the submit actions read.
 */
export function DraftFields({
  creators,
  briefs,
  roomy,
}: {
  creators?: { id: string; name: string; stage: string }[];
  briefs?: { id: string; label: string }[];
  /** Larger inputs for the mobile creator portal (16px text avoids iOS zoom). */
  roomy?: boolean;
}) {
  const inp = cx(input, roomy && "!py-2.5 !text-[16px]");
  const lab = cx(label, roomy && "!text-[13px]");
  return (
    <div className="space-y-3">
      {creators && (
        <label className="block">
          <span className={lab}>Creator</span>
          <select name="creatorId" required className={inp} defaultValue="">
            <option value="" disabled>
              Pick a creator
            </option>
            {creators.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name} ({c.stage})
              </option>
            ))}
          </select>
        </label>
      )}
      <div className="grid gap-3 sm:grid-cols-[160px_1fr]">
        <label className="block">
          <span className={lab}>Platform</span>
          <select name="platform" required className={inp} defaultValue="tiktok">
            <option value="tiktok">TikTok</option>
            <option value="instagram">Instagram</option>
            <option value="youtube">YouTube</option>
          </select>
        </label>
        <label className="block">
          <span className={lab}>Draft link</span>
          <input name="draftUrl" type="url" inputMode="url" placeholder="https://drive.google.com/… or a private/draft post link" className={inp} />
        </label>
      </div>
      {briefs && briefs.length > 0 && (
        <label className="block">
          <span className={lab}>Which brief is this for?</span>
          <select name="briefId" className={inp} defaultValue={briefs[0].id}>
            {briefs.map((b) => (
              <option key={b.id} value={b.id}>
                {b.label}
              </option>
            ))}
            <option value="">Not for a brief</option>
          </select>
        </label>
      )}
      <label className="block">
        <span className={lab}>Caption</span>
        <textarea name="caption" required rows={3} placeholder="The caption exactly as it will be posted, hashtags included" className={inp} />
      </label>
      <label className="block">
        <span className={lab}>Transcript or voiceover</span>
        <textarea name="transcript" rows={4} placeholder="What you say in the video, plus any on-screen text" className={inp} />
      </label>
      <fieldset className="space-y-2 rounded-md border border-line bg-sunken/60 p-3">
        <legend className={cx(lab, "px-1")}>Before you post</legend>
        <Toggle name="paidPartnershipToggle" roomy={roomy}>
          The platform&apos;s paid-partnership label is on
        </Toggle>
        <Toggle name="containsAiFootage" roomy={roomy}>
          The video contains AI-generated or AI-altered footage
        </Toggle>
        <Toggle name="aiLabelToggle" roomy={roomy}>
          The platform&apos;s AI-generated content label is on
        </Toggle>
      </fieldset>
    </div>
  );
}

function Toggle({ name, children, roomy }: { name: string; children: React.ReactNode; roomy?: boolean }) {
  return (
    <label className={cx("flex cursor-pointer items-start gap-2.5", roomy ? "text-[15px]" : "text-[13px]")}>
      <input type="checkbox" name={name} className={cx("mt-0.5 shrink-0 accent-[var(--ink)]", roomy ? "h-5 w-5" : "h-4 w-4")} />
      <span>{children}</span>
    </label>
  );
}

/** Parse the shared draft fields. Throws with a fix-it message when something is missing. */
export function readDraft(fd: FormData) {
  const platform = String(fd.get("platform") ?? "");
  if (platform !== "tiktok" && platform !== "instagram" && platform !== "youtube") throw new Error("Pick a platform");
  const caption = String(fd.get("caption") ?? "").trim();
  if (!caption) throw new Error("Add the caption you plan to post");
  const draftUrl = String(fd.get("draftUrl") ?? "").trim();
  if (draftUrl && !/^https?:\/\//i.test(draftUrl)) throw new Error("The draft link must start with https://");
  return {
    platform: platform as "tiktok" | "instagram" | "youtube",
    caption,
    draftUrl: draftUrl || null,
    transcript: String(fd.get("transcript") ?? "").trim() || null,
    paidPartnershipToggle: fd.get("paidPartnershipToggle") === "on",
    containsAiFootage: fd.get("containsAiFootage") === "on",
    aiLabelToggle: fd.get("aiLabelToggle") === "on",
  };
}
