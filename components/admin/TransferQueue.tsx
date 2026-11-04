"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { SelectedDots } from "@/components/ui/FilterChip";
import { LoadingState } from "@/components/ui/ProgressLoader";
import { EmptyState, Notice } from "@/components/ui/Section";
import { adminListTransfers } from "@/lib/api/admin";
import { ApiError } from "@/lib/api/client";
import type { AdminTransfer, AdminTransfersPage, TransferAction, TransferStatus } from "@/lib/api/types";
import { useAuth } from "@/lib/auth/AuthContext";
import { formatAud, formatMessageTime } from "@/lib/format";
import { useStatusParam } from "./admin-list-url";
import TransferItem from "./TransferItem";
import {
  inTransferView,
  OPEN_TRANSFER_STATUSES,
  TRANSFER_ACTION_LABEL,
  TRANSFER_STATUS_LABEL,
  transferHeadingId,
} from "./transfer-copy";

type View = TransferStatus | "open";

const VIEWS: { value: View; label: string; heading: string }[] = [
  { value: "open", label: "Open", heading: "Open transfers" },
  { value: "failed", label: "Failed", heading: "Failed transfers" },
  { value: "held", label: "Held", heading: "Held transfers" },
  { value: "retry", label: "Retrying", heading: "Transfers retrying automatically" },
  { value: "sending", label: "Sending now", heading: "Transfers sending now" },
  { value: "sent", label: "Sent", heading: "Sent transfers" },
  { value: "cancelled", label: "Cancelled", heading: "Cancelled transfers" },
];

type LoadState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; page: AdminTransfersPage };

function errorText(err: unknown, fallback: string) {
  return err instanceof ApiError && err.status >= 400 && err.status < 500 ? err.message : fallback;
}

function countFor(view: View, counts: AdminTransfersPage["counts"]): number {
  return view === "open" ? OPEN_TRANSFER_STATUSES.reduce((sum, s) => sum + counts[s], 0) : counts[view];
}

/** The page's counts and owed total after one transfer changed status. */
function withChange(page: AdminTransfersPage, before: AdminTransfer, after: AdminTransfer): AdminTransfersPage {
  if (before.status === after.status) return page;
  const counts = { ...page.counts, [before.status]: Math.max(0, page.counts[before.status] - 1) };
  counts[after.status] += 1;
  const owedLeaves = after.status === "cancelled" || after.status === "sent";
  return {
    ...page,
    counts,
    owedToOrganisersCents: owedLeaves ? Math.max(0, page.owedToOrganisersCents - after.amountCents) : page.owedToOrganisersCents,
  };
}

/**
 * /admin/payouts: organiser transfers (delayed payouts) by status, with the
 * actions that apply to each: retry, release (after a confirm) and cancel
 * (after a confirm). Orders appear by their short reference and no buyer
 * details. The filter is kept in `?status=` (Open, the default, is every
 * transfer that still needs sending or a person).
 */
export default function TransferQueue() {
  const auth = useAuth();
  const getToken = auth.getAccessToken;
  const [view, setView] = useStatusParam<View>("/admin/payouts", VIEWS, "open");
  const [attempt, setAttempt] = useState(0);
  const key = `${view}#${attempt}`;
  const [result, setResult] = useState<{ key: string; state: LoadState } | null>(null);
  const state: LoadState = result?.key === key ? result.state : { status: "loading" };
  const [loadingMore, setLoadingMore] = useState(false);
  const [moreError, setMoreError] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState("");
  // Where focus goes once an acted-on transfer has left the list (its button is gone): an element id.
  const focusAfterRemoval = useRef<string | null>(null);

  useEffect(() => {
    if (!focusAfterRemoval.current) return;
    const element = document.getElementById(focusAfterRemoval.current);
    if (!element) return;
    focusAfterRemoval.current = null;
    element.focus();
  });

  useEffect(() => {
    let cancelled = false;
    adminListTransfers(getToken, { status: view }).then(
      (page) => {
        if (!cancelled) setResult({ key, state: { status: "ready", page } });
      },
      (err: unknown) => {
        if (!cancelled) setResult({ key, state: { status: "error", message: errorText(err, "Couldn’t load transfers.") } });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [view, getToken, key]);

  function changed(before: AdminTransfer, after: AdminTransfer, action: TransferAction) {
    const stays = inTransferView(view, after.status);
    const what = `${TRANSFER_ACTION_LABEL[action]} for order ${after.orderReference}: now ${TRANSFER_STATUS_LABEL[after.status].toLowerCase()}.`;
    if (!stays && state.status === "ready") {
      const items = state.page.items;
      const index = items.findIndex((t) => t.transferId === before.transferId);
      const neighbour = items[index + 1] ?? items[index - 1];
      focusAfterRemoval.current =
        neighbour && neighbour.transferId !== before.transferId ? transferHeadingId(neighbour) : "transfers-heading";
    }
    setResult((current) => {
      if (!current || current.key !== key || current.state.status !== "ready") return current;
      const page = withChange(current.state.page, before, after);
      const items = stays
        ? page.items.map((t) => (t.transferId === after.transferId ? after : t))
        : page.items.filter((t) => t.transferId !== after.transferId);
      return { key, state: { status: "ready", page: { ...page, items } } };
    });
    setAnnouncement(stays ? what : `${what} It’s moved out of this list.`);
  }

  async function loadMore() {
    if (state.status !== "ready" || !state.page.nextCursor || loadingMore) return;
    setLoadingMore(true);
    setMoreError(null);
    try {
      const more = await adminListTransfers(getToken, { status: view, cursor: state.page.nextCursor });
      // Only onto the list it was loaded for: another filter may be showing by now.
      setResult((current) => {
        if (!current || current.key !== key || current.state.status !== "ready") return current;
        const known = new Set(current.state.page.items.map((t) => t.transferId));
        return {
          key,
          state: {
            status: "ready",
            page: {
              ...current.state.page,
              items: [...current.state.page.items, ...more.items.filter((t) => !known.has(t.transferId))],
              nextCursor: more.nextCursor,
            },
          },
        };
      });
    } catch (err) {
      setMoreError(errorText(err, "Couldn’t load more transfers."));
    } finally {
      setLoadingMore(false);
    }
  }

  const heading = VIEWS.find((v) => v.value === view)?.heading ?? view;
  const page = state.status === "ready" ? state.page : null;

  return (
    <div className="flex flex-col gap-6">
      {page && (
        <div className="flex flex-col gap-1 text-sm">
          <p className="text-base font-semibold">Owed to organisers: {formatAud(page.owedToOrganisersCents)}</p>
          <p className="text-muted">
            {page.lastRun
              ? `Last run ${formatMessageTime(page.lastRun.finishedAt)}: ${page.lastRun.sent} sent, ${page.lastRun.retrying} retrying, ${page.lastRun.failed} failed (${page.lastRun.claimed} picked up).`
              : "No payouts run yet."}
          </p>
        </div>
      )}

      <div role="group" aria-label="Show transfers" className="flex flex-wrap gap-2">
        {VIEWS.map((v) => (
          <Button
            key={v.value}
            variant={view === v.value ? "solid" : "outline"}
            size="sm"
            className="min-h-11"
            aria-pressed={view === v.value}
            onClick={() => {
              setView(v.value);
              setAnnouncement("");
            }}
          >
            {view === v.value && <SelectedDots />}
            {v.label}
            {page ? ` (${countFor(v.value, page.counts)})` : ""}
          </Button>
        ))}
      </div>

      <section aria-labelledby="transfers-heading" aria-busy={state.status === "loading" ? true : undefined}>
        <h2 id="transfers-heading" tabIndex={-1} className="display-md mb-4 !text-2xl outline-offset-2">
          {heading}
        </h2>

        {state.status === "loading" && <LoadingState text="Loading…" />}

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

        {page && page.items.length === 0 && (
          <EmptyState title={view === "open" ? "Nothing needs you" : "None right now"} />
        )}

        {page && page.items.length > 0 && (
          <ul className="flex flex-col gap-4">
            {page.items.map((transfer) => (
              <TransferItem key={transfer.transferId} transfer={transfer} getToken={getToken} onChanged={changed} />
            ))}
          </ul>
        )}

        {page?.nextCursor && (
          <div className="mt-6 flex flex-col items-start gap-3">
            {moreError && (
              <Notice tone="danger" role="alert">
                {moreError}
              </Notice>
            )}
            <Button variant="outline" busy={loadingMore} onClick={loadMore} className="min-h-11">
              {loadingMore ? "Loading…" : "Load more"}
            </Button>
          </div>
        )}
      </section>

      <p role="status" className="sr-only">
        {announcement}
      </p>
    </div>
  );
}
