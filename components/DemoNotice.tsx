import type { ReactNode } from "react";

/**
 * The demo label: a black-edged white badge, "Demo — sample events", then
 * what it means here. Black on white (21:1) and outlined, so it stays
 * clearly visible without spending the page's orange (brand-direction-one.md
 * orange budget: the primary action and the brand marks).
 */
export default function DemoNotice({ children }: { children: ReactNode }) {
  return (
    <div role="note" className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-sm">
      <span className="eyebrow rounded-badge border border-foreground bg-card px-2 py-1 text-foreground">
        Demo — sample events
      </span>
      <span className="text-muted">{children}</span>
    </div>
  );
}
