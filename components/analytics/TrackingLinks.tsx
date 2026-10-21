"use client";

import { useCallback, useEffect, useId, useRef, useState, type FormEvent } from "react";
import { Button, buttonClass } from "@/components/ui/Button";
import { fieldClass } from "@/components/ui/Field";
import { Notice, Panel } from "@/components/ui/Section";
import { formatAudExact, formatCount } from "@/lib/analytics-format";
import { createTrackingLink, deleteTrackingLink, listTrackingLinks } from "@/lib/api/analytics";
import { ApiError, type GetToken } from "@/lib/api/client";
import { MAX_TRACKING_LINKS_PER_EVENT, type TrackingLink } from "@/lib/api/types";
import { SessionExpiredError } from "@/lib/auth/AuthContext";
import DataTable from "./DataTable";
import { LoadingState } from "@/components/ui/ProgressLoader";

export const MAX_LABEL_LENGTH = 40;
const COPIED_MS = 2000;

/** Labels are counted in code points, as the API counts them. */
export const labelLength = (label: string) => [...label].length;

export function labelError(label: string): string | null {
  const trimmed = label.trim();
  if (!trimmed) return "Enter a label.";
  if (labelLength(trimmed) > MAX_LABEL_LENGTH) return "Keep it to 40 characters or fewer.";
  return null;
}

/** What to say when creating a link fails. */
export function createErrorMessage(err: unknown, label: string): { message: string; atCap?: boolean } {
  if (err instanceof SessionExpiredError || (err instanceof ApiError && err.status === 401)) {
    return { message: "Your session has ended. Sign in again to make a link." };
  }
  if (err instanceof ApiError && err.status === 409) {
    if (err.fieldErrors?.label) return { message: `You already have a link called “${label.trim()}”.` };
    return { message: "You've made 20 links, the most for one event. Delete one to make another.", atCap: true };
  }
  if (err instanceof ApiError && err.status === 400) return { message: err.fieldErrors?.label ?? err.message };
  return { message: "Couldn't make the link. Try again." };
}

type LoadState = { status: "loading" } | { status: "error" } | { status: "ready"; links: TrackingLink[] };

/**
 * Tracking links (§5.15): make one per place the event is shared, copy it,
 * delete it. Numbers here are all-time (since each link was made). Deleting
 * a link keeps what it counted (shown without a label in the period table);
 * the link still opens the event but nothing more is counted under it.
 */
export default function TrackingLinks({ eventId, getToken }: { eventId: string; getToken: GetToken }) {
  const id = useId();
  const [state, setState] = useState<LoadState>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);
  const [label, setLabel] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [fresh, setFresh] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [copyFailed, setCopyFailed] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<TrackingLink | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const tableRef = useRef<HTMLDivElement>(null);
  const pendingFocus = useRef<{ kind: "copy"; linkId: string } | { kind: "delete"; linkId: string } | { kind: "input" } | { kind: "cancel" } | null>(null);

  useEffect(() => {
    let cancelled = false;
    listTrackingLinks(eventId, getToken).then(
      (result) => {
        if (!cancelled) setState({ status: "ready", links: result.items });
      },
      () => {
        if (!cancelled) setState({ status: "error" });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [eventId, getToken, attempt]);

  // Moves focus once the DOM it points at has rendered.
  useEffect(() => {
    const target = pendingFocus.current;
    if (!target) return;
    pendingFocus.current = null;
    if (target.kind === "input") inputRef.current?.focus();
    else if (target.kind === "cancel") cancelRef.current?.focus();
    else {
      const selector = target.kind === "copy" ? "button[data-copy-id]" : "button[data-delete-id]";
      const attr = target.kind === "copy" ? "copyId" : "deleteId";
      const visible = Array.from(tableRef.current?.querySelectorAll<HTMLButtonElement>(selector) ?? []).filter(
        (el) => el.dataset[attr] === target.linkId && el.offsetParent !== null,
      );
      const any = Array.from(tableRef.current?.querySelectorAll<HTMLButtonElement>(selector) ?? []).find(
        (el) => el.dataset[attr] === target.linkId,
      );
      (visible[0] ?? any)?.focus();
    }
  });

  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(null), COPIED_MS);
    return () => window.clearTimeout(timer);
  }, [copied]);

  const links = state.status === "ready" ? state.links : [];
  const atCap = links.length >= MAX_TRACKING_LINKS_PER_EVENT;

  async function create(event: FormEvent) {
    event.preventDefault();
    if (creating) return;
    const problem = labelError(label);
    setFormError(problem);
    if (problem) {
      inputRef.current?.focus();
      return;
    }
    setCreating(true);
    try {
      const link = await createTrackingLink(eventId, { label: label.trim() }, getToken);
      setState((current) => (current.status === "ready" ? { ...current, links: [link, ...current.links] } : current));
      setFresh(link.linkId);
      setLabel("");
      setAnnouncement(`Link created: ${link.label}.`);
      pendingFocus.current = { kind: "input" };
    } catch (err) {
      const { message, atCap: full } = createErrorMessage(err, label);
      if (full) setAttempt((n) => n + 1);
      setFormError(message);
    } finally {
      setCreating(false);
    }
  }

  const copy = useCallback(async (link: TrackingLink) => {
    setCopyFailed(null);
    try {
      await navigator.clipboard.writeText(link.url);
      setCopied(link.linkId);
      setAnnouncement(`Link for ${link.label} copied.`);
    } catch {
      setCopyFailed(link.linkId);
    }
  }, []);

  function askDelete(link: TrackingLink) {
    setConfirming(link);
    setDeleteError(null);
    pendingFocus.current = { kind: "cancel" };
  }

  function cancelDelete() {
    if (!confirming) return;
    pendingFocus.current = { kind: "delete", linkId: confirming.linkId };
    setConfirming(null);
    setDeleteError(null);
  }

  async function confirmDelete() {
    if (!confirming || deleting) return;
    const link = confirming;
    setDeleting(true);
    setDeleteError(null);
    try {
      await deleteTrackingLink(eventId, link.linkId, getToken);
      const index = links.findIndex((l) => l.linkId === link.linkId);
      const remaining = links.filter((l) => l.linkId !== link.linkId);
      const next = remaining[index] ?? remaining[index - 1];
      pendingFocus.current = next ? { kind: "copy", linkId: next.linkId } : { kind: "input" };
      setState({ status: "ready", links: remaining });
      setConfirming(null);
      setAnnouncement(`Deleted ${link.label}.`);
    } catch (err) {
      setDeleteError(
        err instanceof SessionExpiredError || (err instanceof ApiError && err.status === 401)
          ? "Your session has ended. Sign in again to delete it."
          : "Couldn't delete it. Try again.",
      );
    } finally {
      setDeleting(false);
    }
  }

  return (
    <Panel title="Tracking links" titleId="links">
      <p className="mb-6 max-w-xl text-sm leading-relaxed">
        Make a link for each place you share this event, like your Instagram bio or a newsletter. We count the views
        and sales that come through each one. Sales count when someone buys in the same visit. Nothing identifies
        the people who click.
      </p>

      {state.status === "loading" && <LoadingState text="Loading links…" />}

      {state.status === "error" && (
        <div className="flex flex-col items-start gap-3">
          <Notice tone="danger" role="alert">
            Couldn&rsquo;t load your tracking links.
          </Notice>
          <Button
            variant="outline"
            size="lg"
            onClick={() => {
              setState({ status: "loading" });
              setAttempt((n) => n + 1);
            }}
          >
            Try again
          </Button>
        </div>
      )}

      {state.status === "ready" && (
        <>
          {atCap ? (
            <Notice>You&rsquo;ve made 20 links, the most for one event. Delete one to make another.</Notice>
          ) : (
            <form onSubmit={create} noValidate className="flex flex-col gap-3 sm:flex-row sm:items-end">
              <div className="flex flex-col gap-2">
                <label htmlFor={`${id}-label`} className="eyebrow text-muted">
                  Label
                </label>
                <input
                  ref={inputRef}
                  id={`${id}-label`}
                  className={`${fieldClass} sm:w-72`}
                  value={label}
                  autoComplete="off"
                  aria-invalid={formError ? true : undefined}
                  aria-describedby={`${id}-hint${formError ? ` ${id}-error` : ""}`}
                  onChange={(e) => setLabel(e.target.value)}
                />
                <p id={`${id}-hint`} className="flex justify-between gap-4 text-xs text-muted">
                  <span>Up to 40 characters, like &ldquo;Instagram bio&rdquo;.</span>
                  <span className="tabular-nums" aria-hidden="true">
                    {labelLength(label)}/{MAX_LABEL_LENGTH}
                  </span>
                </p>
              </div>
              <Button
                type="submit"
                size="lg"
                className="sm:min-h-11 sm:px-6 sm:py-2.5 sm:text-xs/4.5 sm:mb-5"
                busy={creating}
              >
                {creating ? "Creating…" : "Create link"}
              </Button>
            </form>
          )}
          {formError && (
            <div id={`${id}-error`} className="mt-3">
              <Notice tone="danger" role="alert">
                {formError}
              </Notice>
            </div>
          )}
          <p className="mt-4 text-xs text-muted">
            {links.length} of {MAX_TRACKING_LINKS_PER_EVENT} links
          </p>

          <div ref={tableRef} className="mt-6">
            {links.length === 0 ? (
              <p className="text-sm text-muted">No links yet. Make one for each place you post about this event.</p>
            ) : (
              <DataTable
                caption="Tracking links, totals since each was created"
                columns={[
                  { key: "label", label: "Label" },
                  { key: "link", label: "Link" },
                  { key: "views", label: "Views", numeric: true },
                  { key: "orders", label: "Orders", numeric: true },
                  { key: "gross", label: "Revenue (gross)", numeric: true },
                  { key: "manage", label: "Manage", numeric: true },
                ]}
                rows={links.map((link) => ({
                  key: link.linkId,
                  header: <span className={link.linkId === fresh ? "fade-in" : undefined}>{link.label}</span>,
                  cells: [
                    <LinkCell
                      key="l"
                      link={link}
                      copied={copied === link.linkId}
                      failed={copyFailed === link.linkId}
                      onCopy={() => void copy(link)}
                    />,
                    formatCount(link.views),
                    formatCount(link.orders),
                    formatAudExact(link.grossCents),
                    <Button
                      key="d"
                      data-delete-id={link.linkId}
                      variant="danger"
                      size="sm"
                      className="min-h-11"
                      onClick={() => askDelete(link)}
                    >
                      Delete <span className="sr-only">{link.label}</span>
                    </Button>,
                  ],
                }))}
              />
            )}
          </div>

          {confirming && (
            <div role="group" aria-labelledby={`${id}-confirm`} className="mt-6 border-l-2 border-danger py-1 pl-4">
              <p id={`${id}-confirm`} className="text-sm font-semibold">
                Delete &ldquo;{confirming.label}&rdquo;?
              </p>
              <p className="mt-1 max-w-xl text-sm">
                The link will still open your event, but nothing more will be counted under it. What it&rsquo;s
                counted so far stays in your analytics, without its label.
              </p>
              {deleteError && (
                <div className="mt-3">
                  <Notice tone="danger" role="alert">
                    {deleteError}
                  </Notice>
                </div>
              )}
              <div className="mt-3 flex flex-wrap gap-3">
                <Button variant="danger" className="min-h-11" busy={deleting} onClick={() => void confirmDelete()}>
                  {deleting ? "Deleting…" : "Yes, delete"}
                </Button>
                <button ref={cancelRef} type="button" className={buttonClass("outline", "md", "min-h-11")} onClick={cancelDelete}>
                  Cancel
                </button>
              </div>
            </div>
          )}
        </>
      )}

      <p role="status" className="sr-only">
        {announcement}
      </p>
    </Panel>
  );
}

function LinkCell({
  link,
  copied,
  failed,
  onCopy,
}: {
  link: TrackingLink;
  copied: boolean;
  failed: boolean;
  onCopy: () => void;
}) {
  return (
    <span className="flex flex-col items-end gap-2 sm:items-start">
      {failed ? (
        <>
          <input
            readOnly
            value={link.url}
            aria-label={`Link for ${link.label}`}
            className={`${fieldClass} sm:w-64`}
            ref={(el) => el?.select()}
          />
          <span role="alert" className="text-xs text-danger">
            Couldn&rsquo;t copy. The link is selected, so copy it yourself.
          </span>
        </>
      ) : (
        <span className="max-w-64 truncate text-sm text-muted" title={link.url}>
          {link.url}
        </span>
      )}
      <Button data-copy-id={link.linkId} variant="outline" size="sm" className="min-h-11 min-w-22" onClick={onCopy}>
        {copied ? "Copied" : "Copy"} <span className="sr-only">link for {link.label}</span>
      </Button>
    </span>
  );
}
