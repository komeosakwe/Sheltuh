"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import InitialsAvatar from "@/components/ui/InitialsAvatar";
import { EmptyState, Notice } from "@/components/ui/Section";
import ActionErrorNotice from "@/components/whos-going/ActionErrorNotice";
import type { GetToken } from "@/lib/api/client";
import { listConversations } from "@/lib/api/messages";
import type { ConversationStatus, ConversationSummary } from "@/lib/api/types";
import { formatMessageTime } from "@/lib/format";
import { loadErrorMessage, threadHref } from "./shared";
import { useUnread } from "./UnreadProvider";

const LOAD_ERROR = "Couldn’t load your messages.";
const MORE_ERROR = "Couldn’t load more conversations.";

const STATUS_LABEL: Record<ConversationStatus, string | null> = {
  request_received: "Message request",
  request_sent: "Waiting for a reply",
  active: null,
};

type LoadState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; items: ConversationSummary[]; nextCursor?: string };

/**
 * /messages: the member's conversations, most recent first. Requests they've
 * received, requests they've sent and accepted conversations share one list
 * (the API pages them by activity), each labelled, with unread ones marked.
 */
export default function Inbox({ getToken }: { getToken: GetToken }) {
  const unread = useUnread();
  const refreshUnread = unread?.refresh;
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState<{ attempt: number; state: LoadState } | null>(null);
  const state: LoadState = result?.attempt === attempt ? result.state : { status: "loading" };
  const [loadingMore, setLoadingMore] = useState(false);
  const [moreError, setMoreError] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const pendingFocus = useRef<string | null>(null);
  const listRef = useRef<HTMLUListElement>(null);

  useEffect(() => {
    let cancelled = false;
    listConversations(getToken).then(
      (page) => {
        if (cancelled) return;
        setResult({ attempt, state: { status: "ready", items: page.items, nextCursor: page.nextCursor } });
        // The list is the truth about what's unread: bring the nav badge in step.
        refreshUnread?.();
      },
      (err: unknown) => {
        if (!cancelled) setResult({ attempt, state: { status: "error", message: loadErrorMessage(err, LOAD_ERROR) } });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [getToken, attempt, refreshUnread]);

  // Focus moves only after something the person did (Load more), once it's rendered.
  useEffect(() => {
    const id = pendingFocus.current;
    if (!id) return;
    const rows = listRef.current?.querySelectorAll<HTMLElement>("[data-conversation-id]") ?? [];
    const link = Array.from(rows)
      .find((row) => row.dataset.conversationId === id)
      ?.querySelector<HTMLElement>("a");
    if (!link) return; // Not rendered yet: an earlier render's effects can run first.
    pendingFocus.current = null;
    link.focus();
  });

  async function loadMore() {
    if (state.status !== "ready" || !state.nextCursor || loadingMore) return;
    setLoadingMore(true);
    setMoreError(null);
    try {
      const page = await listConversations(getToken, state.nextCursor);
      const known = new Set(state.items.map((c) => c.conversationId));
      const fresh = page.items.filter((c) => !known.has(c.conversationId));
      setResult({ attempt, state: { status: "ready", items: [...state.items, ...fresh], nextCursor: page.nextCursor } });
      const noun = fresh.length === 1 ? "conversation" : "conversations";
      setAnnouncement(fresh.length > 0 ? `${fresh.length} more ${noun} shown.` : "That’s everything.");
      if (fresh[0]) pendingFocus.current = fresh[0].conversationId;
    } catch (err) {
      setMoreError(loadErrorMessage(err, MORE_ERROR));
    } finally {
      setLoadingMore(false);
    }
  }

  return (
    <div aria-busy={state.status === "loading" ? true : undefined}>
      {state.status === "loading" && <p className="text-sm text-muted">Loading your messages…</p>}

      {state.status === "error" && (
        <div className="flex flex-col items-start gap-3">
          <ActionErrorNotice message={state.message} returnTo="/messages" />
          <Button variant="outline" size="sm" className="min-h-11" onClick={() => setAttempt((n) => n + 1)}>
            Try again
          </Button>
        </div>
      )}

      {state.status === "ready" && state.items.length === 0 && (
        <EmptyState title="No messages yet">
          When you&rsquo;re going to an event and have added yourself to its Who&rsquo;s Going list, you can
          message other people who&rsquo;ve added themselves. Their replies and requests show up here.
        </EmptyState>
      )}

      {state.status === "ready" && state.items.length > 0 && (
        <>
          <ul ref={listRef} aria-label="Conversations" className="border-t border-foreground">
            {state.items.map((conversation) => (
              <ConversationRow key={conversation.conversationId} conversation={conversation} />
            ))}
          </ul>
          {state.nextCursor && (
            <div className="mt-6 flex flex-col items-start gap-3">
              {moreError && <Notice tone="danger">{moreError}</Notice>}
              <Button variant="outline" busy={loadingMore} onClick={loadMore} className="min-h-11 w-full sm:w-auto">
                {loadingMore ? "Loading…" : "Load more"}
              </Button>
            </div>
          )}
        </>
      )}

      <p role="status" className="sr-only">
        {announcement}
      </p>
    </div>
  );
}

function ConversationRow({ conversation }: { conversation: ConversationSummary }) {
  const { otherDisplayName, status, event, lastMessage, unread } = conversation;
  const label = STATUS_LABEL[status];
  return (
    <li data-conversation-id={conversation.conversationId} className="border-b border-surface-border">
      <Link
        href={threadHref(conversation.conversationId)}
        className="flex min-h-11 gap-3 py-4 outline-offset-2 hover:bg-surface"
      >
        <InitialsAvatar name={otherDisplayName} />
        <span className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="flex items-baseline justify-between gap-3">
            <span className={`truncate text-base leading-6 ${unread ? "font-semibold" : ""}`.trim()}>
              {unread && <span className="sr-only">Unread: </span>}
              {otherDisplayName}
            </span>
            <time dateTime={lastMessage.sentAt} className="shrink-0 text-xs text-muted">
              {formatMessageTime(lastMessage.sentAt)}
            </time>
          </span>
          {(label || event) && (
            <span className="flex flex-wrap items-baseline gap-x-2 text-xs text-muted">
              {label && <span className="eyebrow text-foreground">{label}</span>}
              {event && <span className="min-w-0 truncate">{event.title}</span>}
            </span>
          )}
          <span
            className={`line-clamp-2 text-sm leading-5 break-words ${unread ? "text-foreground" : "text-muted"}`}
          >
            {lastMessage.fromYou && <span className="text-muted">You: </span>}
            {lastMessage.preview}
          </span>
        </span>
        {unread && (
          <span aria-hidden="true" data-unread-dot="" className="mt-2 size-2.5 shrink-0 bg-foreground" />
        )}
      </Link>
    </li>
  );
}
