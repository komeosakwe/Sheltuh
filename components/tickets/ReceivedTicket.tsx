"use client";

import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";
import DemoNotice from "@/components/DemoNotice";
import EventArt from "@/components/EventArt";
import FullTicket from "@/components/tickets/FullTicket";
import TicketCalendarCard, { useTicketCalendar } from "@/components/tickets/TicketCalendarCard";
import TicketFullScreen from "@/components/tickets/TicketFullScreen";
import { useTicketEvent } from "@/components/tickets/useTicketEvent";
import { Button, ButtonLink } from "@/components/ui/Button";
import { LoadingState } from "@/components/ui/ProgressLoader";
import { ApiError, isApiConfigured } from "@/lib/api/client";
import { getReceivedTicket } from "@/lib/api/ticket-transfers";
import type { ReceivedTicket as ReceivedTicketRecord } from "@/lib/api/types";
import { useAuth } from "@/lib/auth/AuthContext";
import { SUPPORT_EMAIL } from "@/lib/contact";
import { eventZone } from "@/lib/format";
import { bareSuburb } from "@/lib/place";
import { withNext } from "@/lib/safe-next-path";
import { ticketStubDate, ticketStubTime, ticketWhenLine } from "@/lib/ticket-times";

/** A transfer id as the API issues them (a uuid): anything else is "not found" without asking. */
const TRANSFER_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Load = { status: "loading" } | { status: "ready"; ticket: ReceivedTicketRecord } | { status: "error"; error: unknown };

const titleClass = "label-menu break-words text-foreground";
const quietLinkClass = "body-s inline-flex min-h-11 items-center font-semibold text-foreground underline-offset-4 hover:underline";
const showTicketClass =
  "label-button flex min-h-14 w-full items-center justify-center gap-2 rounded-control bg-signal p-4 text-ink motion-safe:transition-colors motion-safe:duration-200 hover:bg-ink hover:text-signal focus-visible:bg-ink focus-visible:text-signal active:bg-ink active:text-signal md:hidden print:hidden";

/**
 * A ticket someone sent the signed-in member, once accepted
 * (`/tickets/received/{transferId}`; docs/architecture.md, "Ticket
 * transfers"). Not drawn as its own frame: the My ticket page's layout
 * (the ticket left, from 768; above on phones) around the orange-outline
 * ticket with the member's own QR, the holder's name and no "ticket n of
 * N" (the order's size is the buyer's business). "From Alex Chen", the
 * event as the h1 with its date and venue, Add to calendar, the event's
 * page (Who's Going lives there) and the help line with the transfer's
 * reference (never the order's).
 *
 * Only for the account that accepted it: signed out, sign in first (the
 * id in the address isn't a credential); any other account gets "Ticket
 * not found". A ticket that's no longer valid (the order it came from was
 * refunded) says so, with no code.
 */
export default function ReceivedTicket({ transferId }: { transferId: string }) {
  const auth = useAuth();
  const configured = isApiConfigured && auth.configured;
  const signedIn = auth.status === "signed-in";
  const wellFormed = TRANSFER_ID.test(transferId);
  const key = configured && signedIn && wellFormed ? `${transferId}#${auth.userId ?? ""}` : null;
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState<{ key: string; load: Load } | null>(null);
  const getToken = auth.getAccessToken;
  const loadKey = key ? `${key}#${attempt}` : null;

  useEffect(() => {
    if (!loadKey) return;
    let cancelled = false;
    getReceivedTicket(transferId, getToken).then(
      (ticket) => {
        if (!cancelled) setResult({ key: loadKey, load: { status: "ready", ticket } });
      },
      (error: unknown) => {
        if (!cancelled) setResult({ key: loadKey, load: { status: "error", error } });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [loadKey, transferId, getToken]);

  const load: Load = loadKey && result?.key === loadKey ? result.load : { status: "loading" };

  if (!configured) {
    return (
      <Message title="Received tickets are on the live site">
        <DemoNotice>Tickets sent to you can’t be shown in this demo.</DemoNotice>
      </Message>
    );
  }
  if (auth.status === "loading") return <LoadingState text="Loading your ticket…" />;
  if (!signedIn) {
    return (
      <Message title="Sign in to see your ticket">
        <p className="body-m text-muted">Use the account you accepted the ticket with.</p>
        <ButtonLink variant="signal" href={withNext("/login", `/tickets/received/${transferId}`)} className="w-full sm:w-auto">
          Sign in
        </ButtonLink>
      </Message>
    );
  }
  if (!wellFormed || (load.status === "error" && load.error instanceof ApiError && load.error.status === 404)) {
    return (
      <Message title="Ticket not found">
        <p className="body-m text-muted">Check you’re signed in with the account that accepted it.</p>
        <Link href="/events" className={quietLinkClass}>
          Find events
        </Link>
      </Message>
    );
  }
  if (load.status === "error") {
    return (
      <Message title="Couldn’t load your ticket">
        <p role="alert" className="body-m text-danger">
          {load.error instanceof ApiError && load.error.status === 429 ? "Too many tries. Wait a little, then try again." : "Something went wrong. Try again."}
        </p>
        <Button variant="outline" onClick={() => setAttempt((n) => n + 1)} className="w-full sm:w-auto">
          Try again
        </Button>
      </Message>
    );
  }
  if (load.status === "loading") return <LoadingState text="Loading your ticket…" />;
  return <ReceivedTicketView ticket={load.ticket} />;
}

function Message({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="flex max-w-120 flex-col items-start gap-4">
      <h1 className={titleClass}>
        {title}
      </h1>
      {children}
    </div>
  );
}

function ReceivedTicketView({ ticket }: { ticket: ReceivedTicketRecord }) {
  const [fullScreen, setFullScreen] = useState(false);
  const listed = ticket.eventListed;
  const event = useTicketEvent(listed ? (ticket.eventSlug ?? null) : null);
  const zone = eventZone(ticket.eventTimeZone);
  const startsAt = listed ? ticket.eventStartsAt : undefined;
  const suburb = ticket.suburb ? bareSuburb(ticket.suburb, ticket.eventState) : "";
  const venueLine = listed ? [ticket.venueName?.trim() ?? "", suburb].filter(Boolean).join(" · ") : "";
  const eventPath = listed && ticket.eventSlug ? `/events/${encodeURIComponent(ticket.eventSlug)}` : null;
  const calendar = useTicketCalendar({
    slug: listed ? ticket.eventSlug : undefined,
    id: event?.id,
    title: ticket.eventTitle,
    description: event?.description,
    venueName: event?.venueName ?? ticket.venueName,
    venueAddress: event?.venueAddress,
    startsAt,
    endsAt: ticket.eventEndsAt,
  });
  const art = event ? (
    <EventArt poster={event.poster} title={event.title} imageUrl={event.imageUrl} imageFocus={event.imageFocus} className="size-full" />
  ) : undefined;
  const held = ticket.status === "valid" ? ticket.ticket : undefined;
  const ticketProps = held
    ? {
        eventTitle: ticket.eventTitle,
        image: art,
        venueLine: venueLine || undefined,
        date: startsAt ? ticketStubDate(startsAt, ticket.eventTimeZone) : undefined,
        time: startsAt ? ticketStubTime(startsAt, ticket.eventEndsAt, ticket.eventTimeZone) : undefined,
        holderName: ticket.holderName,
        typeName: held.ticketTypeName,
        group: held.group,
        seat: held.seat,
        code: held.ticketCode,
        eventUnlisted: !listed,
        checkedInAt: held.checkedInAt,
        timeZone: zone,
      }
    : null;

  return (
    <div data-received-ticket="" className="flex flex-col gap-6 md:flex-row md:items-start lg:gap-12">
      <section aria-label="Your ticket" className="flex min-w-0 flex-col gap-4 md:w-74 md:shrink-0 lg:w-90">
        {ticketProps ? (
          <>
            <FullTicket {...ticketProps} headingLevel={null} />
            <button type="button" onClick={() => setFullScreen(true)} className={showTicketClass}>
              Show ticket <span aria-hidden="true">→</span>
            </button>
            <p className="text-xs leading-4 text-muted">Screenshot your code in case signal drops at the venue.</p>
          </>
        ) : (
          <div data-ticket-status="" className="rounded-control bg-surface px-3 py-2">
            <p className="body-s font-semibold text-foreground">This ticket is no longer valid. The order it came from was refunded.</p>
          </div>
        )}
      </section>

      <div className="flex min-w-0 flex-1 flex-col gap-6">
        <div className="flex flex-col gap-2">
          <p className="body-s font-semibold break-words text-signal-text">From {ticket.fromName}</p>
          <h1 className="label-menu break-words text-foreground">{ticket.eventTitle}</h1>
          {startsAt && (
            <p className="font-mono text-sm leading-5 font-medium text-muted">
              {ticketWhenLine(startsAt, ticket.eventEndsAt, ticket.eventTimeZone, ticket.eventState)}
            </p>
          )}
          {venueLine && <p className="font-mono text-sm leading-5 font-medium break-words text-muted">{venueLine}</p>}
        </div>

        {calendar && held && (
          <TicketCalendarCard
            links={calendar}
            subtitle={startsAt ? `${ticket.eventTitle} · ${ticketStubDate(startsAt, ticket.eventTimeZone)}, ${ticketStubTime(startsAt, ticket.eventEndsAt, ticket.eventTimeZone)}` : ticket.eventTitle}
          />
        )}

        {eventPath && (
          <Link href={eventPath} className={`${quietLinkClass} self-start`}>
            View event page <span aria-hidden="true">&nbsp;→</span>
          </Link>
        )}

        <p className="body-s text-muted">
          Need a hand?{" "}
          <a href={`mailto:${SUPPORT_EMAIL}`} className="underline underline-offset-2">
            {SUPPORT_EMAIL}
          </a>{" "}
          · Ticket <span className="font-mono">{ticket.reference}</span>
        </p>
      </div>

      {ticketProps && (
        <TicketFullScreen
          open={fullScreen}
          onClose={() => setFullScreen(false)}
          tickets={[<FullTicket key={ticketProps.code} {...ticketProps} size="screen" />]}
        />
      )}
    </div>
  );
}
