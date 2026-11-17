"use client";

import CategoryTag from "@/components/ui/CategoryTag";
import { useMinuteNow } from "@/components/ui/useMinuteNow";
import { soonLabel, type SoonFields, type SoonLabel } from "@/lib/soon";

/** The label for `event` now, in the browser only (null on the server and while hydrating: useMinuteNow). */
function useSoonLabel(event: SoonFields): SoonLabel | null {
  const now = useMinuteNow();
  return now === null ? null : soonLabel(event, new Date(now));
}

/** The flame: decorative, so only the words are read ("Tomorrow"). */
function Flame() {
  return (
    <span aria-hidden="true" className="mr-1">
      🔥
    </span>
  );
}

/**
 * The "soon" tag beside the category tag ("🔥 Tomorrow", lib/soon.ts): the tags' shape and type (CategoryTag)
 * in its own warm tint (`[data-tag="soon"]`, globals.css), the words saying it, never the colour alone.
 * Nothing when the event isn't close, has ended, or the page hasn't hydrated yet.
 */
export default function SoonTag({ event, className = "" }: { event: SoonFields; className?: string }) {
  const label = useSoonLabel(event);
  if (!label) return null;
  return (
    <CategoryTag tone="soon" className={className}>
      <Flame />
      {label}
    </CategoryTag>
  );
}

/**
 * The same label as words in a line ("🔥 Tomorrow · "), for the phone buy bar's date line: kept whole (never
 * cut short) while the date after it gives way. Nothing when there's no label.
 */
export function SoonText({ event, className = "" }: { event: SoonFields; className?: string }) {
  const label = useSoonLabel(event);
  if (!label) return null;
  return (
    <span data-soon-text="" className={`shrink-0 whitespace-nowrap ${className}`.trim()}>
      <Flame />
      <span className="font-semibold text-foreground">{label}</span>
      {/* No-break spaces: a flex item's own trailing space would collapse. */}
      {"\u00a0·\u00a0"}
    </span>
  );
}
