import { formatFeedPrice, formatFeedPriceParts, NO_TICKETS_LABEL } from "@/lib/pricing";
import type { SheltuhEvent } from "@/lib/types";

/**
 * A card's price line (docs/design/brand-direction-one.md §6.8): the
 * all-inclusive amount first and bold, then what it includes, quieter, on
 * the same line. An external event says where tickets are sold instead
 * ("Tickets on Humanitix", never a price), in the price's weight.
 */
export default function CardPrice({
  event,
  id,
  className = "",
}: {
  event: SheltuhEvent;
  /** For a card link's aria-labelledby. */
  id?: string;
  className?: string;
}) {
  if (event.ticketingMode === "external") {
    return (
      <p id={id} className={`font-semibold ${className}`.trim()}>
        {formatFeedPrice(event)}
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
  return (
    <p id={id} className={className}>
      <span className="font-semibold tabular-nums">{parts.amount}</span>{" "}
      <span className="text-muted">{parts.note}</span>
    </p>
  );
}
