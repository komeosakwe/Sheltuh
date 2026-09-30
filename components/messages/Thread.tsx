"use client";

import Link from "next/link";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { EmptyState, Notice } from "@/components/ui/Section";
import ActionErrorNotice from "@/components/whos-going/ActionErrorNotice";
import { ApiError, type GetToken } from "@/lib/api/client";
import {
  blockMember,
  declineConversation,
  getMessages,
  markConversationRead,
  reportMember,
  sendMessage,
  unblockMember,
} from "@/lib/api/messages";
import type { ConversationSummary, MessageRecord, ReportReason } from "@/lib/api/types";
import { endSentence } from "@/lib/display-name";
import { useVisibleInterval } from "@/lib/use-visible-interval";
import Composer, { type SendOutcome } from "./Composer";
import MessageList from "./MessageList";
import ReportDialog, { type ReportOutcome } from "./ReportDialog";
import { loadErrorMessage, messagingError, tallInlineLinkClass, THREAD_POLL_MS, threadHref } from "./shared";
import { useUnread } from "./UnreadProvider";

const LOAD_ERROR = "Couldn’t load this conversation.";
const EARLIER_ERROR = "Couldn’t load earlier messages.";
const POLL_ERROR = "Couldn’t check for new messages. We’ll try again shortly.";
const SEND_RATE_LIMITED = "You’ve sent a lot of messages in the last hour. Take a break and try again a bit later.";
const BLOCK_RATE_LIMITED =
  "You’ve blocked a lot of people today. Try again tomorrow, or email support@sheltuh.com.au if someone is bothering you.";
const REPORT_RATE_LIMITED = "You’ve sent a lot of reports today. If it’s urgent, email support@sheltuh.com.au.";
/** Polling for newer messages follows at most this many pages in one go (50 each). */
const MAX_POLL_PAGES = 3;

interface ThreadData {
  conversation: ConversationSummary;
  messages: MessageRecord[];
  /** Older messages exist before the first one loaded. */
  hasEarlier: boolean;
}

type View =
  | { status: "loading" }
  | { status: "error"; message: string }
  /** Not there for this member (404): hidden, blocked by either side, or gone. All look the same. */
  | { status: "unavailable" }
  | { status: "declined"; name: string }
  /** `blockId` is unknown when the block already existed (a repeat or double submit gets a 404). */
  | { status: "blocked"; name: string; blockId?: string }
  | { status: "ready"; data: ThreadData };

type Focus = "heading" | "status" | "block-cancel" | "block" | "decline-cancel" | "decline" | { messageId: string };

function merge(existing: MessageRecord[], incoming: MessageRecord[], where: "before" | "after") {
  const known = new Set(existing.map((m) => m.messageId));
  const fresh = incoming.filter((m) => !known.has(m.messageId));
  return { fresh, messages: where === "before" ? [...fresh, ...existing] : [...existing, ...fresh] };
}

function waitingNote(name: string) {
  return `Waiting for ${name} to reply. You can send more once they do. People don’t always reply, and we won’t tell you either way.`;
}

/**
 * /messages/[conversationId]: one conversation. Messages oldest first, with
 * "Load earlier messages" at the top and the composer stuck to the foot of
 * the screen. New messages are checked every 10s while the tab is visible
 * and focused (paused otherwise), and announced in the page's one polite
 * live region. Block, Report and (for a request) Decline are in the header.
 */
export default function Thread({ conversationId, getToken }: { conversationId: string; getToken: GetToken }) {
  const unread = useUnread();
  const refreshUnread = unread?.refresh;
  const returnTo = threadHref(conversationId);

  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState<{ attempt: number; view: View } | null>(null);
  const view: View = result?.attempt === attempt ? result.view : { status: "loading" };
  const data = view.status === "ready" ? view.data : null;

  // Keyed, so the same words twice in a row ("New message from Sam.") are announced twice.
  const [announcement, setAnnouncementState] = useState({ text: "", n: 0 });
  const setAnnouncement = useCallback(
    (text: string) => setAnnouncementState((current) => ({ text, n: current.n + 1 })),
    [],
  );
  const [pollError, setPollError] = useState<string | null>(null);
  const [earlierBusy, setEarlierBusy] = useState(false);
  const [earlierError, setEarlierError] = useState<string | null>(null);
  const [newIds, setNewIds] = useState<ReadonlySet<string>>(new Set());
  const [confirming, setConfirming] = useState<"block" | "decline" | null>(null);
  const [actionBusy, setActionBusy] = useState<"block" | "decline" | "unblock" | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [reportOpen, setReportOpen] = useState(false);
  const [reported, setReported] = useState(false);

  const dataRef = useRef<ThreadData | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLOListElement>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const statusRef = useRef<HTMLDivElement>(null);
  const pendingFocus = useRef<Focus | null>(null);
  const pendingScroll = useRef<"initial" | "new" | null>(null);

  // A layout effect, so it's current at commit: a click or a poll never sees the previous render's data.
  useLayoutEffect(() => {
    dataRef.current = data;
  }, [data]);

  const show = useCallback((next: View) => setResult({ attempt, view: next }), [attempt]);
  const update = useCallback(
    (change: (d: ThreadData) => ThreadData) =>
      setResult((current) =>
        current && current.attempt === attempt && current.view.status === "ready"
          ? { attempt, view: { status: "ready", data: change(current.view.data) } }
          : current,
      ),
    [attempt],
  );

  /**
   * The conversation went away (404) mid-action or between checks. Focus
   * moves to the explanation if it was in the thread (whatever it was on
   * has just disappeared), never if it was somewhere else on the page.
   */
  const lose = useCallback(() => {
    const active = document.activeElement;
    const focusWasHere = !active || active === document.body || Boolean(rootRef.current?.contains(active));
    show({ status: "unavailable" });
    if (focusWasHere) pendingFocus.current = "heading";
    refreshUnread?.();
  }, [show, refreshUnread]);

  const markRead = useCallback(
    (lastMessageId: string | undefined) => {
      markConversationRead(conversationId, getToken, lastMessageId).then(
        () => {
          update((d) => ({ ...d, conversation: { ...d.conversation, unread: false } }));
          refreshUnread?.();
        },
        // Not shown: nothing the person can do about it. `unread` stays true,
        // so the next check for new messages tries again.
        () => undefined,
      );
    },
    [conversationId, getToken, update, refreshUnread],
  );

  // First load (and Try again, and after unblocking).
  useEffect(() => {
    let cancelled = false;
    getMessages(conversationId, getToken).then(
      (page) => {
        if (cancelled) return;
        setResult({
          attempt,
          view: { status: "ready", data: { conversation: page.conversation, messages: page.items, hasEarlier: page.hasMore } },
        });
        pendingScroll.current = "initial";
        // Only while it's on screen: opened in a background tab, it's marked
        // read by the first check once the tab is looked at.
        if (page.conversation.unread && document.visibilityState === "visible") markRead(page.items.at(-1)?.messageId);
      },
      (err: unknown) => {
        if (cancelled) return;
        const next: View =
          err instanceof ApiError && err.status === 404
            ? { status: "unavailable" }
            : { status: "error", message: loadErrorMessage(err, LOAD_ERROR) };
        setResult({ attempt, view: next });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [conversationId, getToken, attempt, markRead]);

  // Focus and scroll after the render that caused them has committed.
  useEffect(() => {
    const focus = pendingFocus.current;
    if (focus) {
      if (focus === "heading" || focus === "status") {
        // Kept until it's on screen (after unblocking, the heading only
        // exists once the conversation has loaded again), as are all targets.
        const target = focus === "heading" ? headingRef.current : statusRef.current;
        if (target) {
          pendingFocus.current = null;
          target.focus();
        }
      } else {
        const items = listRef.current?.querySelectorAll<HTMLElement>("[data-message-id]") ?? [];
        const target =
          typeof focus === "string"
            ? document.getElementById(`thread-${focus}`)
            : Array.from(items).find((li) => li.dataset.messageId === focus.messageId);
        // Only once it exists: an earlier render's effects can run first.
        if (target) {
          pendingFocus.current = null;
          target.focus();
        }
      }
    }
    const scroll = pendingScroll.current;
    if (scroll && endRef.current) {
      pendingScroll.current = null;
      const end = endRef.current;
      // New messages only scroll into view if the person was already at the bottom.
      const nearBottom = end.getBoundingClientRect().top <= window.innerHeight + 200;
      if (scroll === "initial" || nearBottom) end.scrollIntoView?.({ block: "end", behavior: scroll === "initial" ? "instant" : "auto" });
    }
  });

  const poll = useCallback(async () => {
    const current = dataRef.current;
    if (!current) return;
    let after = current.messages.at(-1)?.messageId;
    const fresh: MessageRecord[] = [];
    let conversation = current.conversation;
    try {
      for (let i = 0; i < MAX_POLL_PAGES; i++) {
        const page = await getMessages(conversationId, getToken, after ? { after } : {});
        conversation = page.conversation;
        fresh.push(...page.items);
        if (!page.hasMore || !after || page.items.length === 0) break;
        after = page.items.at(-1)?.messageId;
      }
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) lose();
      else setPollError(loadErrorMessage(err, POLL_ERROR));
      return;
    }
    setPollError(null);

    const { fresh: added } = merge(current.messages, fresh, "after");
    const incoming = added.filter((m) => !m.fromYou);
    update((d) => ({ ...d, conversation, messages: merge(d.messages, fresh, "after").messages }));
    if (added.length > 0) {
      setNewIds(new Set(added.map((m) => m.messageId)));
      pendingScroll.current = "new";
    }
    if (incoming.length > 0) {
      const name = conversation.otherDisplayName;
      setAnnouncement(incoming.length === 1 ? `New message from ${name}.` : `${incoming.length} new messages from ${name}.`);
    }
    if (conversation.unread || incoming.length > 0) markRead((added.at(-1) ?? current.messages.at(-1))?.messageId);
  }, [conversationId, getToken, update, lose, markRead, setAnnouncement]);

  useVisibleInterval(poll, THREAD_POLL_MS, { enabled: view.status === "ready", requireFocus: true });

  async function loadEarlier() {
    const current = dataRef.current;
    const first = current?.messages[0]?.messageId;
    if (!current || !first || earlierBusy) return;
    setEarlierBusy(true);
    setEarlierError(null);
    try {
      const page = await getMessages(conversationId, getToken, { before: first });
      const { fresh } = merge(current.messages, page.items, "before");
      update((d) => ({
        ...d,
        conversation: page.conversation,
        messages: merge(d.messages, page.items, "before").messages,
        hasEarlier: page.hasMore,
      }));
      setAnnouncement(
        fresh.length === 0
          ? "No earlier messages."
          : `${fresh.length} earlier ${fresh.length === 1 ? "message" : "messages"} loaded.`,
      );
      if (fresh[0]) pendingFocus.current = { messageId: fresh[0].messageId };
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) lose();
      else setEarlierError(loadErrorMessage(err, EARLIER_ERROR));
    } finally {
      setEarlierBusy(false);
    }
  }

  async function send(body: string): Promise<SendOutcome> {
    const current = dataRef.current;
    if (!current) return { ok: false, gone: true };
    const name = current.conversation.otherDisplayName;
    try {
      const message = await sendMessage(conversationId, body, getToken);
      update((d) => ({
        ...d,
        // Replying to a request accepts it.
        conversation: {
          ...d.conversation,
          status: d.conversation.status === "request_received" ? "active" : d.conversation.status,
          lastMessage: { preview: message.body.slice(0, 140), sentAt: message.sentAt, fromYou: true },
        },
        messages: merge(d.messages, [message], "after").messages,
      }));
      setNewIds(new Set([message.messageId]));
      pendingScroll.current = "new";
      setAnnouncement(
        current.conversation.status === "request_received"
          ? `Message sent. You’re now chatting with ${endSentence(name)}`
          : "Message sent.",
      );
      return { ok: true };
    } catch (err) {
      const mapped = messagingError(err, { rateLimited: SEND_RATE_LIMITED });
      switch (mapped.kind) {
        case "field":
          return { ok: false, fieldError: mapped.message };
        case "unavailable":
          lose();
          return { ok: false, gone: true };
        case "conflict":
          // Their own request is still waiting (another tab, or a stale page).
          update((d) => ({ ...d, conversation: { ...d.conversation, status: "request_sent" } }));
          return { ok: false, message: `Wait for ${name} to reply before sending another message.` };
        default:
          return { ok: false, message: mapped.message };
      }
    }
  }

  function openConfirm(kind: "block" | "decline") {
    setActionError(null);
    setConfirming(kind);
    pendingFocus.current = kind === "block" ? "block-cancel" : "decline-cancel";
  }

  function cancelConfirm() {
    const kind = confirming;
    setConfirming(null);
    setActionError(null);
    if (kind) pendingFocus.current = kind;
  }

  async function block() {
    const current = dataRef.current;
    if (!current || actionBusy) return;
    setActionBusy("block");
    setActionError(null);
    try {
      const record = await blockMember({ conversationId }, getToken);
      show({ status: "blocked", name: current.conversation.otherDisplayName, blockId: record.blockId });
      setConfirming(null);
      pendingFocus.current = "status";
      refreshUnread?.();
    } catch (err) {
      const mapped = messagingError(err, { rateLimited: BLOCK_RATE_LIMITED, fallback: "Couldn’t block. Try again." });
      if (mapped.kind === "unavailable") {
        // Already blocked (a repeat, or another tab), or gone: either way
        // they're blocked from this member's point of view. Not an error.
        show({ status: "blocked", name: current.conversation.otherDisplayName });
        setConfirming(null);
        pendingFocus.current = "status";
        refreshUnread?.();
      } else setActionError("message" in mapped ? mapped.message : "Couldn’t block. Try again.");
    } finally {
      setActionBusy(null);
    }
  }

  async function unblock(blockId: string, name: string) {
    if (actionBusy) return;
    setActionBusy("unblock");
    setActionError(null);
    try {
      await unblockMember(blockId, getToken);
      setAnnouncement(`Unblocked ${endSentence(name)}`);
      pendingFocus.current = "heading";
      setAttempt((n) => n + 1);
    } catch (err) {
      const mapped = messagingError(err, { rateLimited: "Try again in a few minutes.", fallback: "Couldn’t unblock. Try again." });
      setActionError("message" in mapped ? mapped.message : "Couldn’t unblock. Try again.");
    } finally {
      setActionBusy(null);
    }
  }

  async function decline() {
    const current = dataRef.current;
    if (!current || actionBusy) return;
    setActionBusy("decline");
    setActionError(null);
    try {
      await declineConversation(conversationId, getToken);
      show({ status: "declined", name: current.conversation.otherDisplayName });
      setConfirming(null);
      pendingFocus.current = "status";
      refreshUnread?.();
    } catch (err) {
      const mapped = messagingError(err, { rateLimited: "Try again in a few minutes.", fallback: "Couldn’t decline. Try again." });
      if (mapped.kind === "unavailable") lose();
      else setActionError("message" in mapped ? mapped.message : "Couldn’t decline. Try again.");
    } finally {
      setActionBusy(null);
    }
  }

  async function report(reason: ReportReason, details: string | undefined): Promise<ReportOutcome> {
    try {
      await reportMember({ conversationId, reason, details }, getToken);
      setReportOpen(false);
      setReported(true);
      pendingFocus.current = "status";
      return { ok: true };
    } catch (err) {
      const mapped = messagingError(err, { rateLimited: REPORT_RATE_LIMITED, fallback: "Couldn’t send your report. Try again." });
      if (mapped.kind === "unavailable") {
        setReportOpen(false);
        lose();
        return { ok: false, gone: true };
      }
      if (mapped.kind === "field") {
        return { ok: false, fieldErrors: { [mapped.field === "details" ? "details" : "reason"]: mapped.message } };
      }
      return { ok: false, message: "message" in mapped ? mapped.message : "Couldn’t send your report. Try again." };
    }
  }

  const liveRegion = (
    <p role="status" className="sr-only">
      <span key={announcement.n}>{announcement.text}</span>
    </p>
  );
  const backLink = (
    <Link href="/messages" className={`${tallInlineLinkClass} self-start text-sm`}>
      <span aria-hidden="true">&larr;&nbsp;</span>All messages
    </Link>
  );

  if (view.status !== "ready") {
    return (
      <div ref={rootRef} className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-5 py-8 sm:px-8 sm:py-12">
        {backLink}
        {renderOtherState(view)}
        {liveRegion}
      </div>
    );
  }

  const { conversation, messages, hasEarlier } = view.data;
  const name = conversation.otherDisplayName;
  const status = conversation.status;

  return (
    <div ref={rootRef} className="mx-auto flex min-h-[calc(100dvh-var(--header-h))] w-full max-w-2xl flex-col px-5 sm:px-8">
      <header className="flex flex-col gap-3 border-b border-surface-border pt-4 pb-4 sm:pt-8">
        {backLink}
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div className="min-w-0">
            <h1 ref={headingRef} tabIndex={-1} className="display-md break-words outline-offset-2">
              {name}
            </h1>
            {conversation.event && (
              <p className="mt-1 flex flex-wrap items-center gap-x-1 text-sm text-muted">
                Going to
                <Link
                  href={`/events/${conversation.event.slug}`}
                  className={`${tallInlineLinkClass} min-w-0 break-words text-foreground`}
                >
                  {conversation.event.title}
                </Link>
              </p>
            )}
          </div>
          <div className="flex shrink-0 gap-2">
            <Button
              id="thread-report"
              variant="outline"
              size="sm"
              className="min-h-11"
              onClick={() => {
                setReported(false);
                setReportOpen(true);
              }}
            >
              Report
            </Button>
            <Button
              id="thread-block"
              variant="outline"
              size="sm"
              className="min-h-11"
              aria-expanded={confirming === "block"}
              onClick={() => (confirming === "block" ? cancelConfirm() : openConfirm("block"))}
            >
              Block
            </Button>
          </div>
        </div>

        {confirming === "block" && (
          <div role="group" aria-labelledby="block-confirm-text" className="flex flex-col gap-3 bg-surface p-4">
            <p id="block-confirm-text" className="text-sm font-semibold">
              Block {name}?
            </p>
            <p className="text-sm leading-5">
              They won&rsquo;t be told. Neither of you will see this conversation or be able to message the other, and
              you won&rsquo;t see each other on Who&rsquo;s Going lists. You can unblock them later.
            </p>
            <div className="flex flex-col gap-3 sm:flex-row">
              <Button variant="danger" size="lg" busy={actionBusy !== null} onClick={block} className="w-full sm:w-auto">
                {actionBusy === "block" ? "Blocking…" : "Yes, block"}
              </Button>
              <Button
                id="thread-block-cancel"
                variant="outline"
                size="lg"
                busy={actionBusy !== null}
                onClick={cancelConfirm}
                className="w-full sm:w-auto"
              >
                Cancel
              </Button>
            </div>
          </div>
        )}

        {actionError && confirming !== "decline" && <ActionErrorNotice message={actionError} returnTo={returnTo} />}

        {reported && (
          <div ref={statusRef} tabIndex={-1} className="outline-offset-2">
            <Notice>
              Thanks. Your report has been sent and our team will review it. We won&rsquo;t tell {name}. You can also
              block them.
            </Notice>
          </div>
        )}
      </header>

      <section aria-labelledby="thread-messages-title" className="flex flex-1 flex-col gap-4 py-6">
        <h2 id="thread-messages-title" className="sr-only">
          Messages
        </h2>
        {hasEarlier && (
          <div className="flex flex-col items-center gap-3">
            {earlierError && <Notice tone="danger">{earlierError}</Notice>}
            <Button variant="outline" size="sm" className="min-h-11" busy={earlierBusy} onClick={loadEarlier}>
              {earlierBusy ? "Loading…" : "Load earlier messages"}
            </Button>
          </div>
        )}
        <MessageList messages={messages} otherName={name} listRef={listRef} newFrom={newIds} />
        {status === "request_received" && renderRequestReceived(name)}
        {pollError && (
          <p className="text-xs text-muted">
            {pollError}
          </p>
        )}
      </section>

      <div className="sticky bottom-0 -mx-5 border-t border-foreground bg-background px-5 pt-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] sm:-mx-8 sm:px-8">
        <Composer
          otherName={name}
          mode={status === "request_sent" ? "waiting" : status === "request_received" ? "accept" : "reply"}
          waitingNote={waitingNote(name)}
          onSend={send}
          returnTo={returnTo}
        />
      </div>
      <div ref={endRef} />

      <ReportDialog
        open={reportOpen}
        otherName={name}
        onClose={() => setReportOpen(false)}
        onSubmit={report}
        returnTo={returnTo}
      />
      {liveRegion}
    </div>
  );

  function renderRequestReceived(name: string) {
    return (
      <div className="flex flex-col gap-3 border-t border-surface-border pt-4">
        <p className="text-sm leading-5">
          <strong className="font-semibold">{name} wants to message you.</strong> Reply below to accept, and you can
          keep chatting. Not interested? Decline: they won&rsquo;t be told, and they can&rsquo;t send you another
          request.
        </p>
        {confirming === "decline" ? (
          <div role="group" aria-labelledby="decline-confirm-text" className="flex flex-col gap-3">
            <p id="decline-confirm-text" className="text-sm font-semibold">
              Decline {name}&rsquo;s request?
            </p>
            {actionError && <ActionErrorNotice message={actionError} returnTo={returnTo} />}
            <div className="flex flex-col gap-3 sm:flex-row">
              <Button variant="danger" size="lg" busy={actionBusy !== null} onClick={decline} className="w-full sm:w-auto">
                {actionBusy === "decline" ? "Declining…" : "Yes, decline"}
              </Button>
              <Button
                id="thread-decline-cancel"
                variant="outline"
                size="lg"
                busy={actionBusy !== null}
                onClick={cancelConfirm}
                className="w-full sm:w-auto"
              >
                Cancel
              </Button>
            </div>
          </div>
        ) : (
          <Button
            id="thread-decline"
            variant="outline"
            size="lg"
            onClick={() => openConfirm("decline")}
            className="w-full sm:w-auto sm:self-start"
          >
            Decline
          </Button>
        )}
      </div>
    );
  }

  function renderOtherState(v: Exclude<View, { status: "ready" }>) {
    switch (v.status) {
      case "loading":
        return (
          <p className="text-sm text-muted" aria-busy="true">
            Loading the conversation…
          </p>
        );
      case "error":
        return (
          <div className="flex flex-col items-start gap-3">
            <ActionErrorNotice message={v.message} returnTo={returnTo} />
            <Button variant="outline" size="sm" className="min-h-11" onClick={() => setAttempt((n) => n + 1)}>
              Try again
            </Button>
          </div>
        );
      case "unavailable":
        return (
          <div className="border-t border-foreground py-10">
            <h1 ref={headingRef} tabIndex={-1} className="display-md outline-offset-2">
              This conversation isn&rsquo;t available
            </h1>
            <p className="mt-3 max-w-md text-sm text-muted">
              It may have been removed, or this person can&rsquo;t be messaged.
            </p>
          </div>
        );
      case "declined":
        return (
          <div ref={statusRef} tabIndex={-1} className="outline-offset-2">
            <EmptyState title="Request declined">
              {v.name} won&rsquo;t be told. The conversation is gone from your messages.
            </EmptyState>
          </div>
        );
      case "blocked":
        return (
          <div className="flex flex-col items-start gap-4">
            <div ref={statusRef} tabIndex={-1} className="w-full outline-offset-2">
              <EmptyState title={`You blocked ${v.name}`}>
                They haven&rsquo;t been told. You won&rsquo;t see each other&rsquo;s messages or appear on each
                other&rsquo;s Who&rsquo;s Going lists.
              </EmptyState>
            </div>
            {actionError && <ActionErrorNotice message={actionError} returnTo={returnTo} />}
            {v.blockId !== undefined && (
              <Button
                variant="outline"
                size="lg"
                busy={actionBusy !== null}
                onClick={() => v.blockId !== undefined && unblock(v.blockId, v.name)}
                className="w-full sm:w-auto"
              >
                {actionBusy === "unblock" ? "Unblocking…" : "Unblock"}
              </Button>
            )}
            <Link href="/messages/blocked" className={`${tallInlineLinkClass} text-sm`}>
              Blocked members
            </Link>
          </div>
        );
    }
  }
}
