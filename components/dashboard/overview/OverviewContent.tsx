"use client";

import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import JoinedWelcome, { useJoinedWelcome } from "@/components/dashboard/JoinedWelcome";
import OrganiserGate from "@/components/dashboard/OrganiserGate";
import OrgEventCard from "@/components/dashboard/OrgEventCard";
import { DashButton, DashButtonLink } from "@/components/dashboard/ui/DashButton";
import { DASH_MAIN_BLEED, DASH_MAIN_INLINE } from "@/components/dashboard/ui/DashFrame";
import { useDashFrame } from "@/components/dashboard/ui/DashFrameContext";
import { useToday } from "@/components/dashboard/useToday";
import { LoadingState } from "@/components/ui/ProgressLoader";
import { getOrganiserOverview } from "@/lib/api/organiser-summary";
import type { OrganiserOverview, OrganiserRecord } from "@/lib/api/types";
import { accountKey } from "@/lib/auth/account";
import { useAuth } from "@/lib/auth/AuthContext";
import { useOrganiser } from "@/lib/auth/useOrganiser";
import { useFramedHint } from "@/lib/organiser-frame-hint";
import { isKnownOrganiser, NEW_EVENT_HREF } from "@/lib/organiser-nav";
import { formatLongWeekdayDate } from "@/lib/format";
import DraftsBar from "./DraftsBar";
import HighlightBanner from "./HighlightBanner";
import OverviewStats from "./OverviewStats";
import PerformancePanel from "./PerformancePanel";

/** The Events tab, showing the drafts. */
export const DRAFTS_HREF = "/dashboard/events?filter=drafts";

type Load = { status: "loading" } | { status: "error"; message: string } | { status: "ready"; data: OrganiserOverview };

type OverviewLoad = ReturnType<typeof useOverview>;

/**
 * The Overview's numbers (GET /api/organisers/me/overview) once `enabled`, again on `retry`. While a
 * retry runs the error stays (its Try again busy, so focus isn't lost with it); `retrying` says so.
 */
function useOverview(enabled: boolean) {
  const auth = useAuth();
  const getToken = auth.getAccessToken;
  const [attempt, setAttempt] = useState(0);
  const [retrying, setRetrying] = useState(false);
  const [load, setLoad] = useState<Load>({ status: "loading" });
  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    getOrganiserOverview(getToken, { signal: controller.signal })
      .then((data) => {
        setLoad({ status: "ready", data });
        setRetrying(false);
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        setLoad({ status: "error", message: err instanceof Error ? err.message : "Something went wrong." });
        setRetrying(false);
      });
    return () => controller.abort();
  }, [getToken, attempt, enabled]);
  function retry() {
    setRetrying(true);
    setAttempt((n) => n + 1);
  }
  return { load, retry, retrying };
}

/**
 * The organiser dashboard's Overview (/dashboard; Latte's frames 430:7340, 492:14153, 492:14487):
 * "Welcome back, {name}!" and today's date; the banner for the event selling now; this week's
 * tickets, page views and new followers; the next two events as cards with their sales and
 * "Manage →"; the drafts bar; and the cream Performance column with this week's followers and each
 * live event's sales against the week before. Everything is the organiser's own, from the API's
 * Overview (no buyer data; followers a count only). Latte's grey "3" circle by the greeting is left
 * out: nothing it would count is defined.
 *
 * Not drawn, and so in the frames' own pieces: loading (the site's loader under the greeting), an
 * error (what went wrong and Try again), and a new organiser with nothing yet (no banner or drafts
 * bar, zeros on the cards, an Upcoming card inviting them to create an event, and a line in
 * Performance saying what will show there).
 */
export default function OverviewContent() {
  // One account's from start to finish: the dashboard's frame stays mounted across a sign-out and a
  // switch of accounts (OrganiserShell), so the page starts again for the next account rather than
  // keep the last one's numbers (or its request) on screen.
  const auth = useAuth();
  return <AccountOverview key={accountKey(auth) ?? ""} />;
}

function AccountOverview() {
  // The numbers are asked for alongside the organiser's record rather than after it, for an account
  // that's an approved organiser as far as the page knows (its record, or while that loads, this
  // browser's hint: lib/organiser-nav.ts isKnownOrganiser). The API checks it either way (403 for
  // anyone else), and the gate shows the numbers only to an approved organiser.
  const auth = useAuth();
  const record = useOrganiser();
  const signedIn = auth.configured && auth.status === "signed-in";
  const hinted = useFramedHint(signedIn ? auth.userId : undefined);
  const overview = useOverview(isKnownOrganiser({ signedIn, record, hinted }));
  return (
    <OrganiserGate title="Overview" signInText="Sign in to see your dashboard.">
      {(organiser) => <Overview organiser={organiser} overview={overview} />}
    </OrganiserGate>
  );
}

function Overview({ organiser, overview }: { organiser: OrganiserRecord; overview: OverviewLoad }) {
  const welcome = useJoinedWelcome();
  const framed = useDashFrame() !== null;
  const { load, retry, retrying } = overview;
  const now = useToday();
  const data = load.status === "ready" ? load.data : null;
  const headingRef = useRef<HTMLHeadingElement>(null);
  // After Try again loads the page, focus goes to its heading (Try again itself is gone). In the same
  // commit that removes Try again, so focus is never left on the body.
  const focusOnLoad = useRef(false);
  useLayoutEffect(() => {
    if (load.status !== "ready" || !focusOnLoad.current) return;
    focusOnLoad.current = false;
    headingRef.current?.focus();
  }, [load.status]);
  function tryAgain() {
    focusOnLoad.current = true;
    retry();
  }

  // Inside the frame the page takes back the frame's padding, so the Performance column can reach
  // the panel's edges (its right, top and bottom from col-lg; its sides and bottom below that) and
  // gives the padding back to its own column.
  return (
    <div
      data-overview=""
      className={
        framed
          ? `flex flex-1 flex-col ${DASH_MAIN_BLEED} -mb-6 lg:-mb-10 col-lg:-mt-14 col-lg:flex-row`
          : "flex flex-col gap-8"
      }
    >
      <div className={framed ? `flex min-w-0 flex-1 flex-col gap-8 pb-6 md:pb-8 ${DASH_MAIN_INLINE} col-lg:pt-14 col-lg:pb-10` : "flex flex-col gap-8"}>
        <div className="flex flex-col gap-1">
          <h1 ref={headingRef} tabIndex={-1} className="heading-dash break-words focus:outline-none!">
            {welcome ? "Welcome" : "Welcome back"}, {organiser.displayName}!
          </h1>
          <p className="body-m text-muted">{formatLongWeekdayDate(now)}</p>
        </div>
        {welcome && <JoinedWelcome name={organiser.displayName} />}
        {load.status === "loading" && <LoadingState text="Loading your overview…" />}
        {load.status === "error" && (
          <div data-overview-error="" className="flex flex-col items-start gap-4 rounded-card border border-surface-border p-6">
            <div role="alert" className="flex flex-col gap-1">
              <p className="label-button">Your overview couldn’t load.</p>
              <p className="body-s text-muted">{load.message}</p>
            </div>
            <DashButton variant="outline" onClick={tryAgain} busy={retrying} className="pointer-coarse:min-h-11">
              Try again
            </DashButton>
          </div>
        )}
        {data && (
          <>
            {data.highlight && <HighlightBanner event={data.highlight} now={now} />}
            <OverviewStats week={data.thisWeek} />
            <UpcomingEvents events={data.upcoming} now={now} />
            <DraftsBar count={data.draftsCount} href={DRAFTS_HREF} />
          </>
        )}
      </div>
      {data && (
        <PerformancePanel
          newFollowers={data.thisWeek.newFollowers}
          events={data.performance}
          className={
            framed
              ? "px-4 py-6 md:px-6 md:py-8 col-lg:w-100 col-lg:shrink-0 col-lg:rounded-card col-lg:px-8 col-lg:pt-14 col-lg:pb-10"
              : "rounded-card p-6"
          }
        />
      )}
    </div>
  );
}

/**
 * "Upcoming events" (Heading/H3) and the next two live or sold-out events as event cards, two
 * across from 640px; with none, a card in the same edge saying so, with Create event.
 */
function UpcomingEvents({ events, now }: { events: OrganiserOverview["upcoming"]; now: Date }) {
  const titleId = useId();
  return (
    <section aria-labelledby={titleId} className="flex flex-col gap-8">
      <h2 id={titleId} className="heading-dash-section wrap-anywhere">
        Upcoming events
      </h2>
      {events.length > 0 ? (
        <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {events.map((event) => (
            <li key={event.eventId} className="flex min-w-0">
              <OrgEventCard event={event} now={now} />
            </li>
          ))}
        </ul>
      ) : (
        <div data-upcoming-empty="" className="flex flex-col items-start gap-4 rounded-card border border-surface-border bg-card p-6">
          <div className="flex flex-col gap-1">
            <p className="label-button">No upcoming events</p>
            <p className="body-s text-muted">Your next events show here once they’re live, with their sales.</p>
          </div>
          <DashButtonLink href={NEW_EVENT_HREF} variant="primary" className="pointer-coarse:min-h-11">
            Create event
          </DashButtonLink>
        </div>
      )}
    </section>
  );
}
