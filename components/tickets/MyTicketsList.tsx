"use client";

import Link from "next/link";
import { useEffect, useEffectEvent, useRef, useState, type ReactNode } from "react";
import DemoNotice from "@/components/DemoNotice";
import EventArt from "@/components/EventArt";
import { SAVED_GRID } from "@/components/favourites/SavedPageContent";
import TicketCard from "@/components/tickets/TicketCard";
import { Button, ButtonLink } from "@/components/ui/Button";
import { EmptyState, Notice } from "@/components/ui/Section";
import { ApiError, isApiConfigured, type GetToken } from "@/lib/api/client";
import { listMyTickets } from "@/lib/api/me";
import type { MyTicketItem, MyTicketSection, MyTicketsPage } from "@/lib/api/types";
import { accountKey } from "@/lib/auth/account";
import { SessionExpiredError, useAuth } from "@/lib/auth/AuthContext";
import { assignPoster } from "@/lib/live/assign-poster";
import { MY_TICKETS_PATH, mergeMyTickets, myTicketCard, showMoreSection, splitMyTickets } from "@/lib/my-tickets";
import { withNext } from "@/lib/safe-next-path";
import { sampleEvents } from "@/lib/sample-events";
import { sampleMyTickets } from "@/lib/sample-order";

/** Back on the tab after this long, the list is read again (a card may have moved to Past, or a ticket arrived). */
export const REFRESH_AFTER_MS = 30_000;

/** "Show more" and Try again: the Saved page's small outline button, 44px to touch. */
const SMALL_BUTTON_CLASS =
  "label-tag relative inline-flex h-10 items-center rounded-control border-control border-foreground bg-background px-5 text-foreground after:absolute after:-inset-y-0.5 after:inset-x-0 after:content-[''] hover:bg-foreground hover:text-background focus-visible:bg-foreground focus-visible:text-background aria-disabled:cursor-wait motion-safe:transition-colors motion-safe:duration-200 motion-safe:ease-out";

type Failure = "signed-out" | "unverified" | "failed";

/** What a failed read means here: the session ended, the email isn't verified yet (403), or anything else. */
function failureOf(error: unknown): Failure {
  if (error instanceof SessionExpiredError || (error instanceof ApiError && error.status === 401)) return "signed-out";
  if (error instanceof ApiError && error.status === 403) return "unverified";
  return "failed";
}

/**
 * /tickets, My tickets (docs/design/my-ticket.md §5.14): the signed-in
 * member's orders (by their verified email) and the tickets sent to them,
 * from GET /api/me/tickets, in two lists, Upcoming and Past. The demo shows
 * sample cards (lib/sample-order.ts sampleMyTickets).
 */
export default function MyTicketsList() {
  const auth = useAuth();
  if (!isApiConfigured || !auth.configured) return <DemoTickets />;
  if (auth.status === "loading") return <TicketsLoading />;
  if (auth.status === "signed-out") return <SignedOut />;
  return <LiveTickets key={accountKey(auth) ?? ""} getToken={auth.getAccessToken} email={auth.email} />;
}

function DemoTickets() {
  const [page] = useState(() => sampleMyTickets(Date.now()));
  const [now] = useState(() => new Date());
  return (
    <div className="flex flex-col gap-6">
      <DemoNotice>Sample tickets. Nothing here is a real order.</DemoNotice>
      <TicketLists items={page.items} counts={page.counts} now={now} demo />
    </div>
  );
}

type Load =
  | { status: "loading" }
  | { status: "failed"; failure: Failure }
  | { status: "ready"; items: MyTicketItem[]; counts: MyTicketsPage["counts"]; nextCursor?: string };

function LiveTickets({ getToken, email }: { getToken: GetToken; email?: string }) {
  const [load, setLoad] = useState<Load>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);
  const [more, setMore] = useState<"idle" | "loading" | "failed">("idle");
  const [refreshFailed, setRefreshFailed] = useState(false);
  const [now, setNow] = useState(() => new Date());
  const loadedAt = useRef(0);
  const busy = useRef<AbortController | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    busy.current = controller;
    listMyTickets(getToken, { signal: controller.signal }).then(
      (page) => {
        loadedAt.current = Date.now();
        setNow(new Date());
        setLoad({ status: "ready", items: page.items, counts: page.counts, nextCursor: page.nextCursor });
      },
      (error: unknown) => {
        if (!controller.signal.aborted) setLoad({ status: "failed", failure: failureOf(error) });
      },
    );
    return () => controller.abort();
  }, [getToken, attempt]);

  // Leaving the page: a refresh or "Show more" still on its way is dropped.
  useEffect(() => () => busy.current?.abort(), []);

  // Back on the tab (or back to this page from the browser's cache) a while later: the first page again, quietly
  // (the cards stay up meanwhile). The pages are offsets, so the list starts over rather than patching.
  function refresh(force: boolean) {
    if (load.status !== "ready" || more === "loading") return;
    if (!force && Date.now() - loadedAt.current < REFRESH_AFTER_MS) return;
    busy.current?.abort();
    const controller = new AbortController();
    busy.current = controller;
    listMyTickets(getToken, { signal: controller.signal }).then(
      (page) => {
        loadedAt.current = Date.now();
        setNow(new Date());
        setRefreshFailed(false);
        setMore("idle");
        setLoad({ status: "ready", items: page.items, counts: page.counts, nextCursor: page.nextCursor });
      },
      (error: unknown) => {
        if (controller.signal.aborted) return;
        const failure = failureOf(error);
        // Signed out or unverified meanwhile: that's the page now. Otherwise the cards stay, with a note.
        if (failure === "failed") setRefreshFailed(true);
        else setLoad({ status: "failed", failure });
      },
    );
  }
  const onReturn = useEffectEvent((force: boolean) => refresh(force));

  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "visible") onReturn(false);
    };
    const onPageShow = (event: PageTransitionEvent) => {
      if (event.persisted) onReturn(true);
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("pageshow", onPageShow);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("pageshow", onPageShow);
    };
  }, []);

  function showMore() {
    if (load.status !== "ready" || !load.nextCursor || more === "loading") return;
    const cursor = load.nextCursor;
    setMore("loading");
    // A quiet refresh on its way would start the list over under this page: this page wins.
    busy.current?.abort();
    const controller = new AbortController();
    busy.current = controller;
    listMyTickets(getToken, { cursor, signal: controller.signal }).then(
      (page) => {
        setMore("idle");
        setLoad((current) =>
          current.status === "ready"
            ? { status: "ready", items: mergeMyTickets(current.items, page.items), counts: page.counts, nextCursor: page.nextCursor }
            : current,
        );
      },
      (error: unknown) => {
        if (controller.signal.aborted) return;
        const failure = failureOf(error);
        if (failure === "failed") setMore("failed");
        else setLoad({ status: "failed", failure });
      },
    );
  }

  function retry() {
    setLoad({ status: "loading" });
    setMore("idle");
    setRefreshFailed(false);
    setAttempt((n) => n + 1);
  }

  if (load.status === "loading") return <TicketsLoading />;
  if (load.status === "failed") {
    if (load.failure === "signed-out") return <SignedOut ended />;
    if (load.failure === "unverified") {
      return (
        <EmptyState
          title="Confirm your email to see your tickets"
          mark={false}
          action={
            <ButtonLink size="lg" href={withNext("/verify", MY_TICKETS_PATH, email ? { email } : {})}>
              Verify your email
            </ButtonLink>
          }
        >
          Your tickets are found by the email you bought them with, so it needs confirming first.
        </EmptyState>
      );
    }
    return (
      <div className="flex flex-col items-start gap-3">
        <Notice tone="danger" role="alert">
          Couldn&rsquo;t load your tickets.
        </Notice>
        <Button variant="outline" size="lg" onClick={retry}>
          Try again
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      {refreshFailed && (
        <div className="flex flex-col items-start gap-3">
          <Notice tone="danger" role="alert">
            Couldn&rsquo;t check for changes. These are your tickets as they were.
          </Notice>
          <button type="button" onClick={() => refresh(true)} className={SMALL_BUTTON_CLASS}>
            Try again
          </button>
        </div>
      )}
      <TicketLists
        items={load.items}
        counts={load.counts}
        now={now}
        more={{ section: showMoreSection(load, load.items, Boolean(load.nextCursor)), state: more, onShowMore: showMore }}
      />
    </div>
  );
}

/** Signed out (or the session ended): sign in, back here; or the email from checkout, which needs no account. */
function SignedOut({ ended = false }: { ended?: boolean }) {
  return (
    <EmptyState
      title={ended ? "Sign in again to see your tickets" : "Sign in to see your tickets"}
      action={
        <ButtonLink size="lg" href={withNext("/login", MY_TICKETS_PATH)}>
          Sign in
        </ButtonLink>
      }
    >
      Bought without an account? Check your email: your tickets went to the address you used at checkout.
    </EmptyState>
  );
}

/** Three cards' shapes while the list loads (no shimmer), said once to screen readers. */
function TicketsLoading() {
  return (
    <div aria-busy="true" className="flex flex-col gap-4">
      <p role="status" className="sr-only">
        Loading your tickets…
      </p>
      <div className="h-7 w-40 rounded-badge bg-surface" aria-hidden="true" />
      <ul aria-hidden="true" className={SAVED_GRID} data-my-tickets-loading="">
        {[0, 1, 2].map((i) => (
          <li key={i} className="flex flex-col gap-4 rounded-card border border-surface-border bg-card p-4">
            <div className="flex items-center gap-4">
              <div className="size-22 shrink-0 rounded-control bg-surface" />
              <div className="flex min-w-0 flex-1 flex-col gap-2">
                <div className="h-4 w-24 max-w-full rounded-badge bg-surface" />
                <div className="h-6 w-full rounded-badge bg-surface" />
                <div className="h-4 w-32 max-w-full rounded-badge bg-surface" />
              </div>
            </div>
            <div className="h-4 w-40 max-w-full rounded-badge bg-surface" />
            <div className="h-14 w-full rounded-control bg-surface" />
          </li>
        ))}
      </ul>
    </div>
  );
}

interface MoreControls {
  /** Where "Show more" sits; null once everything is in. */
  section: MyTicketSection | null;
  state: "idle" | "loading" | "failed";
  onShowMore: () => void;
}

/** The two lists, Upcoming then Past, with "Show more" under the one the next page continues. */
function TicketLists({
  items,
  counts,
  now,
  demo = false,
  more,
}: {
  items: MyTicketItem[];
  counts: MyTicketsPage["counts"];
  now: Date;
  demo?: boolean;
  more?: MoreControls;
}) {
  const [announcement, setAnnouncement] = useState("");
  const pendingFocus = useRef<string | null>(null);
  const listsRef = useRef<HTMLDivElement>(null);
  const shownBefore = useRef(items.length);

  // After "Show more", focus goes to the first card that came in (its link), and the new total is said.
  useEffect(() => {
    if (items.length > shownBefore.current) {
      const added = items.length - shownBefore.current;
      const first = items[shownBefore.current];
      shownBefore.current = items.length;
      if (pendingFocus.current !== null && first) {
        pendingFocus.current = null;
        const key = myTicketCard(first, now).key;
        const target = listsRef.current?.querySelector<HTMLElement>(`[data-my-ticket="${CSS.escape(key)}"] a`);
        target?.focus();
        setAnnouncement(`${added} more ${added === 1 ? "ticket" : "tickets"} shown.`);
      }
    } else {
      shownBefore.current = items.length;
    }
  }, [items, now]);

  const total = counts.upcoming + counts.past;
  if (total === 0 && items.length === 0 && !more?.section) {
    return (
      <div className="flex flex-col items-start gap-4">
        <div className="flex flex-col gap-1">
          <p className="body-m">No tickets yet.</p>
          {!demo && <p className="body-s text-muted">Tickets bought with another email address aren&rsquo;t listed here.</p>}
        </div>
        <ButtonLink variant="outline" href="/events">
          Find an event
        </ButtonLink>
      </div>
    );
  }

  const lists = splitMyTickets(items);
  const showMore = (section: MyTicketSection) =>
    more?.section === section ? (
      <div className="flex flex-col items-start gap-3">
        {more.state === "failed" && (
          <Notice tone="danger" role="alert">
            Couldn&rsquo;t load more tickets.
          </Notice>
        )}
        <button
          type="button"
          aria-disabled={more.state === "loading" ? true : undefined}
          onClick={() => {
            if (more.state === "loading") return;
            pendingFocus.current = "";
            more.onShowMore();
          }}
          className={SMALL_BUTTON_CLASS}
        >
          {more.state === "failed" ? "Try again" : more.state === "loading" ? "Loading…" : "Show more"}
        </button>
      </div>
    ) : null;
  // The pages walk the upcoming cards first: while some are still to come, Past waits (its count is in its heading).
  const pastReached = more?.section !== "upcoming";

  return (
    <div ref={listsRef} className="mt-6 flex flex-col gap-12">
      <TicketSection id="my-tickets-upcoming" title="Upcoming" count={counts.upcoming}>
        {lists.upcoming.length > 0 ? (
          <CardGrid items={lists.upcoming} now={now} demo={demo} />
        ) : (
          more?.section !== "upcoming" && (
            <p className="body-m text-muted">
              Nothing coming up.{" "}
              <Link href="/events" className="font-semibold text-foreground underline underline-offset-4 hover:decoration-2">
                Find an event
              </Link>
            </p>
          )
        )}
        {showMore("upcoming")}
      </TicketSection>
      {counts.past > 0 && (
        <TicketSection id="my-tickets-past" title="Past" count={counts.past}>
          {pastReached ? (
            <CardGrid items={lists.past} now={now} demo={demo} />
          ) : (
            <p className="body-s text-muted">They&rsquo;re listed once all your upcoming tickets are shown.</p>
          )}
          {showMore("past")}
        </TicketSection>
      )}
      <p role="status" className="sr-only">
        {more?.state === "loading" ? "Loading more tickets…" : announcement}
      </p>
    </div>
  );
}

function TicketSection({ id, title, count, children }: { id: string; title: string; count: number; children: ReactNode }) {
  return (
    <section aria-labelledby={id} className="flex flex-col gap-4">
      <h2 id={id} className="text-xl leading-7 font-semibold text-foreground">
        {title}
        <span aria-hidden="true">&nbsp;·</span>
        <span className="sr-only">,</span> {count}
      </h2>
      {children}
    </section>
  );
}

function CardGrid({ items, now, demo }: { items: MyTicketItem[]; now: Date; demo: boolean }) {
  if (items.length === 0) return null;
  return (
    <ul className={SAVED_GRID}>
      {items.map((item) => {
        const card = myTicketCard(item, now);
        return (
          <li key={card.key} data-my-ticket={card.key} className="flex min-w-0 flex-col">
            <TicketCard
              state={card.state}
              when={card.when}
              eventTitle={card.eventTitle}
              venue={card.venue}
              image={<CardArt item={item} demo={demo} />}
              holder={card.holder}
              count={card.count}
              status={card.status}
              showTicket={card.action.kind === "show" ? { href: card.href } : undefined}
              statusAction={card.action.kind === "status" ? { href: card.href, label: card.action.label } : undefined}
              nameActionsByEvent
              className="h-full"
            />
          </li>
        );
      })}
    </ul>
  );
}

/** The event's photo or generated art, while it's listed; nothing (TicketCard's muted square) otherwise. */
function CardArt({ item, demo }: { item: MyTicketItem; demo: boolean }) {
  const slug = item.eventListed ? item.eventSlug : undefined;
  if (!slug) return null;
  // The demo's samples have their own art; a live event's is generated from its slug, as everywhere else.
  const poster = (demo ? sampleEvents.find((event) => event.slug === slug)?.poster : undefined) ?? assignPoster(slug);
  return <EventArt poster={poster} title={item.eventTitle} imageUrl={item.imageUrl} imageFocus={item.imageFocus} className="size-full" />;
}
