import type { ReactNode } from "react";

export type StatusTone = "pending" | "approved" | "on-sale" | "rejected" | "neutral";

/**
 * A status badge for dashboards and admin (docs/design/brand-direction-one.md
 * §6.3): mono caps on a 4px rounded square. Pending is outlined, approved or
 * published is black, on sale is the only orange in the tools, rejected or
 * suspended is outlined in red. The word carries the state, never the colour.
 */
export function statusBadgeClass(tone: StatusTone) {
  const tones: Record<StatusTone, string> = {
    pending: "border border-foreground text-foreground",
    approved: "border border-foreground bg-foreground text-background",
    "on-sale": "border border-signal bg-signal text-signal-foreground",
    rejected: "border border-danger text-danger",
    neutral: "border border-surface-border text-muted",
  };
  return `eyebrow inline-flex shrink-0 items-center rounded-badge px-2 py-0.5 ${tones[tone]}`;
}

export default function StatusBadge({ tone, children }: { tone: StatusTone; children: ReactNode }) {
  return <span className={statusBadgeClass(tone)}>{children}</span>;
}
