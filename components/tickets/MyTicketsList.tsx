"use client";

import Link from "next/link";
import { useEffect, useEffectEvent, useRef, useState, useSyncExternalStore, type ReactNode, type Ref } from "react";
import DemoNotice from "@/components/DemoNotice";
import EventArt from "@/components/EventArt";
import { SAVED_GRID, SHOW_MORE_CLASS } from "@/components/favourites/SavedPageContent";
import TicketCard from "@/components/tickets/TicketCard";
import { Button, ButtonLink } from "@/components/ui/Button";
import { EmptyState, Notice } from "@/components/ui/Section";
import { ApiError, isApiConfigured, type GetToken } from "@/lib/api/client";
import { listMyTickets } from "@/lib/api/me";
import type { MyTicketItem, MyTicketSection, MyTicketsPage } from "@/lib/api/types";
import { accountKey } from "@/lib/auth/account";
import { SessionExpiredError, useAuth } from "@/lib/auth/AuthContext";
import { assignPoster } from "@/lib/live/assign-poster";
import { mergeMyTickets, myTicketCard, myTicketKey, showMoreCount, showMoreSection, splitMyTickets } from "@/lib/my-tickets";
import { MY_TICKETS_HREF } from "@/lib/my-tickets-href";
import { withNext } from "@/lib/safe-next-path";
import { sampleEvents } from "@/lib/sample-events";
import { sampleMyTickets } from "@/lib/sample-order";

/** Back on the tab after this long, the list is read again (a card may have moved to Past, or a ticket arrived). */
export const REFRESH_AFTER_MS = 30_000;

type Failure = "signed-out" | "unverified" | "failed";

/** What a failed read means here: the session ended, the email isn't verified yet (403), or anything else. */
function failureOf(error: unknown): Failure {
  if (error instanceof SessionExpiredError || (error instanceof ApiError && error.status === 401)) return "signed-out";
  if (error instanceof ApiError && error.status === 403) return "unverified";
  return "failed";
}

/** What the status line says when the list arrives. */
function countsMessage(counts: MyTicketsPage["counts"]): string {
  return counts.upcoming + counts.past === 0 ? "No tickets yet." : `Your tickets: ${counts.upcoming} upcoming, ${counts.past} past.`;
}

/**
 * /tickets, My tickets (docs/design/my-ticket.md §5.14): the signed-in
 * member's orders (by their verified email) and the tickets sent to them,
 * from GET /api/me/tickets, in two lists, Upcoming and Past. The demo shows
 * sample cards (lib/sample-order.ts sampleMyTickets).
 *
 * One status line (polite, always there, outside anything busy) says what's
 * happening: loading, the counts when the list arrives, more shown, updated.
 */
export default function MyTicketsList() {
  const auth = useAuth();
  const [message, setMessage] = useState("");
  const demo = !isApiConfigured || !auth.configured;
  const said = demo || auth.status === "signed-out" ? "" : auth.status === "loading" ? "Loading your tickets…" : message;
  return (
    <>
      <p role="status" data-my-tickets-status="" className="sr-only">
        {said}
      </p>
      {demo ? (
        <DemoTickets />
      ) : auth.status === "loading" ? (
        <TicketsLoading />
      ) : auth.status === "signed-out" ? (
        <SignedOut />
      ) : (
        <LiveTickets key={accountKey(auth) ?? ""} getToken={auth.getAccessToken} email={auth.email} announce={setMessage} />
      )}
    </>
  );
}

const noSubscription = () => () => undefined;

/**
 * The demo's samples are dated from now, so they're drawn in the browser only: /tickets is a static page, and
 * dates made when it was built would differ from the browser's when it hydrates. The card shapes until then.
 */
function DemoTickets() {
  const mounted = useSyncExternalStore(
    noSubscription,
    () => true,
    () => false,
  );
  return mounted ? <DemoList /> : <TicketsLoading />;
}

function DemoList() {
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
  /** `pages`: how many pages are in (1, then one more for each "Show more"). */
  | { status: "ready"; items: MyTicketItem[]; counts: MyTicketsPage["counts"]; nextCursor?: string; pages: number };

/**
 * Where focus goes once the list has drawn what changed (a control that had it may be gone):
 * - `start`: the list's first place: the Upcoming heading, the "No tickets yet." line, a state's title, or Try again.
 * - `card`: a card's link (the first new card after Show more, or the one focused before a refresh); if it's
 *   gone, its section's heading. `kept`: the element focused before; nothing moves while it's still there.
 * - `section`: a section's heading.
 * - `more`: the Show more button, else its section's heading (a page that brought nothing).
 */
type FocusRequest =
  | { to: "start" }
  | { to: "card"; key: string; section: MyTicketSection; kept?: Element }
  | { to: "section"; section: MyTicketSection; kept?: Element }
  | { to: "more"; section: MyTicketSection };

function LiveTickets({ getToken, email, announce }: { getToken: GetToken; email?: string; announce: (message: string) => void }) {
  const [load, setLoad] = useState<Load>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);
  const [more, setMore] = useState<"idle" | "loading" | "failed">("idle");
  const [refreshFailed, setRefreshFailed] = useState(false);
  const [now, setNow] = useState(() => new Date());
  const loadedAt = useRef(0);
  const busy = useRef<AbortController | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const stateTitleRef = useRef<HTMLHeadingElement>(null);
  const focusRequest = useRef<FocusRequest | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    busy.current = controller;
    announce("Loading your tickets…");
    listMyTickets(getToken, { signal: controller.signal }).then(
      (page) => {
        if (controller.signal.aborted) return;
        loadedAt.current = Date.now();
        setNow(new Date());
        setLoad({ status: "ready", items: page.items, counts: page.counts, nextCursor: page.nextCursor, pages: 1 });
        announce(countsMessage(page.counts));
      },
      (error: unknown) => {
        if (controller.signal.aborted) return;
        setLoad({ status: "failed", failure: failureOf(error) });
        announce("");
      },
    );
    return () => controller.abort();
  }, [getToken, attempt, announce]);

  // Leaving the page: a refresh or "Show more" still on its way is dropped.
  useEffect(() => () => busy.current?.abort(), []);

  // Focus, once what changed is drawn.
  useEffect(() => {
    const request = focusRequest.current;
    const root = rootRef.current;
    if (!request || !root || load.status === "loading") return;
    focusRequest.current = null;
    if ("kept" in request && request.kept?.isConnected && document.activeElement === request.kept) return;
    const find = (selector: string) => root.querySelector<HTMLElement>(selector);
    const heading = (section: MyTicketSection) => find(`#my-tickets-${section}`);
    const start = () => stateTitleRef.current ?? find("[data-my-tickets-focus]");
    const target =
      request.to === "card"
        ? (find(`[data-my-ticket="${CSS.escape(request.key)}"] a`) ?? heading(request.section) ?? heading("upcoming") ?? start())
        : request.to === "section"
          ? (heading(request.section) ?? heading("upcoming") ?? start())
          : request.to === "more"
            ? (find("[data-my-tickets-more]") ?? heading(request.section) ?? start())
            : start();
    target?.focus();
  }, [load, more]);

  /** The list was replaced by a signed-out or unverified state: its title takes focus, and says it. */
  function lost(failure: Failure) {
    focusRequest.current = { to: "start" };
    setMore("idle");
    setLoad({ status: "failed", failure });
    announce("");
  }

  /**
   * The first page again, quietly: the cards stay up meanwhile. Automatic (back on the tab after a while, or
   * back from the browser's cache) only while just the first page is in: the pages are offsets, so a refresh
   * starts the list over, and it mustn't take away cards someone asked for with Show more. `manual`: the
   * refresh note's Try again, which always runs.
   */
  function refresh(how: "auto" | "auto-now" | "manual") {
    if (load.status !== "ready" || more === "loading") return;
    if (how !== "manual" && load.pages > 1) return;
    if (how === "auto" && Date.now() - loadedAt.current < REFRESH_AFTER_MS) return;
    const before = load;
    busy.current?.abort();
    const controller = new AbortController();
    busy.current = controller;
    listMyTickets(getToken, { signal: controller.signal }).then(
      (page) => {
        if (controller.signal.aborted) return;
        loadedAt.current = Date.now();
        const changed = JSON.stringify([page.items, page.counts]) !== JSON.stringify([before.items, before.counts]);
        if (how === "manual") {
          // Its button goes with the note: the list's first heading takes focus.
          focusRequest.current = { to: "section", section: "upcoming" };
          announce("Tickets updated.");
        } else if (changed) {
          // Focus stays on its card (found again if it moved to the other list), else goes to its list's heading.
          const focused = document.activeElement;
          const card = focused instanceof HTMLElement && rootRef.current?.contains(focused) ? focused.closest<HTMLElement>("[data-my-ticket]") : null;
          const section = (card?.closest("section")?.getAttribute("aria-labelledby")?.replace("my-tickets-", "") ?? "upcoming") as MyTicketSection;
          if (card?.dataset.myTicket) focusRequest.current = { to: "card", key: card.dataset.myTicket, section, kept: focused ?? undefined };
          else if (focused && rootRef.current?.contains(focused)) focusRequest.current = { to: "section", section, kept: focused };
          announce("Your tickets were updated.");
        }
        if (!changed && how !== "manual") return;
        setNow(new Date());
        setRefreshFailed(false);
        setLoad({ status: "ready", items: page.items, counts: page.counts, nextCursor: page.nextCursor, pages: 1 });
      },
      (error: unknown) => {
        if (controller.signal.aborted) return;
        const failure = failureOf(error);
        // Signed out or unverified meanwhile: that's the page now. Otherwise the cards stay, with a note.
        if (failure === "failed") setRefreshFailed(true);
        else lost(failure);
      },
    );
  }
  const onReturn = useEffectEvent((how: "auto" | "auto-now") => refresh(how));

  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "visible") onReturn("auto");
    };
    const onPageShow = (event: PageTransitionEvent) => {
      if (event.persisted) onReturn("auto-now");
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
    const before = load;
    const cursor = before.nextCursor;
    const section = showMoreSection(before.items, true) ?? "upcoming";
    setMore("loading");
    announce("Loading more tickets…");
    // A quiet refresh on its way would start the list over under this page: this page wins.
    busy.current?.abort();
    const controller = new AbortController();
    busy.current = controller;
    listMyTickets(getToken, { cursor, signal: controller.signal }).then(
      (page) => {
        if (controller.signal.aborted) return;
        const items = mergeMyTickets(before.items, page.items);
        const added = items.slice(before.items.length);
        if (added[0]) {
          focusRequest.current = { to: "card", key: myTicketKey(added[0]), section: added[0].section };
          announce(`${added.length} more ${added.length === 1 ? "ticket" : "tickets"} shown.`);
        } else {
          focusRequest.current = { to: "more", section };
          announce("No more tickets.");
        }
        setMore("idle");
        setLoad({ status: "ready", items, counts: page.counts, nextCursor: page.nextCursor, pages: before.pages + 1 });
      },
      (error: unknown) => {
        if (controller.signal.aborted) return;
        const failure = failureOf(error);
        if (failure !== "failed") return lost(failure);
        setMore("failed");
        announce("");
      },
    );
  }

  function retry() {
    focusRequest.current = { to: "start" };
    setLoad({ status: "loading" });
    setMore("idle");
    setRefreshFailed(false);
    setAttempt((n) => n + 1);
  }

  let content: ReactNode;
  if (load.status === "loading") content = <TicketsLoading />;
  else if (load.status === "failed") {
    content =
      load.failure === "signed-out" ? (
        <SignedOut ended titleRef={stateTitleRef} />
      ) : load.failure === "unverified" ? (
        <EmptyState
          title="Verify your email to see your tickets"
          headingLevel={2}
          titleRef={stateTitleRef}
          mark={false}
          action={
            <ButtonLink size="lg" href={withNext("/verify", MY_TICKETS_HREF, email ? { email } : {})}>
              Verify your email
            </ButtonLink>
          }
        >
          Your tickets are found by the email you bought them with, so it needs verifying first.
        </EmptyState>
      ) : (
        <div className="flex flex-col items-start gap-3">
          <Notice tone="danger" role="alert">
            Couldn&rsquo;t load your tickets. Check your connection, then try again.
          </Notice>
          <Button variant="outline" size="lg" onClick={retry} data-my-tickets-focus="">
            Try again
          </Button>
        </div>
      );
  } else {
    const section = showMoreSection(load.items, Boolean(load.nextCursor));
    content = (
      <>
        {refreshFailed && (
          <div className="flex flex-col items-start gap-3">
            <Notice tone="danger" role="alert">
              Couldn&rsquo;t check for changes. These are your tickets as they were.
            </Notice>
            <button type="button" onClick={() => refresh("manual")} className={SHOW_MORE_CLASS}>
              Try again
            </button>
          </div>
        )}
        <TicketLists
          items={load.items}
          counts={load.counts}
          now={now}
          more={{ section, count: showMoreCount(load.counts, load.items.length), state: more, onShowMore: showMore }}
        />
      </>
    );
  }

  return (
    <div ref={rootRef} className="flex flex-col gap-6">
      {content}
    </div>
  );
}

/** Signed out (or the session ended): sign in, back here; or the email from checkout, which needs no account. */
function SignedOut({ ended = false, titleRef }: { ended?: boolean; titleRef?: Ref<HTMLHeadingElement> }) {
  return (
    <EmptyState
      title={ended ? "Sign in again to see your tickets" : "Sign in to see your tickets"}
      headingLevel={2}
      titleRef={titleRef}
      action={
        <ButtonLink size="lg" href={withNext("/login", MY_TICKETS_HREF)}>
          Sign in
        </ButtonLink>
      }
    >
      Bought without an account? Check your email: your tickets went to the address you used at checkout.
    </EmptyState>
  );
}

/** Three cards' shapes while the list loads (no shimmer); the status line says it. */
function TicketsLoading() {
  return (
    <div aria-busy="true" className="flex flex-col gap-4">
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
  /** "Show 20 more"; null: "Show more". */
  count: number | null;
  state: "idle" | "loading" | "failed";
  onShowMore: () => void;
}

/** The two lists, Upcoming then Past, with "Show more" under the one the last card loaded is in. */
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
  const total = counts.upcoming + counts.past;
  if (total === 0 && items.length === 0 && !more?.section) {
    return (
      <div className="flex flex-col items-start gap-4">
        <div className="flex flex-col gap-1">
          <p tabIndex={-1} data-my-tickets-focus="" className="body-m outline-offset-2">
            No tickets yet.
          </p>
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
          data-my-tickets-more=""
          aria-disabled={more.state === "loading" ? true : undefined}
          onClick={() => {
            if (more.state !== "loading") more.onShowMore();
          }}
          className={SHOW_MORE_CLASS}
        >
          {more.state === "failed" ? "Try again" : more.state === "loading" ? "Loading…" : more.count ? `Show ${more.count} more` : "Show more"}
        </button>
      </div>
    ) : null;
  // The pages walk the upcoming cards first: until one past card is in (or the list is), Past waits, its count
  // in its heading.
  const pastReached = lists.past.length > 0 || !more?.section;

  return (
    <div className="mt-6 flex flex-col gap-12">
      <TicketSection id="my-tickets-upcoming" title="Upcoming" count={counts.upcoming} first>
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
      {(counts.past > 0 || lists.past.length > 0) && (
        <TicketSection id="my-tickets-past" title="Past" count={counts.past}>
          {pastReached ? (
            <CardGrid items={lists.past} now={now} demo={demo} />
          ) : (
            <p className="body-s text-muted">Show all your upcoming tickets to see these.</p>
          )}
          {showMore("past")}
        </TicketSection>
      )}
    </div>
  );
}

/** A list and its heading, "Upcoming · 3": focusable by script (tabIndex -1) when what had focus goes. */
function TicketSection({
  id,
  title,
  count,
  first = false,
  children,
}: {
  id: string;
  title: string;
  count: number;
  /** The list's first place (focused after a retry). */
  first?: boolean;
  children: ReactNode;
}) {
  return (
    <section aria-labelledby={id} className="flex flex-col gap-4">
      <h2 id={id} tabIndex={-1} data-my-tickets-focus={first ? "" : undefined} className="text-xl leading-7 font-semibold text-foreground outline-offset-2">
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
