"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { EmptyState, Notice } from "@/components/ui/Section";
import { adminListOrganisers, adminSuspendOrganiser } from "@/lib/api/admin";
import { ApiError } from "@/lib/api/client";
import type { AdminOrganiserRecord, OrganiserStatus, SuspendOrganiserResult } from "@/lib/api/types";
import { useAuth } from "@/lib/auth/AuthContext";
import { SessionExpiredError } from "@/lib/auth/session-token";
import AdminSessionExpired from "./AdminSessionExpired";
import OrganiserItem, { actionErrorText, organiserHeadingId, suspendButtonId } from "./OrganiserItem";
import SuspendOrganiserDialog, { type SuspendOutcome } from "./SuspendOrganiserDialog";

const STATUSES: {
  value: OrganiserStatus;
  label: string;
  heading: string;
  empty: string;
  /** What a loaded list is announced as: "3 pending applications". */
  one: string;
  many: string;
  none: string;
  intro?: string;
}[] = [
  {
    value: "pending",
    label: "Pending",
    heading: "Pending applications",
    empty: "Nothing to review",
    one: "pending application",
    many: "pending applications",
    none: "No pending applications",
  },
  {
    value: "approved",
    label: "Approved",
    heading: "Approved organisers",
    empty: "No approved organisers",
    one: "approved organiser",
    many: "approved organisers",
    none: "No approved organisers",
    intro: "Live on Sheltüh now. Suspend one to take their profile and events down.",
  },
  {
    value: "rejected",
    label: "Rejected & suspended",
    heading: "Rejected and suspended",
    empty: "None yet",
    one: "rejected or suspended organiser",
    many: "rejected or suspended organisers",
    none: "No rejected or suspended organisers",
    intro: "Rejected applications, and organisers who were suspended.",
  },
];

type LoadState =
  | { status: "loading" }
  | { status: "error"; message: string; sessionExpired: boolean }
  | { status: "ready"; items: AdminOrganiserRecord[]; nextCursor?: string };

/** Load more failed: a message, or the session ran out. */
type MoreError = { message: string } | { sessionExpired: true };

/** The visible result of the last action; the next heading to take focus is described by it. */
const ANNOUNCEMENT_ID = "organisers-announcement";
/** Who shows the sign-in form (its fields have fixed ids, so only one may): an organiser id, "more" or "suspend". */
type ReauthOwner = string | null;

function count(n: number, one: string, many: string) {
  return `${n.toLocaleString("en-AU")} ${n === 1 ? one : many}`;
}

/** What's announced after a takedown: "Suspended X. 3 events unpublished." (plus any rejected submissions). */
export function suspendedMessage(name: string, result: SuspendOrganiserResult): string {
  const rejected =
    result.submissionsRejected > 0
      ? ` ${count(result.submissionsRejected, "submission", "submissions")} rejected.`
      : "";
  return `Suspended ${name}. ${count(result.eventsUnpublished, "event", "events")} unpublished.${rejected}`;
}

/** What a finished load is announced as: "3 pending applications", "No approved organisers". */
export function loadedMessage(status: OrganiserStatus, items: number, more: boolean): string {
  const s = STATUSES.find((entry) => entry.value === status) ?? STATUSES[0];
  if (items === 0) return s.none;
  return `${count(items, s.one, s.many)}${more ? " shown, more to load" : ""}.`;
}

/**
 * /admin/organisers: organisers by status. Pending applications can be
 * approved or rejected; approved organisers suspended (a dialog asks for the
 * reason first); rejected and suspended ones are listed for reference. Each
 * shows its website and social handles and its recent profile changes.
 */
export default function OrganiserQueue() {
  const auth = useAuth();
  const getToken = auth.getAccessToken;
  const [status, setStatus] = useState<OrganiserStatus>("pending");
  const [attempt, setAttempt] = useState(0);
  const key = `${status}#${attempt}`;
  const [result, setResult] = useState<{ key: string; state: LoadState } | null>(null);
  const state: LoadState = result?.key === key ? result.state : { status: "loading" };
  const [loadingMore, setLoadingMore] = useState(false);
  const [moreError, setMoreError] = useState<MoreError | null>(null);
  const [announcement, setAnnouncement] = useState("");
  /** The result of a load the admin asked for (a filter, Try again): screen readers only. */
  const [loadAnnouncement, setLoadAnnouncement] = useState("");
  /** A suspend that failed after its dialog was closed (Escape can still force it): shown as an alert. */
  const [lateSuspendError, setLateSuspendError] = useState<string | null>(null);
  /** The organiser heading (or "heading", the list's) that focus moved to after a removal: it's described by the announcement. */
  const [describedFocus, setDescribedFocus] = useState<string | "heading" | null>(null);
  const [reauthOwner, setReauthOwner] = useState<ReauthOwner>(null);
  const [suspending, setSuspending] = useState<AdminOrganiserRecord | null>(null);
  /** The organiser whose suspend dialog is open now, so a result that lands after it closed can still be told. */
  const suspendOpenFor = useRef<string | null>(null);
  /** Set when a suspend found nothing to suspend (409/404): closing the dialog drops them from the list. */
  const suspendGone = useRef<string | null>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  /** An element id, or the list heading. */
  const pendingFocus = useRef<string | "heading" | null>(null);
  /** The next load finishing is announced (it was asked for, not the first page load). */
  const announceLoad = useRef(false);

  useEffect(() => {
    let cancelled = false;
    adminListOrganisers(status, getToken).then(
      (page) => {
        if (cancelled) return;
        setResult({ key, state: { status: "ready", items: page.items, nextCursor: page.nextCursor } });
        if (announceLoad.current) {
          announceLoad.current = false;
          setLoadAnnouncement(loadedMessage(status, page.items.length, Boolean(page.nextCursor)));
        }
      },
      (err: unknown) => {
        if (cancelled) return;
        // The error is an alert itself.
        announceLoad.current = false;
        setResult({
          key,
          state: {
            status: "error",
            message: actionErrorText(err, "Couldn’t load organisers."),
            sessionExpired: err instanceof SessionExpiredError,
          },
        });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [status, getToken, key]);

  useEffect(() => {
    const target = pendingFocus.current;
    if (!target) return;
    const element = target === "heading" ? headingRef.current : document.getElementById(target);
    if (!element) return; // Not rendered yet: an earlier render's effects can run first.
    pendingFocus.current = null;
    element.focus();
  });

  function setItems(change: (items: AdminOrganiserRecord[]) => AdminOrganiserRecord[], nextCursor?: string | null) {
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

  /** An organiser left this list: announce why and focus the next one (or the heading). */
  function removed(item: AdminOrganiserRecord, message: string) {
    const items = state.status === "ready" ? state.items : [];
    const index = items.findIndex((i) => i.organiserId === item.organiserId);
    const next = index === -1 ? undefined : (items[index + 1] ?? items[index - 1]);
    setItems((current) => current.filter((i) => i.organiserId !== item.organiserId));
    setAnnouncement(message);
    setLateSuspendError(null);
    if (reauthOwner === item.organiserId) setReauthOwner(null);
    const target = next ? next.organiserId : "heading";
    pendingFocus.current = next ? organiserHeadingId(next.organiserId) : "heading";
    setDescribedFocus(target);
  }

  function openSuspend(item: AdminOrganiserRecord) {
    suspendOpenFor.current = item.organiserId;
    setLateSuspendError(null);
    setSuspending(item);
  }

  async function suspend(item: AdminOrganiserRecord, reason: string): Promise<SuspendOutcome> {
    let outcome: SuspendOutcome;
    /** What went wrong, if there's more to say than "couldn't suspend". */
    let detail = "";
    try {
      const result = await adminSuspendOrganiser(item.organiserId, reason, getToken);
      removed(item, suspendedMessage(item.displayName, result));
      suspendOpenFor.current = null;
      setSuspending(null);
      return { ok: true };
    } catch (err) {
      if (err instanceof ApiError && err.fieldErrors?.reason) {
        outcome = { ok: false, reasonError: err.fieldErrors.reason };
        detail = `Reason: ${err.fieldErrors.reason} `;
      } else if (err instanceof ApiError && (err.status === 409 || err.status === 404)) {
        outcome = { ok: false, message: err.message, gone: true };
      } else if (err instanceof SessionExpiredError) {
        outcome = { ok: false, sessionExpired: true };
        detail = "Your session has expired. ";
      } else {
        const fallback = "Couldn’t suspend them. Try again.";
        const message = actionErrorText(err, fallback);
        outcome = { ok: false, message };
        if (message !== fallback) detail = `${message} `;
      }
    }
    if (suspendOpenFor.current !== item.organiserId) {
      // The dialog was closed while this was in flight: say what happened out here.
      if ("gone" in outcome && outcome.gone) {
        removed(item, `${item.displayName} is no longer approved, so they’ve been taken off this list.`);
      } else {
        setLateSuspendError(`Couldn’t suspend ${item.displayName}. ${detail}Open Suspend… to try again.`);
      }
      return outcome;
    }
    if ("gone" in outcome && outcome.gone) suspendGone.current = item.organiserId;
    if ("sessionExpired" in outcome) setReauthOwner("suspend");
    return outcome;
  }

  /** The dialog closed (Cancel, Escape or Close); after a success `suspending` is already null. */
  function suspendClosed() {
    const item = suspending;
    suspendOpenFor.current = null;
    if (reauthOwner === "suspend") setReauthOwner(null);
    if (!item) return;
    setSuspending(null);
    if (suspendGone.current === item.organiserId) {
      suspendGone.current = null;
      removed(item, `${item.displayName} is no longer approved, so they’ve been taken off this list.`);
    } else {
      pendingFocus.current = suspendButtonId(item.organiserId);
    }
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
      const page = await adminListOrganisers(status, getToken, state.nextCursor);
      const known = new Set(state.items.map((i) => i.organiserId));
      const fresh = page.items.filter((i) => !known.has(i.organiserId));
      setItems((current) => [...current, ...fresh], page.nextCursor ?? null);
      if (fresh[0]) pendingFocus.current = organiserHeadingId(fresh[0].organiserId);
    } catch (err) {
      if (err instanceof SessionExpiredError) {
        setMoreError({ sessionExpired: true });
        setReauthOwner("more");
      } else {
        setMoreError({ message: actionErrorText(err, "Couldn’t load more organisers.") });
      }
    } finally {
      setLoadingMore(false);
    }
  }

  const current = STATUSES.find((s) => s.value === status) ?? STATUSES[0];
  const shown = state.status === "ready" ? state.items.length : null;

  return (
    <div className="flex flex-col gap-6">
      <div role="group" aria-label="Show organisers" className="flex flex-wrap gap-2">
        {STATUSES.map((s) => (
          <Button
            key={s.value}
            variant={status === s.value ? "solid" : "outline"}
            size="sm"
            className="min-h-11"
            aria-pressed={status === s.value}
            onClick={() => {
              announceLoad.current = true;
              setStatus(s.value);
              setAnnouncement("");
              setLoadAnnouncement("");
              setLateSuspendError(null);
              setDescribedFocus(null);
              setMoreError(null);
              setReauthOwner(null);
            }}
          >
            {s.label}
          </Button>
        ))}
      </div>

      {/* Always rendered so each result is announced; empty, it takes no space. */}
      <p id={ANNOUNCEMENT_ID} role="status" className="border-l-2 border-foreground py-1 pl-4 text-sm empty:sr-only">
        {announcement}
      </p>
      <p id="organisers-load-status" role="status" className="sr-only">
        {loadAnnouncement}
      </p>
      {lateSuspendError && (
        <Notice tone="danger" role="alert">
          {lateSuspendError}
        </Notice>
      )}

      <section aria-labelledby="organisers-heading" aria-busy={state.status === "loading" ? true : undefined}>
        <h2
          id="organisers-heading"
          ref={headingRef}
          tabIndex={-1}
          aria-describedby={describedFocus === "heading" && announcement ? ANNOUNCEMENT_ID : undefined}
          className="display-md !text-2xl outline-offset-2"
        >
          {current.heading}
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
        {current.intro && <p className="mt-2 text-sm text-muted">{current.intro}</p>}

        <div className="mt-4">
          {state.status === "loading" && <p className="text-sm text-muted">Loading…</p>}

          {state.status === "error" && (
            <div className="flex flex-col items-start gap-3">
              {state.sessionExpired ? (
                // Nothing else is listed (or open) while the list failed, so this form is the only one.
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

          {state.status === "ready" && state.items.length === 0 && <EmptyState title={current.empty} />}

          {state.status === "ready" && state.items.length > 0 && (
            <ul className="flex flex-col gap-6">
              {state.items.map((item) => (
                <OrganiserItem
                  key={item.organiserId}
                  item={item}
                  getToken={getToken}
                  onRemoved={removed}
                  onSuspend={openSuspend}
                  headingDescribedBy={
                    describedFocus === item.organiserId && announcement ? ANNOUNCEMENT_ID : undefined
                  }
                  reauthOwner={reauthOwner}
                  onClaimReauth={setReauthOwner}
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

      <SuspendOrganiserDialog
        organiserName={suspending?.displayName ?? null}
        onClose={suspendClosed}
        onSubmit={async (reason): Promise<SuspendOutcome> =>
          suspending ? suspend(suspending, reason) : { ok: false, message: "Nobody to suspend.", gone: true }
        }
      />
    </div>
  );
}

