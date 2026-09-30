"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import DemoNotice from "@/components/DemoNotice";
import { Button, ButtonLink } from "@/components/ui/Button";
import { Notice, Panel } from "@/components/ui/Section";
import { ApiError } from "@/lib/api/client";
import { listGoingAttendees, setGoing, unsetGoing } from "@/lib/api/going";
import { saveMyProfile } from "@/lib/api/profiles";
import type { MyGoingStatus } from "@/lib/api/types";
import { SUPPORT_EMAIL } from "@/lib/contact";
import { endSentence } from "@/lib/display-name";
import { withNext } from "@/lib/safe-next-path";
import ActionErrorNotice from "./whos-going/ActionErrorNotice";
import ConsentCopy from "./whos-going/ConsentCopy";
import NameList from "./whos-going/NameList";
import OptInForm, { type OptInResult } from "./whos-going/OptInForm";
import { COUNT_THRESHOLD, splitSelf, useWhosGoing, type GoingData } from "./whos-going/WhosGoingProvider";
import SuspendedNotice from "./whos-going/SuspendedNotice";
import { mutationErrorMessage, pillClass } from "./whos-going/shared";

/** Three rows of two: keeps the collapsed panel short beside the tickets. */
export const FIRST_PAGE_SIZE = 6;
export const MORE_PAGE_SIZE = 12;

const LOAD_ERROR = "Couldn't load who's going.";
const RATE_LIMITED = "Lots of people are looking right now. Try again in a few minutes.";
const inlineLinkClass = "underline underline-offset-4 hover:decoration-2";
const tallInlineLinkClass = `inline-flex min-h-11 items-center ${inlineLinkClass}`;

type PendingFocus = { kind: "you" } | { kind: "action" } | { kind: "add" } | { kind: "row"; index: number };

function reportHref(eventTitle: string, slug: string) {
  const subject = `Report a Who's Going name: ${eventTitle}`;
  const body = `Event: /events/${slug}\nName you're reporting:\nWhat's wrong with it:\n`;
  return `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

function withStatus(data: GoingData, next: MyGoingStatus): GoingData {
  if (data.viewer.kind !== "signed-in") return data;
  const was = data.viewer.me.going;
  // A suspended member is never in the count, whatever their own status says;
  // and a withheld count (under three) isn't known, so it stays withheld
  // until the next load rather than being guessed at.
  const delta =
    data.countHidden || data.viewer.profile?.suspended || next.going === was ? 0 : next.going ? 1 : -1;
  return {
    ...data,
    count: Math.max(0, data.count + delta),
    viewer: { ...data.viewer, me: next, self: next.going ? data.viewer.self : undefined },
  };
}

/**
 * "Who's going" on the event page: a count for everyone, names for signed-in
 * members, and opting yourself in or out. Data comes from WhosGoingProvider.
 */
export default function WhosGoing() {
  const { mode, event, state, retry, update, getToken } = useWhosGoing();
  const [visible, setVisible] = useState(FIRST_PAGE_SIZE);
  const [newFrom, setNewFrom] = useState<number | undefined>(undefined);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadMoreError, setLoadMoreError] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [busy, setBusy] = useState<"join" | "leave" | null>(null);
  const [mutationError, setMutationError] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const [youIsNew, setYouIsNew] = useState(false);

  const pendingFocus = useRef<PendingFocus | null>(null);
  const youRef = useRef<HTMLLIElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const actionRowRef = useRef<HTMLDivElement>(null);

  // Focus only ever moves in response to something the person did (never on
  // load): set pendingFocus alongside the state change, and it's applied once
  // that render has committed.
  useEffect(() => {
    const target = pendingFocus.current;
    if (!target) return;
    pendingFocus.current = null;
    if (target.kind === "you") {
      youRef.current?.focus();
    } else if (target.kind === "row") {
      listRef.current?.querySelector<HTMLElement>(`[data-row-index="${target.index}"]`)?.focus();
    } else if (target.kind === "add") {
      document.getElementById("wg-add")?.focus();
    } else {
      const row = actionRowRef.current;
      (row?.querySelector<HTMLElement>("button:not(:disabled)") ?? row)?.focus();
    }
  });

  if (state.status === "ready" && state.data.closed) return null;

  const data = state.status === "ready" ? state.data : null;
  const others = data?.attendees ?? null;
  const shown = others ? Math.min(visible, others.length) : 0;
  const expanded = formOpen || shown > FIRST_PAGE_SIZE;

  function joined(displayName: string) {
    setYouIsNew(true);
    setAnnouncement(displayName ? `You're now shown as going as ${endSentence(displayName)}` : "You're now shown as going.");
    pendingFocus.current = { kind: "you" };
  }

  async function join() {
    if (!getToken || busy) return;
    setBusy("join");
    setMutationError(null);
    try {
      const next = await setGoing(event.id, getToken);
      update((d) => withStatus(d, next));
      const name = data?.viewer.kind === "signed-in" ? data.viewer.profile?.displayName : undefined;
      if (next.going) joined(name ?? "");
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        // Their profile has gone (deleted in another tab): back to the form.
        update((d) =>
          d.viewer.kind === "signed-in"
            ? { ...d, viewer: { ...d.viewer, profile: null, me: { ...d.viewer.me, hasProfile: false } } }
            : d,
        );
      }
      setMutationError(mutationErrorMessage(err));
      // The button may have been replaced (a 409 swaps in "Add yourself"):
      // keep focus on the action row rather than losing it to the page.
      pendingFocus.current = { kind: "action" };
    } finally {
      setBusy(null);
    }
  }

  async function leave() {
    if (!getToken || busy) return;
    setBusy("leave");
    setMutationError(null);
    try {
      const next = await unsetGoing(event.id, getToken);
      update((d) => withStatus(d, next));
      setYouIsNew(false);
      setAnnouncement("You're no longer shown as going.");
      pendingFocus.current = { kind: "action" };
    } catch (err) {
      setMutationError(mutationErrorMessage(err));
      pendingFocus.current = { kind: "action" };
    } finally {
      setBusy(null);
    }
  }

  async function createProfileAndJoin(displayName: string): Promise<OptInResult> {
    if (!getToken) return { message: mutationErrorMessage(null) };
    setMutationError(null);
    let profile;
    try {
      profile = await saveMyProfile({ displayName, adultConfirmed: true }, getToken);
    } catch (err) {
      if (err instanceof ApiError && (err.fieldErrors?.displayName || err.fieldErrors?.adultConfirmed)) {
        return { fieldErrors: err.fieldErrors };
      }
      return { message: mutationErrorMessage(err) };
    }

    // The profile exists now, so the form gives way to the one-tap state
    // (showing "Adding you…") while the opt-in itself is sent.
    update((d) =>
      d.viewer.kind === "signed-in"
        ? { ...d, viewer: { ...d.viewer, profile, me: { ...d.viewer.me, hasProfile: true } } }
        : d,
    );
    setFormOpen(false);
    setBusy("join");
    try {
      const next = await setGoing(event.id, getToken);
      update((d) => withStatus(d, next));
      if (next.going) joined(profile.displayName);
    } catch (err) {
      setMutationError(mutationErrorMessage(err));
      pendingFocus.current = { kind: "action" };
    } finally {
      setBusy(null);
    }
    return null;
  }

  function toggleForm() {
    setMutationError(null);
    setFormOpen((open) => !open);
  }

  function cancelForm() {
    setFormOpen(false);
    pendingFocus.current = { kind: "add" };
  }

  async function showMore() {
    if (!data || !others || loadingMore) return;
    const from = shown;
    const target = from + MORE_PAGE_SIZE;
    let total = others.length;
    let cursor = data.nextCursor;
    setLoadMoreError(null);

    // Names already loaded are revealed first; the next page is only
    // fetched once they run out.
    if (target > total && cursor && getToken) {
      setLoadingMore(true);
      try {
        const page = await listGoingAttendees(event.id, getToken, cursor);
        const known = new Set(others.map((a) => a.attendeeId));
        const fresh = splitSelf(page.items).others.filter((a) => !known.has(a.attendeeId));
        update((d) => ({ ...d, attendees: [...(d.attendees ?? []), ...fresh], nextCursor: page.nextCursor }));
        total += fresh.length;
        cursor = page.nextCursor;
      } catch (err) {
        setLoadMoreError(
          err instanceof ApiError && err.status === 429 ? RATE_LIMITED : "Couldn’t load more names.",
        );
        return;
      } finally {
        setLoadingMore(false);
      }
    }

    const nextShown = Math.min(target, total);
    const added = nextShown - from;
    const atEnd = nextShown >= total && !cursor;
    setVisible(nextShown);
    setNewFrom(from);
    const addedText = added > 0 ? `${added} more ${added === 1 ? "name" : "names"} shown.` : "";
    setAnnouncement(atEnd ? `${addedText} That's everyone.`.trim() : addedText);
    if (added > 0) pendingFocus.current = { kind: "row", index: from };
  }

  function tryAgain() {
    setAnnouncement("");
    retry();
  }

  return (
    <div
      id="whos-going"
      tabIndex={-1}
      className="focus:outline-none"
      data-wg-expanded={expanded ? "" : undefined}
      aria-busy={state.status === "loading" ? true : undefined}
    >
      <Panel title="Who's going" titleId="whos-going-title">
        {state.status === "loading" && <p className="min-h-30 text-sm text-muted">Loading who&rsquo;s going…</p>}

        {state.status === "error" && (
          <div className="flex flex-col items-start gap-3">
            <Notice tone="danger">{LOAD_ERROR}</Notice>
            <Button variant="outline" size="sm" className="min-h-11" onClick={tryAgain}>
              Try again
            </Button>
          </div>
        )}

        {data && renderReady(data)}

        {/* One polite live region for the panel, always mounted. */}
        <p role="status" className="sr-only">
          {state.status === "error" ? LOAD_ERROR : announcement}
        </p>
      </Panel>
    </div>
  );

  function renderReady(d: GoingData) {
    const viewer = d.viewer;
    const signedIn = viewer.kind === "signed-in" ? viewer : null;
    // A suspended member is hidden from every list and count, so they're
    // never shown as going here either (no "You" row).
    const going = !signedIn?.profile?.suspended && (signedIn?.me.going ?? false);
    const youName = going ? (signedIn?.profile?.displayName ?? signedIn?.self?.displayName ?? "") : undefined;
    const countShown = !d.countHidden && d.count >= COUNT_THRESHOLD;
    const hasMore = others !== null && (shown < others.length || Boolean(d.nextCursor));
    const listShown = others !== null && (others.length > 0 || youName !== undefined);
    const nobody = signedIn !== null && others !== null && others.length === 0 && !going;
    const somethingAbove = countShown || others !== null || Boolean(signedIn?.namesRateLimited);

    return (
      <>
        {countShown && (
          <p className="mb-4 flex items-baseline gap-2">
            <span className="font-heading text-4xl leading-none font-extrabold tabular-nums">{d.count}</span>{" "}
            <span className="eyebrow text-muted">going</span>
          </p>
        )}

        {listShown && others && (
          <NameList
            attendees={others.slice(0, shown)}
            youName={youName}
            youIsNew={youIsNew}
            youRef={youRef}
            newFrom={newFrom}
            listRef={listRef}
          />
        )}

        {nobody && <p className="text-sm text-muted">No one&rsquo;s added themselves yet.</p>}

        {signedIn?.namesRateLimited && (
          <div className="flex flex-col items-start gap-3">
            <p className="text-sm">{RATE_LIMITED}</p>
            <Button variant="outline" size="sm" className="min-h-11" onClick={tryAgain}>
              Try again
            </Button>
          </div>
        )}

        {hasMore && (
          <div className="mt-4 flex flex-col items-start gap-3">
            {loadMoreError && <Notice tone="danger">{loadMoreError}</Notice>}
            <Button variant="outline" busy={loadingMore} onClick={showMore} className="min-h-11 w-full sm:w-auto">
              {loadingMore ? "Loading…" : "Show more"}
            </Button>
          </div>
        )}

        <div
          ref={actionRowRef}
          tabIndex={-1}
          className={`flex flex-col items-start gap-3 outline-offset-2 ${
            somethingAbove ? "mt-5 border-t border-surface-border pt-4" : ""
          }`.trim()}
        >
          {mode === "demo" ? renderDemoActions() : signedIn ? renderMemberActions(d, signedIn) : renderSignedOutActions(d)}
        </div>
      </>
    );
  }

  function renderDemoActions() {
    return (
      <>
        <button
          type="button"
          disabled
          aria-disabled="true"
          className="btn btn-lg w-full cursor-not-allowed border-surface-border bg-surface-border text-muted sm:w-auto"
        >
          Add yourself
        </button>
        <DemoNotice>These names are samples. Adding yourself isn&rsquo;t available in this demo.</DemoNotice>
      </>
    );
  }

  function renderSignedOutActions(d: GoingData) {
    return (
      <>
        {/* The API withholds counts under three (including none), so this can't tell 0 from 1–2. */}
        {d.countHidden && (
          <p className="text-sm">Be one of the first to add yourself.</p>
        )}
        <ButtonLink variant="outline" size="lg" href={withNext("/login", `/events/${event.slug}`)} className={pillClass}>
          Sign in to see who&rsquo;s going
        </ButtonLink>
      </>
    );
  }

  function renderMemberActions(d: GoingData, viewer: Extract<GoingData["viewer"], { kind: "signed-in" }>) {
    const { me, profile } = viewer;
    const errorNotice = mutationError && (
      <ActionErrorNotice message={mutationError} returnTo={`/events/${event.slug}#whos-going`} />
    );
    const report = d.attendees && d.attendees.length > 0 && (
      <p className="text-xs text-muted">
        <a href={reportHref(event.title, event.slug)} className={tallInlineLinkClass}>
          Report a name (by email)
        </a>
      </p>
    );

    // Checked before `me.going`: a suspended member isn't shown, so they
    // don't get "You" or "Stop showing me".
    if (profile?.suspended) {
      return (
        <>
          <p className="text-sm">
            <SuspendedNotice />
          </p>
          {report}
        </>
      );
    }

    if (me.going) {
      return (
        <>
          {errorNotice}
          <Button variant="outline" size="lg" busy={busy !== null} onClick={leave} className={pillClass}>
            {busy === "leave" ? "Removing…" : "Stop showing me"}
          </Button>
          <p className="text-xs text-muted">
            <Link href="/account" className={tallInlineLinkClass}>
              Edit name
            </Link>
          </p>
          {report}
        </>
      );
    }

    // Names are refused (403) with a profile: the email isn't verified.
    // Without one, it's the missing profile, handled with the states below.
    if (viewer.namesDenied && profile) {
      return <p className="text-sm">Verify your email address to see who&rsquo;s going and add yourself.</p>;
    }
    const namesNeedProfile = viewer.namesDenied && !profile;

    if (me.eligible && me.hasProfile && profile) {
      return (
        <>
          <p className="text-sm">
            Show up as {endSentence(profile.displayName)}{" "}
            <Link href="/account" className={inlineLinkClass}>
              Edit name
            </Link>
          </p>
          {errorNotice}
          <Button variant="outline" size="lg" busy={busy !== null} onClick={join} className={pillClass}>
            {busy === "join" ? "Adding you…" : "Show me as going"}
          </Button>
          <ConsentCopy className="text-xs leading-4 text-muted" />
          {report}
        </>
      );
    }

    if (me.eligible) {
      return (
        <>
          <p className="text-sm">
            You&rsquo;ve got a ticket. Want people to know you&rsquo;re going?
            {namesNeedProfile && <> Add yourself to see who else is.</>}
          </p>
          {errorNotice}
          <Button
            id="wg-add"
            variant="outline"
            size="lg"
            aria-expanded={formOpen}
            aria-controls={formOpen ? "wg-form" : undefined}
            onClick={toggleForm}
            className={pillClass}
          >
            Add yourself
          </Button>
          {formOpen && (
            <div className="w-full">
              <OptInForm
                onSubmit={createProfileAndJoin}
                onCancel={cancelForm}
                returnTo={`/events/${event.slug}#whos-going`}
              />
            </div>
          )}
          {report}
        </>
      );
    }

    return (
      <>
        <p className="text-sm">
          <a href="#tickets" className={tallInlineLinkClass}>
            Get a ticket
          </a>{" "}
          to add yourself.
        </p>
        {viewer.email && (
          <p className="text-xs text-muted">Tickets count when they&rsquo;re booked with {viewer.email}.</p>
        )}
        {namesNeedProfile && (
          <p className="text-sm">
            Names are shown to members with a Who&rsquo;s Going profile.{" "}
            <Link href="/account" className={tallInlineLinkClass}>
              Set up your profile
            </Link>
          </p>
        )}
        {report}
      </>
    );
  }
}
