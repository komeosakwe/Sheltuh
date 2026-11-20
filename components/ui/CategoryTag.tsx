import type { ReactNode } from "react";
import type { EventCategory } from "@/lib/types";

/**
 * A tag's tint: an event category's own, `free`, `neutral` (states such
 * as "Sold out"), or `soon` (the "🔥 Tomorrow" tag: components/ui/SoonTag.tsx).
 * Any other value (a category this build doesn't know) takes the neutral tint.
 */
export type TagTone = EventCategory | "free" | "neutral" | "soon" | (string & {});

/**
 * A tag (the rules' Tags & chips board, "Tags look"): it labels, it never
 * taps. A soft tint per category from globals.css (`[data-tag]`, swapped in
 * Dark and inside ink), radius 8, Label/Tag, 24px tall, 8px each side. No
 * outline and no hover, so it never looks like a button; it's plain text to
 * a screen reader. `size="md"` (at least 32px, Body S 500, 12px each side) is the
 * organiser profile's chips only (docs/design/organiser-profile.md §5.6): it
 * wraps onto more lines rather than truncating when the text is large.
 */
export default function CategoryTag({
  tone,
  children,
  size = "sm",
  className = "",
}: {
  tone: TagTone;
  children: ReactNode;
  size?: "sm" | "md";
  className?: string;
}) {
  if (size === "md") {
    // At least 32px, and taller when large text makes it wrap: never cut short.
    return (
      <span
        data-tag={tone}
        className={`body-s inline-flex h-auto min-h-8 max-w-full items-center rounded-badge px-3 py-1 font-medium break-words whitespace-normal ${className}`.trim()}
      >
        <span className="min-w-0">{children}</span>
      </span>
    );
  }
  return (
    <span
      data-tag={tone}
      className={`label-tag inline-flex h-6 max-w-full items-center rounded-badge px-2 whitespace-nowrap ${className}`.trim()}
    >
      <span className="truncate">{children}</span>
    </span>
  );
}
