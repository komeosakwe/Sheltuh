"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/Button";
import { fieldClass } from "@/components/ui/Field";
import { SelectedDots } from "@/components/ui/FilterChip";
import { EmptyState, Notice } from "@/components/ui/Section";
import { adminListOrganisers, adminSuspendOrganiser, type AdminListOrganisersQuery } from "@/lib/api/admin";
import { ApiError } from "@/lib/api/client";
import type { AdminOrganiserRecord, OrganiserStatus, SuspendOrganiserResult } from "@/lib/api/types";
import { useAuth } from "@/lib/auth/AuthContext";
import { SessionExpiredError } from "@/lib/auth/session-token";
import { adminListHref, pickParam } from "./admin-list-url";
import AdminSessionExpired from "./AdminSessionExpired";
import { useAdminSummary } from "./AdminSummaryProvider";
import OrganiserItem, { actionErrorText, organiserHeadingId, suspendButtonId } from "./OrganiserItem";
import SuspendOrganiserDialog, { type SuspendOutcome } from "./SuspendOrganiserDialog";
import { LoadingState } from "@/components/ui/ProgressLoader";

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
  },
  {
    value: "rejected",
    label: "Rejected or suspended",
    heading: "Rejected or suspended",
    empty: "None yet",
    one: "rejected or suspended organiser",
    many: "rejected or suspended organisers",
    none: "No rejected or suspended organisers",
  },
];

type LoadState =
  | { status: "loading" }
  | { status: "error"; message: string; sessionExpired: boolean }
  | { status: "ready"; items: AdminOrganiserRecord[]; nextCursor?: string };

/** Load more failed: a message, or the session ran out. */
type MoreError = { message: string } | { sessionExpired: true };

/** The visible result of the last action (a live region: focus moving afterwards doesn't repeat it). */
const ANNOUNCEMENT_ID = "organisers-announcement";
const SEARCH_ID = "organisers-search";
export const ORGANISERS_PATH = "/admin/organisers";
/** The API's search limit (lib/api/admin.ts, AdminListOrganisersQuery): longer text is cut there anyway. */
export const ORGANISER_SEARCH_MAX = 100;
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

/** What a finished load is announced as: "3 pending applications", "No approved organisers matching “neon”." */
export function loadedMessage(status: OrganiserStatus, items: number, more: boolean, q = ""): string {
  const s = STATUSES.find((entry) => entry.value === status) ?? STATUSES[0];
  const matching = q ? ` matching “${q}”` : "";
  if (items === 0) return q ? `No ${s.many}${matching}.` : s.none;
  return `${count(items, s.one, s.many)}${matching}${more ? " shown, more to load" : ""}.`;
}

/** The URL's filters: `?status=` (pending when absent or unknown) and the search, `?q=`. */
export function readOrganiserFilters(params: Pick<URLSearchParams, "get">): { status: OrganiserStatus; q: string } {
  return {
    status: pickParam(STATUSES, params.get("status"), "pending"),
    q: (params.get("q") ?? "").trim().slice(0, ORGANISER_SEARCH_MAX),
  };
}

/** What the API is asked for: the status, the search if there is one, and the page. */
export function organiserQuery(status: OrganiserStatus, q: string, cursor?: string): AdminListOrganisersQuery {
  const query: AdminListOrganisersQuery = { status };
  if (q) query.q = q;
  if (cursor) query.cursor = cursor;
  return query;
}

export function organiserQueueHref(filters: { status: OrganiserStatus; q: string }): string {
  return adminListHref(ORGANISERS_PATH, {
    status: filters.status === "pending" ? undefined : filters.status,
    q: filters.q.trim(),
  });
}

/**
 * /admin/organisers: organisers by status, kept in the URL (`?status=`,
 * `?q=`) so the hub can link to Approved. Pending applications can be
 * approved or rejected; approved organisers suspended (a dialog asks for the
 * reason first); rejected and suspended ones are listed for reference. Each
 * shows its website and social handles and its recent profile changes. A
 * search finds a name, contact email or handle in the current status;
 * searching (or clearing it) keeps focus in the search box. A Load more that
 * finishes after the list changed is dropped.
 */
export default function OrganiserQueue() {
  const auth = useAuth();
  const getToken = auth.getAccessToken;
  const adminSummary = useAdminSummary();
  const router = useRouter();
  const searchParams = useSearchParams();
  const filters = useMemo(() => readOrganiserFilters(searchParams), [searchParams]);
  const { status, q } = filters;
  const [attempt, setAttempt] = useState(0);
  const key = `${status}|${q}#${attempt}`;
  const [result, setResult] = useState<{ key: string; state: LoadState } | null>(null);
  const state: LoadState = result?.key === key ? result.state : { status: "loading" };
  const [loadingMore, setLoadingMore] = useState(false);
  const [moreError, setMoreError] = useState<MoreError | null>(null);
  const [announcement, setAnnouncement] = useState("");
  /** The result of a load the admin asked for (a filter, Try again): screen readers only. */
  const [loadAnnouncement, setLoadAnnouncement] = useState("");
  /** A suspend that failed after its dialog was closed (Escape can still force it): shown as an alert. */
  const [lateSuspendError, setLateSuspendError] = useState<string | null>(null);
  /** The search box's text while it's being typed, for the search it was typed against. */
  const [typed, setTyped] = useState<{ q: string; value: string } | null>(null);
  const searchValue = typed && typed.q === q ? typed.value : q;
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
  /** The list on screen: replaced whenever another is asked for, so an earlier list's Load more can tell. */
  const listToken = useRef<object>({});

  useEffect(() => {
    listToken.current = {};
  }, [key]);

  useEffect(() => {
    let cancelled = false;
    adminListOrganisers(organiserQuery(status, q), getToken).then(
      (page) => {
        if (cancelled) return;
        setResult({ key, state: { status: "ready", items: page.items, nextCursor: page.nextCursor } });
        if (announceLoad.current) {
          announceLoad.current = false;
          setLoadAnnouncement(loadedMessage(status, page.items.length, Boolean(page.nextCursor), q));
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
  }, [status, q, getToken, key]);

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
    adminSummary?.refresh(); // The hub's and sub-nav's waiting count.
    setAnnouncement(message);
    setLateSuspendError(null);
    if (reauthOwner === item.organiserId) setReauthOwner(null);
    pendingFocus.current = next ? organiserHeadingId(next.organiserId) : "heading";
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
    listToken.current = {};
    pendingFocus.current = null;
    setLoadingMore(false);
    announceLoad.current = true;
    setLoadAnnouncement("");
    setAttempt((n) => n + 1);
  }

  /** Another list (or the same one again): whatever the last list had going no longer applies. */
  function show(next: { status: OrganiserStatus; q: string }) {
    listToken.current = {};
    pendingFocus.current = null;
    announceLoad.current = true;
    setLoadingMore(false);
    setAnnouncement("");
    setLoadAnnouncement("");
    setLateSuspendError(null);
    setMoreError(null);
    setReauthOwner(null);
    const href = organiserQueueHref(next);
    // The same filters (the same search submitted again): the URL won't change, so load again.
    if (href === organiserQueueHref(filters)) setAttempt((n) => n + 1);
    else router.replace(href, { scroll: false });
  }

  /** Searches (or clears the search), keeping focus in the search box: the button pressed may be gone. */
  function showSearch(value: string) {
    setTyped(null);
    show({ status, q: value.trim().slice(0, ORGANISER_SEARCH_MAX) });
    pendingFocus.current = SEARCH_ID;
  }

  function search(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    showSearch(searchValue);
  }

  async function loadMore() {
    if (state.status !== "ready" || !state.nextCursor || loadingMore) return;
    const token = listToken.current;
    setLoadingMore(true);
    setMoreError(null);
    if (reauthOwner === "more") setReauthOwner(null);
    try {
      const page = await adminListOrganisers(organiserQuery(status, q, state.nextCursor), getToken);
      if (token !== listToken.current) return;
      const known = new Set(state.items.map((i) => i.organiserId));
      const fresh = page.items.filter((i) => !known.has(i.organiserId));
      setItems((current) => [...current, ...fresh], page.nextCursor ?? null);
      if (fresh[0]) pendingFocus.current = organiserHeadingId(fresh[0].organiserId);
    } catch (err) {
      if (token !== listToken.current) return;
      if (err instanceof SessionExpiredError) {
        setMoreError({ sessionExpired: true });
        setReauthOwner("more");
      } else {
        setMoreError({ message: actionErrorText(err, "Couldn’t load more organisers.") });
      }
    } finally {
      if (token === listToken.current) setLoadingMore(false);
    }
  }

  const current = STATUSES.find((s) => s.value === status) ?? STATUSES[0];
  const shown = state.status === "ready" ? state.items.length : null;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3">
        <div role="group" aria-label="Show organisers" className="flex flex-wrap gap-2">
          {STATUSES.map((s) => (
            <Button
              key={s.value}
              variant={status === s.value ? "solid" : "outline"}
              size="sm"
              className="min-h-11"
              aria-pressed={status === s.value}
              onClick={() => show({ status: s.value, q })}
            >
              {status === s.value && <SelectedDots />}
              {s.label}
            </Button>
          ))}
        </div>

        <form role="search" aria-label="Organisers" onSubmit={search} className="flex flex-wrap items-end gap-2">
          <div className="flex min-w-0 flex-1 basis-56 flex-col gap-1">
            <label htmlFor={SEARCH_ID} className="eyebrow text-muted">
              Search by name, email or handle
            </label>
            <input
              id={SEARCH_ID}
              name="q"
              type="search"
              value={searchValue}
              onChange={(e) => setTyped({ q, value: e.target.value })}
              maxLength={ORGANISER_SEARCH_MAX}
              autoComplete="off"
              className={fieldClass}
            />
          </div>
          <Button type="submit" variant="solid" size="sm" className="min-h-11">
            Search
          </Button>
          {q && (
            <Button variant="outline" size="sm" className="min-h-11" onClick={() => showSearch("")}>
              Clear search
            </Button>
          )}
        </form>
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
        {q && <p className="mt-2 text-sm text-muted">Matching “{q}”.</p>}

        <div className="mt-4">
          {state.status === "loading" && <LoadingState text="Loading…" />}

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

          {state.status === "ready" &&
            state.items.length === 0 &&
            (q ? (
              <EmptyState
                title={`Nothing matches “${q}”`}
                action={
                  <Button variant="outline" size="sm" className="min-h-11" onClick={() => showSearch("")}>
                    Clear search
                  </Button>
                }
              />
            ) : (
              <EmptyState title={current.empty} />
            ))}

          {state.status === "ready" && state.items.length > 0 && (
            <ul className="flex flex-col gap-6">
              {state.items.map((item) => (
                <OrganiserItem
                  key={item.organiserId}
                  item={item}
                  getToken={getToken}
                  onRemoved={removed}
                  onUpdated={(record, message) => {
                    setItems((current) => current.map((i) => (i.organiserId === record.organiserId ? record : i)));
                    setAnnouncement(message);
                    pendingFocus.current = organiserHeadingId(record.organiserId);
                  }}
                  onSuspend={openSuspend}
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

