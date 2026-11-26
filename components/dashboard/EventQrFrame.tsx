"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { Button, ButtonLink } from "@/components/ui/Button";
import { backLinkClass } from "@/components/ui/BackLink";
import { LoadingState } from "@/components/ui/ProgressLoader";
import { EmptyState, Notice } from "@/components/ui/Section";
import Strap from "@/components/ui/Strap";
import { EVENTS_HREF, eventQrHref, manageEventHref } from "@/lib/organiser-nav";
import type { EventQrState } from "./useEventQr";

/** The ways back, above the header: to the Events tab and the event (the QR page), or to the QR page (the sign). */
function BackLinks({ eventId, from }: { eventId: string; from: "qr" | "sign" }) {
  return (
    <nav aria-label="Event" className="mb-6 flex flex-wrap gap-x-6">
      {from === "sign" ? (
        <Link href={eventQrHref(eventId)} className={backLinkClass}>
          &larr; QR code
        </Link>
      ) : (
        <>
          <Link href={EVENTS_HREF} className={backLinkClass}>
            &larr; Events
          </Link>
          <Link href={manageEventHref(eventId)} className={backLinkClass}>
            Edit event
          </Link>
        </>
      )}
    </nav>
  );
}

/**
 * The QR page's and the sign's frame: the way back, the header (the h1 and
 * the event's title once known), then either `children` with the loaded code
 * or the state that stands in for it (loading, error with Try again, not
 * found, not published yet).
 */
export default function EventQrFrame({
  eventId,
  from,
  title,
  state,
  retry,
  children,
}: {
  eventId: string;
  from: "qr" | "sign";
  /** The h1: "QR code" or "Printable sign". */
  title: string;
  state: EventQrState;
  retry: () => void;
  children: (ready: Extract<EventQrState, { status: "ready" }>) => ReactNode;
}) {
  const back = <BackLinks eventId={eventId} from={from} />;

  if (state.status === "not-found") {
    return (
      <>
        {back}
        <EmptyState
          headingLevel={1}
          title="Event not found"
          action={
            <ButtonLink size="lg" variant="outline" href={EVENTS_HREF}>
              Back to events
            </ButtonLink>
          }
        >
          It may have been deleted, or it belongs to another organiser account.
        </EmptyState>
      </>
    );
  }

  const event = state.status === "ready" || state.status === "unpublished" ? state.event : null;
  return (
    <>
      {back}
      <header className="mb-8 flex flex-col gap-3">
        <Strap label="QR code" rule={false} />
        <h1 className="display-md break-words">{title}</h1>
        {event && <p className="meta break-words text-muted">{event.title || "Untitled event"}</p>}
      </header>
      {state.status === "loading" && (
        <div aria-busy="true" className="min-h-48">
          <LoadingState text="Getting the QR code ready…" announce />
        </div>
      )}
      {state.status === "error" && (
        <div className="flex flex-col items-start gap-3">
          <Notice tone="danger" role="alert">
            {state.message}
          </Notice>
          <Button variant="outline" size="lg" onClick={retry}>
            Try again
          </Button>
        </div>
      )}
      {state.status === "unpublished" && (
        <EmptyState
          title="Publish your event first"
          action={
            <ButtonLink size="lg" variant="outline" href={manageEventHref(eventId)}>
              Go to your event
            </ButtonLink>
          }
        >
          The QR code opens your event’s page, so you’ll get it once the event is live.
        </EmptyState>
      )}
      {state.status === "ready" && children(state)}
    </>
  );
}
