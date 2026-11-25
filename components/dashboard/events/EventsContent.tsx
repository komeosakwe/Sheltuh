"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import AccountPageHead from "@/components/account/AccountPageHead";
import OrganiserGate from "@/components/dashboard/OrganiserGate";
import OrgEventCard from "@/components/dashboard/OrgEventCard";
import { DashButton, DashButtonLink } from "@/components/dashboard/ui/DashButton";
import { DashChip } from "@/components/dashboard/ui/DashChip";
import DashMenu from "@/components/dashboard/ui/DashMenu";
import { MoreIcon } from "@/components/dashboard/ui/icons";
import { useToday } from "@/components/dashboard/useToday";
import { LoadingState } from "@/components/ui/ProgressLoader";
import { formatCount } from "@/lib/analytics-format";
import { getOrganiserEventsSummary } from "@/lib/api/organiser-summary";
import type { OrganiserEventCounts, OrganiserEventFilter, OrganiserEventSummary, OrganiserRecord } from "@/lib/api/types";
import { useAuth } from "@/lib/auth/AuthContext";
import { cardMenuActions, eventsFilterFrom } from "@/lib/organiser-event-card";
import { NEW_EVENT_HREF } from "@/lib/organiser-nav";
import { ADD_LOGO_HREF } from "@/lib/organiser-profile";
import EventCardDetails from "./EventCardDetails";

/** What a filter's events are called: "6 events", "3 live events", "2 drafts", "1 past event". */
function eventsWord(filter: OrganiserEventFilter, n: number): string {
  const one = n === 1;
  switch (filter) {
    case "all":
      return one ? "event" : "events";
    case "live":
      return one ? "live event" : "live events";
    case "drafts":
      return one ? "draft" : "drafts";
    case "past":
      return one ? "past event" : "past events";
  }
}

/** The chips, in the frame's order, with their words. */
const FILTERS: { filter: OrganiserEventFilter; label: string; empty: string }[] = [
  { filter: "all", label: "All", empty: "No events yet" },
  { filter: "live", label: "Live", empty: "No live events right now." },
  { filter: "drafts", label: "Drafts", empty: "No drafts." },
  { filter: "past", label: "Past", empty: "No past events yet." },
];

/** A note in the frames' own note style (Attendees' privacy note): cream, a 1px border/subtle edge, radius 16, Body/S. */
const NOTE = "body-s flex flex-wrap items-center justify-between gap-3 rounded-card border border-surface-border bg-hover px-4 py-3 text-foreground";

/** A page of the filter it was asked for (so a page for another filter is never shown as this one's). */
type Load =
  | { status: "loading" }
  | { status: "error"; filter: OrganiserEventFilter; message: string }
  | { status: "ready"; filter: OrganiserEventFilter; items: OrganiserEventSummary[]; nextCursor?: string; counts: OrganiserEventCounts };

/** The address bar says which filter is showing (`?filter=drafts`; none for All), so a reload or a link keeps it. */
function showFilterInAddress(filter: OrganiserEventFilter) {
  const url = new URL(window.location.href);
  if (filter === "all") url.searchParams.delete("filter");
  else url.searchParams.set("filter", filter);
  // null, as Next documents: Next keeps its own state, and then updates useSearchParams to match.
  window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
}

/**
 * The organiser dashboard's Events tab (/dashboard/events; Latte's frames 433:7341, 492:14821,
 * 492:15144): "Your events" and "Drafts, live and past events." with Create event; the filter chips
 * with their counts (All · 6, Live · 3, Drafts · 2, Past · 1); and the event cards, three across at a
 * desktop (from col-lg), two from 640px, one on phones. Each card is Latte's event card: its status
 * (Live, Sold out, Draft, Ended, and the undrawn In review, Changes needed, Unpublished in the same
 * pill), date and place, sales, and Manage → (Continue → while it's being made). What the list always
 * said stays on the card: "Live on Sheltüh. Contact Sheltüh to change it." for a published event,
 * Sheltüh's note and the next step for the undrawn states, and the paid-draft payouts line; its other
 * actions (View public page, Orders, Analytics, Check-in) are in the card's "···" menu until the
 * Manage tabs (plan OD-13) hold them.
 *
 * The address is the filter's source (`?filter=`, read with useSearchParams): a chip writes it, and
 * any other way of changing it (the nav's Events link back to All, the browser's back) shows what it
 * says.
 *
 * Not drawn, in the same pieces: loading, an error with Try again (it stays, busy, while it loads,
 * then focus goes to the heading), no events at all (Create your first event), an empty filter, and
 * more than a page (Load more: focus goes to the first new card, and "Showing 20 of 45 events" is
 * said). The no-logo and payouts prompts the list has had sit above the chips as notes.
 */
export default function EventsContent() {
  return (
    <OrganiserGate title="Your events" signInText="Sign in to see your events.">
      {(organiser) => <Events organiser={organiser} />}
    </OrganiserGate>
  );
}

function Events({ organiser }: { organiser: OrganiserRecord }) {
  const auth = useAuth();
  const getToken = auth.getAccessToken;
  const params = useSearchParams();
  const filter = eventsFilterFrom(params.getAll("filter"));
  const [attempt, setAttempt] = useState(0);
  const [retrying, setRetrying] = useState(false);
  const [load, setLoad] = useState<Load>({ status: "loading" });
  const [counts, setCounts] = useState<OrganiserEventCounts | null>(null);
  const [more, setMore] = useState<{ loading: boolean; error: string | null }>({ loading: false, error: null });
  const now = useToday();
  /** What the status line says: nothing on arrival (the heading says where you are), then after a chip or Load more. */
  const [said, setSaid] = useState<"none" | "chose" | "more">("none");
  /** After Load more: the first new card, whose link takes focus once it's there. */
  const [focusCard, setFocusCard] = useState<string | null>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const focusTitleOnLoad = useRef(false);
  // The newest request: a page that lands after the filter changed again is dropped.
  const requestRef = useRef(0);

  useEffect(() => {
    const request = ++requestRef.current;
    const controller = new AbortController();
    getOrganiserEventsSummary(getToken, { filter, signal: controller.signal })
      .then((page) => {
        if (request !== requestRef.current) return;
        setLoad({ status: "ready", filter, items: page.items, nextCursor: page.nextCursor, counts: page.counts });
        setCounts(page.counts);
        setMore({ loading: false, error: null });
        setRetrying(false);
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted || request !== requestRef.current) return;
        setLoad({ status: "error", filter, message: err instanceof Error ? err.message : "Something went wrong." });
        setRetrying(false);
      });
    return () => controller.abort();
  }, [getToken, filter, attempt]);

  // The page as it stands for the filter the address shows: the last answer if it's this filter's, else loading.
  const shown: Load = load.status !== "loading" && load.filter !== filter ? { status: "loading" } : load;

  // Focus moves in the same commit that removes Try again or Load more, so it's never left on the body.
  useLayoutEffect(() => {
    if (shown.status !== "ready" || !focusTitleOnLoad.current) return;
    focusTitleOnLoad.current = false;
    titleRef.current?.focus();
  }, [shown.status]);

  useLayoutEffect(() => {
    if (!focusCard) return;
    const link = document.querySelector<HTMLElement>(`[data-org-event-card="${CSS.escape(focusCard)}"] a[data-card-link]`);
    if (!link) return;
    link.focus();
    queueMicrotask(() => setFocusCard(null));
  }, [focusCard, load]);

  function choose(next: OrganiserEventFilter) {
    if (next === filter) return;
    setSaid("chose");
    showFilterInAddress(next);
  }

  function retry() {
    focusTitleOnLoad.current = true;
    setRetrying(true);
    setAttempt((n) => n + 1);
  }

  function loadMore() {
    if (shown.status !== "ready" || !shown.nextCursor) return;
    const request = requestRef.current;
    const loadedFilter = shown.filter;
    const seen = new Set(shown.items.map((item) => item.eventId));
    setMore({ loading: true, error: null });
    getOrganiserEventsSummary(getToken, { filter: loadedFilter, cursor: shown.nextCursor })
      .then((page) => {
        if (request !== requestRef.current) return;
        const added = page.items.filter((item) => !seen.has(item.eventId));
        setLoad((current) =>
          current.status !== "ready" || current.filter !== loadedFilter
            ? current
            : { ...current, items: [...current.items, ...added], nextCursor: page.nextCursor, counts: page.counts },
        );
        setCounts(page.counts);
        setMore({ loading: false, error: null });
        setSaid("more");
        setFocusCard(added[0]?.eventId ?? null);
      })
      .catch((err: unknown) => {
        if (request !== requestRef.current) return;
        setMore({ loading: false, error: err instanceof Error ? err.message : "Couldn’t load more events." });
      });
  }

  const payoutsEnabled = organiser.payoutsEnabled === true;
  const chosen = FILTERS.find((item) => item.filter === filter) ?? FILTERS[0];
  const noEventsAtAll = counts !== null && counts.all === 0;
  let status = "";
  if (shown.status === "ready" && !noEventsAtAll && said !== "none") {
    const total = shown.counts[filter];
    status =
      said === "more"
        ? `Showing ${formatCount(shown.items.length)} of ${formatCount(total)} ${eventsWord(filter, total)}.`
        : `Showing ${formatCount(total)} ${eventsWord(filter, total)}.`;
  }

  return (
    <div data-events-tab="" className="flex flex-col gap-6">
      <AccountPageHead
        title="Your events"
        intro="Drafts, live and past events."
        tightOnPhone
        titleRef={titleRef}
        action={
          noEventsAtAll ? undefined : (
            <DashButtonLink href={NEW_EVENT_HREF} variant="primary" className="max-w-full text-center pointer-coarse:min-h-11">
              Create event
            </DashButtonLink>
          )
        }
      />
      {!organiser.logoUrl && (
        <div data-logo-prompt="" className={NOTE}>
          <p className="min-w-0 font-semibold break-words">Add your logo</p>
          <DashButtonLink href={ADD_LOGO_HREF} variant="outline" className="max-w-full text-center pointer-coarse:min-h-11">
            Add logo
          </DashButtonLink>
        </div>
      )}
      {!payoutsEnabled && (
        <p data-payouts-note="" className={NOTE}>
          <span className="min-w-0 break-words">
            <Link href="/dashboard/payouts" className="font-semibold underline underline-offset-4 hover:decoration-2">
              Set up payouts
            </Link>{" "}
            before publishing paid events.
          </span>
        </p>
      )}
      {!noEventsAtAll && (
        <div role="group" aria-label="Filter events" className="flex flex-wrap gap-2">
          {FILTERS.map((item) => (
            <DashChip
              key={item.filter}
              pressed={item.filter === filter}
              onClick={() => choose(item.filter)}
              data-events-filter={item.filter}
              className="max-w-full pointer-coarse:min-h-11"
            >
              {/* One span, so the chip's gap doesn't add space around the dot: "All · 6". */}
              <span className="whitespace-normal">
                {item.label}
                {counts && (
                  <>
                    {" "}
                    <span aria-hidden="true">·</span> {formatCount(counts[item.filter])}
                  </>
                )}
              </span>
            </DashChip>
          ))}
        </div>
      )}
      {/* What the chips or Load more now show, said once it's loaded (the grid changing isn't announced on its own). */}
      <p role="status" className="sr-only">
        {status}
      </p>
      {shown.status === "loading" && <LoadingState text="Loading your events…" />}
      {shown.status === "error" && (
        <div data-events-error="" className="flex flex-col items-start gap-4 rounded-card border border-surface-border p-6">
          <div role="alert" className="flex flex-col gap-1">
            <p className="label-button">Your events couldn’t load.</p>
            <p className="body-s text-muted">{shown.message}</p>
          </div>
          <DashButton variant="outline" onClick={retry} busy={retrying} className="pointer-coarse:min-h-11">
            Try again
          </DashButton>
        </div>
      )}
      {shown.status === "ready" &&
        (noEventsAtAll ? (
          <div data-events-empty="all" className="flex flex-col items-start gap-4 rounded-card border border-surface-border bg-card p-6">
            <div className="flex flex-col gap-1">
              <h2 className="label-button">No events yet</h2>
              <p className="body-s text-muted">Create your first event: it’s saved as a draft until you publish it.</p>
            </div>
            <DashButtonLink href={NEW_EVENT_HREF} variant="primary" className="max-w-full text-center pointer-coarse:min-h-11">
              Create your first event
            </DashButtonLink>
          </div>
        ) : shown.items.length === 0 ? (
          <p data-events-empty={filter} className="body-m rounded-card border border-surface-border p-6 text-muted">
            {chosen.empty}
          </p>
        ) : (
          <>
            <ul className="grid grid-cols-1 gap-6 sm:grid-cols-2 col-lg:grid-cols-3">
              {shown.items.map((event) => (
                <li key={event.eventId} className="flex min-w-0">
                  <OrgEventCard
                    event={event}
                    now={now}
                    headingLevel={2}
                    details={<EventCardDetails event={event} payoutsEnabled={payoutsEnabled} />}
                    menu={<CardMenu event={event} />}
                  />
                </li>
              ))}
            </ul>
            {shown.nextCursor && (
              <div className="flex flex-col items-center gap-2">
                <DashButton variant="outline" onClick={loadMore} busy={more.loading} className="pointer-coarse:min-h-11">
                  {more.loading ? "Loading…" : "Load more"}
                </DashButton>
                {more.error && (
                  <p role="alert" className="body-s text-danger">
                    {more.error}
                  </p>
                )}
              </div>
            )}
          </>
        ))}
    </div>
  );
}

/**
 * A card's other actions behind "···" (Latte's Dash menu): View public page, Orders, Analytics and
 * Check-in, as each applies. 32px square on a desktop, 44 on a touch screen; named "More for {title}".
 */
function CardMenu({ event }: { event: OrganiserEventSummary }) {
  const title = event.title.trim() || "Untitled event";
  const actions = cardMenuActions(event);
  if (actions.length === 0) return null;
  return (
    <DashMenu
      label={<MoreIcon className="size-5" />}
      triggerLabel={`More for ${title}`}
      triggerClassName="inline-flex size-8 items-center justify-center rounded-control text-foreground hover:bg-surface pointer-coarse:size-11"
      items={actions.map((action) => ({ key: action.kind, label: action.label, href: action.href }))}
      menuLabel={`More for ${title}`}
    />
  );
}
