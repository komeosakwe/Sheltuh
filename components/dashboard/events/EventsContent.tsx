"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import AccountPageHead from "@/components/account/AccountPageHead";
import OrganiserGate from "@/components/dashboard/OrganiserGate";
import OrgEventCard from "@/components/dashboard/OrgEventCard";
import { DashButton, DashButtonLink } from "@/components/dashboard/ui/DashButton";
import { DashChip } from "@/components/dashboard/ui/DashChip";
import DashMenu from "@/components/dashboard/ui/DashMenu";
import { MoreIcon } from "@/components/dashboard/ui/icons";
import { LoadingState } from "@/components/ui/ProgressLoader";
import { formatCount } from "@/lib/analytics-format";
import { getOrganiserEventsSummary } from "@/lib/api/organiser-summary";
import type { OrganiserEventCounts, OrganiserEventFilter, OrganiserEventSummary, OrganiserRecord } from "@/lib/api/types";
import { useAuth } from "@/lib/auth/AuthContext";
import { NEW_EVENT_HREF } from "@/lib/organiser-nav";
import { cardMenuActions } from "@/lib/organiser-event-card";
import { ADD_LOGO_HREF } from "@/lib/organiser-profile";
import EventCardDetails from "./EventCardDetails";


/** The chips, in the frame's order, with their words. */
const FILTERS: { filter: OrganiserEventFilter; label: string; empty: string; shown: (n: number) => string }[] = [
  { filter: "all", label: "All", empty: "No events yet", shown: (n) => `${formatCount(n)} ${n === 1 ? "event" : "events"}` },
  { filter: "live", label: "Live", empty: "No live events right now.", shown: (n) => `${formatCount(n)} live ${n === 1 ? "event" : "events"}` },
  { filter: "drafts", label: "Drafts", empty: "No drafts.", shown: (n) => `${formatCount(n)} ${n === 1 ? "draft" : "drafts"}` },
  { filter: "past", label: "Past", empty: "No past events yet.", shown: (n) => `${formatCount(n)} past ${n === 1 ? "event" : "events"}` },
];

/** A note in the frames' own note style (Attendees' privacy note): cream, a 1px border/subtle edge, radius 16, Body/S. */
const NOTE = "body-s flex flex-wrap items-center justify-between gap-3 rounded-card border border-surface-border bg-hover px-4 py-3 text-foreground";

type Load =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; items: OrganiserEventSummary[]; nextCursor?: string; counts: OrganiserEventCounts };

/** The address bar says which filter is showing (`?filter=drafts`; none for All), so a reload or a link keeps it. */
function showFilterInAddress(filter: OrganiserEventFilter) {
  const url = new URL(window.location.href);
  if (filter === "all") url.searchParams.delete("filter");
  else url.searchParams.set("filter", filter);
  window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
}

/**
 * The organiser dashboard's Events tab (/dashboard/events; Latte's frames 433:7341, 492:14821,
 * 492:15144): "Your events" and "Drafts, live and past events." with Create event; the filter chips
 * with their counts (All · 6, Live · 3, Drafts · 2, Past · 1); and the event cards, three across at a
 * desktop (from col-lg), two from 640px, one on phones. Each card is Latte's event card: its status
 * (Live, Sold out, Draft, Ended, and the undrawn In review, Changes needed, Unpublished in the same
 * pill), date and place, sales, and Manage → (Continue → while it's being made). What the list always
 * said stays on the card: Sheltüh's note and the next step for the undrawn states, and the paid-draft
 * payouts line; its other actions (View public page, Orders, Analytics, Check-in) are in the card's
 * "···" menu until the Manage tabs (plan OD-13) hold them.
 *
 * Not drawn, in the same pieces: loading, an error with Try again, no events at all (Create your
 * first event), an empty filter, and more than a page (Load more). The no-logo and payouts prompts
 * the list has had sit above the chips as notes.
 */
export default function EventsContent({ initialFilter }: { initialFilter: OrganiserEventFilter }) {
  return (
    <OrganiserGate title="Your events" signInText="Sign in to see your events.">
      {(organiser) => <Events organiser={organiser} initialFilter={initialFilter} />}
    </OrganiserGate>
  );
}

function Events({ organiser, initialFilter }: { organiser: OrganiserRecord; initialFilter: OrganiserEventFilter }) {
  const auth = useAuth();
  const getToken = auth.getAccessToken;
  const [filter, setFilter] = useState<OrganiserEventFilter>(initialFilter);
  const [attempt, setAttempt] = useState(0);
  const [load, setLoad] = useState<Load>({ status: "loading" });
  const [counts, setCounts] = useState<OrganiserEventCounts | null>(null);
  const [more, setMore] = useState<{ loading: boolean; error: string | null }>({ loading: false, error: null });
  const [now] = useState(() => new Date());
  /** A chip was pressed: what it shows is said once it's loaded (not on arrival: the page's heading says where you are). */
  const [chose, setChose] = useState(false);
  // The newest request: a page that lands after the filter changed again is dropped.
  const requestRef = useRef(0);

  useEffect(() => {
    const request = ++requestRef.current;
    const controller = new AbortController();
    getOrganiserEventsSummary(getToken, { filter, signal: controller.signal })
      .then((page) => {
        if (request !== requestRef.current) return;
        setLoad({ status: "ready", items: page.items, nextCursor: page.nextCursor, counts: page.counts });
        setCounts(page.counts);
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted || request !== requestRef.current) return;
        setLoad({ status: "error", message: err instanceof Error ? err.message : "Something went wrong." });
      });
    return () => controller.abort();
  }, [getToken, filter, attempt]);

  function choose(next: OrganiserEventFilter) {
    if (next === filter) return;
    setLoad({ status: "loading" });
    setMore({ loading: false, error: null });
    setFilter(next);
    setChose(true);
    showFilterInAddress(next);
  }

  function retry() {
    setLoad({ status: "loading" });
    setAttempt((n) => n + 1);
  }

  function loadMore() {
    if (load.status !== "ready" || !load.nextCursor) return;
    const request = requestRef.current;
    setMore({ loading: true, error: null });
    getOrganiserEventsSummary(getToken, { filter, cursor: load.nextCursor })
      .then((page) => {
        if (request !== requestRef.current) return;
        setLoad((current) => {
          if (current.status !== "ready") return current;
          const seen = new Set(current.items.map((item) => item.eventId));
          return {
            status: "ready",
            items: [...current.items, ...page.items.filter((item) => !seen.has(item.eventId))],
            nextCursor: page.nextCursor,
            counts: page.counts,
          };
        });
        setCounts(page.counts);
        setMore({ loading: false, error: null });
      })
      .catch((err: unknown) => {
        if (request !== requestRef.current) return;
        setMore({ loading: false, error: err instanceof Error ? err.message : "Couldn’t load more events." });
      });
  }

  const payoutsEnabled = organiser.payoutsEnabled === true;
  const chosen = FILTERS.find((item) => item.filter === filter) ?? FILTERS[0];
  const noEventsAtAll = counts !== null && counts.all === 0;

  return (
    <div data-events-tab="" className="flex flex-col gap-6">
      <AccountPageHead
        title="Your events"
        intro="Drafts, live and past events."
        action={
          noEventsAtAll ? undefined : (
            <DashButtonLink href={NEW_EVENT_HREF} variant="primary" className="pointer-coarse:min-h-11">
              Create event
            </DashButtonLink>
          )
        }
      />
      {!organiser.logoUrl && (
        <div data-logo-prompt="" className={NOTE}>
          <p className="font-semibold">Add your logo</p>
          <DashButtonLink href={ADD_LOGO_HREF} variant="outline" className="pointer-coarse:min-h-11">
            Add logo
          </DashButtonLink>
        </div>
      )}
      {!payoutsEnabled && (
        <p data-payouts-note="" className={NOTE}>
          <span>
            <Link href="/dashboard/payouts" className="font-semibold underline underline-offset-4 hover:decoration-2">
              Set up payouts
            </Link>{" "}
            before publishing paid events.
          </span>
        </p>
      )}
      {!noEventsAtAll && (
        <div role="group" aria-label="Show" className="flex flex-wrap gap-2">
          {FILTERS.map((item) => (
            <DashChip
              key={item.filter}
              pressed={item.filter === filter}
              onClick={() => choose(item.filter)}
              data-events-filter={item.filter}
              className="pointer-coarse:min-h-11"
            >
              {item.label}
              {counts && (
                <>
                  {" "}
                  <span aria-hidden="true">·</span> {formatCount(counts[item.filter])}
                </>
              )}
            </DashChip>
          ))}
        </div>
      )}
      {/* What the chips now show, said once it's loaded (the grid changing isn't announced on its own). */}
      <p role="status" className="sr-only">
        {chose && load.status === "ready" && !noEventsAtAll ? `Showing ${chosen.shown(load.counts[filter])}.` : ""}
      </p>
      {load.status === "loading" && <LoadingState text="Loading your events…" />}
      {load.status === "error" && (
        <div data-events-error="" className="flex flex-col items-start gap-4 rounded-card border border-surface-border p-6">
          <div role="alert" className="flex flex-col gap-1">
            <p className="label-button">Your events couldn’t load.</p>
            <p className="body-s text-muted">{load.message}</p>
          </div>
          <DashButton variant="outline" onClick={retry} className="pointer-coarse:min-h-11">
            Try again
          </DashButton>
        </div>
      )}
      {load.status === "ready" &&
        (noEventsAtAll ? (
          <div data-events-empty="all" className="flex flex-col items-start gap-4 rounded-card border border-surface-border bg-card p-6">
            <div className="flex flex-col gap-1">
              <h2 className="label-button">No events yet</h2>
              <p className="body-s text-muted">Create your first event: it’s saved as a draft until you publish it.</p>
            </div>
            <DashButtonLink href={NEW_EVENT_HREF} variant="primary" className="pointer-coarse:min-h-11">
              Create your first event
            </DashButtonLink>
          </div>
        ) : load.items.length === 0 ? (
          <p data-events-empty={filter} className="body-m rounded-card border border-surface-border p-6 text-muted">
            {chosen.empty}
          </p>
        ) : (
          <>
            <ul className="grid grid-cols-1 gap-6 sm:grid-cols-2 col-lg:grid-cols-3">
              {load.items.map((event) => (
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
            {load.nextCursor && (
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
