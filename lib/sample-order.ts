import type { CustomerOrder, MyTicketItem, MyTicketOrderItem, MyTicketsPage } from "@/lib/api/types";
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

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;

/** The order total a buyer pays for `quantity` of a ticket type, all-inclusive (lib/fees.ts). */
function sampleTotalCents(type: SheltuhEvent["ticketTypes"][number], quantity: number): number {
  const fee = type.feePolicy === "buyer-pays" ? calculateBookingFeeCents(type.priceCents) : 0;
  return (type.priceCents + fee) * quantity;
}

/**
 * The demo's My tickets (/tickets with no API): five cards across the sample
 * events, upcoming and past, in the list's states (a plain ticket, one on
 * offer to a friend, one received, an ended event, a refund). Dated from
 * `now`, so the samples never drift into the past as the real sample events
 * do; each keeps its event's title, venue, image and ticket type. Ids start
 * with "demo-" (the order cards open the demo ticket page, which shows its
 * own sample whatever the id). The fee maths is lib/fees.ts's.
 */
export function sampleMyTickets(now: number): MyTicketsPage {
  const hour = Math.floor(now / HOUR_MS) * HOUR_MS;
  const paid = sampleEvents.filter((event) => event.ticketTypes.some((type) => type.priceCents > 0));
  const pick = (i: number) => paid[i % Math.max(paid.length, 1)];

  function eventFields(event: SheltuhEvent, startOffsetMs: number) {
    const startsAt = hour + startOffsetMs;
    return {
      eventTitle: event.title,
      eventListed: true,
      eventSlug: event.slug,
      eventStartsAt: new Date(startsAt).toISOString(),
      eventEndsAt: new Date(startsAt + 3 * HOUR_MS).toISOString(),
      eventTimeZone: event.timeZone,
      eventState: event.state,
      venueName: event.venueName,
      suburb: event.suburb,
      imageUrl: event.imageUrl,
      imageFocus: event.imageFocus,
    };
  }
  function order(
    i: number,
    startOffsetMs: number,
    fields: Pick<MyTicketOrderItem, "section" | "status" | "ticketCount" | "heldCount" | "pendingCount">,
  ): MyTicketItem | null {
    const event = pick(i);
    const type = event?.ticketTypes.find((candidate) => candidate.priceCents > 0);
    if (!event || !type) return null;
    return {
      kind: "order",
      orderId: `demo-order-${i + 1}`,
      ...eventFields(event, startOffsetMs),
      ...fields,
      ...(fields.status === "refunded" ? { refundReason: "refunded" as const } : {}),
      totalCents: sampleTotalCents(type, fields.ticketCount),
      checkedInCount: 0,
      ticketTypeName: type.name,
    };
  }
  const receivedEvent = pick(2);
  const receivedType = receivedEvent?.ticketTypes.find((candidate) => candidate.priceCents > 0);
  const received: MyTicketItem | null =
    receivedEvent && receivedType
      ? {
          kind: "received",
          transferId: "demo-received-1",
          reference: "#DEMO0R01",
          status: "valid",
          section: "upcoming",
          ...eventFields(receivedEvent, 17 * DAY_MS),
          fromName: "Alex Chen",
          holderName: "Sam Lee",
          acceptedAt: new Date(hour - 2 * DAY_MS).toISOString(),
          ticketTypeName: receivedType.name,
        }
      : null;

  const items = [
    order(0, 3 * DAY_MS, { section: "upcoming", status: "paid", ticketCount: 1, heldCount: 1, pendingCount: 0 }),
    order(1, 10 * DAY_MS, { section: "upcoming", status: "paid", ticketCount: 2, heldCount: 2, pendingCount: 1 }),
    received,
    // A refunded order is past, even for an event still to come (it sorts first there: the API's order).
    order(3, 20 * DAY_MS, { section: "past", status: "refunded", ticketCount: 1, heldCount: 0, pendingCount: 0 }),
    order(4, -12 * DAY_MS, { section: "past", status: "paid", ticketCount: 2, heldCount: 2, pendingCount: 0 }),
  ].filter((item): item is MyTicketItem => item !== null);

  return {
    items,
    counts: {
      upcoming: items.filter((item) => item.section === "upcoming").length,
      past: items.filter((item) => item.section === "past").length,
    },
  };
}
