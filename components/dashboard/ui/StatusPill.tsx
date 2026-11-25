import type { ReactNode } from "react";
import { TONE_TAG, type DashTone } from "./tones";

/** The pill's tones: the soft ones (./tones.ts), white (a delta on an orange or tinted card) and black (Owner). */
export type StatusPillTone = DashTone | "white" | "black";

/**
 * "Dash / Status pill" (Latte's dashboard Components 465:7337): px 12, py 4, radius 8, Label/Tag,
 * in a soft tone (Live, Sold out, Draft, Scheduled, Processing, ↑ 15%…), white, or black. The
 * word carries the state, never the colour alone. `srText` replaces what's read where the
 * visible words are a symbol ("↑ 15%" is read "Up 15% on the week before").
 */
export default function StatusPill({
  tone = "grey",
  srText,
  className = "",
  children,
}: {
  tone?: StatusPillTone;
  srText?: string;
  className?: string;
  children: ReactNode;
}) {
  const fill = tone === "white" ? "bg-card text-foreground" : tone === "black" ? "bg-foreground text-background" : "";
  return (
    <span
      data-status-pill={tone}
      data-tag={tone === "white" || tone === "black" ? undefined : TONE_TAG[tone]}
      className={`label-tag inline-flex shrink-0 items-center rounded-badge px-3 py-1 whitespace-nowrap ${fill} ${className}`
        .replace(/\s+/g, " ")
        .trim()}
    >
      {srText ? (
        <>
          <span aria-hidden="true">{children}</span>
          <span className="sr-only">{srText}</span>
        </>
      ) : (
        children
      )}
    </span>
  );
}
