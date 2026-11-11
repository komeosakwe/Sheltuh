import type { ReactNode } from "react";

/**
 * An event card's price label (the rules' Cards board): Signal Orange with a
 * black label (6.18:1), radius 8, 32px tall. It's a label, never a control:
 * no link, no button, no tab stop, no hover of its own. On a card it sits
 * inside the card's stretched link, so a tap on it opens the event like
 * anywhere else on the card. `neutral`: a quiet label for a price that
 * isn't one yet ("Tickets coming soon"), so orange stays for what's on sale.
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
  const look = tone === "signal" ? "bg-signal text-signal-foreground" : "bg-surface text-foreground";
  return (
    <span
      data-price-tag={tone}
      className={`inline-flex min-h-8 max-w-full items-center rounded-control px-2 text-sm leading-5 font-semibold tabular-nums ${look} ${className}`.trim()}
    >
      {children}
    </span>
  );
}
