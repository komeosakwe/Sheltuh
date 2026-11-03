"use client";

import { useEffect, useRef, useState } from "react";
import StopHolderMessageDialog from "@/components/admin/StopHolderMessageDialog";
import { Button } from "@/components/ui/Button";
import { LoadingState } from "@/components/ui/ProgressLoader";
import { EmptyState, Notice } from "@/components/ui/Section";
import { ApiError, type GetToken } from "@/lib/api/client";
import { adminCancelHolderMessage, adminGetHolderMessage, adminListHolderMessages } from "@/lib/api/holder-messages";
import type { AdminHolderMessage, AdminHolderMessageDetail } from "@/lib/api/types";
import { useAuth } from "@/lib/auth/AuthContext";
import { formatMessageTime } from "@/lib/format";

type LoadState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; items: AdminHolderMessage[]; nextCursor?: string };

function errorText(err: unknown, fallback: string) {
  return err instanceof ApiError && err.status >= 400 && err.status < 500 ? err.message : fallback;
}

/**
 * /admin/event-messages: the messages organisers have sent to their ticket
 * holders, newest first (no addresses). Open one to read it; Stop it if it
 * shouldn't go out (whatever hasn't been sent never is). The list can be
 * narrowed to one event.
 */
export default function HolderMessages() {
  const getToken = useAuth().getAccessToken;
  const [event, setEvent] = useState<{ id: string; title: string } | null>(null);
  const [attempt, setAttempt] = useState(0);
  const key = `${event?.id ?? ""}#${attempt}`;
  const [result, setResult] = useState<{ key: string; state: LoadState } | null>(null);
  const state: LoadState = result?.key === key ? result.state : { status: "loading" };
  const [loadingMore, setLoadingMore] = useState(false);
  const [moreError, setMoreError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    adminListHolderMessages({ eventId: event?.id }, getToken).then(
      (page) => {
        if (!cancelled) setResult({ key, state: { status: "ready", items: page.items, nextCursor: page.nextCursor } });
      },
      (err: unknown) => {
        if (!cancelled) setResult({ key, state: { status: "error", message: errorText(err, "Couldn’t load messages.") } });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [event?.id, getToken, key]);

  async function loadMore() {
    if (state.status !== "ready" || !state.nextCursor || loadingMore) return;
    setLoadingMore(true);
    setMoreError(null);
    try {
      const page = await adminListHolderMessages({ eventId: event?.id, cursor: state.nextCursor }, getToken);
      const known = new Set(state.items.map((m) => m.messageId));
      // Only onto the list it was loaded for: another filter may be showing by now.
      setResult((current) =>
        current && current.key === key && current.state.status === "ready"
          ? {
              key,
              state: {
                status: "ready",
                items: [...current.state.items, ...page.items.filter((m) => !known.has(m.messageId))],
                nextCursor: page.nextCursor,
              },
            }
          : current,
      );
    } catch (err) {
      setMoreError(errorText(err, "Couldn’t load more messages."));
    } finally {
      setLoadingMore(false);
    }
  }

  function stopped(message: AdminHolderMessage) {
    setResult((current) =>
      current && current.key === key && current.state.status === "ready"
        ? {
            key,
            state: { ...current.state, items: current.state.items.map((m) => (m.messageId === message.messageId ? message : m)) },
          }
        : current,
    );
  }

  return (
    <section aria-labelledby="event-messages-heading" aria-busy={state.status === "loading" ? true : undefined}>
      <h2 id="event-messages-heading" className="display-md mb-4 !text-2xl">
        {event ? `Messages for ${event.title}` : "Messages to ticket holders"}
      </h2>

      {event && (
        <div className="mb-4">
          <Button variant="outline" size="sm" className="min-h-11" onClick={() => setEvent(null)}>
            Show all events
          </Button>
        </div>
      )}

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

      {state.status === "ready" && state.items.length === 0 && <EmptyState title="No messages sent" />}

      {state.status === "ready" && state.items.length > 0 && (
        <ul className="flex flex-col">
          {state.items.map((message) => (
            <MessageItem
              key={message.messageId}
              message={message}
              filtered={event !== null}
              getToken={getToken}
              onStopped={stopped}
              onOnlyThisEvent={() => setEvent({ id: message.eventId, title: message.eventTitle })}
            />
          ))}
        </ul>
      )}

      {state.status === "ready" && state.nextCursor && (
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
  );
}

type DetailState =
  | { status: "closed" }
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; detail: AdminHolderMessageDetail };

function MessageItem({
  message,
  filtered,
  getToken,
  onStopped,
  onOnlyThisEvent,
}: {
  message: AdminHolderMessage;
  filtered: boolean;
  getToken: GetToken;
  onStopped: (message: AdminHolderMessage) => void;
  onOnlyThisEvent: () => void;
}) {
  const [detail, setDetail] = useState<DetailState>({ status: "closed" });
  const [confirming, setConfirming] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [stopProblem, setStopProblem] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const toggleRef = useRef<HTMLButtonElement>(null);
  const focusToggle = useRef(false);
  const panelId = `holder-message-${message.messageId}`;
  const open = detail.status !== "closed";

  // The Stop button leaves with the stop: focus goes back to the message's own button.
  useEffect(() => {
    if (!focusToggle.current || confirming) return;
    focusToggle.current = false;
    toggleRef.current?.focus();
  });

  async function load() {
    setDetail({ status: "loading" });
    try {
      setDetail({ status: "ready", detail: await adminGetHolderMessage(message.messageId, getToken) });
    } catch (err) {
      setDetail({ status: "error", message: errorText(err, "Couldn’t load this message.") });
    }
  }

  function toggle() {
    if (open) setDetail({ status: "closed" });
    else void load();
  }

  async function stop() {
    if (stopping) return;
    setStopping(true);
    setStopProblem(null);
    try {
      const updated = await adminCancelHolderMessage(message.messageId, getToken);
      setDetail({ status: "ready", detail: updated });
      onStopped(updated);
      setConfirming(false);
      focusToggle.current = true;
      setAnnouncement(`Stopped “${message.subject}”.`);
    } catch (err) {
      setStopProblem(errorText(err, "Couldn’t stop it. Try again."));
    } finally {
      setStopping(false);
    }
  }

  return (
    <li className="border-t border-foreground py-4">
      <h3 className="font-sans text-base font-semibold normal-case tracking-normal">
        <button
          ref={toggleRef}
          type="button"
          aria-expanded={open}
          aria-controls={panelId}
          onClick={toggle}
          className="flex min-h-11 w-full items-center justify-between gap-3 text-left break-words"
        >
          <span className="min-w-0">{message.subject}</span>
          <span aria-hidden="true" className="shrink-0 text-muted">
            {open ? "−" : "+"}
          </span>
        </button>
      </h3>
      <p className="text-sm text-muted">
        {message.eventTitle} · {message.organiserName}
      </p>
      <p className="text-sm">
        <time dateTime={message.createdAt}>{formatMessageTime(message.createdAt)}</time>
        {" · "}Sent {message.sentCount} of {message.recipientCount}
        {message.skippedCount > 0 && <> · {message.skippedCount} skipped</>}
        {message.cancelled && <> · Stopped</>}
      </p>

      <div id={panelId} hidden={!open} className="mt-3 flex flex-col gap-3">
        {detail.status === "loading" && <LoadingState text="Loading…" />}
        {detail.status === "error" && (
          <div className="flex flex-col items-start gap-3">
            <Notice tone="danger" role="alert">
              {detail.message}
            </Notice>
            <Button variant="outline" size="sm" className="min-h-11" onClick={() => void load()}>
              Try again
            </Button>
          </div>
        )}
        {detail.status === "ready" && (
          <>
            <p className="text-sm leading-5 break-words whitespace-pre-wrap border-l-2 border-foreground pl-4">
              {detail.detail.body}
            </p>
            {detail.detail.cancelled && detail.detail.cancelledAt && (
              <p className="text-sm text-muted">Stopped {formatMessageTime(detail.detail.cancelledAt)}.</p>
            )}
            <div className="flex flex-col gap-3 sm:flex-row">
              {!detail.detail.cancelled && (
                <Button
                  variant="danger"
                  size="sm"
                  className="min-h-11"
                  aria-label={`Stop “${message.subject}”`}
                  onClick={() => {
                    setStopProblem(null);
                    setConfirming(true);
                  }}
                >
                  Stop
                </Button>
              )}
              {!filtered && (
                <Button variant="outline" size="sm" className="min-h-11" onClick={onOnlyThisEvent}>
                  Only this event
                </Button>
              )}
            </div>
          </>
        )}
      </div>

      <StopHolderMessageDialog
        subject={confirming ? message.subject : null}
        busy={stopping}
        problem={stopProblem}
        onStop={stop}
        onClose={() => setConfirming(false)}
      />
      <p role="status" className="sr-only">
        {announcement}
      </p>
    </li>
  );
}
