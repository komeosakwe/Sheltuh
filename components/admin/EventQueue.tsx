"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { Button, buttonClass } from "@/components/ui/Button";
import { fieldClass } from "@/components/ui/Field";
import { SelectedDots } from "@/components/ui/FilterChip";
import { LoadingState } from "@/components/ui/ProgressLoader";
import { EmptyState, Notice } from "@/components/ui/Section";
import { countText, hoursText } from "@/lib/admin-summary";
import { adminListEvents } from "@/lib/api/admin";
import type { AdminEventRecord } from "@/lib/api/types";
import { useAuth } from "@/lib/auth/AuthContext";
import { SessionExpiredError } from "@/lib/auth/session-token";
import AdminSessionExpired from "./AdminSessionExpired";
import { useAdminSummary } from "./AdminSummaryProvider";
import {
  EVENT_SEARCH_MAX,
  EVENT_STATUSES,
  eventQueueHref,
  eventQueueQuery,
  eventQueueWords,
  PUBLISHED_VIEWS,
  readEventQueueFilters,
  type EventQueueFilters,
} from "./event-queue-filters";
import EventQueueItem, { clipReauthOwner, eventHeadingId } from "./EventQueueItem";
import { actionErrorText } from "./OrganiserItem";

type LoadState =
  | { status: "loading" }
  | { status: "error"; message: string; sessionExpired: boolean }
  | { status: "ready"; items: AdminEventRecord[]; nextCursor?: string };

type MoreError = { message: string } | { sessionExpired: true };

const HEADING_ID = "events-heading";
const SEARCH_ID = "events-search";

/** What a finished load is announced as: "3 events waiting for review.", "Nothing to review." */
export function loadedMessage(filters: EventQueueFilters, items: number, more: boolean): string {
  const words = eventQueueWords(filters);
  const matching = filters.q ? ` matching “${filters.q}”` : "";
  if (items === 0) return filters.q ? `No ${words.many}${matching}.` : `${words.emptyTitle}.`;
  return `${countText(items, words.one, words.many)}${matching}${more ? " shown, more to load" : ""}.`;
}

/**
 * /admin/events: events by status, with the filters in the URL
 * (event-queue-filters.ts). Published events show upcoming ones by default,
 * with views for Sheltüh-run events (door check-in) and for every event,
 * past included. A search box finds a title or organiser in the current
 * status; searching (or clearing it) keeps focus in the search box, and
 * searching for the same words again reloads. After Approve, Reject or
 * Unpublish the event leaves the list, a status line says what happened
 * (announced once, by that live region), and focus moves to the next
 * event's heading (or the list's heading when it was the last). A Load more
 * that finishes after the list changed (a filter, a search, Try again) is
 * dropped: it belongs to a list that's gone.
 */
export default function EventQueue() {
  const auth = useAuth();
  const getToken = auth.getAccessToken;
  const router = useRouter();
  const searchParams = useSearchParams();
  const filters = useMemo(() => readEventQueueFilters(searchParams), [searchParams]);
  const adminSummary = useAdminSummary();
  const doorSoon = adminSummary?.summary?.doorEvents;

  const [attempt, setAttempt] = useState(0);
  const key = `${filters.status}|${filters.view}|${filters.q}#${attempt}`;
  const [result, setResult] = useState<{ key: string; state: LoadState } | null>(null);
  const state: LoadState = result?.key === key ? result.state : { status: "loading" };
  const [loadingMore, setLoadingMore] = useState(false);
  const [moreError, setMoreError] = useState<MoreError | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const [loadAnnouncement, setLoadAnnouncement] = useState("");
  const [reauthOwner, setReauthOwner] = useState<string | null>(null);
  /** The search box's text while it's being typed, for the search it was typed against. */
  const [typed, setTyped] = useState<{ q: string; value: string } | null>(null);
  const searchValue = typed && typed.q === filters.q ? typed.value : filters.q;
  /** When "ended" is judged from; set per load so rows don't flip while being read. */
  const [now, setNow] = useState(() => Date.now());
  const headingRef = useRef<HTMLHeadingElement>(null);
  const pendingFocus = useRef<string | null>(null);
  /** The next load finishing is announced (a filter or search the admin asked for). */
  const announceLoad = useRef(false);
  /**
   * The list on screen: replaced whenever another one is asked for, so a Load
   * more started on an earlier list can tell it no longer applies.
   */
  const listToken = useRef<object>({});

  useEffect(() => {
    listToken.current = {};
  }, [key]);

  useEffect(() => {
    let cancelled = false;
    adminListEvents(eventQueueQuery(filters), getToken).then(
      (page) => {
        if (cancelled) return;
        setNow(Date.now());
        setResult({ key, state: { status: "ready", items: page.items, nextCursor: page.nextCursor } });
        if (announceLoad.current) {
          announceLoad.current = false;
          setLoadAnnouncement(loadedMessage(filters, page.items.length, Boolean(page.nextCursor)));
        }
      },
      (err: unknown) => {
        if (cancelled) return;
        announceLoad.current = false; // The error is an alert itself.
        setResult({
          key,
          state: {
            status: "error",
            message: actionErrorText(err, "Couldn’t load events. Try again."),
            sessionExpired: err instanceof SessionExpiredError,
          },
        });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [filters, key, getToken]);

  useEffect(() => {
    const target = pendingFocus.current;
    if (!target) return;
    const element = target === HEADING_ID ? headingRef.current : document.getElementById(target);
    if (!element) return; // Not rendered yet.
    pendingFocus.current = null;
    element.focus();
  });

  /** Another list (or the same one again): whatever the last list had going no longer applies. */
  function show(next: EventQueueFilters) {
    listToken.current = {};
    pendingFocus.current = null;
    announceLoad.current = true;
    setLoadingMore(false);
    setAnnouncement("");
    setLoadAnnouncement("");
    setMoreError(null);
    setReauthOwner(null);
    const href = eventQueueHref(next);
    // The same filters (the same search submitted again): the URL won't change, so load again.
    if (href === eventQueueHref(filters)) setAttempt((n) => n + 1);
    else router.replace(href, { scroll: false });
  }

  function setItems(change: (items: AdminEventRecord[]) => AdminEventRecord[], nextCursor?: string | null) {
    setResult((current) =>
      current && current.key === key && current.state.status === "ready"
        ? {
            key,
            state: {
              status: "ready",
              items: change(current.state.items),
              nextCursor: nextCursor === undefined ? current.state.nextCursor : (nextCursor ?? undefined),
            },
          }
        : current,
    );
  }

  /** An event left this list: announce why, focus the next one (or the list heading), and recount. */
  function removed(item: AdminEventRecord, message: string) {
    const items = state.status === "ready" ? state.items : [];
    const index = items.findIndex((i) => i.eventId === item.eventId);
    const next = index === -1 ? undefined : (items[index + 1] ?? items[index - 1]);
    setItems((current) => current.filter((i) => i.eventId !== item.eventId));
    setAnnouncement(message);
    if (reauthOwner === item.eventId || reauthOwner === clipReauthOwner(item.eventId)) setReauthOwner(null);
    pendingFocus.current = next ? eventHeadingId(next.eventId) : HEADING_ID;
    adminSummary?.refresh();
  }

  function retryLoad() {
    listToken.current = {};
    pendingFocus.current = null;
    setLoadingMore(false);
    announceLoad.current = true;
    setLoadAnnouncement("");
    setAttempt((n) => n + 1);
  }

  async function loadMore() {
    if (state.status !== "ready" || !state.nextCursor || loadingMore) return;
    const token = listToken.current;
    setLoadingMore(true);
    setMoreError(null);
    if (reauthOwner === "more") setReauthOwner(null);
    try {
      const page = await adminListEvents(eventQueueQuery(filters, state.nextCursor), getToken);
      if (token !== listToken.current) return;
      const known = new Set(state.items.map((i) => i.eventId));
      const fresh = page.items.filter((i) => !known.has(i.eventId));
      setItems((current) => [...current, ...fresh], page.nextCursor ?? null);
      if (fresh[0]) pendingFocus.current = eventHeadingId(fresh[0].eventId);
    } catch (err) {
      if (token !== listToken.current) return;
      if (err instanceof SessionExpiredError) {
        setMoreError({ sessionExpired: true });
        setReauthOwner("more");
      } else {
        setMoreError({ message: actionErrorText(err, "Couldn’t load more events. Try again.") });
      }
    } finally {
      if (token === listToken.current) setLoadingMore(false);
    }
  }

  /** Searches (or clears the search), keeping focus in the search box: the button pressed may be gone. */
  function showSearch(q: string) {
    setTyped(null);
    show({ ...filters, q: q.trim().slice(0, EVENT_SEARCH_MAX) });
    pendingFocus.current = SEARCH_ID;
  }

  function search(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    showSearch(searchValue);
  }

  const words = eventQueueWords(filters);
  const shown = state.status === "ready" ? state.items.length : null;
  const doorView = filters.status === "published" && filters.view === "door";

  return (
    <div className="flex flex-col gap-6">
      {doorSoon && doorSoon.count > 0 && !doorView && (
        <Notice>
          {countText(doorSoon.count, "Sheltüh-run event starts", "Sheltüh-run events start")} in the next{" "}
          {hoursText(doorSoon.windowHours)}, and admins run their door.{" "}
          <Link
            href={eventQueueHref({ status: "published", view: "door", q: "" })}
            className="inline-flex min-h-11 items-center font-semibold underline underline-offset-4"
          >
            Open the door check-in list
          </Link>
        </Notice>
      )}

      <div className="flex flex-col gap-3">
        <div role="group" aria-label="Show events" className="flex flex-wrap gap-2">
          {EVENT_STATUSES.map((s) => (
            <Button
              key={s.value}
              variant={filters.status === s.value ? "solid" : "outline"}
              size="sm"
              className="min-h-11"
              aria-pressed={filters.status === s.value}
              onClick={() => show({ status: s.value, view: "upcoming", q: filters.q })}
            >
              {filters.status === s.value && <SelectedDots />}
              {s.label}
            </Button>
          ))}
        </div>
        {filters.status === "published" && (
          <div role="group" aria-label="Show published events" className="flex flex-wrap gap-2">
            {PUBLISHED_VIEWS.map((v) => (
              <Button
                key={v.value}
                variant={filters.view === v.value ? "solid" : "outline"}
                size="sm"
                className="min-h-11"
                aria-pressed={filters.view === v.value}
                onClick={() => show({ ...filters, view: v.value })}
              >
                {filters.view === v.value && <SelectedDots />}
                {v.label}
              </Button>
            ))}
          </div>
        )}

        {/* Not remounted when the search changes (focus stays put); the box shows the URL's search until typed in. */}
        <form
          role="search"
          aria-label="Events"
          onSubmit={search}
          className="flex flex-wrap items-end gap-2"
        >
          <div className="flex min-w-0 flex-1 basis-56 flex-col gap-1">
            <label htmlFor={SEARCH_ID} className="eyebrow text-muted">
              Search by title or organiser
            </label>
            <input
              id={SEARCH_ID}
              name="q"
              type="search"
              value={searchValue}
              onChange={(e) => setTyped({ q: filters.q, value: e.target.value })}
              maxLength={EVENT_SEARCH_MAX}
              autoComplete="off"
              className={fieldClass}
            />
          </div>
          <Button type="submit" variant="solid" size="sm" className="min-h-11">
            Search
          </Button>
          {filters.q && (
            <Button variant="outline" size="sm" className="min-h-11" onClick={() => showSearch("")}>
              Clear search
            </Button>
          )}
        </form>
      </div>

      {/* Always rendered so each result is announced; empty, it takes no space. */}
      <p role="status" className="border-l-2 border-foreground py-1 pl-4 text-sm empty:sr-only">
        {announcement}
      </p>
      <p role="status" className="sr-only">
        {loadAnnouncement}
      </p>

      <section aria-labelledby={HEADING_ID} aria-busy={state.status === "loading" ? true : undefined}>
        <h2
          id={HEADING_ID}
          ref={headingRef}
          tabIndex={-1}
          className="display-md !text-2xl outline-offset-2"
        >
          {words.heading}
          {shown !== null && (
            <>
              {" "}
              <span className="text-muted">
                ({shown.toLocaleString("en-AU")}
                {state.status === "ready" && state.nextCursor ? "+" : ""})
              </span>
            </>
          )}
        </h2>
        {doorView && (
          <p className="mt-2 text-sm text-muted">
            Admins run the door only for the ones ticketed on Sheltüh: those have a Door check-in button.
          </p>
        )}
        {filters.q && <p className="mt-2 text-sm text-muted">Matching “{filters.q}”.</p>}

        <div className="mt-4">
          {state.status === "loading" && <LoadingState text="Loading…" />}

          {state.status === "error" && (
            <div className="flex flex-col items-start gap-3">
              {state.sessionExpired ? (
                <AdminSessionExpired then="try again" onSignedIn={retryLoad} />
              ) : (
                <Notice tone="danger" role="alert">
                  {state.message}
                </Notice>
              )}
              <Button variant="outline" size="sm" className="min-h-11" onClick={retryLoad}>
                Try again
              </Button>
            </div>
          )}

          {state.status === "ready" &&
            state.items.length === 0 &&
            (filters.q ? (
              <EmptyState
                title={`Nothing matches “${filters.q}”`}
                action={
                  <Button variant="outline" size="sm" className="min-h-11" onClick={() => showSearch("")}>
                    Clear search
                  </Button>
                }
              >
                The search looks at titles and organiser names in this list only. Try another list above.
              </EmptyState>
            ) : (
              <EmptyState
                title={words.emptyTitle}
                action={
                  filters.status === "pending_review" ? (
                    <Link href="/admin/events/new" className={buttonClass("outline", "sm", "min-h-11")}>
                      Create an event
                    </Link>
                  ) : undefined
                }
              >
                {words.emptyText}
              </EmptyState>
            ))}

          {state.status === "ready" && state.items.length > 0 && (
            <ul className="flex flex-col border-b border-foreground">
              {state.items.map((item) => (
                <EventQueueItem
                  key={item.eventId}
                  item={item}
                  listStatus={filters.status}
                  getToken={getToken}
                  onRemoved={removed}
                  reauthOwner={reauthOwner}
                  onClaimReauth={setReauthOwner}
                  now={now}
                />
              ))}
            </ul>
          )}

          {state.status === "ready" && state.nextCursor && (
            <div className="mt-6 flex flex-col items-start gap-3">
              {moreError &&
                ("sessionExpired" in moreError ? (
                  <AdminSessionExpired
                    then="load more"
                    withForm={reauthOwner === "more"}
                    onSignedIn={() => {
                      setMoreError(null);
                      setReauthOwner(null);
                    }}
                  />
                ) : (
                  <Notice tone="danger" role="alert">
                    {moreError.message}
                  </Notice>
                ))}
              <Button variant="outline" busy={loadingMore} onClick={loadMore} className="min-h-11">
                {loadingMore ? "Loading…" : "Load more"}
              </Button>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
