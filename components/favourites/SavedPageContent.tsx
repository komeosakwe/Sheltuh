"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import DemoNotice from "@/components/DemoNotice";
import EventResults from "@/components/EventResults";
import { Button, ButtonLink } from "@/components/ui/Button";
import { EmptyState, Notice, SectionHeader } from "@/components/ui/Section";
import { listFavourites } from "@/lib/api/favourites";
import { MAX_FAVOURITES } from "@/lib/api/types";
import { useOptionalAuth } from "@/lib/auth/useOptionalAuth";
import { formatDayWithYear } from "@/lib/format";
import { adaptPublicEvent } from "@/lib/live/adapt";
import { withNext } from "@/lib/safe-next-path";
import { sampleEvents } from "@/lib/sample-events";
import type { SheltuhEvent } from "@/lib/types";
import { useFavourites } from "./FavouritesProvider";

/** Saved events per page (the API allows up to 50). */
export const SAVED_PAGE_SIZE = 48;
/** From here the count line says "{n} of 500 saved". */
const NEAR_CAP = 450;

type ListState =
  | { status: "loading" }
  | { status: "error" }
  | { status: "ready"; events: SheltuhEvent[]; nextCursor?: string; now: number };

const hasEnded = (event: SheltuhEvent, now: number) => new Date(event.endsAt ?? event.startsAt).getTime() < now;

/**
 * /saved (docs/design/favourites-analytics.md §5.6), in the API's order:
 * newest save first. Coming up is a grid of tiles; unsaving one leaves it in
 * place (with an empty heart) until the next load, so nothing moves under a
 * finger. Ended events are listed below with a Remove button each. Only
 * published events are ever listed (an unpublished one is hidden until it's
 * published again), so there's no "no longer listed" row.
 */
export default function SavedPageContent() {
  const favourites = useFavourites();
  const auth = useOptionalAuth();

  if (!favourites || favourites.mode === "demo") return <DemoSaved />;
  if (!auth || favourites.status === "auth-loading") return <p className="text-sm text-muted">Loading…</p>;
  if (favourites.signedOut) {
    return (
      <EmptyState
        title="Sign in to see your saved events"
        action={
          <ButtonLink size="lg" href={withNext("/login", "/saved")}>
            Sign in
          </ButtonLink>
        }
      >
        Tap the heart on any event to keep it here.
      </EmptyState>
    );
  }
  return <LiveSaved key={auth.email ?? ""} getToken={auth.getAccessToken} />;
}

function CountLine({ count }: { count: number }) {
  return (
    <p className="-mt-2 mb-8 text-sm text-muted">{count >= NEAR_CAP ? `${count} of ${MAX_FAVOURITES} saved` : `${count} saved`}</p>
  );
}

function DemoSaved() {
  const favourites = useFavourites();
  const ready = favourites?.status === "ready";
  // The list as it was when the page opened: unsaving leaves the tile in place.
  const [shown, setShown] = useState<{ ids: readonly string[] } | null>(null);
  const [now] = useState(() => Date.now());
  if (shown === null && ready && favourites) setShown({ ids: favourites.ids });

  const events = (shown?.ids ?? [])
    .map((id) => sampleEvents.find((event) => event.id === id))
    .filter((event): event is SheltuhEvent => event !== undefined);

  return (
    <>
      <div className="mb-8">
        <DemoNotice>Saved on this device only. Nothing leaves your browser.</DemoNotice>
      </div>
      {!shown ? (
        <p className="text-sm text-muted">Loading…</p>
      ) : (
        <SavedList events={events} now={now} count={favourites?.count ?? 0} />
      )}
    </>
  );
}

function LiveSaved({ getToken }: { getToken: () => Promise<string> }) {
  const favourites = useFavourites();
  const [state, setState] = useState<ListState>({ status: "loading" });
  const [loadingMore, setLoadingMore] = useState(false);
  const [moreError, setMoreError] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    listFavourites(getToken, { limit: SAVED_PAGE_SIZE }).then(
      (page) => {
        if (cancelled) return;
        setState({
          status: "ready",
          events: page.items.map(adaptPublicEvent),
          nextCursor: page.nextCursor,
          now: Date.now(),
        });
      },
      () => {
        if (!cancelled) setState({ status: "error" });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [getToken, attempt]);

  function retry() {
    setState({ status: "loading" });
    setAttempt((n) => n + 1);
  }

  async function loadMore() {
    if (state.status !== "ready" || !state.nextCursor) return;
    setLoadingMore(true);
    setMoreError(false);
    try {
      const page = await listFavourites(getToken, { cursor: state.nextCursor, limit: SAVED_PAGE_SIZE });
      setState((current) => {
        if (current.status !== "ready") return current;
        const seen = new Set(current.events.map((e) => e.id));
        return {
          ...current,
          events: [...current.events, ...page.items.map(adaptPublicEvent).filter((e) => !seen.has(e.id))],
          nextCursor: page.nextCursor,
        };
      });
    } catch {
      setMoreError(true);
    } finally {
      setLoadingMore(false);
    }
  }

  if (state.status === "loading") {
    return (
      <div aria-busy="true" className="min-h-64">
        <p className="text-sm text-muted">Loading your saved events…</p>
      </div>
    );
  }

  if (state.status === "error") {
    return (
      <div>
        <Notice tone="danger" role="alert">
          Couldn&rsquo;t load your saved events.
        </Notice>
        <Button variant="outline" size="lg" className="mt-3" onClick={retry}>
          Try again
        </Button>
      </div>
    );
  }

  return (
    <SavedList
      events={state.events}
      now={state.now}
      count={favourites?.status === "ready" ? favourites.count : state.events.length}
      more={
        state.nextCursor ? (
          <div className="mt-10 flex flex-col items-start gap-3">
            {moreError && (
              <Notice tone="danger" role="alert">
                Couldn&rsquo;t load more. Try again.
              </Notice>
            )}
            <Button variant="outline" size="lg" className="w-full sm:w-auto" busy={loadingMore} onClick={loadMore}>
              {loadingMore ? "Loading…" : "Load more"}
            </Button>
          </div>
        ) : null
      }
    />
  );
}

function SavedList({
  events,
  now,
  count,
  more,
}: {
  events: SheltuhEvent[];
  now: number;
  count: number;
  more?: ReactNode;
}) {
  const [removed, setRemoved] = useState<ReadonlySet<string>>(new Set());
  const upcoming = events.filter((event) => !hasEnded(event, now));
  const past = events.filter((event) => hasEnded(event, now) && !removed.has(event.id));
  // Stays once shown, so removing the last row leaves focus somewhere (its heading).
  const [hadPast, setHadPast] = useState(false);
  if (!hadPast && past.length > 0) setHadPast(true);

  if (events.length === 0) {
    return (
      <EmptyState
        title="Nothing saved yet"
        action={
          <ButtonLink size="lg" href="/events">
            Browse events
          </ButtonLink>
        }
      >
        Tap the heart on any event and it&rsquo;ll wait for you here.
      </EmptyState>
    );
  }

  return (
    <>
      <CountLine count={count} />
      <section aria-labelledby="saved-upcoming" className="flex flex-col">
        <SectionHeader title="Coming up" id="saved-upcoming" />
        {upcoming.length > 0 ? (
          <EventResults events={upcoming} layout="grid" />
        ) : (
          <p className="text-sm text-muted">Nothing coming up. Your past events are below.</p>
        )}
      </section>
      {hadPast && (
        <PastList
          events={past}
          onRemoved={(id) => setRemoved((current) => new Set([...current, id]))}
        />
      )}
      {more}
    </>
  );
}

function PastList({ events, onRemoved }: { events: SheltuhEvent[]; onRemoved: (id: string) => void }) {
  const favourites = useFavourites();
  const [busy, setBusy] = useState<ReadonlySet<string>>(new Set());
  const [errors, setErrors] = useState<ReadonlySet<string>>(new Set());
  const [announcement, setAnnouncement] = useState("");
  // After a row goes, focus moves to the next row's Remove, else the previous one, else the heading.
  const pendingFocus = useRef<string | null>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    const id = pendingFocus.current;
    if (id === null) return;
    const button = Array.from(listRef.current?.querySelectorAll<HTMLButtonElement>("button[data-remove-id]") ?? []).find(
      (el) => el.dataset.removeId === id,
    );
    pendingFocus.current = null;
    (button ?? headingRef.current)?.focus();
  });

  const remove = useCallback(
    async (event: SheltuhEvent) => {
      if (!favourites) return;
      setBusy((s) => new Set([...s, event.id]));
      setErrors((s) => new Set([...s].filter((id) => id !== event.id)));
      try {
        await favourites.remove({ id: event.id, title: event.title, slug: event.slug });
        const index = events.findIndex((e) => e.id === event.id);
        const neighbour = events[index + 1] ?? events[index - 1];
        pendingFocus.current = neighbour ? neighbour.id : "";
        setAnnouncement(`Removed ${event.title} from saved.`);
        onRemoved(event.id);
      } catch {
        setErrors((s) => new Set([...s, event.id]));
      } finally {
        setBusy((s) => new Set([...s].filter((id) => id !== event.id)));
      }
    },
    [favourites, events, onRemoved],
  );

  return (
    <section aria-labelledby="saved-past" className="mt-16 border-t border-foreground pt-5">
      <h2 id="saved-past" ref={headingRef} tabIndex={-1} className="display-md mb-4 !text-2xl outline-offset-2">
        Past events
      </h2>
      {events.length === 0 && <p className="text-sm text-muted">No past events saved.</p>}
      <ul ref={listRef}>
        {events.map((event) => (
          <li key={event.id} className="flex flex-col gap-2 border-b border-surface-border py-3">
            <div className="flex items-center justify-between gap-4">
              <div className="min-w-0">
                <Link
                  href={`/events/${event.slug}`}
                  className="text-base leading-snug font-semibold underline-offset-4 hover:underline"
                >
                  {event.title}
                </Link>
                <p className="text-sm text-muted">{formatDayWithYear(event.startsAt)} · Ended</p>
              </div>
              <Button
                data-remove-id={event.id}
                variant="outline"
                size="sm"
                className="min-h-11 shrink-0"
                busy={busy.has(event.id) || favourites?.status !== "ready"}
                onClick={() => void remove(event)}
              >
                Remove <span className="sr-only">{event.title}</span>
              </Button>
            </div>
            {errors.has(event.id) && (
              <Notice tone="danger" role="alert">
                Couldn&rsquo;t remove it. Try again.
              </Notice>
            )}
          </li>
        ))}
      </ul>
      <p role="status" className="sr-only">
        {announcement}
      </p>
    </section>
  );
}
