import { input, label, cx } from "@/components/ui";
import { KeepForm, KeepSubmit } from "@/components/client";
import { addCompetitorAction } from "./actions";

export function CompetitorForm() {
  return (
    <KeepForm action={addCompetitorAction} resetOnSuccess className="space-y-2.5">
      <div className="grid grid-cols-[1fr_120px] gap-2">
        <label className="block">
          <span className={label}>Competitor</span>
          <input name="competitorName" required placeholder="e.g. CalAI" className={input} />
        </label>
        <label className="block">
          <span className={label}>Platform</span>
          <select name="platform" defaultValue="tiktok" className={input}>
            <option value="tiktok">TikTok</option>
            <option value="instagram">Instagram</option>
            <option value="youtube">YouTube</option>
          </select>
        </label>
      </div>
      <label className="block">
        <span className={label}>Video link</span>
        <input name="url" type="url" required placeholder="https://www.tiktok.com/@…/video/…" className={input} />
      </label>
      <label className="block">
        <span className={label}>Caption</span>
        <textarea name="caption" rows={2} className={input} />
      </label>
      <label className="block">
        <span className={label}>Transcript</span>
        <textarea name="transcript" rows={4} placeholder="What's said in the video — the first line becomes the hook" className={input} />
      </label>
      <div className="grid grid-cols-2 gap-2">
        {(
          [
            ["views", "Views", true],
            ["likes", "Likes", false],
            ["comments", "Comments", false],
            ["shares", "Shares", false],
          ] as const
        ).map(([name, l, req]) => (
          <label key={name} className="block">
            <span className={label}>{l}</span>
            <input name={name} inputMode="numeric" required={req} placeholder="0" className={cx(input, "num")} />
          </label>
        ))}
      </div>
      <KeepSubmit variant="primary" className="w-full" pendingText="Tagging…">
        Add to hook bank
      </KeepSubmit>
    </KeepForm>
  );
}
