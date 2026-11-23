import type { CustomerOrder } from "@/lib/api/types";
import { calculateBookingFeeCents } from "@/lib/fees";
import { sampleEvents } from "@/lib/sample-events";
import type { SheltuhEvent } from "@/lib/types";

/**
 * The demo's sample order (no Supabase configured): one ticket to the first
 * sample event that sells tickets here, priced with the real fee maths
 * (lib/fees.ts), so the ticket page can be seen without an API. Null if the
 * samples ever hold no such event.
 */
export function sampleTicketOrder(): { order: CustomerOrder; event: SheltuhEvent } | null {
  const event = sampleEvents.find((candidate) => candidate.ticketTypes.some((type) => type.priceCents > 0));
  const type = event?.ticketTypes.find((candidate) => candidate.priceCents > 0);
  if (!event || !type) return null;
  const buyerFeeCents = type.feePolicy === "buyer-pays" ? calculateBookingFeeCents(type.priceCents) : 0;
  return {
    event,
    order: {
      status: "paid",
      reference: "#DEMO0001",
      eventTitle: event.title,
      eventSlug: event.slug,
      eventListed: true,
      eventStartsAt: event.startsAt,
      eventEndsAt: event.endsAt,
      venueName: event.venueName,
      suburb: event.suburb,
      eventState: event.state,
      refundPolicy: event.refundPolicy,
      refundDays: event.refundDays,
      subtotalCents: type.priceCents,
      buyerFeeCents,
      totalCents: type.priceCents + buyerFeeCents,
      tickets: [{ ticketCode: "K7QM-2XPD", ticketTypeName: type.name, checkedInAt: null }],
    },
  };
}
