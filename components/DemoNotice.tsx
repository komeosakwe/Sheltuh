import type { ReactNode } from "react";

/**
 * A demo notice at the point where something won't happen in the demo
 * (booking, waitlist, adding yourself, following, messages): one quiet line,
 * a small "Demo" tag then what it means here. The page's sample-data
 * disclosure is DemoBanner, once per page (docs/design/mobile-redesign.md,
 * Refinement 22 Oct 2026), so these stay short and never repeat it. Never
 * orange (brand-direction-one.md orange budget).
 */
export default function DemoNotice({ children }: { children: ReactNode }) {
  return (
    <p role="note" data-demo-notice="" className="text-sm leading-5 text-muted">
      <span className="mr-2 inline-block rounded-badge bg-surface px-1.5 text-xs leading-5 font-semibold text-foreground">
        Demo
      </span>
      {children}
    </p>
  );
}
