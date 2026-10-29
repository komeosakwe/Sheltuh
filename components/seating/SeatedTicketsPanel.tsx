import { ArrowRightIcon } from "@/components/home/icons";
import { ButtonLink } from "@/components/ui/Button";
import WaitlistBlock from "@/components/waitlist/WaitlistBlock";
import { isApiConfigured } from "@/lib/api/client";
import { describeBookingFeeNote } from "@/lib/fees";
import {
  formatFeedPriceParts,
  formatTicketHeadline,
  getTicketBuyerTotalCents,
  isSoldOut,
} from "@/lib/pricing";
import { tierTreatments } from "@/lib/seating/selection";
import type { SheltuhEvent } from "@/lib/types";
import { patternIdsFor, SeatPatternDefs, SeatSwatch } from "./SeatGlyph";

/**
 * The event page's tickets panel for a seated event (docs/design/seating.md
 * §5.1), in TicketSelector's place: the "From" price, each tier
 * with its seat pattern and all-inclusive price, then "Choose your seats"
 * to the seat page. Nothing is chosen here, so seated tiers are never sold
 * as quantities. Sold out: the waitlist instead; once the event has ended,
 * no "Choose your seats".
 */
export default function SeatedTicketsPanel({ event, demo }: { event: SheltuhEvent; demo: boolean }) {
  const patterns = patternIdsFor(`panel-${event.id}`);
  const seated = event.ticketTypes
    .filter((ticket) => ticket.seated)
    .sort((a, b) => getTicketBuyerTotalCents(a) - getTicketBuyerTotalCents(b) || (a.id < b.id ? -1 : 1));
  const treatments = tierTreatments(seated);
  const soldOut = isSoldOut(event);
  const ended = Date.parse(event.endsAt ?? event.startsAt) <= new Date().getTime();
  const price = formatFeedPriceParts(event);
  const buyerPaysAFee = event.ticketTypes.some((t) => t.priceCents > 0 && t.feePolicy === "buyer-pays");
  const low = seated.find((ticket) => !ticket.soldOut && ticket.remaining !== undefined && ticket.remaining > 0);

  return (
    <div className="flex flex-col gap-5 rounded-card border border-foreground bg-card p-4 sm:p-5">
      <SeatPatternDefs ids={patterns} />
      {price && !soldOut && (
        <p className="text-base leading-6">
          <span className="font-semibold tabular-nums">{price.amount}</span>
          {price.note && <span className="text-muted"> {price.note}</span>}
        </p>
      )}

      <ul className="flex flex-col">
        {event.ticketTypes.map((ticket) => {
          const tierSoldOut = ticket.soldOut === true;
          return (
            // The standard ticket row (as TicketSelector's): the name, then the all-inclusive price under it at every width.
            <li
              key={ticket.id}
              className="grid grid-cols-[1rem_1fr] items-start gap-x-3 border-t border-surface-border py-3 first:border-t-0 first:pt-0"
            >
              <span className="mt-1">
                {ticket.seated && <SeatSwatch size={16} treatment={treatments.get(ticket.id) ?? "outline"} patterns={patterns} />}
              </span>
              <div className="min-w-0">
                <p className="text-base leading-snug font-semibold">{ticket.name}</p>
                <p className={`mt-1 text-base leading-6 font-semibold tabular-nums ${tierSoldOut ? "text-muted" : ""}`.trim()}>
                  {formatTicketHeadline(ticket)}
                </p>
                {!ticket.seated && <p className="mt-1 text-xs text-muted">Standing</p>}
                {tierSoldOut ? (
                  <p className="eyebrow mt-1">Sold out</p>
                ) : (
                  ticket.remaining !== undefined &&
                  ticket.remaining > 0 && (
                    <p className="mt-1 text-xs font-semibold">
                      Only {ticket.remaining} {ticket.seated ? (ticket.remaining === 1 ? "seat" : "seats") : ticket.remaining === 1 ? "ticket" : "tickets"} left
                    </p>
                  )
                )}
              </div>
            </li>
          );
        })}
      </ul>

      {soldOut ? (
        <WaitlistBlock eventId={event.id} closed={ended} demo={demo || !isApiConfigured} />
      ) : ended ? (
        <p className="border-t border-foreground pt-4 text-sm">Ticket sales for this event have ended.</p>
      ) : (
        <div className="flex flex-col gap-3 border-t border-foreground pt-4">
          {low && <p className="text-sm font-semibold">Few seats left in {low.name}.</p>}
          <ButtonLink variant="solid" size="lg" href={`/events/${event.slug}/seats`} className="w-full">
            Choose your seats
            <ArrowRightIcon className="h-4 w-4 shrink-0" />
          </ButtonLink>
          {buyerPaysAFee && <p className="text-xs text-muted">{describeBookingFeeNote()}</p>}
        </div>
      )}
    </div>
  );
}
