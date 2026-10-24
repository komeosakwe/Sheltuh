"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import EventEditor from "@/components/dashboard/EventEditor";
import { adminGetEvent } from "@/lib/api/admin";
import type { AdminEventRecord, EventStatus } from "@/lib/api/types";
import { useAuth } from "@/lib/auth/AuthContext";
import { actionErrorText } from "./OrganiserItem";
import TrendingPanel, { TRENDING_PANEL_ID } from "./TrendingPanel";

/** The editor's name when it holds the page's sign-in form. */
const EDITOR_REAUTH_OWNER = "editor";

const STATUS_LABEL: Record<EventStatus, string> = {
  draft: "Draft",
  pending_review: "Pending review",
  published: "Published",
  rejected: "Rejected",
};

/**
 * /admin/events/[eventId]/edit (gated by app/admin/layout.tsx): loads any event and edits
 * it in admin mode. After a save conflict, "Reload latest version" fetches it
 * again and remounts the editor on the new version. A platform-managed
 * organiser's Sheltüh-ticketed event links to its door check-in, which admins
 * run (docs/architecture.md, "Check-in"). Below the editor, its Trending
 * curation (TrendingPanel), linked from the top of the page. After an
 * expired session the sign-in form is shown once, by whichever of the two
 * needed it last (InlineReauth's fields have fixed ids); the other says to
 * sign in, then try again.
 */
export default function AdminEditEvent() {
  const auth = useAuth();
  const getToken = auth.getAccessToken;
  const { eventId } = useParams<{ eventId: string }>();
  const [event, setEvent] = useState<AdminEventRecord | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Bumped on reload, so the editor starts again from the fetched version.
  const [generation, setGeneration] = useState(0);
  const [reauthOwner, setReauthOwner] = useState<string | null>(null);

  const load = useCallback(
    async (signal: { cancelled: boolean }) => {
      try {
        const record = await adminGetEvent(eventId, getToken);
        if (!signal.cancelled) {
          setEvent(record);
          setError(null);
          setGeneration((g) => g + 1);
        }
      } catch (err) {
        if (!signal.cancelled) setError(actionErrorText(err, "Couldn’t load this event. Try again."));
      }
    },
    [eventId, getToken],
  );

  useEffect(() => {
    const signal = { cancelled: false };
    queueMicrotask(() => {
      if (!signal.cancelled) load(signal);
    });
    return () => {
      signal.cancelled = true;
    };
  }, [load]);

  if (error) {
    return (
      <p role="alert" className="text-sm text-danger">
        {error}
      </p>
    );
  }
  if (!event) return <p className="text-sm text-muted">Loading event…</p>;

  const adminCheckIn = event.organiserPlatformManaged && event.ticketingMode === "sheltuh";

  return (
    <>
      <p className="text-sm text-muted">
        Status: <span className="font-medium text-foreground">{STATUS_LABEL[event.status]}</span>
      </p>
      {event.ticketingMode !== "external" && (
        <p className="text-sm text-muted">
          <Link
            href={`/admin/events/${encodeURIComponent(event.eventId)}/seat-map`}
            className="inline-flex min-h-11 items-center font-medium text-foreground underline underline-offset-4"
          >
            {event.seating ? `Seat map (${event.seating.seatCount} seats)` : "Seat map"}
          </Link>{" "}
          — preview, replace or remove (only while the event has no orders).
        </p>
      )}
      {adminCheckIn && (
        <p className="text-sm text-muted">
          <Link
            href={`/dashboard/${encodeURIComponent(event.eventId)}/check-in`}
            className="inline-flex min-h-11 items-center font-medium text-foreground underline underline-offset-4"
          >
            Open door check-in
          </Link>{" "}
          — admins check tickets in for platform-managed organisers&rsquo; events.
        </p>
      )}
      <p className="text-sm text-muted">
        <a
          href={`#${TRENDING_PANEL_ID}`}
          className="inline-flex min-h-11 items-center font-medium text-foreground underline underline-offset-4"
        >
          Trending
        </a>{" "}
        — boost this event on the home page, or keep it out (below the editor).
      </p>
      <EventEditor
        key={generation}
        mode="admin"
        getToken={getToken}
        initial={event}
        onSaved={setEvent}
        onReload={() => load({ cancelled: false })}
        reauthForm={reauthOwner === null || reauthOwner === EDITOR_REAUTH_OWNER}
        onReauthNeeded={(needed) =>
          setReauthOwner((owner) => (needed ? EDITOR_REAUTH_OWNER : owner === EDITOR_REAUTH_OWNER ? null : owner))
        }
      />
      <TrendingPanel
        eventId={event.eventId}
        getToken={getToken}
        reauthOwner={reauthOwner}
        onClaimReauth={setReauthOwner}
      />
    </>
  );
}
