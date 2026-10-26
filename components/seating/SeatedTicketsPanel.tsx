import { ArrowRightIcon } from "@/components/home/icons";
import { ButtonLink } from "@/components/ui/Button";
import WaitlistBlock from "@/components/waitlist/WaitlistBlock";
import { isApiConfigured } from "@/lib/api/client";
import { describeBookingFee } from "@/lib/fees";
import {
  formatFeedPriceParts,
  formatTicketBreakdown,
  formatTicketHeadline,
  getTicketBuyerTotalCents,
  isSoldOut,
  pricedTicketTypes,
} from "@/lib/pricing";
import { tierTreatments } from "@/lib/seating/selection";
import type { SheltuhEvent } from "@/lib/types";
import { patternIdsFor, SeatPatternDefs, SeatSwatch } from "./SeatGlyph";

/**
 * The event page's tickets panel for a seated event (docs/design/seating.md
 * §5.1), in TicketSelector's place: the steps, the "From" price, each tier
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
  const allFree = pricedTicketTypes(event).every((t) => t.priceCents === 0);
  const buyerPaysAFee = event.ticketTypes.some((t) => t.priceCents > 0 && t.feePolicy === "buyer-pays");
  const steps = allFree ? ["Choose seats", "Confirm by email", "Tickets"] : ["Choose seats", "Pay", "Tickets by email"];
  const low = seated.find((ticket) => !ticket.soldOut && ticket.remaining !== undefined && ticket.remaining > 0);

  return (
    <div className="flex flex-col gap-5 rounded-card border border-foreground bg-card p-4 sm:p-5">
      <SeatPatternDefs ids={patterns} />
      {!soldOut && !ended && (
        <ol aria-label="How booking works" className="eyebrow flex flex-wrap gap-x-3 gap-y-1">
          {steps.map((step, i) => (
            <li key={step} aria-current={i === 0 ? "step" : undefined} className={`flex gap-x-3 ${i === 0 ? "text-foreground" : "text-muted"}`}>
              {i > 0 && <span aria-hidden="true">&rarr;</span>}
              <span>
                {i + 1} {step}
              </span>
            </li>
          ))}
        </ol>
      )}

      {price && !soldOut && (
        <p className="text-base leading-6">
          <span className="font-semibold tabular-nums">{price.amount}</span>
          {price.note && <span className="text-muted"> {price.note}</span>}
        </p>
      )}

      {buyerPaysAFee && <p className="text-sm text-muted">Booking fee: {describeBookingFee()}. Free tickets never carry a fee.</p>}

      <ul className="flex flex-col">
        {event.ticketTypes.map((ticket) => {
          const tierSoldOut = ticket.soldOut === true;
          const breakdown = formatTicketBreakdown(ticket);
          return (
            // The standard ticket row (as TicketSelector's): the name, the all-inclusive price
            // under it at every width, then what makes it up, quieter and in sentence case.
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
                {ticket.seated ? (
                  breakdown && <p className="mt-1 text-xs text-muted tabular-nums">{breakdown}</p>
                ) : (
                  <p className="mt-1 text-xs text-muted">Standing · chosen on the next page</p>
                )}
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
          <p className={`text-sm ${low ? "font-semibold" : ""}`}>
            {low ? `Few seats left in ${low.name}.` : "Seats are numbered. You’ll pick yours on a seat map."}
          </p>
          <ButtonLink variant="solid" size="lg" href={`/events/${event.slug}/seats`} className="w-full">
            Choose your seats
            <ArrowRightIcon className="h-4 w-4 shrink-0" />
          </ButtonLink>
          <p className="text-xs text-muted">Nothing is held until you press Checkout on the next page.</p>
        </div>
      )}
    </div>
  );
}
