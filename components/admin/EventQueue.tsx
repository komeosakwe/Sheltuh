"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent } from "react";
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
import EventQueueItem, { eventHeadingId } from "./EventQueueItem";
import { actionErrorText } from "./OrganiserItem";

type LoadState =
  | { status: "loading" }
  | { status: "error"; message: string; sessionExpired: boolean }
  | { status: "ready"; items: AdminEventRecord[]; nextCursor?: string };

type MoreError = { message: string } | { sessionExpired: true };

/** The visible result of the last action; the heading that takes focus next is described by it. */
const ANNOUNCEMENT_ID = "events-announcement";
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
 * status. After Approve, Reject or Unpublish the event leaves the list, a
 * status line says what happened, and focus moves to the next event's
 * heading (or the list's heading when it was the last).
 */
export default function EventQueue() {
  const auth = useAuth();
  const getToken = auth.getAccessToken;
  const router = useRouter();
  const searchParams = useSearchParams();
  const filters = readEventQueueFilters(searchParams);
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
  const [describedFocus, setDescribedFocus] = useState<string | null>(null);
  const [reauthOwner, setReauthOwner] = useState<string | null>(null);
  /** When "ended" is judged from; set per load so rows don't flip while being read. */
  const [now, setNow] = useState(() => Date.now());
  const headingRef = useRef<HTMLHeadingElement>(null);
  const pendingFocus = useRef<string | null>(null);
  /** The next load finishing is announced (a filter or search the admin asked for). */
  const announceLoad = useRef(false);

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
    // `key` covers every filter and retry; `filters` is rebuilt from the URL on each render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, getToken]);

  useEffect(() => {
    const target = pendingFocus.current;
    if (!target) return;
    const element = target === HEADING_ID ? headingRef.current : document.getElementById(target);
    if (!element) return; // Not rendered yet.
    pendingFocus.current = null;
    element.focus();
  });

  function show(next: EventQueueFilters) {
    announceLoad.current = true;
    setAnnouncement("");
    setLoadAnnouncement("");
    setDescribedFocus(null);
    setMoreError(null);
    setReauthOwner(null);
    router.replace(eventQueueHref(next), { scroll: false });
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
    if (reauthOwner === item.eventId) setReauthOwner(null);
    pendingFocus.current = next ? eventHeadingId(next.eventId) : HEADING_ID;
    setDescribedFocus(next ? next.eventId : HEADING_ID);
    adminSummary?.refresh();
  }

  function retryLoad() {
    announceLoad.current = true;
    setLoadAnnouncement("");
    setAttempt((n) => n + 1);
  }

  async function loadMore() {
    if (state.status !== "ready" || !state.nextCursor || loadingMore) return;
    setLoadingMore(true);
    setMoreError(null);
    if (reauthOwner === "more") setReauthOwner(null);
    try {
      const page = await adminListEvents(eventQueueQuery(filters, state.nextCursor), getToken);
      const known = new Set(state.items.map((i) => i.eventId));
      const fresh = page.items.filter((i) => !known.has(i.eventId));
      setItems((current) => [...current, ...fresh], page.nextCursor ?? null);
      if (fresh[0]) pendingFocus.current = eventHeadingId(fresh[0].eventId);
    } catch (err) {
      if (err instanceof SessionExpiredError) {
        setMoreError({ sessionExpired: true });
        setReauthOwner("more");
      } else {
        setMoreError({ message: actionErrorText(err, "Couldn’t load more events. Try again.") });
      }
    } finally {
      setLoadingMore(false);
    }
  }

  function search(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const value = new FormData(event.currentTarget).get("q");
    show({ ...filters, q: typeof value === "string" ? value.trim().slice(0, EVENT_SEARCH_MAX) : "" });
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
            className="inline-flex min-h-6 items-center font-semibold underline underline-offset-4"
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

        {/* Remounted when the URL's search changes, so the box always shows what's searched. */}
        <form
          key={filters.q}
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
              defaultValue={filters.q}
              maxLength={EVENT_SEARCH_MAX}
              autoComplete="off"
              className={fieldClass}
            />
          </div>
          <Button type="submit" variant="solid" size="sm" className="min-h-11">
            Search
          </Button>
          {filters.q && (
            <Button variant="outline" size="sm" className="min-h-11" onClick={() => show({ ...filters, q: "" })}>
              Clear search
            </Button>
          )}
        </form>
      </div>

      {/* Always rendered so each result is announced; empty, it takes no space. */}
      <p id={ANNOUNCEMENT_ID} role="status" className="border-l-2 border-foreground py-1 pl-4 text-sm empty:sr-only">
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
          aria-describedby={describedFocus === HEADING_ID && announcement ? ANNOUNCEMENT_ID : undefined}
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
                  <Button variant="outline" size="sm" className="min-h-11" onClick={() => show({ ...filters, q: "" })}>
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
                  headingDescribedBy={describedFocus === item.eventId && announcement ? ANNOUNCEMENT_ID : undefined}
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
