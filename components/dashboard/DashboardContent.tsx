"use client";

import Link from "next/link";
import StatusBadge, { type StatusTone } from "@/components/ui/StatusBadge";
import { useEffect, useRef, useState } from "react";
import { listMyEvents } from "@/lib/api/events";
import type { EventRecord } from "@/lib/api/types";
import { useAuth } from "@/lib/auth/AuthContext";
import { useOrganiser } from "@/lib/auth/useOrganiser";
import { LoadingState } from "@/components/ui/ProgressLoader";

const STATUS_LABEL: Record<EventRecord["status"], string> = {
  draft: "Draft",
  pending_review: "Pending review",
  published: "Published",
  rejected: "Rejected",
};

const STATUS_TONE: Record<EventRecord["status"], StatusTone> = {
  draft: "neutral",
  pending_review: "pending",
  published: "approved",
  rejected: "rejected",
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
  const getToken = auth.getAccessToken;

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
      <p role="alert" className="border-l-2 border-danger px-4 py-3 text-sm text-foreground">
        Accounts aren&rsquo;t configured in this environment yet.
      </p>
    );
  }

  if (auth.status === "loading" || organiserLoading) {
    return <LoadingState text="Loading…" />;
  }

  if (auth.status === "signed-out") {
    return (
      <div className="border-t border-foreground pt-5">
        <p className="mb-4 text-foreground">Sign in to see your events.</p>
        <Link href="/login" className="btn btn-solid">
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
      <div className="border-t border-foreground pt-5">
        <p className="mb-4 text-foreground">
          {organiser?.status === "pending"
            ? "Your organiser application is still pending review."
            : organiser?.status === "rejected"
              ? "Your organiser application wasn't approved."
              : "You need an approved organiser application before you can create events."}
        </p>
        <Link href="/organisers/apply" className="btn btn-solid">
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
          className="btn btn-solid min-h-11 w-fit"
        >
          New event
        </Link>
        <Link
          href="/dashboard/payouts"
          className="btn btn-outline min-h-11 w-fit"
        >
          Payouts
        </Link>
        <Link href="/dashboard/analytics" className="btn btn-outline min-h-11 w-fit">
          Analytics
        </Link>
        <Link href="/dashboard/profile" className="btn btn-outline min-h-11 w-fit">
          Public profile
        </Link>
      </div>

      {!organiser.payoutsEnabled && (
        <p className="border-l-2 border-foreground py-1 pl-4 text-sm text-muted">
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

      {events === null && !eventsError && <LoadingState text="Loading your events…" />}

      {events !== null && events.length === 0 && (
        <p className="text-sm text-muted">You haven&rsquo;t created any events yet.</p>
      )}

      {events !== null && events.length > 0 && (
        <>
          <ul className="flex flex-col border-b border-foreground">
            {events.map((event) => {
              const title = event.title || "Untitled event";
              const canCheckIn = event.status === "published";
              return (
                // Under sm the side links drop below the title (two columns), so it isn't squeezed at 320.
                <li key={event.eventId} className="flex flex-col border-t border-foreground sm:flex-row sm:items-stretch">
                  <Link
                    href={`/dashboard/${event.eventId}`}
                    className="group flex min-w-0 flex-1 items-center justify-between gap-3 py-4 pr-3 hover:bg-surface sm:pl-2"
                  >
                    <div className="min-w-0">
                      <p className="font-semibold break-words text-foreground underline-offset-4 group-hover:underline">{title}</p>
                      <p className="text-sm text-muted">{event.suburb}</p>
                    </div>
                    <StatusBadge tone={STATUS_TONE[event.status]}>{STATUS_LABEL[event.status]}</StatusBadge>
                  </Link>
                  <div className="grid grid-cols-2 border-t border-surface-border sm:flex sm:border-t-0">
                    <Link
                      href={`/dashboard/events/${encodeURIComponent(event.eventId)}/analytics`}
                      className={`eyebrow inline-flex min-h-11 items-center px-4 underline underline-offset-4 first:pl-0 sm:border-l sm:border-surface-border sm:first:pl-4 ${
                        canCheckIn ? "" : "col-span-2"
                      }`.trim()}
                    >
                      Analytics <span className="sr-only">for {title}</span>
                    </Link>
                    {canCheckIn && (
                      <Link
                        href={`/dashboard/${encodeURIComponent(event.eventId)}/check-in`}
                        className="eyebrow inline-flex min-h-11 items-center border-l border-surface-border px-4 underline underline-offset-4"
                      >
                        Check-in <span className="sr-only">for {title}</span>
                      </Link>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
          {nextCursor && (
            <button
              type="button"
              onClick={handleLoadMore}
              disabled={loadingMore}
              className="btn btn-outline w-fit self-center"
            >
              {loadingMore ? "Loading…" : "Load more"}
            </button>
          )}
        </>
      )}
    </div>
  );
}
