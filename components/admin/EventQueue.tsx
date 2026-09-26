"use client";

import { useCallback, useEffect, useState } from "react";
import { adminApproveEvent, adminListEvents, adminRejectEvent, adminUnpublishEvent } from "@/lib/api/admin";
import type { EventRecord, EventStatus } from "@/lib/api/types";
import { useAuth } from "@/lib/auth/AuthContext";
import { formatEventDateTimeRange } from "@/lib/format";

const STATUSES: EventStatus[] = ["pending_review", "published", "draft", "rejected"];
const STATUS_LABEL: Record<EventStatus, string> = {
  draft: "Draft",
  pending_review: "Pending review",
  published: "Published",
  rejected: "Rejected",
};

export default function EventQueue() {
  const auth = useAuth();
  const getToken = auth.getAccessToken;

  const [status, setStatus] = useState<EventStatus>("pending_review");
  const [items, setItems] = useState<EventRecord[]>([]);
  const [cursor, setCursor] = useState<string | undefined>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [actionError, setActionError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(
    async (nextStatus: EventStatus, append: boolean) => {
      setLoading(true);
      setError(null);
      try {
        const page = await adminListEvents(nextStatus, getToken, append ? cursor : undefined);
        setItems((prev) => (append ? [...prev, ...page.items] : page.items));
        setCursor(page.nextCursor);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Couldn't load events.");
      } finally {
        setLoading(false);
      }
    },
    [getToken, cursor],
  );

  useEffect(() => {
    let cancelled = false;
    queueMicrotask(() => {
      if (!cancelled) load(status, false);
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);

  function removeItem(eventId: string) {
    setItems((prev) => prev.filter((i) => i.eventId !== eventId));
  }

  async function handleApprove(item: EventRecord) {
    setActionError(null);
    setBusyId(item.eventId);
    try {
      await adminApproveEvent(item.eventId, getToken);
      removeItem(item.eventId);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Couldn't approve this event.");
    } finally {
      setBusyId(null);
    }
  }

  async function handleReject(item: EventRecord) {
    if (!reason.trim()) return;
    setActionError(null);
    setBusyId(item.eventId);
    try {
      await adminRejectEvent(item.eventId, reason.trim(), getToken);
      removeItem(item.eventId);
      setRejectingId(null);
      setReason("");
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Couldn't reject this event.");
    } finally {
      setBusyId(null);
    }
  }

  async function handleUnpublish(item: EventRecord) {
    setActionError(null);
    setBusyId(item.eventId);
    try {
      await adminUnpublishEvent(item.eventId, getToken);
      removeItem(item.eventId);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Couldn't unpublish this event.");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap gap-2">
        {STATUSES.map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => setStatus(s)}
            className={`rounded px-3 py-1.5 text-sm font-medium ${
              status === s ? "bg-accent text-accent-foreground" : "border border-surface-border text-foreground"
            }`}
          >
            {STATUS_LABEL[s]}
          </button>
        ))}
      </div>

      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
      {actionError && (
        <p role="alert" className="text-sm text-danger">
          {actionError}
        </p>
      )}

      {loading && items.length === 0 && <p className="text-sm text-muted">Loading…</p>}
      {!loading && items.length === 0 && <p className="text-sm text-muted">No events with this status.</p>}

      <ul className="flex flex-col gap-3">
        {items.map((item) => (
          <li key={item.eventId} className="rounded-lg border border-surface-border bg-surface p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="font-medium text-foreground">{item.title}</p>
                <p className="text-sm text-muted">
                  {item.organiserName} &middot; {formatEventDateTimeRange(item.startsAt, item.endsAt)}
                </p>
                <p className="mt-1 text-sm text-foreground">{item.description}</p>
                <p className="mt-1 text-xs text-muted">
                  {item.venueName}, {item.suburb}
                </p>
                {item.rejectionReason && (
                  <p className="mt-1 text-xs text-muted">Rejection reason: {item.rejectionReason}</p>
                )}
              </div>
              <div className="flex shrink-0 gap-2">
                {status === "pending_review" && (
                  <>
                    <button
                      type="button"
                      onClick={() => handleApprove(item)}
                      disabled={busyId === item.eventId}
                      className="rounded bg-accent px-3 py-1.5 text-sm font-medium text-accent-foreground disabled:opacity-60"
                    >
                      Approve
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setRejectingId(item.eventId);
                        setReason("");
                      }}
                      disabled={busyId === item.eventId}
                      className="rounded border border-danger/40 px-3 py-1.5 text-sm font-medium text-danger disabled:opacity-60"
                    >
                      Reject
                    </button>
                  </>
                )}
                {status === "published" && (
                  <button
                    type="button"
                    onClick={() => handleUnpublish(item)}
                    disabled={busyId === item.eventId}
                    className="rounded border border-surface-border px-3 py-1.5 text-sm font-medium text-foreground disabled:opacity-60"
                  >
                    Unpublish
                  </button>
                )}
              </div>
            </div>

            {rejectingId === item.eventId && (
              <div className="mt-3 flex flex-col gap-2 border-t border-surface-border pt-3">
                <label htmlFor={`reason-${item.eventId}`} className="text-sm font-medium text-foreground">
                  Reason (shown to the organiser)
                </label>
                <textarea
                  id={`reason-${item.eventId}`}
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  rows={2}
                  className="rounded border border-surface-border bg-background px-3 py-2 text-foreground"
                />
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => handleReject(item)}
                    disabled={!reason.trim() || busyId === item.eventId}
                    className="rounded bg-danger px-3 py-1.5 text-sm font-medium text-danger-foreground disabled:opacity-60"
                  >
                    Confirm rejection
                  </button>
                  <button
                    type="button"
                    onClick={() => setRejectingId(null)}
                    className="rounded border border-surface-border px-3 py-1.5 text-sm font-medium text-foreground"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </li>
        ))}
      </ul>

      {cursor && (
        <button
          type="button"
          onClick={() => load(status, true)}
          disabled={loading}
          className="w-fit rounded border border-surface-border px-4 py-2 text-sm font-medium disabled:opacity-60"
        >
          {loading ? "Loading…" : "Load more"}
        </button>
      )}
    </div>
  );
}
