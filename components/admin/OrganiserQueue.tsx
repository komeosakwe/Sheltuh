"use client";

import { useCallback, useEffect, useState } from "react";
import { adminApproveOrganiser, adminListOrganisers, adminRejectOrganiser } from "@/lib/api/admin";
import type { OrganiserRecord, OrganiserStatus } from "@/lib/api/types";
import { useAuth } from "@/lib/auth/AuthContext";

const STATUSES: OrganiserStatus[] = ["pending", "approved", "rejected"];

export default function OrganiserQueue() {
  const auth = useAuth();
  const token = auth.idToken as string;

  const [status, setStatus] = useState<OrganiserStatus>("pending");
  const [items, setItems] = useState<OrganiserRecord[]>([]);
  const [cursor, setCursor] = useState<string | undefined>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [actionError, setActionError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(
    async (nextStatus: OrganiserStatus, append: boolean) => {
      setLoading(true);
      setError(null);
      try {
        const page = await adminListOrganisers(nextStatus, token, append ? cursor : undefined);
        setItems((prev) => (append ? [...prev, ...page.items] : page.items));
        setCursor(page.nextCursor);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Couldn't load applications.");
      } finally {
        setLoading(false);
      }
    },
    [token, cursor],
  );

  useEffect(() => {
    // Deferred so the fetch (and its setState calls) run after this effect
    // has committed, not synchronously as part of it. Reloading on status
    // change only — `load` itself changes identity as `cursor` updates,
    // which must not re-trigger this effect.
    let cancelled = false;
    queueMicrotask(() => {
      if (!cancelled) load(status, false);
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);

  async function handleApprove(item: OrganiserRecord) {
    setActionError(null);
    setBusyId(item.ownerUserId);
    try {
      await adminApproveOrganiser(item.ownerUserId, token);
      setItems((prev) => prev.filter((i) => i.ownerUserId !== item.ownerUserId));
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Couldn't approve this application.");
    } finally {
      setBusyId(null);
    }
  }

  async function handleReject(item: OrganiserRecord) {
    if (!reason.trim()) return;
    setActionError(null);
    setBusyId(item.ownerUserId);
    try {
      await adminRejectOrganiser(item.ownerUserId, reason.trim(), token);
      setItems((prev) => prev.filter((i) => i.ownerUserId !== item.ownerUserId));
      setRejectingId(null);
      setReason("");
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Couldn't reject this application.");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex gap-2">
        {STATUSES.map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => setStatus(s)}
            className={`rounded px-3 py-1.5 text-sm font-medium ${
              status === s ? "bg-accent text-accent-foreground" : "border border-surface-border text-foreground"
            }`}
          >
            {s[0].toUpperCase() + s.slice(1)}
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
      {!loading && items.length === 0 && <p className="text-sm text-muted">No {status} applications.</p>}

      <ul className="flex flex-col gap-3">
        {items.map((item) => (
          <li key={item.ownerUserId} className="rounded-lg border border-surface-border bg-surface p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="font-medium text-foreground">{item.displayName}</p>
                <p className="text-sm text-muted">{item.contactEmail}</p>
                <p className="mt-1 text-sm text-foreground">{item.description}</p>
                <p className="mt-1 text-xs text-muted">Categories: {item.categories.join(", ")}</p>
                {item.websiteUrl && (
                  <a href={item.websiteUrl} className="text-xs text-accent underline underline-offset-2">
                    {item.websiteUrl}
                  </a>
                )}
                {item.rejectionReason && (
                  <p className="mt-1 text-xs text-muted">Rejection reason: {item.rejectionReason}</p>
                )}
              </div>
              {status === "pending" && (
                <div className="flex shrink-0 gap-2">
                  <button
                    type="button"
                    onClick={() => handleApprove(item)}
                    disabled={busyId === item.ownerUserId}
                    className="rounded bg-accent px-3 py-1.5 text-sm font-medium text-accent-foreground disabled:opacity-60"
                  >
                    Approve
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setRejectingId(item.ownerUserId);
                      setReason("");
                    }}
                    disabled={busyId === item.ownerUserId}
                    className="rounded border border-danger/40 px-3 py-1.5 text-sm font-medium text-danger disabled:opacity-60"
                  >
                    Reject
                  </button>
                </div>
              )}
            </div>

            {rejectingId === item.ownerUserId && (
              <div className="mt-3 flex flex-col gap-2 border-t border-surface-border pt-3">
                <label htmlFor={`reason-${item.ownerUserId}`} className="text-sm font-medium text-foreground">
                  Reason (shown to the applicant)
                </label>
                <textarea
                  id={`reason-${item.ownerUserId}`}
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  rows={2}
                  className="rounded border border-surface-border bg-background px-3 py-2 text-foreground"
                />
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => handleReject(item)}
                    disabled={!reason.trim() || busyId === item.ownerUserId}
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
