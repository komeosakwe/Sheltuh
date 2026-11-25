import type { MyTicketItem, MyTicketOrderItem, MyTicketReceivedItem, MyTicketSection, MyTicketsPage } from "@/lib/api/types";
import { eventZone, formatAud, formatDayWithYear, formatEventTime, zoneSuffix } from "@/lib/format";
import { firstName } from "@/lib/person-name";
import type { TicketCardState } from "@/lib/ticket-card-state";
import { ticketStubTime } from "@/lib/ticket-times";

/*
 * My tickets (/tickets; components/tickets/MyTicketsList.tsx): what each card
 * of GET /api/me/tickets says, as TicketCard's props. Pure, so the words are
 * tested on their own (tests/my-tickets.test.ts).
 *
 * An order card has counts only (no recipient names, offer ids, check-in
 * times or refund dates), so its words are generic: "Waiting to be accepted"
 * ("1 sent, waiting for them to accept" with several), "2 sent", "✓ Checked in", "Refunded A$25.94". A one-ticket order drops the
 * number. A card never carries a ticket code (the list has none).
 */

/** Cards a page of GET /api/me/tickets holds: the API's default (lib/server/pagination.ts), which the list uses. */
export const MY_TICKETS_PAGE_SIZE = 20;

/** A card's identity across pages: an order and a received ticket can't share an id, but the kinds are kept apart anyway. */
export function myTicketKey(item: MyTicketItem): string {
  return item.kind === "order" ? `order:${item.orderId}` : `received:${item.transferId}`;
}

/** Where a card goes: the order's ticket page (its id is the page's credential) or the received ticket's page. */
export function myTicketHref(item: MyTicketItem): string {
  return item.kind === "order"
    ? `/checkout/success?session_id=${encodeURIComponent(item.orderId)}`
    : `/tickets/received/${encodeURIComponent(item.transferId)}`;
}

/** Shown instead of a date when the card has none: an unlisted event (its times aren't sent), or no event at all. */
export const UNLISTED_WHEN = "No longer listed";
export const NO_DATE_WHEN = "No date";

/**
 * The card's date line, in the event's zone: "Sat 14 Nov · 5–9 pm", with the
 * year when it isn't this year ("Fri 25 Sep 2025 · 8 pm") and the zone's city
 * when its clock isn't Melbourne's ("… · 7–10 pm Perth time"). An unlisted
 * event: "No longer listed"; no start at all: "No date".
 */
export function myTicketWhen(item: MyTicketItem, now: Date): string {
  if (!item.eventListed) return UNLISTED_WHEN;
  const start = item.eventStartsAt;
  if (!start || !Number.isFinite(Date.parse(start))) return NO_DATE_WHEN;
  const zone = eventZone(item.eventTimeZone);
  return `${formatDayWithYear(start, now, zone)} · ${ticketStubTime(start, item.eventEndsAt, zone)}${zoneSuffix(zone, item.eventState, start)}`;
}

/** "Interconnect Studio", else the suburb; nothing for an unlisted event. */
export function myTicketVenue(item: MyTicketItem): string | undefined {
  if (!item.eventListed) return undefined;
  return item.venueName?.trim() || item.suburb?.trim() || undefined;
}

const tickets = (n: number) => `${n} ${n === 1 ? "ticket" : "tickets"}`;

/** What TicketCard is given for one card (less the image, which is a component's business). */
export interface MyTicketCardModel {
  key: string;
  section: MyTicketSection;
  state: TicketCardState;
  when: string;
  eventTitle: string;
  venue?: string;
  holder: string;
  count?: string;
  /** The status bar's words; undefined for an Active card (it has none). */
  status?: string;
  href: string;
  /**
   * How the card is opened: "Show ticket →" on an upcoming card, else the bar's link ("View order" / "View
   * ticket"), so a past card's page (its receipt, who it went to) can still be reached.
   */
  action: { kind: "show" } | { kind: "status"; label: string };
}

function orderCard(item: MyTicketOrderItem, now: Date): MyTicketCardModel {
  const single = item.ticketCount === 1;
  const sentCount = Math.max(0, item.ticketCount - item.heldCount);
  const typeLine =
    item.ticketCount === 0 ? "No tickets issued" : (item.ticketTypeName?.trim() || (single ? "Ticket" : "Several ticket types"));
  const base = {
    key: myTicketKey(item),
    section: item.section,
    when: myTicketWhen(item, now),
    eventTitle: item.eventTitle,
    venue: myTicketVenue(item),
    count: item.ticketCount > 0 ? tickets(item.ticketCount) : undefined,
    href: myTicketHref(item),
  };

  if (item.status !== "paid") {
    // Refunded (by an admin or the oversell path), or not reserved and owed a refund: the total, all-inclusive.
    const amount = item.totalCents > 0 ? formatAud(item.totalCents) : null;
    const status =
      item.status === "oversold_refund_required"
        ? amount
          ? `Tickets not reserved. ${amount} refund on its way.`
          : "Tickets not reserved"
        : amount
          ? `Refunded ${amount}`
          : "Refunded";
    return { ...base, state: "refunded", holder: typeLine, status, action: { kind: "status", label: "View order" } };
  }

  if (item.section === "past") {
    if (item.ticketCount > 0 && item.heldCount === 0) {
      // Every ticket was sent to someone who accepted it: the QR codes here no longer work.
      return {
        ...base,
        state: "transferred",
        holder: typeLine,
        status: single ? "Sent. This QR code no longer works." : `${sentCount} sent. These QR codes no longer work.`,
        action: { kind: "status", label: "View order" },
      };
    }
    return { ...base, state: "ended", holder: typeLine, status: "Event ended", action: { kind: "status", label: "View order" } };
  }

  // Upcoming: at least one ticket is still the caller's.
  const holder = sentCount > 0 ? `${typeLine} · ${sentCount} sent` : typeLine;
  if (item.pendingCount > 0) {
    return {
      ...base,
      state: "transfer_pending",
      holder,
      status: single ? "Waiting to be accepted" : `${item.pendingCount} sent, waiting for them to accept`,
      action: { kind: "show" },
    };
  }
  if (item.checkedInCount > 0) {
    return {
      ...base,
      state: "checked_in",
      holder,
      status: item.heldCount === 1 ? "✓ Checked in" : `✓ ${item.checkedInCount} of ${item.heldCount} checked in`,
      action: { kind: "show" },
    };
  }
  return { ...base, state: "active", holder, action: { kind: "show" } };
}

function receivedCard(item: MyTicketReceivedItem, now: Date): MyTicketCardModel {
  const base = {
    key: myTicketKey(item),
    section: item.section,
    when: myTicketWhen(item, now),
    eventTitle: item.eventTitle,
    venue: myTicketVenue(item),
    holder: [item.holderName.trim(), item.ticketTypeName.trim()].filter(Boolean).join(" · ") || "Ticket",
    // Who it came from, as the received page's "From Alex Chen" (first name: the row is short).
    count: item.fromName.trim() ? `From ${firstName(item.fromName)}` : undefined,
    href: myTicketHref(item),
  };
  if (item.status === "void") {
    return { ...base, state: "transferred", status: "This ticket is no longer valid", action: { kind: "status", label: "View ticket" } };
  }
  if (item.section === "past") {
    return { ...base, state: "ended", status: "Event ended", action: { kind: "status", label: "View ticket" } };
  }
  if (item.checkedInAt) {
    const at = formatEventTime(item.checkedInAt, eventZone(item.eventTimeZone));
    return { ...base, state: "checked_in", status: `✓ Checked in ${at}`, action: { kind: "show" } };
  }
  return { ...base, state: "active", action: { kind: "show" } };
}

/** One card's words and link. */
export function myTicketCard(item: MyTicketItem, now: Date): MyTicketCardModel {
  return item.kind === "order" ? orderCard(item, now) : receivedCard(item, now);
}

/**
 * Adds a page to the cards so far (Show more): only cards not already listed, by key. The pages are offsets
 * into the list as it is when each is fetched, so a card that moved (its event ended between two pages) could
 * come again; the first one stays.
 */
export function mergeMyTickets(current: readonly MyTicketItem[], page: readonly MyTicketItem[]): MyTicketItem[] {
  const seen = new Set(current.map(myTicketKey));
  const added: MyTicketItem[] = [];
  for (const item of page) {
    const key = myTicketKey(item);
    if (seen.has(key)) continue;
    seen.add(key);
    added.push(item);
  }
  return [...current, ...added];
}

/** The cards in each list, in the API's order (upcoming soonest first, past most recent first). */
export function splitMyTickets(items: readonly MyTicketItem[]): Record<MyTicketSection, MyTicketItem[]> {
  return {
    upcoming: items.filter((item) => item.section === "upcoming"),
    past: items.filter((item) => item.section === "past"),
  };
}

/**
 * Where "Show more" goes: under the list the last loaded card is in (the pages walk the upcoming cards first,
 * then the past ones). Decided by what has loaded, not by the counts, which can drift from the pages (a card
 * that moves to Past between two reads). Null once the list is all in.
 */
export function showMoreSection(items: readonly MyTicketItem[], hasMore: boolean): MyTicketSection | null {
  if (!hasMore) return null;
  return items.at(-1)?.section ?? "upcoming";
}

/**
 * How many cards "Show N more" brings: a page, or what the counts say is left when that's less. Null when the
 * counts say nothing's left though the API has another page (they drifted): then it's "Show more".
 */
export function showMoreCount(counts: MyTicketsPage["counts"], loaded: number): number | null {
  const left = counts.upcoming + counts.past - loaded;
  return left > 0 ? Math.min(MY_TICKETS_PAGE_SIZE, left) : null;
}
