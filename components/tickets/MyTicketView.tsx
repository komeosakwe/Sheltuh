"use client";

import Link from "next/link";
import { useMemo, useState, useSyncExternalStore, type ReactNode } from "react";
import EventArt from "@/components/EventArt";
import FullTicket from "@/components/tickets/FullTicket";
import TicketFullScreen from "@/components/tickets/TicketFullScreen";
import TicketPagerButton from "@/components/tickets/TicketPagerButton";
import {
  AddToCalendarSheet,
  DirectionsSheet,
  ManageOrderSheet,
  OrderReceiptSheet,
  type CalendarLinks,
  type ManageOrderRow,
} from "@/components/tickets/TicketSheets";
import WalletButtons from "@/components/tickets/WalletButtons";
import { ButtonLink, buttonClass } from "@/components/ui/Button";
import type { CustomerOrder } from "@/lib/api/types";
import { googleCalendarUrl, icsFilename, outlookCalendarUrl, type CalendarEvent } from "@/lib/calendar";
import { SUPPORT_EMAIL } from "@/lib/contact";
import { eventCalendarPath, publicEventUrl } from "@/lib/event-url";
import { eventZone, formatAud } from "@/lib/format";
import { appleMapsHref, directionsHref, type VenueLinkTarget } from "@/lib/maps";
import { addressNamesPlace, bareSuburb, placeNameParts, venueLines } from "@/lib/place";
import { REFUND_ACL_STATEMENT, refundTermsLine } from "@/lib/refund-policy";
import { compareSeats } from "@/lib/seating/format";
import { SUPPORT_REFUND_NOTE } from "@/lib/support";
import { ticketStubDate, ticketStubTime, ticketWhenLine } from "@/lib/ticket-times";
import type { SheltuhEvent } from "@/lib/types";
import { appleWalletDeviceNote } from "@/lib/wallet-badges";

/** Each ticket with its number in the API's (and the email's) order, seated ones sorted by seat. */
export function sortTicketsBySeat(tickets: CustomerOrder["tickets"]) {
  const numbered = tickets.map((ticket, i) => ({ ticket, number: i + 1 }));
  if (!tickets.some((ticket) => ticket.seat)) return numbered;
  return [...numbered].sort((a, b) =>
    a.ticket.seat && b.ticket.seat ? compareSeats(a.ticket.seat, b.ticket.seat) : a.ticket.seat ? -1 : b.ticket.seat ? 1 : a.number - b.number,
  );
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
  /** Send a ticket to a friend (the ticket's number in the order). Left out until tickets can be sent: no Send anywhere. */
  onSendTicket?: (ticketNumber: number) => void;
}

/** The page's own origin, for the calendar entries' link back to the event: only known in the browser. */
const noStore = () => () => {};
const useOrigin = () => useSyncExternalStore<string | null>(noStore, () => window.location.origin, () => null);

const cardClass = "flex flex-col gap-4 rounded-control border border-surface-border bg-card p-6";
const cardTitleClass = "text-xl leading-7 font-semibold text-foreground";
const detailLabelClass = "font-mono text-xs leading-4 text-muted uppercase";
const quietLinkClass = "body-s inline-flex min-h-11 items-center font-semibold text-foreground underline-offset-4 hover:underline";
const calendarButtonClass = buttonClass("outline", "sm", "min-w-0 flex-1 px-2");
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
 * line and PDF, and Manage order's send, rename, resend and contact rows.
 */
export default function MyTicketView({ order, sessionId, event = null, emailSlot, onSendTicket }: MyTicketViewProps) {
  const [sheet, setSheet] = useState<"calendar" | "directions" | "receipt" | "manage" | null>(null);
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
  const tickets = sortTicketsBySeat(order.tickets);
  const count = order.tickets.length;
  const index = Math.min(shownIndex, Math.max(tickets.length - 1, 0));
  const current = tickets[index];
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

  const origin = useOrigin();
  const calendar: CalendarLinks | null = useMemo(() => {
    if (!order.eventSlug || !startsAt || origin === null) return null;
    const entry: CalendarEvent = {
      id: listedEvent?.id ?? order.eventSlug,
      slug: order.eventSlug,
      title: order.eventTitle,
      description: listedEvent?.description ?? "",
      venueName: listedEvent?.venueName ?? order.venueName ?? "",
      venueAddress: listedEvent?.venueAddress ?? "",
      startsAt,
      endsAt: order.eventEndsAt,
    };
    const url = publicEventUrl(order.eventSlug, origin);
    const google = googleCalendarUrl(entry, url);
    const outlook = outlookCalendarUrl(entry, url);
    if (google === null || outlook === null) return null;
    return { google, outlook, ics: eventCalendarPath(order.eventSlug), icsName: icsFilename(entry) };
  }, [order.eventSlug, order.eventTitle, order.venueName, order.eventEndsAt, startsAt, listedEvent, origin]);

  // One kind of ticket (and no group tickets, whose people each hold one): "2 × Second release". Otherwise the plain label.
  const types = new Set(order.tickets.map((ticket) => ticket.ticketTypeName));
  const oneKind = types.size === 1 && !order.tickets.some((ticket) => ticket.group);
  const ticketsLabel = oneKind ? `${count} × ${order.tickets[0].ticketTypeName}` : "Ticket subtotal";
  const ticketSummary = oneKind
    ? `${order.tickets[0].ticketTypeName} · ${count === 1 ? "1 of 1" : `${count} tickets`}`
    : `${count} ${count === 1 ? "ticket" : "tickets"}`;

  const manageRows: ManageOrderRow[] = [
    ...(onSendTicket && count === 1
      ? [{ title: "Send ticket to a friend", sub: "They get their own QR code; yours stops working", onClick: () => onSendTicket(1) }]
      : []),
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
              <span className="uppercase">Ticket</span> {current.number} of {count}
            </p>
            <TicketPagerButton direction="next" atEnd={index === count - 1} onMove={() => setShownIndex(index + 1)} className={pagerButtonClass} />
          </div>
        )}
        <ul className="flex flex-col gap-6">
          {/* Numbered as in the ticket email and at the door (ticket type, then code, as the API returns them);
              seated tickets are listed by section, row, then seat, keeping those numbers. One shows at a time;
              the rest are hidden on screen but all print, each on its own. */}
          {tickets.map(({ ticket, number }, i) => (
            <li key={ticket.ticketCode} className={i === index ? undefined : "hidden print:block"}>
              <FullTicket {...ticketProps(ticket, number)} headingLevel={null} />
            </li>
          ))}
        </ul>
        {current && (
          <>
            <button type="button" onClick={() => setFullScreen({ open: true, start: index })} className={showTicketClass}>
              Show ticket <span aria-hidden="true">→</span>
              {count > 1 && <span className="sr-only"> {current.number} of {count}</span>}
            </button>
            {/* The wallet badges are the shown ticket's. Side by side on phones and from 1024; stacked in the 296 column between (the frames). */}
            {walletFor(current.number, "justify-center md:max-lg:flex-col")}
          </>
        )}
        {/* Apple's badge rules: say how to add the pass from a device without Wallet. */}
        {hasWallet && order.wallet?.apple && <p className="text-xs leading-4 text-muted print:hidden">{appleWalletDeviceNote("page", count)}</p>}
        <div className="flex flex-col gap-1 text-xs leading-4 text-muted">
          <p>Screenshot your codes in case signal drops at the venue.</p>
          <p>Each code works once. Don&rsquo;t share it.</p>
        </div>
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
          <section aria-labelledby="ticket-calendar" className={`${cardClass} print:hidden`}>
            <h2 id="ticket-calendar" className={cardTitleClass}>
              Add to calendar
            </h2>
            {/* Three equal buttons from 360 wide (the frames). Narrower, they don't fit: one button opens the list. */}
            <div className="flex gap-2 max-[359px]:hidden">
              <a href={calendar.google} target="_blank" rel="noopener noreferrer" className={calendarButtonClass}>
                Google<span className="sr-only"> Calendar (opens in a new tab)</span>
              </a>
              <a href={calendar.ics} className={calendarButtonClass}>
                Apple<span className="sr-only"> Calendar</span>
              </a>
              <a href={calendar.outlook} target="_blank" rel="noopener noreferrer" className={calendarButtonClass}>
                Outlook<span className="sr-only"> (opens in a new tab)</span>
              </a>
            </div>
            <button type="button" onClick={() => setSheet("calendar")} className={buttonClass("outline", "sm", "w-full min-[360px]:hidden")}>
              Choose a calendar
            </button>
          </section>
        )}

        {venue && lines && (
          <section aria-labelledby="ticket-venue" className={cardClass}>
            <h2 id="ticket-venue" className={cardTitleClass}>
              Getting there
            </h2>
            {/* The frames' map placeholder (the page has no map of its own yet): it opens the directions. */}
            <button
              type="button"
              onClick={() => setSheet("directions")}
              aria-label={`Directions to ${lines.first}`}
              className="flex h-50 w-full items-center justify-center rounded-control bg-surface print:hidden"
            >
              <span aria-hidden="true" className="size-4 rounded-full bg-signal" />
            </button>
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

      {calendar && (
        <AddToCalendarSheet
          open={sheet === "calendar"}
          onClose={() => setSheet(null)}
          subtitle={startsAt ? `${order.eventTitle} · ${ticketStubDate(startsAt, order.eventTimeZone)}, ${ticketStubTime(startsAt, order.eventEndsAt, order.eventTimeZone)}` : order.eventTitle}
          links={calendar}
        />
      )}
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
      />
    </div>
  );
}
