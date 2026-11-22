import { BEFORE_YOU_GO_TITLE, beforeYouGoLines } from "@/lib/before-you-go";

/**
 * The organiser's "Before you go" note on the event page (and the editor's preview of it), boxed as Latte's
 * ticket email draws it (frame 526:11545): a 1px rule, 24px padding, the control radius (8px), the title in
 * semibold and each line of the note in muted Body/S. Plain text, escaped by React, a paragraph per line
 * (lib/before-you-go.ts beforeYouGoLines). Nothing when the note has no text.
 */
export default function BeforeYouGo({ text, className = "" }: { text: string; className?: string }) {
  const lines = beforeYouGoLines(text);
  if (lines.length === 0) return null;
  return (
    <section
      aria-labelledby="before-you-go-title"
      data-before-you-go=""
      className={`flex flex-col gap-2 rounded-control border border-foreground p-6 ${className}`.trim()}
    >
      <h2 id="before-you-go-title" className="body-m font-semibold">
        {BEFORE_YOU_GO_TITLE}
      </h2>
      {lines.map((line, index) => (
        <p key={index} className="body-s break-words text-muted">
          {line}
        </p>
      ))}
    </section>
  );
}
