import type { ReactNode } from "react";

/** Inline **bold** only. React escapes everything else. */
function inline(text: string): ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*)/g).map((part, i) => (part.startsWith("**") && part.endsWith("**") && part.length > 4 ? <strong key={i}>{part.slice(2, -2)}</strong> : part));
}

/**
 * Minimal Markdown for contract bodies: `#` / `##` headings, `- ` lists, paragraphs
 * (consecutive lines are kept as separate lines), and **bold**.
 */
export function Markdown({ source, className }: { source: string; className?: string }) {
  const blocks: ReactNode[] = [];
  let para: string[] = [];
  let list: string[] = [];
  const flush = () => {
    if (para.length) {
      const lines = para;
      blocks.push(
        <p key={blocks.length} className="my-2 leading-relaxed">
          {lines.map((l, i) => (
            <span key={i}>
              {inline(l)}
              {i < lines.length - 1 && <br />}
            </span>
          ))}
        </p>,
      );
      para = [];
    }
    if (list.length) {
      const items = list;
      blocks.push(
        <ul key={blocks.length} className="my-2 list-disc space-y-1 pl-5 leading-relaxed">
          {items.map((l, i) => (
            <li key={i}>{inline(l)}</li>
          ))}
        </ul>,
      );
      list = [];
    }
  };
  for (const raw of source.split("\n")) {
    const line = raw.trimEnd();
    if (line.startsWith("## ")) {
      flush();
      blocks.push(
        <h3 key={blocks.length} className="mt-5 mb-1 font-display text-[16px] font-bold tracking-[-0.01em]">
          {inline(line.slice(3))}
        </h3>,
      );
    } else if (line.startsWith("# ")) {
      flush();
      blocks.push(
        <h2 key={blocks.length} className="mb-2 font-display text-[20px] font-bold tracking-[-0.02em]">
          {inline(line.slice(2))}
        </h2>,
      );
    } else if (/^\s*[-*] /.test(line)) {
      if (para.length) flush(); // list is always empty while a paragraph is open
      list.push(line.replace(/^\s*[-*] /, ""));
    } else if (!line.trim()) {
      flush();
    } else {
      if (list.length) flush();
      para.push(line);
    }
  }
  flush();
  return <div className={className}>{blocks}</div>;
}
