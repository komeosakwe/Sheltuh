"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { EmptyState, Notice } from "@/components/ui/Section";
import { adminListOrganisers, adminSuspendOrganiser } from "@/lib/api/admin";
import { ApiError } from "@/lib/api/client";
import type { AdminOrganiserRecord, OrganiserStatus, SuspendOrganiserResult } from "@/lib/api/types";
import { useAuth } from "@/lib/auth/AuthContext";
import OrganiserItem, { actionErrorText, organiserHeadingId, suspendButtonId } from "./OrganiserItem";
import SuspendOrganiserDialog, { type SuspendOutcome } from "./SuspendOrganiserDialog";

const STATUSES: { value: OrganiserStatus; label: string; heading: string; empty: string; intro?: string }[] = [
  { value: "pending", label: "Pending", heading: "Pending applications", empty: "Nothing to review" },
  {
    value: "approved",
    label: "Approved",
    heading: "Approved organisers",
    empty: "No approved organisers",
    intro: "Live on Sheltüh now. Suspend one to take their profile and events down.",
  },
  {
    value: "rejected",
    label: "Rejected",
    heading: "Rejected and suspended",
    empty: "None yet",
    intro: "Rejected applications, and organisers who were suspended.",
  },
];

type LoadState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; items: AdminOrganiserRecord[]; nextCursor?: string };

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
  const [moreError, setMoreError] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const [suspending, setSuspending] = useState<AdminOrganiserRecord | null>(null);
  /** Set when a suspend found nothing to suspend (409/404): closing the dialog drops them from the list. */
  const suspendGone = useRef<string | null>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  /** An element id, or the list heading. */
  const pendingFocus = useRef<string | "heading" | null>(null);

  useEffect(() => {
    let cancelled = false;
    adminListOrganisers(status, getToken).then(
      (page) => {
        if (!cancelled) setResult({ key, state: { status: "ready", items: page.items, nextCursor: page.nextCursor } });
      },
      (err: unknown) => {
        if (!cancelled) {
          setResult({ key, state: { status: "error", message: actionErrorText(err, "Couldn’t load organisers.") } });
        }
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
    pendingFocus.current = next ? organiserHeadingId(next.organiserId) : "heading";
  }

  async function suspend(item: AdminOrganiserRecord, reason: string): Promise<SuspendOutcome> {
    try {
      const outcome = await adminSuspendOrganiser(item.organiserId, reason, getToken);
      removed(item, suspendedMessage(item.displayName, outcome));
      setSuspending(null);
      return { ok: true };
    } catch (err) {
      if (err instanceof ApiError && err.fieldErrors?.reason) return { ok: false, reasonError: err.fieldErrors.reason };
      if (err instanceof ApiError && (err.status === 409 || err.status === 404)) {
        suspendGone.current = item.organiserId;
        return { ok: false, message: err.message, gone: true };
      }
      return { ok: false, message: actionErrorText(err, "Couldn’t suspend them. Try again.") };
    }
  }

  /** The dialog closed (Cancel, Escape or Close); after a success `suspending` is already null. */
  function suspendClosed() {
    const item = suspending;
    if (!item) return;
    setSuspending(null);
    if (suspendGone.current === item.organiserId) {
      suspendGone.current = null;
      removed(item, `${item.displayName} is no longer approved, so they’ve been taken off this list.`);
    } else {
      pendingFocus.current = suspendButtonId(item.organiserId);
    }
  }

  async function loadMore() {
    if (state.status !== "ready" || !state.nextCursor || loadingMore) return;
    setLoadingMore(true);
    setMoreError(null);
    try {
      const page = await adminListOrganisers(status, getToken, state.nextCursor);
      const known = new Set(state.items.map((i) => i.organiserId));
      const fresh = page.items.filter((i) => !known.has(i.organiserId));
      setItems((current) => [...current, ...fresh], page.nextCursor ?? null);
      if (fresh[0]) pendingFocus.current = organiserHeadingId(fresh[0].organiserId);
    } catch (err) {
      setMoreError(actionErrorText(err, "Couldn’t load more organisers."));
    } finally {
      setLoadingMore(false);
    }
  }

  const current = STATUSES.find((s) => s.value === status) ?? STATUSES[0];

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
              setStatus(s.value);
              setAnnouncement("");
              setMoreError(null);
            }}
          >
            {s.label}
          </Button>
        ))}
      </div>

      {/* Always rendered so each result is announced; empty, it takes no space. */}
      <p role="status" className="border-l-2 border-foreground py-1 pl-4 text-sm empty:sr-only">
        {announcement}
      </p>

      <section aria-labelledby="organisers-heading" aria-busy={state.status === "loading" ? true : undefined}>
        <h2 id="organisers-heading" ref={headingRef} tabIndex={-1} className="display-md !text-2xl outline-offset-2">
          {current.heading}
        </h2>
        {current.intro && <p className="mt-2 text-sm text-muted">{current.intro}</p>}

        <div className="mt-4">
          {state.status === "loading" && <p className="text-sm text-muted">Loading…</p>}

          {state.status === "error" && (
            <div className="flex flex-col items-start gap-3">
              <Notice tone="danger" role="alert">
                {state.message}
              </Notice>
              <Button variant="outline" size="sm" className="min-h-11" onClick={() => setAttempt((n) => n + 1)}>
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
                  onSuspend={setSuspending}
                />
              ))}
            </ul>
          )}

          {state.status === "ready" && state.nextCursor && (
            <div className="mt-6 flex flex-col items-start gap-3">
              {moreError && <Notice tone="danger">{moreError}</Notice>}
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
