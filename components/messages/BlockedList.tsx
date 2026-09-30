"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { EmptyState, Notice } from "@/components/ui/Section";
import ActionErrorNotice from "@/components/whos-going/ActionErrorNotice";
import type { GetToken } from "@/lib/api/client";
import { listBlocks, unblockMember } from "@/lib/api/messages";
import type { BlockRecord } from "@/lib/api/types";
import { endSentence } from "@/lib/display-name";
import { formatEventDateShort } from "@/lib/format";
import { loadErrorMessage, messagingError } from "./shared";

const RETURN_TO = "/messages/blocked";
const LOAD_ERROR = "Couldn’t load the people you’ve blocked.";
/** The name shown for a block made when the member had no profile (so no name was kept). */
const NO_NAME = "Member without a name";

type LoadState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; items: BlockRecord[]; nextCursor?: string };

/**
 * /messages/blocked: everyone the member has blocked, with Unblock. After an
 * unblock the row goes, it's announced, and focus moves to the next row's
 * Unblock (or the list's heading when it was the last).
 */
export default function BlockedList({ getToken }: { getToken: GetToken }) {
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState<{ attempt: number; state: LoadState } | null>(null);
  const state: LoadState = result?.attempt === attempt ? result.state : { status: "loading" };
  const [busyId, setBusyId] = useState<string | null>(null);
  const [rowError, setRowError] = useState<{ blockId: string; message: string } | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [moreError, setMoreError] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const headingRef = useRef<HTMLHeadingElement>(null);
  const pendingFocus = useRef<string | "heading" | null>(null);

  useEffect(() => {
    let cancelled = false;
    listBlocks(getToken).then(
      (page) => {
        if (!cancelled) setResult({ attempt, state: { status: "ready", items: page.items, nextCursor: page.nextCursor } });
      },
      (err: unknown) => {
        if (!cancelled) setResult({ attempt, state: { status: "error", message: loadErrorMessage(err, LOAD_ERROR) } });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [getToken, attempt]);

  useEffect(() => {
    const target = pendingFocus.current;
    if (!target) return;
    const element = target === "heading" ? headingRef.current : document.getElementById(`unblock-${target}`);
    if (!element) return; // Not rendered yet: an earlier render's effects can run first.
    pendingFocus.current = null;
    element.focus();
  });

  function setItems(change: (items: BlockRecord[]) => BlockRecord[], nextCursor?: string | null) {
    setResult((current) =>
      current && current.attempt === attempt && current.state.status === "ready"
        ? {
            attempt,
            state: {
              status: "ready",
              items: change(current.state.items),
              nextCursor: nextCursor === undefined ? current.state.nextCursor : (nextCursor ?? undefined),
            },
          }
        : current,
    );
  }

  async function unblock(block: BlockRecord, index: number, items: BlockRecord[]) {
    if (busyId) return;
    setBusyId(block.blockId);
    setRowError(null);
    try {
      await unblockMember(block.blockId, getToken);
      const next = items[index + 1] ?? items[index - 1];
      setItems((current) => current.filter((b) => b.blockId !== block.blockId));
      setAnnouncement(`Unblocked ${endSentence(block.displayName ?? NO_NAME)}`);
      pendingFocus.current = next ? next.blockId : "heading";
    } catch (err) {
      const mapped = messagingError(err, { rateLimited: "Try again in a few minutes.", fallback: "Couldn’t unblock. Try again." });
      setRowError({ blockId: block.blockId, message: "message" in mapped ? mapped.message : "Couldn’t unblock. Try again." });
    } finally {
      setBusyId(null);
    }
  }

  async function loadMore() {
    if (state.status !== "ready" || !state.nextCursor || loadingMore) return;
    setLoadingMore(true);
    setMoreError(null);
    try {
      const page = await listBlocks(getToken, state.nextCursor);
      const known = new Set(state.items.map((b) => b.blockId));
      const fresh = page.items.filter((b) => !known.has(b.blockId));
      setItems((current) => [...current, ...fresh], page.nextCursor ?? null);
      setAnnouncement(fresh.length > 0 ? `${fresh.length} more shown.` : "That’s everyone.");
      if (fresh[0]) pendingFocus.current = fresh[0].blockId;
    } catch (err) {
      setMoreError(loadErrorMessage(err, "Couldn’t load more."));
    } finally {
      setLoadingMore(false);
    }
  }

  return (
    <section aria-labelledby="blocked-title" aria-busy={state.status === "loading" ? true : undefined}>
      <h2 id="blocked-title" ref={headingRef} tabIndex={-1} className="display-md mb-3 !text-2xl outline-offset-2">
        Blocked members
      </h2>
      <p className="mb-6 max-w-xl text-sm leading-5 text-muted">
        People you&rsquo;ve blocked can&rsquo;t message you, you won&rsquo;t see each other on Who&rsquo;s Going
        lists, and any conversation you had is hidden from both of you. They aren&rsquo;t told. Unblocking brings a
        conversation back if it&rsquo;s still there.
      </p>

      {state.status === "loading" && <p className="text-sm text-muted">Loading…</p>}

      {state.status === "error" && (
        <div className="flex flex-col items-start gap-3">
          <ActionErrorNotice message={state.message} returnTo={RETURN_TO} />
          <Button variant="outline" size="sm" className="min-h-11" onClick={() => setAttempt((n) => n + 1)}>
            Try again
          </Button>
        </div>
      )}

      {state.status === "ready" && state.items.length === 0 && (
        <EmptyState title="Nobody blocked">You haven&rsquo;t blocked anyone.</EmptyState>
      )}

      {state.status === "ready" && state.items.length > 0 && (
        <ul aria-label="Blocked members" className="border-t border-foreground">
          {state.items.map((block, index, items) => {
            const name = block.displayName ?? NO_NAME;
            return (
              <li key={block.blockId} className="flex flex-col gap-3 border-b border-surface-border py-4">
                <div className="flex items-center justify-between gap-4">
                  <div className="flex min-w-0 flex-col">
                    <span className={`truncate text-base ${block.displayName ? "" : "text-muted italic"}`.trim()}>
                      {name}
                    </span>
                    <span className="text-xs text-muted">Blocked {formatEventDateShort(block.createdAt)}</span>
                  </div>
                  <Button
                    id={`unblock-${block.blockId}`}
                    variant="outline"
                    size="sm"
                    className="min-h-11 shrink-0"
                    busy={busyId !== null}
                    aria-label={`Unblock ${name}`}
                    onClick={() => unblock(block, index, items)}
                  >
                    {busyId === block.blockId ? "Unblocking…" : "Unblock"}
                  </Button>
                </div>
                {rowError?.blockId === block.blockId && (
                  <ActionErrorNotice message={rowError.message} returnTo={RETURN_TO} />
                )}
              </li>
            );
          })}
        </ul>
      )}

      {state.status === "ready" && state.nextCursor && (
        <div className="mt-6 flex flex-col items-start gap-3">
          {moreError && <Notice tone="danger">{moreError}</Notice>}
          <Button variant="outline" busy={loadingMore} onClick={loadMore} className="min-h-11 w-full sm:w-auto">
            {loadingMore ? "Loading…" : "Load more"}
          </Button>
        </div>
      )}

      <p role="status" className="sr-only">
        {announcement}
      </p>
    </section>
  );
}
