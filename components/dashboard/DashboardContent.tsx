"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
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

// Bounds the "skip past an empty page that still has a cursor" loop so a
// pathological run of empty pages can't hang a request.
const MAX_EMPTY_PAGES_TO_SKIP = 10;

export default function DashboardContent() {
  const auth = useAuth();
  const { loading: organiserLoading, organiser, error: organiserError } = useOrganiser();
  const [events, setEvents] = useState<EventRecord[] | null>(null);
  const [eventsError, setEventsError] = useState<string | null>(null);
  const [nextCursor, setNextCursor] = useState<string | undefined>(undefined);
  const [loadingMore, setLoadingMore] = useState(false);

  const canLoadEvents = auth.status === "signed-in" && organiser?.status === "approved";
  const getToken = auth.getValidIdToken;

  // Bumped on every fresh load so a page that resolves after this
  // organiser's events have already reloaded (e.g. a fast remount) is
  // discarded instead of overwriting newer results.
  const requestIdRef = useRef(0);

  async function fetchNonEmptyPage(cursor: string | undefined, myRequestId: number) {
    let cur = cursor;
    for (let i = 0; i < MAX_EMPTY_PAGES_TO_SKIP; i++) {
      const page = await listMyEvents(getToken, cur);
      if (requestIdRef.current !== myRequestId) return "stale" as const;
      if (page.items.length > 0 || !page.nextCursor) return page;
      cur = page.nextCursor;
    }
    return { items: [], nextCursor: cur };
  }

  function loadFirstPage() {
    requestIdRef.current += 1;
    const myRequestId = requestIdRef.current;
    setEvents(null);
    setNextCursor(undefined);
    fetchNonEmptyPage(undefined, myRequestId)
      .then((page) => {
        if (page === "stale") return;
        setEvents(page.items);
        setNextCursor(page.nextCursor);
      })
      .catch((err) => {
        if (requestIdRef.current !== myRequestId) return;
        setEventsError(err instanceof Error ? err.message : "Couldn't load your events.");
      });
  }

  useEffect(() => {
    if (!canLoadEvents) return;
    let cancelled = false;
    // Deferred via queueMicrotask so the effect body itself never calls
    // setState directly — only the microtask callback does, matching the
    // pattern used elsewhere in this codebase (see useOrganiser.ts).
    queueMicrotask(() => {
      if (!cancelled) loadFirstPage();
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canLoadEvents, getToken]);

  function handleLoadMore() {
    const myRequestId = requestIdRef.current;
    setLoadingMore(true);
    fetchNonEmptyPage(nextCursor, myRequestId)
      .then((page) => {
        if (page === "stale") return;
        setEvents((prev) => {
          const seenIds = new Set((prev ?? []).map((e) => e.eventId));
          return [...(prev ?? []), ...page.items.filter((e) => !seenIds.has(e.eventId))];
        });
        setNextCursor(page.nextCursor);
      })
      .catch((err) => {
        if (requestIdRef.current !== myRequestId) return;
        setEventsError(err instanceof Error ? err.message : "Couldn't load more events.");
      })
      .finally(() => {
        if (requestIdRef.current === myRequestId) setLoadingMore(false);
      });
  }

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
      <div className="flex flex-wrap items-center gap-3">
        <Link
          href="/dashboard/new"
          className="w-fit rounded bg-accent px-4 py-2 text-sm font-medium text-accent-foreground hover:bg-accent-strong"
        >
          New event
        </Link>
        <Link
          href="/dashboard/payouts"
          className="w-fit rounded border border-surface-border px-4 py-2 text-sm font-medium text-foreground hover:border-accent hover:text-accent"
        >
          Payouts
        </Link>
      </div>

      {!organiser.payoutsEnabled && (
        <p className="rounded-md border border-surface-border bg-surface px-4 py-3 text-sm text-muted">
          Free events don&rsquo;t need this, but{" "}
          <Link href="/dashboard/payouts" className="text-accent underline underline-offset-2">
            connect Stripe
          </Link>{" "}
          before selling paid tickets.
        </p>
      )}

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
        <>
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
          {nextCursor && (
            <button
              type="button"
              onClick={handleLoadMore}
              disabled={loadingMore}
              className="w-fit self-center rounded border border-surface-border px-4 py-2 text-sm font-medium text-foreground transition-colors hover:border-accent hover:text-accent disabled:cursor-not-allowed disabled:opacity-60"
            >
              {loadingMore ? "Loading…" : "Load more"}
            </button>
          )}
        </>
      )}
    </div>
  );
}
