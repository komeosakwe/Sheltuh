import type { ReactNode } from "react";

/**
 * The demo label: a black-edged white badge, "Demo — sample events", then
 * what it means here. Black on white (21:1) and outlined, so it stays
 * clearly visible without spending the page's orange (brand-direction-one.md
 * orange budget: the primary action and the brand marks).
 *
 * `compact` (the home hero): one short line, the badge slimmer and the note
 * 12px, so it stays plainly visible without taking a phone's first screen.
 */
export default function DemoNotice({ children, compact = false }: { children: ReactNode; compact?: boolean }) {
  return (
    <div
      role="note"
      data-compact={compact ? "" : undefined}
      className={`flex flex-wrap items-baseline ${compact ? "gap-x-2 gap-y-1 text-xs leading-4" : "gap-x-3 gap-y-1 text-sm"}`}
    >
      <span
        className={`eyebrow rounded-badge border border-foreground bg-card text-foreground ${compact ? "px-1.5 py-0.5" : "px-2 py-1"}`}
      >
        Demo — sample events
      </span>
      <span className="text-muted">{children}</span>
    </div>
  );
}
