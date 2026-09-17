"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { listMyEvents } from "@/lib/api/events";
import type { EventRecord } from "@/lib/api/types";
import { useAuth } from "@/lib/auth/AuthContext";
import { useOrganiser } from "@/lib/auth/useOrganiser";

const STATUS_LABEL: Record<EventRecord["status"], string> = {
  draft: "Draft",
  pending_review: "Pending review",
  published: "Published",
  rejected: "Rejected",
};

export default function DashboardContent() {
  const auth = useAuth();
  const { loading: organiserLoading, organiser, error: organiserError } = useOrganiser();
  const [events, setEvents] = useState<EventRecord[] | null>(null);
  const [eventsError, setEventsError] = useState<string | null>(null);

  const canLoadEvents = auth.status === "signed-in" && organiser?.status === "approved";
  const getToken = auth.getValidIdToken;

  useEffect(() => {
    if (!canLoadEvents) return;
    let cancelled = false;
    listMyEvents(getToken)
      .then((page) => {
        if (!cancelled) setEvents(page.items);
      })
      .catch((err) => {
        if (!cancelled) setEventsError(err instanceof Error ? err.message : "Couldn't load your events.");
      });
    return () => {
      cancelled = true;
    };
  }, [canLoadEvents, getToken]);

  if (!auth.configured) {
    return (
      <p role="alert" className="rounded-md border border-danger/40 bg-danger/10 px-4 py-3 text-sm text-foreground">
        Accounts aren&rsquo;t configured in this environment yet.
      </p>
    );
  }

  if (auth.status === "loading" || organiserLoading) {
    return <p className="text-sm text-muted">Loading…</p>;
  }

  if (auth.status === "signed-out") {
    return (
      <div className="rounded-lg border border-surface-border bg-surface p-4">
        <p className="mb-3 text-foreground">Sign in to see your events.</p>
        <Link href="/login" className="rounded bg-accent px-4 py-2 text-sm font-medium text-accent-foreground">
          Sign in
        </Link>
      </div>
    );
  }

  if (organiserError) {
    return (
      <p role="alert" className="text-sm text-danger">
        {organiserError}
      </p>
    );
  }

  if (!organiser || organiser.status !== "approved") {
    return (
      <div className="rounded-lg border border-surface-border bg-surface p-4">
        <p className="mb-3 text-foreground">
          {organiser?.status === "pending"
            ? "Your organiser application is still pending review."
            : organiser?.status === "rejected"
              ? "Your organiser application wasn't approved."
              : "You need an approved organiser application before you can create events."}
        </p>
        <Link href="/organisers/apply" className="rounded bg-accent px-4 py-2 text-sm font-medium text-accent-foreground">
          {organiser ? "View application" : "Apply as an organiser"}
        </Link>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <Link
        href="/dashboard/new"
        className="w-fit rounded bg-accent px-4 py-2 text-sm font-medium text-accent-foreground hover:bg-accent-strong"
      >
        New event
      </Link>

      {eventsError && (
        <p role="alert" className="text-sm text-danger">
          {eventsError}
        </p>
      )}

      {events === null && !eventsError && <p className="text-sm text-muted">Loading your events…</p>}

      {events !== null && events.length === 0 && (
        <p className="text-sm text-muted">You haven&rsquo;t created any events yet.</p>
      )}

      {events !== null && events.length > 0 && (
        <ul className="flex flex-col gap-3">
          {events.map((event) => (
            <li key={event.eventId}>
              <Link
                href={`/dashboard/${event.eventId}`}
                className="flex items-center justify-between rounded-lg border border-surface-border bg-surface p-4 hover:border-accent"
              >
                <div>
                  <p className="font-medium text-foreground">{event.title || "Untitled event"}</p>
                  <p className="text-sm text-muted">{event.suburb}</p>
                </div>
                <span className="rounded bg-background px-2 py-1 text-xs font-medium uppercase tracking-wide text-muted">
                  {STATUS_LABEL[event.status]}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
