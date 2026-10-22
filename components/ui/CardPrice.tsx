import { hasEnded } from "@/lib/event-card";
import { formatFeedPriceParts, isSoldOut, NO_TICKETS_LABEL, SOLD_OUT_LABEL } from "@/lib/pricing";
import type { SheltuhEvent } from "@/lib/types";

/**
 * A card's price line (docs/design/mobile-redesign.md §6.2.4): the
 * all-inclusive amount first and bold, then what it includes, quieter, on
 * the same line. An external event says where tickets are sold instead
 * ("Tickets on Humanitix", never a price), in the price's weight; a free
 * one is "Free" and where. Every tier sold out: "Sold out", in the price's
 * weight and black (words, never a colour or badge alone). With `now`, an
 * event that has ended by then is "Ended" and nothing else.
 */
export default function CardPrice({
  event,
  id,
  className = "",
  now,
}: {
  event: SheltuhEvent;
  /** For a card link's aria-labelledby. */
  id?: string;
  className?: string;
  now?: Date;
}) {
  if (now && hasEnded(event, now)) {
    return (
      <p id={id} className={`font-semibold text-muted ${className}`.trim()}>
        Ended
      </p>
    );
  }
  if (isSoldOut(event)) {
    return (
      <p id={id} className={`font-semibold text-foreground ${className}`.trim()}>
        {SOLD_OUT_LABEL}
      </p>
    );
  }
  const parts = formatFeedPriceParts(event);
  if (!parts) {
    return (
      <p id={id} className={`font-semibold ${className}`.trim()}>
        {NO_TICKETS_LABEL}
      </p>
    );
  }
  if (!parts.note) {
    // A paid external event: where its tickets are, in the price's weight.
    return (
      <p id={id} className={`font-semibold ${className}`.trim()}>
        {parts.amount}
      </p>
    );
  }
  return (
    <p id={id} className={className}>
      <span className="font-semibold tabular-nums">{parts.amount}</span>{" "}
      <span className="text-muted">{parts.note}</span>
    </p>
  );
}
