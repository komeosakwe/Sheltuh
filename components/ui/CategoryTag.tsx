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
 * a screen reader. `size="md"` (32px, Body S 500, 12px each side) is the
 * organiser profile's chips only (docs/design/organiser-profile.md §5.6).
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
  const sizing = size === "md" ? "h-8 px-3 body-s font-medium" : "label-tag h-6 px-2";
  return (
    <span
      data-tag={tone}
      className={`${sizing} inline-flex max-w-full items-center rounded-badge whitespace-nowrap ${className}`.trim()}
    >
      <span className="truncate">{children}</span>
    </span>
  );
}
