"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import { LoadingState } from "@/components/ui/ProgressLoader";
import { Notice } from "@/components/ui/Section";
import { ApiError } from "@/lib/api/client";
import { getMyPayouts } from "@/lib/api/organisers";
import type { OrganiserPayoutEvent, OrganiserPayouts } from "@/lib/api/types";
import { useAuth } from "@/lib/auth/AuthContext";
import { formatAud, formatDayWithYear } from "@/lib/format";

const PAGE_SIZE = 20;

export const DELAYED_PAYOUTS_COPY =
  "We send your share about 2 days after your event ends. Stripe then pays your bank, usually in 1–3 business days.";

type LoadState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; payouts: OrganiserPayouts };

function errorText(err: unknown, fallback: string) {
  return err instanceof ApiError && err.status >= 400 && err.status < 500 ? err.message : fallback;
}

/** The lines worth saying for an event: amounts that are zero are left out. */
function eventAmounts(item: OrganiserPayoutEvent): { label: string; value: string }[] {
  const lines: { label: string; value: string }[] = [];
  if (item.paidOutCents > 0) lines.push({ label: "Paid out", value: formatAud(item.paidOutCents) });
  if (item.pendingCents > 0) {
    lines.push({
      label: "Pending",
      value: `${formatAud(item.pendingCents)}${item.dueAt ? `, due ${formatDayWithYear(item.dueAt)}` : ""}`,
    });
  }
  if (item.sentCents > 0) lines.push({ label: "Sent", value: formatAud(item.sentCents) });
  return lines;
}

/**
 * The organiser's money on /dashboard/payouts: totals (paid out, pending,
 * sent) and a list per event, newest first. Amounts are the organiser's
 * share. When payouts are delayed, says when the share is sent.
 */
export default function PayoutsEarnings() {
  const auth = useAuth();
  const getToken = auth.getAccessToken;
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState<{ attempt: number; state: LoadState } | null>(null);
  const state: LoadState = result?.attempt === attempt ? result.state : { status: "loading" };
  const [loadingMore, setLoadingMore] = useState(false);
  const [moreError, setMoreError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    getMyPayouts(getToken, { limit: PAGE_SIZE }).then(
      (payouts) => {
        if (!cancelled) setResult({ attempt, state: { status: "ready", payouts } });
      },
      (err: unknown) => {
        if (!cancelled) {
          setResult({ attempt, state: { status: "error", message: errorText(err, "Couldn’t load your payouts.") } });
        }
      },
    );
    return () => {
      cancelled = true;
    };
  }, [getToken, attempt]);

  async function loadMore() {
    if (state.status !== "ready" || !state.payouts.nextCursor || loadingMore) return;
    setLoadingMore(true);
    setMoreError(null);
    try {
      const page = await getMyPayouts(getToken, { limit: PAGE_SIZE, cursor: state.payouts.nextCursor });
      setResult((current) => {
        if (!current || current.attempt !== attempt || current.state.status !== "ready") return current;
        const known = new Set(current.state.payouts.items.map((i) => i.eventId));
        return {
          attempt,
          state: {
            status: "ready",
            payouts: {
              ...current.state.payouts,
              items: [...current.state.payouts.items, ...page.items.filter((i) => !known.has(i.eventId))],
              nextCursor: page.nextCursor,
            },
          },
        };
      });
    } catch (err) {
      setMoreError(errorText(err, "Couldn’t load more."));
    } finally {
      setLoadingMore(false);
    }
  }

  return (
    <section
      aria-labelledby="payouts-share-heading"
      aria-busy={state.status === "loading" ? true : undefined}
      className="flex flex-col gap-3 border-t border-foreground pt-5"
    >
      <h2 id="payouts-share-heading" className="font-heading text-xl text-foreground">
        Your share
      </h2>

      {state.status === "loading" && <LoadingState text="Loading your payouts…" />}

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

      {state.status === "ready" && (
        <>
          {state.payouts.delayedPayouts && <p className="text-sm text-muted">{DELAYED_PAYOUTS_COPY}</p>}

          {state.payouts.items.length === 0 ? (
            <p className="text-sm text-muted">No ticket sales yet.</p>
          ) : (
            <>
              <dl className="grid grid-cols-3 gap-3 text-sm">
                <Total label="Paid out" cents={state.payouts.totals.paidOutCents} />
                <Total label="Pending" cents={state.payouts.totals.pendingCents} />
                <Total label="Sent" cents={state.payouts.totals.sentCents} />
              </dl>

              <ul className="flex flex-col">
                {state.payouts.items.map((item) => {
                  const lines = eventAmounts(item);
                  return (
                    <li key={item.eventId} className="flex flex-col gap-1 border-t border-surface-border py-3">
                      <h3 className="font-sans text-base font-semibold normal-case tracking-normal break-words">
                        {item.title}
                      </h3>
                      <p className="text-sm text-muted">Ended {formatDayWithYear(item.endsAt)}</p>
                      {lines.length > 0 && (
                        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
                          {lines.map((line) => (
                            <div key={line.label} className="contents">
                              <dt className="text-muted">{line.label}</dt>
                              <dd className="break-words">{line.value}</dd>
                            </div>
                          ))}
                        </dl>
                      )}
                    </li>
                  );
                })}
              </ul>

              {state.payouts.nextCursor && (
                <div className="flex flex-col items-start gap-3">
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
            </>
          )}
        </>
      )}
    </section>
  );
}

function Total({ label, cents }: { label: string; cents: number }) {
  return (
    <div className="flex flex-col gap-1">
      <dt className="text-muted">{label}</dt>
      <dd className="font-heading text-xl text-foreground">{formatAud(cents)}</dd>
    </div>
  );
}
