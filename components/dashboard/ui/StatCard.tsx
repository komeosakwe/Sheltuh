import type { ReactNode } from "react";
import { TONE_TAG, type DashTone } from "./tones";

/**
 * "Dash / Stat" (Latte's dashboard Components 465:7337): a number over its label.
 *
 * - `plain` (Overview's "+86 Tickets this week", Manage · Insights' stats): white, a 1px
 *   border/subtle edge, px 16 py 24, centred; the number Heading/H2 (32/40 SemiBold; 28/36 on phones, Mobile/H2), the label
 *   Body/S text/secondary, 4px apart. Radius 16, or 8 (`radius="control"`, as Insights draws them).
 * - a tone (Attendees' "86 Tickets" orange, "0 / 86 Checked in" green, "3 Transfers" lilac,
 *   "41 Agreed to hear from you" yellow): the tone's fill, no edge, p 24, left-aligned, number and
 *   label both in the tone's text colour (black on orange).
 *
 * A group of figures, not headings: the label is the figure's name and both are read in turn.
 */
export default function StatCard({
  value,
  label,
  tone = "plain",
  radius = "card",
  className = "",
}: {
  value: ReactNode;
  label: ReactNode;
  tone?: "plain" | "signal" | DashTone;
  radius?: "card" | "control";
  className?: string;
}) {
  const shape = radius === "card" ? "rounded-card" : "rounded-control";
  const look =
    tone === "plain"
      ? "items-center border border-surface-border bg-card px-4 py-6 text-center text-foreground"
      : tone === "signal"
        ? "bg-signal p-6 text-signal-foreground"
        : "p-6";
  return (
    <div
      data-stat-card={tone}
      data-tag={tone !== "plain" && tone !== "signal" ? TONE_TAG[tone] : undefined}
      className={`flex min-w-0 flex-col gap-1 ${shape} ${look} ${className}`.replace(/\s+/g, " ").trim()}
    >
      <p className="heading-h2 break-words tabular-nums">{value}</p>
      <p className={`body-s break-words ${tone === "plain" ? "text-muted" : ""}`.trim()}>{label}</p>
    </div>
  );
}
