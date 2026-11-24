"use client";

import Link from "next/link";
import { useState, type ReactNode } from "react";
import EventArt from "@/components/EventArt";
import EventLocationMap from "@/components/events/EventLocationMap";
import FullTicket from "@/components/tickets/FullTicket";
import TicketCard from "@/components/tickets/TicketCard";
import TicketFullScreen from "@/components/tickets/TicketFullScreen";
import TicketPagerButton from "@/components/tickets/TicketPagerButton";
import TicketCalendarCard, { ticketCardClass, ticketCardTitleClass, useTicketCalendar } from "@/components/tickets/TicketCalendarCard";
import {
  DirectionsSheet,
  ManageOrderSheet,
  OrderReceiptSheet,
  type ManageOrderRow,
} from "@/components/tickets/TicketSheets";
import WalletButtons from "@/components/tickets/WalletButtons";
import { ButtonLink } from "@/components/ui/Button";
import type { CustomerOrder, CustomerTicket, TicketSeat, TransferredTicket } from "@/lib/api/types";
import { SUPPORT_EMAIL } from "@/lib/contact";
import { eventZone, formatAud, formatDayMonth } from "@/lib/format";
import { appleMapsHref, directionsHref, type VenueLinkTarget } from "@/lib/maps";
import { addressNamesPlace, bareSuburb, placeNameParts, venueLines } from "@/lib/place";
import { firstName } from "@/lib/person-name";
import { REFUND_ACL_STATEMENT, refundTermsLine } from "@/lib/refund-policy";
import { compareSeats } from "@/lib/seating/format";
import { SUPPORT_REFUND_NOTE } from "@/lib/support";
import { ticketStubDate, ticketStubTime, ticketWhenLine } from "@/lib/ticket-times";
import type { SheltuhEvent } from "@/lib/types";
import { appleWalletDeviceNote } from "@/lib/wallet-badges";

/** Each ticket with its number in the API's (and the email's) order, seated ones sorted by seat. */
export function sortTicketsBySeat(tickets: CustomerOrder["tickets"]) {
  const numbered = tickets.map((ticket, i) => ({ ticket, number: ticket.ticketNumber ?? i + 1 }));
  if (!tickets.some((ticket) => ticket.seat)) return numbered;
  return [...numbered].sort((a, b) => bySeatThenNumber(a.ticket.seat, a.number, b.ticket.seat, b.number));
}

function bySeatThenNumber(aSeat: TicketSeat | undefined, aNumber: number, bSeat: TicketSeat | undefined, bNumber: number) {
  return aSeat && bSeat ? compareSeats(aSeat, bSeat) : aSeat ? -1 : bSeat ? 1 : aNumber - bNumber;
}

/**
 * One of the order's tickets as the page shows it: one the buyer holds (`live`, with its code, maybe on
 * offer to someone), or one they sent that was accepted (`sent`: no code, ever).
 */
export type OrderTicketEntry =
  | { kind: "live"; ticket: CustomerTicket; number: number }
  | { kind: "sent"; sent: TransferredTicket; number: number };

/**
 * The order's tickets, held and sent, each with its own number (the email's and the door's), in that order;
 * seated ones by section, row, then seat.
 */
export function orderTicketEntries(order: CustomerOrder): OrderTicketEntry[] {
  const entries: OrderTicketEntry[] = [
    ...order.tickets.map((ticket, i): OrderTicketEntry => ({ kind: "live", ticket, number: ticket.ticketNumber ?? i + 1 })),
    ...(order.transferredTickets ?? []).map((sent): OrderTicketEntry => ({ kind: "sent", sent, number: sent.ticketNumber })),
  ];
  const seatOf = (entry: OrderTicketEntry) => (entry.kind === "live" ? entry.ticket.seat : entry.sent.seat);
  return entries.sort((a, b) => bySeatThenNumber(seatOf(a), a.number, seatOf(b), b.number));
}

interface MyTicketViewProps {
  /** A paid order (its tickets issued). */
  order: CustomerOrder;
  /** The order id the page was opened with: what the wallet passes are fetched by. Null where there is none (the demo). */
  sessionId: string | null;
  /**
   * The event as its public page has it, when it could be loaded: its image, street address and map links. The
   * page works without it (the order has the name, date, venue and suburb); it only adds to what's shown.
   */
  event?: SheltuhEvent | null;
  /** The order's email line and its change form (components/checkout/OrderEmail.tsx), under the title. */
  emailSlot?: ReactNode;
  /**
   * Send a ticket to a friend (the ticket's number in the order): Manage order's "Send ticket to a friend" and
   * the full-screen ticket's Send, for a ticket the API says can be sent now (CustomerTicket.canSend). Left
   * out (sending is off, or this visitor can't send): no Send anywhere.
   */
  onSendTicket?: (ticketNumber: number) => void;
  /**
   * Sending needs the buyer signed in (CustomerOrder.transfers.reason `sign_in`): Manage order's row says so
   * and this goes to sign in, coming back to the ticket (its number).
   */
  onSignInToSend?: (ticketNumber: number) => void;
  /** Takes back an offer of a ticket (the "Waiting for Sam to accept" strip's Cancel). */
  onCancelTransfer?: (ticketNumber: number, transferId: string) => void;
  /** The ticket whose offer is being cancelled now. */
  cancelling?: number | null;
  /** Why a ticket's offer couldn't be cancelled, said under its strip. */
  transferError?: { ticketNumber: number; message: string } | null;
  /** The page's toast (components/ui/Toast.tsx): also shown over the full-screen ticket while that's open. */
  toast?: ReactNode;
}

const cardClass = ticketCardClass;
const cardTitleClass = ticketCardTitleClass;
const detailLabelClass = "font-mono text-xs leading-4 text-muted uppercase";
const quietLinkClass = "body-s inline-flex min-h-11 items-center font-semibold text-foreground underline-offset-4 hover:underline";
const pagerButtonClass = "inline-flex min-h-11 min-w-11 items-center justify-center rounded-control text-foreground hover:bg-surface";
const showTicketClass =
  "label-button flex min-h-14 w-full items-center justify-center gap-2 rounded-control bg-signal p-4 text-ink motion-safe:transition-colors motion-safe:duration-200 hover:bg-ink hover:text-signal focus-visible:bg-ink focus-visible:text-signal active:bg-ink active:text-signal md:hidden print:hidden";

/**
 * The My ticket page (Latte's 1120 frames at 1440 / 768 / 390) for one paid
 * order: the full ticket on the left (360 wide from 1024, 296 from 768;
 * above the details on phones, compact) with its wallet badges; on the right
 * the order line, the event, and the Add to calendar, Getting there and
 * Ticket details cards, then the help line.
 *
 * An order of several tickets shows one at a time at every width, as the
 * full-screen ticket does: Previous / Next with "Ticket 1 of 2" between
 * (said politely on each change), in seat order for seated tickets but each
 * with its own number. The wallet badges and "Show ticket" are the shown
 * ticket's, and the full-screen ticket opens on it. Printing prints them all.
 *
 * The ticket itself is the email's orange-outline design (FullTicket: owner
 * rule); everything around it follows the frames. On phones "Show ticket"
 * opens the ticket full screen for scanning (TicketFullScreen).
 *
 * Rows the frames draw whose data doesn't exist yet are left out, not shown
 * empty: PURCHASED (no order date), the receipt's placed-at / card line, GST
 * line and PDF, and Manage order's rename, resend and contact rows. Sending a ticket (when the API
 * says it can be sent) is Manage order's first row and the full-screen ticket's Send; a ticket on offer has
 * a "Waiting for Sam to accept" strip under it, and one sent and accepted is Latte's Transferred card.
 */
export default function MyTicketView({
  order,
  sessionId,
  event = null,
  emailSlot,
  onSendTicket,
  onSignInToSend,
  onCancelTransfer,
  cancelling = null,
  transferError = null,
  toast,
}: MyTicketViewProps) {
  const [sheet, setSheet] = useState<"directions" | "receipt" | "manage" | null>(null);
  const [fullScreen, setFullScreen] = useState<{ open: boolean; start: number }>({ open: false, start: 0 });
  // The ticket shown (by its place in `tickets`, the seat order): one at a time, at every width.
  const [shownIndex, setShownIndex] = useState(0);

  // An event that's no longer published: no date, venue, image or links to its page (which would be a 404).
  const unlisted = order.eventListed === false;
  const listedEvent = unlisted ? null : event;
  const eventPath = order.eventSlug && !unlisted ? `/events/${encodeURIComponent(order.eventSlug)}` : null;
  const zone = eventZone(order.eventTimeZone);
  const startsAt = unlisted ? undefined : order.eventStartsAt;
  const suburb = order.suburb ? bareSuburb(order.suburb, order.eventState) : "";
  const venueLine = unlisted ? "" : [order.venueName?.trim() ?? "", suburb].filter(Boolean).join(" · ");
  const entries = orderTicketEntries(order);
  // The full-screen ticket's slides: the tickets the buyer holds, in the page's order.
  const tickets = entries.flatMap((entry) => (entry.kind === "live" ? [{ ticket: entry.ticket, number: entry.number }] : []));
  const count = entries.length;
  const index = Math.min(shownIndex, Math.max(entries.length - 1, 0));
  const shown = entries[index];
  const current = shown?.kind === "live" ? { ticket: shown.ticket, number: shown.number } : null;
  const currentSlide = current ? tickets.findIndex(({ number }) => number === current.number) : -1;
  const canSend = (ticket: CustomerTicket) => Boolean(onSendTicket) && ticket.canSend !== false && !ticket.transfer && !ticket.checkedInAt;
  const hasWallet = Boolean(sessionId && !unlisted && (order.wallet?.apple || order.wallet?.google));
  const paid = order.totalCents > 0;
  // The refund policy: only where something was paid (a free order has nothing to refund) and the event is listed.
  const refunds = unlisted || !paid ? null : refundTermsLine(order.refundPolicy, order.refundDays, order.eventStartsAt, { timeZone: zone });

  // Where the venue is: the event's own fields when loaded (street address, the organiser's pin or place), else the order's.
  const venue: VenueLinkTarget | null = unlisted
    ? null
    : listedEvent
      ? listedEvent
      : order.venueName || order.suburb
        ? { venueName: order.venueName ?? "", venueAddress: "", suburb: order.suburb ?? "", state: order.eventState }
        : null;
  const lines = venue ? venueLines({ venueName: venue.venueName, venueAddress: venue.venueAddress, suburb: venue.suburb, state: venue.state }) : null;
  // Under the venue's name: its street address with the suburb and state ("16 Catherine St, Coburg North VIC", as
  // the frames and the ticket email write it), unless the address already names them; without a street address,
  // venueLines' own second line (the place).
  const street = venue?.venueAddress.trim() ?? "";
  const place = venue ? placeNameParts(venue.suburb, venue.state) : null;
  const address =
    lines && venue && lines.named && street && place && !addressNamesPlace(street, venue.suburb, venue.state)
      ? `${street}, ${place.suburb} ${place.state}`
      : (lines?.second ?? "");
  // What Directions' Copy address copies. A venue with no name has its street as the first line and the place as the
  // second ("16 Catherine St" / "Coburg North, VIC"): copy both, not the place alone. A named venue copies `address`.
  const copyAddress = lines && !lines.named ? [lines.first, lines.second].filter(Boolean).join(", ") : undefined;
  const googleHref = venue ? directionsHref(venue) : null;
  const appleHref = venue ? appleMapsHref(venue) : null;

  const calendar = useTicketCalendar({
    slug: order.eventSlug,
    id: listedEvent?.id,
    title: order.eventTitle,
    description: listedEvent?.description,
    venueName: listedEvent?.venueName ?? order.venueName,
    venueAddress: listedEvent?.venueAddress,
    startsAt,
    endsAt: order.eventEndsAt,
  });

  // One kind of ticket (and no group tickets, whose people each hold one): "2 × Second release". Otherwise the plain label.
  const kinds = entries.map((entry) => (entry.kind === "live" ? entry.ticket : entry.sent));
  const types = new Set(kinds.map((ticket) => ticket.ticketTypeName));
  const oneKind = types.size === 1 && !kinds.some((ticket) => ticket.group);
  const ticketsLabel = oneKind ? `${count} × ${kinds[0].ticketTypeName}` : "Ticket subtotal";
  const ticketSummary = oneKind
    ? `${kinds[0].ticketTypeName} · ${count === 1 ? "1 of 1" : `${count} tickets`}`
    : `${count} ${count === 1 ? "ticket" : "tickets"}`;

  // Send ticket to a friend (Latte's Manage order row), for the ticket shown: when it can be sent now, or
  // (signed out) to sign in first. Never for a ticket on offer, checked in or sent already.
  const sendable = current && !current.ticket.transfer && !current.ticket.checkedInAt ? current : null;
  const sendSub = (rest: string) => (count > 1 && sendable ? `Ticket ${sendable.number} of ${count}. ${rest}` : rest);
  const sendRow: ManageOrderRow | null =
    sendable && onSendTicket && canSend(sendable.ticket)
      ? { title: "Send ticket to a friend", sub: sendSub("They get their own QR code; yours stops working"), onClick: () => onSendTicket(sendable.number) }
      : sendable && onSignInToSend
        ? {
            title: "Send ticket to a friend",
            sub: sendSub(`Sign in with ${order.maskedEmail ?? "the email you bought with"} to send it`),
            onClick: () => onSignInToSend(sendable.number),
          }
        : null;
  const manageRows: ManageOrderRow[] = [
    ...(sendRow ? [sendRow] : []),
    ...(paid ? [{ title: "Request a refund", sub: "Only if eligible under the policy", href: "/refunds" }] : []),
  ];

  const art = listedEvent ? (
    <EventArt poster={listedEvent.poster} title={listedEvent.title} imageUrl={listedEvent.imageUrl} imageFocus={listedEvent.imageFocus} className="size-full" />
  ) : undefined;
  const ticketProps = (ticket: CustomerOrder["tickets"][number], number: number) => ({
    eventTitle: order.eventTitle,
    image: art,
    venueLine: venueLine || undefined,
    date: startsAt ? ticketStubDate(startsAt, order.eventTimeZone) : undefined,
    time: startsAt ? ticketStubTime(startsAt, order.eventEndsAt, order.eventTimeZone) : undefined,
    typeName: ticket.ticketTypeName,
    group: ticket.group,
    seat: ticket.seat,
    code: ticket.ticketCode,
    ticketNumber: number,
    ticketCount: count,
    eventUnlisted: unlisted,
    checkedInAt: ticket.checkedInAt,
    timeZone: zone,
  });
  const walletFor = (number: number, className: string) =>
    sessionId && hasWallet ? (
      <WalletButtons sessionId={sessionId} wallet={order.wallet} ticketNumber={number} ticketCount={count} className={className} />
    ) : null;

  return (
    <div data-my-ticket="" className="flex flex-col gap-6 md:flex-row md:items-start lg:gap-12">
      {/*
        The tickets come first (above the title on phones, left of it from 768), so nothing here is a heading:
        the page's first heading is its h1. The section is a named region instead, and each ticket's title
        (the event's name, as the h1) isn't a heading. A group ticket's people each have one: the name counts them.
      */}
      <section
        aria-label={order.tickets.some((ticket) => ticket.group) ? `Your tickets (${count})` : "Your tickets"}
        className="flex min-w-0 flex-col gap-4 md:w-74 md:shrink-0 lg:w-90"
      >
        {count > 1 && (
          <div className="-my-2 flex items-center justify-between gap-3 print:hidden" data-ticket-pager="">
            <TicketPagerButton direction="previous" atEnd={index === 0} onMove={() => setShownIndex(index - 1)} className={pagerButtonClass} />
            {/* Its own number in the order (the email's and the door's), even where seats set the order shown. */}
            <p className="font-mono text-sm leading-5 font-medium text-foreground" aria-live="polite" aria-atomic="true">
              <span className="uppercase">Ticket</span> {shown.number} of {count}
            </p>
            <TicketPagerButton direction="next" atEnd={index === count - 1} onMove={() => setShownIndex(index + 1)} className={pagerButtonClass} />
          </div>
        )}
        <ul className="flex flex-col gap-6">
          {/* Numbered as in the ticket email and at the door (ticket type, then code, as the API returns them);
              seated tickets are listed by section, row, then seat, keeping those numbers. One shows at a time;
              the rest are hidden on screen but all print, each on its own. */}
          {entries.map((entry, i) => (
            <li key={`${entry.kind}-${entry.number}`} className={i === index ? undefined : "hidden print:block"}>
              {entry.kind === "live" ? (
                <FullTicket {...ticketProps(entry.ticket, entry.number)} headingLevel={null} />
              ) : (
                // Sent and accepted (Latte's Ticket card, Transferred): no QR, no code, ever.
                <TicketCard
                  state="transferred"
                  headingLevel={null}
                  when={startsAt ? `${ticketStubDate(startsAt, order.eventTimeZone)} · ${ticketStubTime(startsAt, order.eventEndsAt, order.eventTimeZone)}` : ""}
                  eventTitle={order.eventTitle}
                  venue={unlisted ? undefined : order.venueName || undefined}
                  image={art}
                  holder={`${entry.sent.holderName ? `Sent to ${entry.sent.holderName}` : "Sent"} · accepted ${formatDayMonth(entry.sent.acceptedAt, zone)}`}
                  count={`${entry.number} of ${count}`}
                />
              )}
            </li>
          ))}
        </ul>
        {current?.ticket.transfer && (
          <TransferPendingStrip
            ticketNumber={current.number}
            toName={current.ticket.transfer.toName}
            transferId={current.ticket.transfer.canCancel ? current.ticket.transfer.transferId : undefined}
            onCancel={onCancelTransfer}
            busy={cancelling === current.number}
            error={transferError?.ticketNumber === current.number ? transferError.message : null}
          />
        )}
        {shown?.kind === "sent" && shown.sent.acceptedByMaskedEmail && (
          <p className="body-s break-words text-muted">
            Accepted with {shown.sent.acceptedByMaskedEmail}, not the address you sent it to.
          </p>
        )}
        {current && (
          <>
            <button type="button" onClick={() => setFullScreen({ open: true, start: Math.max(currentSlide, 0) })} className={showTicketClass}>
              Show ticket <span aria-hidden="true">→</span>
              {count > 1 && <span className="sr-only"> {current.number} of {count}</span>}
            </button>
            {/* The wallet badges are the shown ticket's. Side by side on phones and from 1024; stacked in the 296 column between (the frames). */}
            {walletFor(current.number, "justify-center md:max-lg:flex-col")}
          </>
        )}
        {/* Apple's badge rules: say how to add the pass from a device without Wallet. */}
        {hasWallet && order.wallet?.apple && <p className="text-xs leading-4 text-muted print:hidden">{appleWalletDeviceNote("page", count)}</p>}
        {tickets.length > 0 && (
          <div className="flex flex-col gap-1 text-xs leading-4 text-muted">
            <p>Screenshot your codes in case signal drops at the venue.</p>
            <p>{order.transfers ? "Each code works once. To give a ticket away, send it from Manage order." : "Each code works once. Don’t share it."}</p>
          </div>
        )}
      </section>

      <div className="flex min-w-0 flex-1 flex-col gap-6">
        <div className="flex flex-col gap-2">
          {/* The reference is a machine code: mono, so 0 and O read apart. "Confirmed" is the order's status in words. */}
          <p className="font-mono text-sm leading-5 font-medium text-signal-text">Order {order.reference} Confirmed</p>
          {/* Heading/H1 as the frames draw it at every width: Bold 40/48 (label-menu is that style; heading-h1 drops to 32 on phones). */}
          <h1 className="label-menu break-words text-foreground">{order.eventTitle}</h1>
          {startsAt && (
            <p className="font-mono text-sm leading-5 font-medium text-muted">
              {ticketWhenLine(startsAt, order.eventEndsAt, order.eventTimeZone, order.eventState)}
            </p>
          )}
          {venueLine && <p className="font-mono text-sm leading-5 font-medium break-words text-muted">{venueLine}</p>}
          {emailSlot}
        </div>

        {calendar && (
          <TicketCalendarCard
            links={calendar}
            subtitle={startsAt ? `${order.eventTitle} · ${ticketStubDate(startsAt, order.eventTimeZone)}, ${ticketStubTime(startsAt, order.eventEndsAt, order.eventTimeZone)}` : order.eventTitle}
          />
        )}

        {venue && lines && (
          <section aria-labelledby="ticket-venue" className={cardClass}>
            <h2 id="ticket-venue" className={cardTitleClass}>
              Getting there
            </h2>
            {/* The frames' map box opens the directions sheet (Apple / Google Maps, Copy address). Once the event has
                loaded, the event page's map sits under it with the venue pinned (decorative and out of the tab order;
                the button on top takes the tap); until then, the frames' placeholder dot. */}
            <div
              className={
                listedEvent && googleHref
                  ? "relative min-h-52 overflow-hidden rounded-card bg-surface print:hidden lg:min-h-64"
                  : "relative print:hidden"
              }
            >
              {listedEvent && googleHref && <EventLocationMap event={listedEvent} directions={googleHref} />}
              <button
                type="button"
                onClick={() => setSheet("directions")}
                aria-label={`Directions to ${lines.first}`}
                className={
                  listedEvent && googleHref
                    ? "absolute inset-0 z-10 rounded-card"
                    : "flex h-50 w-full items-center justify-center rounded-control bg-surface"
                }
              >
                {!(listedEvent && googleHref) && <span aria-hidden="true" className="size-4 rounded-full bg-signal" />}
              </button>
            </div>
            <div className="body-m flex flex-col gap-1">
              <p className="font-semibold break-words text-foreground">{lines.first}</p>
              {address && <p className="break-words text-muted">{address}</p>}
            </div>
            {(googleHref || appleHref) && (
              <p className="body-s -my-3 flex flex-wrap items-center gap-x-3 font-semibold text-foreground print:hidden">
                {googleHref && (
                  <a href={googleHref} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center underline-offset-4 hover:underline">
                    Google Maps <span aria-hidden="true">&nbsp;↗</span>
                    <span className="sr-only"> (opens in a new tab)</span>
                  </a>
                )}
                {googleHref && appleHref && <span aria-hidden="true">·</span>}
                {appleHref && (
                  <a href={appleHref} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center underline-offset-4 hover:underline">
                    Apple Maps <span aria-hidden="true">&nbsp;↗</span>
                    <span className="sr-only"> (opens in a new tab)</span>
                  </a>
                )}
              </p>
            )}
          </section>
        )}

        <section aria-labelledby="ticket-details" className={`${cardClass} gap-3!`}>
          <h2 id="ticket-details" className={cardTitleClass}>
            Ticket details
          </h2>
          <dl className="flex flex-col gap-3">
            <div className="flex items-center justify-between gap-4">
              <dt className={detailLabelClass}>Ticket</dt>
              <dd className="body-m min-w-0 text-right break-words text-foreground">{ticketSummary}</dd>
            </div>
            <div className="flex items-center justify-between gap-4">
              <dt className={detailLabelClass}>Order</dt>
              <dd className="body-m text-right text-foreground">{order.reference}</dd>
            </div>
            <div className="flex items-center justify-between gap-4 border-t border-surface-border pt-3">
              <dt className={detailLabelClass}>Total paid</dt>
              <dd className="label-button text-right text-foreground tabular-nums">{paid ? `${formatAud(order.totalCents)} incl. fees` : "Free"}</dd>
            </div>
          </dl>
          <p className="-my-2 flex flex-wrap items-center gap-x-6 print:hidden">
            {eventPath && (
              <Link href={eventPath} className={quietLinkClass}>
                View event page <span aria-hidden="true">&nbsp;→</span>
              </Link>
            )}
            {manageRows.length > 0 && (
              <button type="button" onClick={() => setSheet("manage")} className={quietLinkClass}>
                Manage order
              </button>
            )}
            {paid && (
              <button type="button" onClick={() => setSheet("receipt")} className={quietLinkClass}>
                View receipt
              </button>
            )}
          </p>
        </section>

        <div className="body-s flex flex-col gap-1 text-muted">
          <p>
            Need a hand?{" "}
            <a href={`mailto:${SUPPORT_EMAIL}`} className="underline underline-offset-2">
              {SUPPORT_EMAIL}
            </a>
          </p>
          {/* The event's refund policy (the API sends it for listed events only). */}
          {refunds && (
            <div data-refund-policy="" className="flex flex-col gap-1">
              <p>
                <span className="font-semibold text-foreground">Refund policy:</span> {refunds}
              </p>
              {order.supportCents !== undefined && order.supportCents > 0 && <p>{SUPPORT_REFUND_NOTE}</p>}
              <p>{REFUND_ACL_STATEMENT}</p>
              <p>
                To ask for one, use{" "}
                <Link href="/refunds" className="text-foreground underline underline-offset-2">
                  Request a refund
                </Link>
                .
              </p>
            </div>
          )}
        </div>

        <div className="flex flex-col items-start gap-1 print:hidden">
          {eventPath && (
            <ButtonLink variant="outline" size="md" href={`${eventPath}#whos-going`} className="w-full sm:w-auto">
              Add yourself to Who&rsquo;s Going
            </ButtonLink>
          )}
          <Link href="/" className={quietLinkClass}>
            Back to Sheltüh
          </Link>
        </div>
      </div>

      {venue && lines && (
        <DirectionsSheet
          open={sheet === "directions"}
          onClose={() => setSheet(null)}
          venueName={lines.first}
          address={address}
          copyText={copyAddress}
          appleHref={appleHref}
          googleHref={googleHref}
        />
      )}
      <OrderReceiptSheet
        open={sheet === "receipt"}
        onClose={() => setSheet(null)}
        reference={order.reference}
        ticketsLabel={ticketsLabel}
        amounts={{ subtotalCents: order.subtotalCents, buyerFeeCents: order.buyerFeeCents, supportCents: order.supportCents, totalCents: order.totalCents }}
      />
      <ManageOrderSheet
        open={sheet === "manage"}
        onClose={() => setSheet(null)}
        subtitle={`Order ${order.reference} · ${count} ${count === 1 ? "ticket" : "tickets"}`}
        rows={manageRows}
        note={refunds ? `${refunds} ${REFUND_ACL_STATEMENT}` : undefined}
      />
      <TicketFullScreen
        open={fullScreen.open}
        start={fullScreen.start}
        onClose={() => setFullScreen((was) => ({ ...was, open: false }))}
        tickets={tickets.map(({ ticket, number }) => (
          <FullTicket key={ticket.ticketCode} {...ticketProps(ticket, number)} size="screen" />
        ))}
        numbers={tickets.map(({ number }) => number)}
        footer={hasWallet ? (index) => walletFor(tickets[index].number, "justify-center") : undefined}
        onSend={onSendTicket ? (index) => onSendTicket(tickets[index].number) : undefined}
        canSend={(index) => canSend(tickets[index].ticket)}
        overlay={toast}
      />
      {toast}
    </div>
  );
}

/**
 * A ticket on offer (my-ticket.md §5.10 state 2; Latte's Ticket card "Transfer pending" status bar): its QR
 * still works until the friend accepts. "Waiting for Sam to accept" and, for the buyer, Cancel (no confirm
 * step: sending again undoes it), a real button with a 44px target. A failed cancel says why under it.
 */
function TransferPendingStrip({
  ticketNumber,
  toName,
  transferId,
  onCancel,
  busy,
  error,
}: {
  ticketNumber: number;
  toName?: string;
  /** Set only when this visitor may cancel it. */
  transferId?: string;
  onCancel?: (ticketNumber: number, transferId: string) => void;
  busy: boolean;
  error: string | null;
}) {
  const who = toName ? firstName(toName) : "them";
  return (
    <div className="flex flex-col gap-2 print:hidden">
      <div data-ticket-status="" className="flex items-center justify-between gap-3 rounded-control bg-surface px-3 py-2 text-foreground">
        <p className="body-s min-w-0 font-semibold break-words">Waiting for {who} to accept</p>
        {transferId && onCancel && (
          <button
            type="button"
            onClick={busy ? undefined : () => onCancel(ticketNumber, transferId)}
            aria-disabled={busy || undefined}
            // The visible word first (the name starts with what's seen), then what it cancels.
            aria-label={busy ? undefined : "Cancel sending this ticket"}
            className="body-s -my-3 inline-flex min-h-11 shrink-0 items-center font-semibold underline underline-offset-2 aria-disabled:text-muted"
          >
            {busy ? "Cancelling…" : "Cancel"}
          </button>
        )}
      </div>
      {error && (
        <p role="alert" className="body-s text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
