"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import EventEditor from "@/components/dashboard/EventEditor";
import { adminGetEvent } from "@/lib/api/admin";
import type { AdminEventRecord, EventStatus } from "@/lib/api/types";
import { useAuth } from "@/lib/auth/AuthContext";

const STATUS_LABEL: Record<EventStatus, string> = {
  draft: "Draft",
  pending_review: "Pending review",
  published: "Published",
  rejected: "Rejected",
};

/**
 * /admin/events/[eventId]/edit (inside AdminGate): loads any event and edits
 * it in admin mode. After a save conflict, "Reload latest version" fetches it
 * again and remounts the editor on the new version. A platform-managed
 * organiser's Sheltüh-ticketed event links to its door check-in, which admins
 * run (docs/architecture.md, "Check-in").
 */
export default function AdminEditEvent() {
  const auth = useAuth();
  const getToken = auth.getAccessToken;
  const { eventId } = useParams<{ eventId: string }>();
  const [event, setEvent] = useState<AdminEventRecord | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Bumped on reload, so the editor starts again from the fetched version.
  const [generation, setGeneration] = useState(0);

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
        if (!signal.cancelled) setError(err instanceof Error ? err.message : "Couldn't load this event.");
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
      <EventEditor
        key={generation}
        mode="admin"
        getToken={getToken}
        initial={event}
        onSaved={setEvent}
        onReload={() => load({ cancelled: false })}
      />
    </>
  );
}
