"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { ButtonLink } from "@/components/ui/Button";
import { LoadingState } from "@/components/ui/ProgressLoader";
import { EmptyState, Notice, PageHeader } from "@/components/ui/Section";
import { listMyEvents } from "@/lib/api/events";
import type { EventRecord } from "@/lib/api/types";
import { useAuth } from "@/lib/auth/AuthContext";
import { useOrganiser } from "@/lib/auth/useOrganiser";
import OrganiserEventRow from "./OrganiserEventRow";

const NEW_EVENT_HREF = "/dashboard/new";

/** Decorative: the words beside it name the action. */
function PlusIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" className="h-4 w-4 shrink-0">
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

/**
 * New event: an action beside the "Your events" heading, not a tab. An
 * outlined button with a plus, so it never reads as the current page (the
 * sub-nav's underlined tabs carry that); 44px tall at every width. Not while
 * the list is loading or empty: the empty state has "Create your first event".
 */
function NewEventLink() {
  return (
    <ButtonLink href={NEW_EVENT_HREF} variant="outline" className="min-h-11">
      <PlusIcon />
      New event
    </ButtonLink>
  );
}

/** The page's h1, with New event beside it once the organiser can create events. */
function Header({ action }: { action?: ReactNode }) {
  return <PageHeader flush size="md" eyebrow="Organiser" title="Your events" action={action} />;
}

/**
 * `?welcome=organiser`: they've just joined with an organiser link
 * (components/organisers/OrganiserJoinFlow.tsx). Read once after hydration,
 * then taken out of the address bar, so a reload or a shared URL doesn't
 * say it again.
 */
function useJoinedWelcome(): boolean {
  const [welcome, setWelcome] = useState(false);
  useEffect(() => {
    const url = new URL(window.location.href);
    if (url.searchParams.get("welcome") !== "organiser") return;
    url.searchParams.delete("welcome");
    window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
    queueMicrotask(() => setWelcome(true));
  }, []);
  return welcome;
}

/** The welcome after joining: takes focus once, so it's read out before the list. */
function JoinedWelcome({ name }: { name: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.focus();
  }, []);
  return (
    <div ref={ref} tabIndex={-1} className="outline-offset-2">
      <Notice>
        <p className="font-semibold">Welcome to Sheltüh, {name}.</p>
        <p className="mt-1">
          Add a bio and links on{" "}
          <Link href="/dashboard/profile" className="text-accent underline underline-offset-2">
            your profile
          </Link>
          , and set up payouts before selling paid tickets. Your first paid event is checked by Sheltüh before it
          goes live.
        </p>
      </Notice>
    </div>
  );
}

// Bounds the "skip past an empty page that still has a cursor" loop so a
// pathological run of empty pages can't hang a request.
const MAX_EMPTY_PAGES_TO_SKIP = 10;

export default function DashboardContent() {
  const auth = useAuth();
  const { loading: organiserLoading, organiser, error: organiserError } = useOrganiser();
  const welcome = useJoinedWelcome();
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

  const approved = organiser?.status === "approved";
  // Once there's a list to add to (or it couldn't load, when this is the way to create one anyway).
  const listShown = (events !== null && events.length > 0) || eventsError !== null;
  const canCreate = auth.status === "signed-in" && approved && !organiserError && listShown;
  return (
    <div className="flex flex-col gap-8">
      <Header action={canCreate ? <NewEventLink /> : undefined} />
      {renderBody()}
    </div>
  );

  function renderBody() {
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

    const payoutsEnabled = organiser.payoutsEnabled === true;
    return (
      <div className="flex flex-col gap-4">
        {welcome && <JoinedWelcome name={organiser.displayName} />}
        {!payoutsEnabled && (
          <p className="border-l-2 border-foreground py-1 pl-4 text-sm text-muted">
            <Link href="/dashboard/payouts" className="text-accent underline underline-offset-2">
              Set up payouts
            </Link>{" "}
            before publishing paid events.
          </p>
        )}

        {eventsError && (
          <p role="alert" className="text-sm text-danger">
            {eventsError}
          </p>
        )}

        {events === null && !eventsError && <LoadingState text="Loading your events…" />}

        {events !== null && events.length === 0 && !eventsError && (
          <EmptyState
            title="No events yet"
            action={
              <ButtonLink href={NEW_EVENT_HREF} variant="solid" size="lg" className="min-h-11">
                <PlusIcon />
                Create your first event
              </ButtonLink>
            }
          />
        )}

        {events !== null && events.length > 0 && (
          <>
            <ul className="flex flex-col border-b border-foreground">
              {events.map((event) => (
                <OrganiserEventRow key={event.eventId} event={event} payoutsEnabled={payoutsEnabled} />
              ))}
            </ul>
            {nextCursor && (
              <button
                type="button"
                onClick={handleLoadMore}
                disabled={loadingMore}
                className="btn btn-outline min-h-11 w-fit self-center"
              >
                {loadingMore ? "Loading…" : "Load more"}
              </button>
            )}
          </>
        )}
      </div>
    );
  }
}
