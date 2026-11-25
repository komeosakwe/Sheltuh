"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import DemoNotice from "@/components/DemoNotice";
import { Button, ButtonLink } from "@/components/ui/Button";
import { EmptyState, Notice } from "@/components/ui/Section";
import { listFavourites } from "@/lib/api/favourites";
import { MAX_FAVOURITES } from "@/lib/api/types";
import { useOptionalAuth } from "@/lib/auth/useOptionalAuth";
import { eventZone, formatDayWithYear } from "@/lib/format";
import { adaptPublicEvent } from "@/lib/live/adapt";
import { getMinBuyerTotalCents } from "@/lib/pricing";
import { withNext } from "@/lib/safe-next-path";
import { sampleEvents } from "@/lib/sample-events";
import type { SheltuhEvent } from "@/lib/types";
import { useFavourites } from "./FavouritesProvider";
import SavedEventCard from "./SavedEventCard";
import { LoadingState } from "@/components/ui/ProgressLoader";

/** Saved events per page (the API's most). */
export const SAVED_PAGE_SIZE = 50;
/** Cards shown at a time: six, then "Show 6 more" (Latte's Saved frames). */
export const SAVED_STEP = 6;
/** From here a line under the filters says "{n} of 500 saved". */
const NEAR_CAP = 450;

/**
 * Saved's own grid (Latte's Saved frames): one card per row on phones, two from 768px (328px cards
 * at 768) and three from 1280px; 16px across and 24px down (16 down on phones). The cards carry
 * their own 16px padding.
 */
export const SAVED_GRID = "grid grid-cols-1 gap-4 md:grid-cols-2 md:gap-y-6 xl:grid-cols-3";

/** "Show 6 more" (the frames' small outline button, Label/Tag), 44px to touch. My tickets' Show more and Try again too. */
export const SHOW_MORE_CLASS =
  "label-tag relative inline-flex h-10 items-center rounded-control border-control border-foreground bg-background px-5 text-foreground after:absolute after:-inset-y-0.5 after:inset-x-0 after:content-[''] hover:bg-foreground hover:text-background focus-visible:bg-foreground focus-visible:text-background aria-disabled:cursor-wait motion-safe:transition-colors motion-safe:duration-200 motion-safe:ease-out";

type ListState =
  | { status: "loading" }
  | { status: "error" }
  /**
   * `next`: where the walk through the rest of the list is up to (the page after `cursor`, or the
   * first page again when `cursor` is undefined); undefined once it's all in.
   */
  | { status: "ready"; events: SheltuhEvent[]; next?: { cursor?: string }; now: number };

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
  if (!auth || favourites.status === "auth-loading") return <LoadingState text="Loading…" />;
  if (favourites.signedOut) {
    return (
      <EmptyState
        title="Sign in to see your saved events"
        action={
          <ButtonLink size="lg" href={withNext("/login", "/saved")}>
            Sign in
          </ButtonLink>
        }
      />
    );
  }
  return <LiveSaved key={auth.email ?? ""} getToken={auth.getAccessToken} />;
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
      <DemoNotice>Saved on this device only.</DemoNotice>
      {!shown ? (
        <LoadingState text="Loading…" />
      ) : (
        <SavedList events={events} now={now} count={favourites?.count ?? 0} />
      )}
    </>
  );
}

function LiveSaved({ getToken }: { getToken: () => Promise<string> }) {
  const favourites = useFavourites();
  const [state, setState] = useState<ListState>({ status: "loading" });
  const [restFailed, setRestFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    listFavourites(getToken, { limit: SAVED_PAGE_SIZE }).then(
      (page) => {
        if (cancelled) return;
        setState({
          status: "ready",
          events: page.items.map(adaptPublicEvent),
          next: page.nextCursor ? { cursor: page.nextCursor } : undefined,
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

  // The filters and their counts need the whole list (up to 500), not the first page: the rest is
  // fetched page by page straight after the first is shown. A failed page stops it, and says so.
  // The pages are offsets into the list as it is when each is fetched, so if the list changes
  // meanwhile (an unsave here, a save in another tab) the walk starts again from the first page,
  // or it could skip an event; anything it already has isn't added twice.
  // (The saved ids arriving, which changes nothing on the server, doesn't count.)
  const savedIds = favourites?.status === "ready" ? favourites.ids : null;
  const [walkedIds, setWalkedIds] = useState(savedIds);
  if (savedIds !== walkedIds) {
    setWalkedIds(savedIds);
    if (walkedIds && savedIds && state.status === "ready" && state.next) setState({ ...state, next: {} });
  }
  const next = state.status === "ready" ? state.next : undefined;
  useEffect(() => {
    if (!next || restFailed) return;
    let cancelled = false;
    listFavourites(getToken, next.cursor ? { cursor: next.cursor, limit: SAVED_PAGE_SIZE } : { limit: SAVED_PAGE_SIZE }).then(
      (page) => {
        if (cancelled) return;
        setState((current) => {
          if (current.status !== "ready") return current;
          const seen = new Set(current.events.map((e) => e.id));
          return {
            ...current,
            events: [...current.events, ...page.items.map(adaptPublicEvent).filter((e) => !seen.has(e.id))],
            next: page.nextCursor ? { cursor: page.nextCursor } : undefined,
          };
        });
      },
      () => {
        if (!cancelled) setRestFailed(true);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [getToken, next, restFailed]);

  function retry() {
    setState({ status: "loading" });
    setRestFailed(false);
    setAttempt((n) => n + 1);
  }

  if (state.status === "loading") {
    return (
      <div aria-busy="true" className="min-h-64">
        <LoadingState text="Loading your saved events…" />
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
      rest={{ complete: !state.next, failed: restFailed, retry: () => setRestFailed(false) }}
    />
  );
}

/** The rest of the saved events, after the first page (live mode): still loading, all in, or stopped by an error. */
interface RestOfList {
  complete: boolean;
  failed: boolean;
  retry: () => void;
}

type SavedFilter = "all" | "week" | "free";

const WEEK_MS = 7 * 86_400_000;

/** Coming up in the next seven days (or on now). */
const isThisWeek = (event: SheltuhEvent, now: number) => new Date(event.startsAt).getTime() - now < WEEK_MS;
/** Free to go: its cheapest ticket costs nothing, or (tickets sold on another site) the organiser says entry is free. */
export const isFree = (event: SheltuhEvent) =>
  event.ticketingMode === "external" ? Boolean(event.externalFree) : getMinBuyerTotalCents(event) === 0;

/**
 * The saved events (Latte's Saved frames): the filters (All · This week · Free, each with its
 * count), the grid of cards (one per row on phones, two from 768px and three from 1280px:
 * SAVED_GRID), six at a time with "Show 6 more" under them, then any ended events in their own
 * list with Remove buttons.
 */
function SavedList({
  events,
  now,
  count,
  rest = { complete: true, failed: false, retry: () => undefined },
}: {
  events: SheltuhEvent[];
  now: number;
  count: number;
  rest?: RestOfList;
}) {
  const [removed, setRemoved] = useState<ReadonlySet<string>>(new Set());
  const [filter, setFilter] = useState<SavedFilter>("all");
  const [shown, setShown] = useState(SAVED_STEP);
  const [announcement, setAnnouncement] = useState("");
  const [retried, setRetried] = useState(false);
  const pendingFocus = useRef<string | null>(null);
  const gridRef = useRef<HTMLUListElement>(null);
  const filtersRef = useRef<HTMLDivElement>(null);
  const upcoming = events.filter((event) => !hasEnded(event, now));
  const past = events.filter((event) => hasEnded(event, now) && !removed.has(event.id));
  // Stays once shown, so removing the last row leaves focus somewhere (its heading).
  const [hadPast, setHadPast] = useState(false);
  if (!hadPast && past.length > 0) setHadPast(true);

  // After "Show more", focus goes to the first card that appeared, once it's rendered.
  useEffect(() => {
    const id = pendingFocus.current;
    if (!id) return;
    const link = gridRef.current?.querySelector<HTMLElement>(`[data-saved-id="${CSS.escape(id)}"] [data-card-link]`);
    if (!link) return;
    pendingFocus.current = null;
    link.focus();
  });

  // Empty only once the whole list is in: a first page can come back empty with more after it.
  if (events.length === 0 && rest.complete) return <SavedEmpty />;

  // This week and Free count the whole list, so their numbers wait until it's all in. All is the
  // saved total until then, and once it's all in the events coming up, so it matches the cards.
  const whole = rest.complete;
  const filters: { key: SavedFilter; label: string; count: number | null }[] = [
    { key: "all", label: "All", count: whole ? upcoming.length : Math.max(count, upcoming.length) },
    { key: "week", label: "This week", count: whole ? upcoming.filter((event) => isThisWeek(event, now)).length : null },
    { key: "free", label: "Free", count: whole ? upcoming.filter(isFree).length : null },
  ];
  const filtered =
    filter === "week" ? upcoming.filter((event) => isThisWeek(event, now)) : filter === "free" ? upcoming.filter(isFree) : upcoming;
  const visible = filtered.slice(0, shown);
  const hidden = filtered.length - visible.length;
  const nowDate = new Date(now);

  function showMore() {
    const next = filtered[shown];
    const added = Math.min(SAVED_STEP, hidden);
    if (next) pendingFocus.current = next.id;
    setShown((n) => n + SAVED_STEP);
    // The running total, so each press is announced even when it adds the same number as the last.
    setAnnouncement(`${added} more shown: ${Math.min(shown + SAVED_STEP, filtered.length)} of ${filtered.length} events.`);
  }

  return (
    <>
      <div ref={filtersRef} role="group" aria-label="Filter saved events" className="flex flex-wrap gap-2">
        {filters.map((option) => (
          <button
            key={option.key}
            type="button"
            aria-pressed={filter === option.key}
            onClick={() => {
              setFilter(option.key);
              setShown(SAVED_STEP);
            }}
            className={`label-tag relative inline-flex h-9 items-center rounded-control border-control border-foreground px-4 after:absolute after:-inset-y-1 after:inset-x-0 after:content-[''] motion-safe:transition-colors motion-safe:duration-200 motion-safe:ease-out ${
              filter === option.key ? "bg-foreground text-background" : "bg-background text-foreground hover:bg-hover"
            }`}
          >
            {option.label}
            {option.count !== null && (
              <>
                <span aria-hidden="true">&nbsp;·</span>
                <span className="sr-only">,</span> {option.count}
              </>
            )}
          </button>
        ))}
      </div>
      {count >= NEAR_CAP && (
        <p className="body-s text-muted">
          {count} of {MAX_FAVOURITES} saved
        </p>
      )}
      <section aria-labelledby="saved-upcoming" className="flex flex-col gap-6">
        <h2 id="saved-upcoming" className="sr-only">
          Coming up
        </h2>
        {visible.length > 0 ? (
          <ul ref={gridRef} className={SAVED_GRID}>
            {visible.map((event, index) => (
              <li key={event.id} data-saved-id={event.id} className="flex">
                <SavedEventCard event={event} now={nowDate} priority={index < 2} />
              </li>
            ))}
          </ul>
        ) : !whole ? null : (
          <p className="body-s text-muted">
            {filter === "all" ? "Nothing coming up." : filter === "week" ? "Nothing on this week." : "No free events saved."}
          </p>
        )}
        {hidden > 0 && (
          <div>
            <button type="button" onClick={showMore} className={SHOW_MORE_CLASS}>
              Show {Math.min(SAVED_STEP, hidden)} more
            </button>
          </div>
        )}
        {/* The rest of the list, after the first page: shown whatever "Show 6 more" is doing. */}
        {rest.failed ? (
          <div className="flex flex-col items-start gap-3">
            <Notice tone="danger" role="alert">
              Couldn&rsquo;t load all your saved events.
            </Notice>
            <button
              type="button"
              onClick={() => {
                // The button goes as the loading starts: focus moves to the filter in use (a
                // control that stays), and the status line says what's happening and when it's done.
                filtersRef.current?.querySelector<HTMLElement>('[aria-pressed="true"]')?.focus();
                setRetried(true);
                rest.retry();
              }}
              className={SHOW_MORE_CLASS}
            >
              Try again
            </button>
          </div>
        ) : (
          !whole && <LoadingState text="Loading the rest of your saved events…" />
        )}
        <p role="status" className="sr-only">
          {retried && !rest.failed ? (whole ? `All ${events.length} saved events loaded.` : "Loading the rest of your saved events…") : ""}
        </p>
        <p role="status" className="sr-only">
          {announcement}
        </p>
      </section>
      {hadPast && (
        <PastList events={past} onRemoved={(id) => setRemoved((current) => new Set([...current, id]))} />
      )}
    </>
  );
}

/** Nothing saved (until Latte designs it: the page title, one line and a link to Discover). */
function SavedEmpty() {
  return (
    <p className="body-m">
      Nothing saved yet. Tap the heart on any event to keep it here.{" "}
      <Link href="/" className="font-semibold underline underline-offset-4 hover:decoration-2">
        Discover events
      </Link>
    </p>
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
    <section aria-labelledby="saved-past" className="mt-4 border-t border-surface-border pt-6">
      <h2 id="saved-past" ref={headingRef} tabIndex={-1} className="heading-h3 mb-4 outline-offset-2">
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
                <p className="text-sm text-muted">{formatDayWithYear(event.startsAt, new Date(), eventZone(event.timeZone))} · Ended</p>
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
