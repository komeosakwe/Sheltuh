import type { ReactNode } from "react";
import type { EventCategory } from "@/lib/types";

/**
 * A tag's tint: an event category's own, `free`, or `neutral` (states such
 * as "Sold out"). Any other value (a category this build doesn't know)
 * takes the neutral tint.
 */
export type TagTone = EventCategory | "free" | "neutral" | (string & {});

/**
 * A tag (the rules' Tags & chips board, "Tags look"): it labels, it never
 * taps. A soft tint per category from globals.css (`[data-tag]`, swapped in
 * Dark and inside ink), radius 8, Label/Tag, 24px tall, 8px each side. No
 * outline and no hover, so it never looks like a button; it's plain text to
 * a screen reader.
 */
export default function CategoryTag({
  tone,
  children,
  className = "",
}: {
  tone: TagTone;
  children: ReactNode;
  className?: string;
}) {
  return (
    <span
      data-tag={tone}
      className={`label-tag inline-flex h-6 max-w-full items-center rounded-badge px-2 whitespace-nowrap ${className}`.trim()}
    >
      <span className="truncate">{children}</span>
    </span>
  );
}
