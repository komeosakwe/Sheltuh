"use client";

import Link from "next/link";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Notice } from "@/components/ui/Section";
import ActionErrorNotice from "@/components/whos-going/ActionErrorNotice";
import type { GetToken } from "@/lib/api/client";
import { listConversations } from "@/lib/api/messages";
import type { ConversationStatus, ConversationSummary } from "@/lib/api/types";
import { formatMessageTime, formatShortAgo } from "@/lib/format";
import ConversationAvatar from "./ConversationAvatar";
import { useInboxVersion } from "./InboxSync";
import { loadErrorMessage, threadHref } from "./shared";
import { useUnread } from "./UnreadProvider";
import { LoadingState } from "@/components/ui/ProgressLoader";

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
  | { status: "ready"; items: ConversationSummary[]; nextCursor?: string; stale?: boolean };

/**
 * /messages: the member's conversations, most recent first. Requests they've
 * received, requests they've sent and accepted conversations share one list
 * (the API pages them by activity), each labelled, with unread ones marked.
 */
export default function Inbox({ getToken, selectedId }: { getToken: GetToken; selectedId?: string | null }) {
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

  // Loads the list, and reloads it whenever the conversation beside it changed something (InboxSync)
  // or you move to another conversation or back to /messages (`selectedId`: the list doesn't poll, so
  // that's when it picks up conversations that changed elsewhere). A reload keeps the rows on screen
  // until the new ones arrive, and fetches as many as are shown (following the pages Load more
  // reached), and further if need be to reach the open conversation (new ones above it push it down
  // a page), so a conversation from a later page doesn't drop out. Only what the API returns is
  // shown, so a conversation blocked or declined stays out. If it fails, the rows stay, marked as
  // possibly out of date.
  const syncVersion = useInboxVersion();
  /** Try again after a failed reload: reloads, keeping the rows on screen meanwhile. */
  const [reloads, setReloads] = useState(0);
  // Each (re)load starts a new generation: a Load more begun before it is dropped when it lands, so
  // it can't put back rows the reload took out (a conversation just blocked) or announce them.
  // A Load more asked for while a reload is in flight waits for it (shown as busy), then runs.
  const listGeneration = useRef(0);
  const listLoading = useRef(false);
  const moreQueued = useRef(false);
  /** How many rows are on screen: a reload fetches at least that many. */
  const shownCount = useRef(0);
  const shown = state.status === "ready" ? state.items.length : 0;
  useLayoutEffect(() => {
    shownCount.current = shown;
  }, [shown]);
  /** Fetches the page after `list` and shows it under `list`'s rows (Load more, now or once a reload lands). */
  const loadMoreFrom = useCallback(
    async (list: { items: ConversationSummary[]; nextCursor?: string }) => {
      const generation = listGeneration.current;
      setLoadingMore(true);
      setMoreError(null);
      try {
        if (!list.nextCursor) {
          setAnnouncement("That’s everything.");
          return;
        }
        const page = await listConversations(getToken, list.nextCursor);
        if (generation !== listGeneration.current) return; // A reload replaced the list meanwhile.
        const items = appendNew(list.items, page.items);
        const fresh = items.slice(list.items.length);
        setResult({ attempt, state: { status: "ready", items, nextCursor: page.nextCursor } });
        const noun = fresh.length === 1 ? "conversation" : "conversations";
        setAnnouncement(fresh.length > 0 ? `${fresh.length} more ${noun} shown.` : "That’s everything.");
        if (fresh[0]) pendingFocus.current = fresh[0].conversationId;
      } catch (err) {
        if (generation === listGeneration.current) setMoreError(loadErrorMessage(err, MORE_ERROR));
      } finally {
        setLoadingMore(false);
      }
    },
    [getToken, attempt],
  );

  useEffect(() => {
    let cancelled = false;
    listGeneration.current += 1;
    listLoading.current = true;
    const keep = shownCount.current;
    async function reload() {
      const first = await listConversations(getToken);
      let items = first.items;
      let nextCursor = first.nextCursor;
      // As many as were shown, and on to the open conversation if new ones pushed it further down.
      const missingSelected = () => Boolean(selectedId) && !items.some((c) => c.conversationId === selectedId);
      while (!cancelled && nextCursor && (items.length < keep || missingSelected())) {
        const page = await listConversations(getToken, nextCursor);
        items = appendNew(items, page.items);
        nextCursor = page.nextCursor;
        if (page.items.length === 0) break;
      }
      return { items, nextCursor };
    }
    reload().then(
      (list) => {
        if (cancelled) return;
        listLoading.current = false;
        setResult({ attempt, state: { status: "ready", ...list } });
        // The list is the truth about what's unread: bring the nav badge in step.
        refreshUnread?.();
        if (moreQueued.current) {
          moreQueued.current = false;
          void loadMoreFrom(list);
        }
      },
      (err: unknown) => {
        if (cancelled) return;
        listLoading.current = false;
        if (moreQueued.current) {
          // The reload failed (said below the list): the queued Load more isn't run over rows that
          // may be out of date.
          moreQueued.current = false;
          setLoadingMore(false);
        }
        setResult((current) =>
          current?.attempt === attempt && current.state.status === "ready"
            ? { attempt, state: { ...current.state, stale: true } }
            : { attempt, state: { status: "error", message: loadErrorMessage(err, LOAD_ERROR) } },
        );
      },
    );
    return () => {
      cancelled = true;
    };
  }, [getToken, attempt, refreshUnread, syncVersion, selectedId, reloads, loadMoreFrom]);

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

  function loadMore() {
    if (state.status !== "ready" || !state.nextCursor || loadingMore) return;
    if (listLoading.current) {
      // Runs once the reload in flight lands, from its rows.
      moreQueued.current = true;
      setLoadingMore(true);
      setMoreError(null);
      return;
    }
    void loadMoreFrom(state);
  }

  return (
    <div aria-busy={state.status === "loading" ? true : undefined} className={CONVERSATIONS_PANEL_CLASS}>
      {state.status === "loading" && <LoadingState text="Loading your messages…" />}

      {state.status === "error" && (
        <div className="flex flex-col items-start gap-3">
          <ActionErrorNotice message={state.message} returnTo="/messages" />
          <Button variant="outline" size="sm" className="min-h-11" onClick={() => setAttempt((n) => n + 1)}>
            Try again
          </Button>
        </div>
      )}

      {state.status === "ready" && state.items.length === 0 && <InboxEmpty />}

      {/* A reload that failed (the list on screen may be out of date), with or without rows. */}
      {state.status === "ready" && state.stale && (
        <div role="status" className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2">
          <p className="label-tag text-muted">Couldn&rsquo;t refresh this list.</p>
          <button
            type="button"
            onClick={() => setReloads((n) => n + 1)}
            className="label-tag inline-flex min-h-11 items-center underline underline-offset-4 hover:decoration-2"
          >
            Try again
          </button>
        </div>
      )}

      {state.status === "ready" && state.items.length > 0 && (
        <>
          <ul ref={listRef} aria-label="Conversations" className={CONVERSATIONS_LIST_CLASS}>
            {state.items.map((conversation) => (
              <ConversationRow
                key={conversation.conversationId}
                conversation={conversation}
                selected={conversation.conversationId === selectedId}
              />
            ))}
          </ul>
          {state.nextCursor && (
            <div className="mt-2 flex flex-col items-start gap-3 px-2 pb-2">
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

/** `items` followed by those of `more` it doesn't already have (offset pages overlap when the list moves). */
function appendNew(items: ConversationSummary[], more: ConversationSummary[]): ConversationSummary[] {
  const known = new Set(items.map((c) => c.conversationId));
  return [...items, ...more.filter((c) => !known.has(c.conversationId))];
}

/**
 * The conversations' panel (Latte's Messages frames): cream (surface/card-hover), radius 16, 8px
 * in; 280px wide beside the thread from 768px and 360px from 1280px, full width above it on phones.
 */
export const CONVERSATIONS_PANEL_CLASS =
  "flex w-full shrink-0 flex-col gap-1 rounded-card bg-hover p-2 md:w-70 md:self-stretch xl:w-90";
const CONVERSATIONS_LIST_CLASS = "flex flex-col gap-1";

/** No conversations yet (until Latte designs it: one line and a link to Discover). */
export function InboxEmpty() {
  return (
    <div className="flex flex-col gap-1 p-4">
      <p className="body-s font-semibold">No messages yet</p>
      <p className="body-s text-muted">
        When someone going to the same event messages you, it shows up here.{" "}
        <Link href="/" className="font-semibold text-foreground underline underline-offset-4 hover:decoration-2">
          Discover events
        </Link>
      </p>
    </div>
  );
}

/**
 * One conversation in the list (the frames' "Conversation" row): a 44px round avatar, the name
 * (Body/S Strong when unread, Body/S when read; cut short with "…", never pushing the time out)
 * and the time (IBM Plex Mono 12/16) on top, the preview on one line under them (Label/Tag, black
 * when unread, text/secondary when read), and an 8px orange dot when unread. The open one is a
 * white row (aria-current="page"); the others fill white on hover or keyboard focus.
 */
export function ConversationRow({
  conversation,
  selected = false,
}: {
  conversation: ConversationSummary;
  selected?: boolean;
}) {
  const { otherDisplayName, status, lastMessage, unread } = conversation;
  const label = STATUS_LABEL[status];
  return (
    <li data-conversation-id={conversation.conversationId}>
      <Link
        href={threadHref(conversation.conversationId)}
        aria-current={selected ? "page" : undefined}
        className={`flex min-h-11 items-center gap-3 rounded-card px-4 py-3 outline-offset-2 hover:bg-background focus-visible:bg-background motion-safe:transition-colors motion-safe:duration-200 motion-safe:ease-out ${
          selected ? "bg-background" : ""
        }`.trim()}
      >
        <ConversationAvatar name={otherDisplayName} size="row" />
        <span className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="flex min-w-0 items-baseline justify-between gap-2">
            <span className={`body-s min-w-0 truncate ${unread ? "font-semibold" : ""}`.trim()}>
              {unread && <span className="sr-only">Unread: </span>}
              {otherDisplayName}
            </span>
            <time dateTime={lastMessage.sentAt} className="shrink-0 font-mono text-xs leading-4 text-muted">
              <span aria-hidden="true">{formatShortAgo(lastMessage.sentAt)}</span>
              <span className="sr-only">{formatMessageTime(lastMessage.sentAt)}</span>
            </time>
          </span>
          <span className={`label-tag truncate ${unread ? "text-foreground" : "text-muted"}`}>
            {label && <span className="font-semibold text-foreground">{label} · </span>}
            {lastMessage.fromYou && <span>You: </span>}
            {lastMessage.preview}
          </span>
        </span>
        {unread && <span aria-hidden="true" data-unread-dot="" className="size-2 shrink-0 rounded-full bg-signal" />}
      </Link>
    </li>
  );
}
