import type { ReactNode } from "react";

/**
 * An event card's price label (the rules' Cards board): Signal Orange with a
 * black label (6.18:1), radius 8, 40px tall, Label/Button (a longer label,
 * "Tickets coming soon", may wrap rather than overflow a narrow card). It's a label, never a control:
 * no link, no button, no tab stop, no hover of its own. On a card it sits
 * inside the card's stretched link, so a tap on it opens the event like
 * anywhere else on the card. When the card is hovered, its link has
 * keyboard focus or it's pressed (touch has no hover: a press shows the
 * card's panel and this together), the orange label turns black with an orange label (6.18:1),
 * as Buy tickets' hover does (Round 2 §1.5): the card's state, not the label's.
 * `neutral`: a quiet label for a price that isn't one yet ("Tickets coming
 * soon"), so orange stays for what's on sale; it doesn't change.
 */
export default function PriceTag({
  children,
  tone = "signal",
  className = "",
}: {
  children: ReactNode;
  tone?: "signal" | "neutral";
  className?: string;
}) {
  const look =
    tone === "signal"
      ? "bg-signal text-signal-foreground group-hover/card:bg-ink group-hover/card:text-signal group-has-[[data-card-link]:focus-visible]/card:bg-ink group-has-[[data-card-link]:focus-visible]/card:text-signal group-has-[[data-card-link]:active]/card:bg-ink group-has-[[data-card-link]:active]/card:text-signal motion-safe:transition-colors motion-safe:duration-200"
      : "bg-surface text-foreground";
  return (
    <span
      data-price-tag={tone}
      className={`label-button inline-flex min-h-10 max-w-full items-center rounded-control px-2 py-2 tabular-nums ${look} ${className}`.trim()}
    >
      {children}
    </span>
  );
}
