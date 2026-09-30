"use client";

import { useEffect, useRef, useState } from "react";
import MessageField from "@/components/messages/MessageField";
import { reportReasonLabel } from "@/components/messages/shared";
import { Button } from "@/components/ui/Button";
import { EmptyState, Notice } from "@/components/ui/Section";
import { adminListReports, adminResolveReport } from "@/lib/api/admin";
import { ApiError } from "@/lib/api/client";
import type { AdminReport, ReportStatus } from "@/lib/api/types";
import { useAuth } from "@/lib/auth/AuthContext";
import { formatMessageTime } from "@/lib/format";
import { validateMessage } from "@/lib/message-text";

const STATUSES: { value: ReportStatus; label: string }[] = [
  { value: "open", label: "Open" },
  { value: "actioned", label: "Suspended" },
  { value: "dismissed", label: "Dismissed" },
];

type LoadState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; items: AdminReport[]; nextCursor?: string };

function errorText(err: unknown, fallback: string) {
  return err instanceof ApiError && err.status >= 400 && err.status < 500 ? err.message : fallback;
}

/**
 * /admin/reports: members' reports. Open ones oldest first, with Dismiss or
 * Suspend (with an optional private note); resolved ones for reference.
 * Everything a report carries is plain text, shown as text.
 */
export default function ReportQueue() {
  const auth = useAuth();
  const getToken = auth.getAccessToken;
  const [status, setStatus] = useState<ReportStatus>("open");
  const [attempt, setAttempt] = useState(0);
  const key = `${status}#${attempt}`;
  const [result, setResult] = useState<{ key: string; state: LoadState } | null>(null);
  const state: LoadState = result?.key === key ? result.state : { status: "loading" };
  const [loadingMore, setLoadingMore] = useState(false);
  const [moreError, setMoreError] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const headingRef = useRef<HTMLHeadingElement>(null);
  const pendingFocus = useRef<string | "heading" | null>(null);

  useEffect(() => {
    let cancelled = false;
    adminListReports(status, getToken).then(
      (page) => {
        if (!cancelled) setResult({ key, state: { status: "ready", items: page.items, nextCursor: page.nextCursor } });
      },
      (err: unknown) => {
        if (!cancelled) setResult({ key, state: { status: "error", message: errorText(err, "Couldn’t load reports.") } });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [status, getToken, key]);

  useEffect(() => {
    const target = pendingFocus.current;
    if (!target) return;
    const element = target === "heading" ? headingRef.current : document.getElementById(`report-${target}`);
    if (!element) return; // Not rendered yet: an earlier render's effects can run first.
    pendingFocus.current = null;
    element.focus();
  });

  function setItems(change: (items: AdminReport[]) => AdminReport[], nextCursor?: string | null) {
    setResult((current) =>
      current && current.key === key && current.state.status === "ready"
        ? {
            key,
            state: {
              status: "ready",
              items: change(current.state.items),
              nextCursor: nextCursor === undefined ? current.state.nextCursor : (nextCursor ?? undefined),
            },
          }
        : current,
    );
  }

  /** A report left the open queue (resolved here, or by someone else): focus the next one. */
  function removed(report: AdminReport, items: AdminReport[], message: string) {
    const index = items.findIndex((r) => r.reportId === report.reportId);
    const next = items[index + 1] ?? items[index - 1];
    setItems((current) => current.filter((r) => r.reportId !== report.reportId));
    setAnnouncement(message);
    pendingFocus.current = next ? next.reportId : "heading";
  }

  async function loadMore() {
    if (state.status !== "ready" || !state.nextCursor || loadingMore) return;
    setLoadingMore(true);
    setMoreError(null);
    try {
      const page = await adminListReports(status, getToken, state.nextCursor);
      const known = new Set(state.items.map((r) => r.reportId));
      const fresh = page.items.filter((r) => !known.has(r.reportId));
      setItems((current) => [...current, ...fresh], page.nextCursor ?? null);
      if (fresh[0]) pendingFocus.current = fresh[0].reportId;
    } catch (err) {
      setMoreError(errorText(err, "Couldn’t load more reports."));
    } finally {
      setLoadingMore(false);
    }
  }

  const current = STATUSES.find((s) => s.value === status)?.label ?? status;

  return (
    <div className="flex flex-col gap-6">
      <div role="group" aria-label="Show reports" className="flex flex-wrap gap-2">
        {STATUSES.map((s) => (
          <Button
            key={s.value}
            variant={status === s.value ? "solid" : "outline"}
            size="sm"
            className="min-h-11"
            aria-pressed={status === s.value}
            onClick={() => {
              setStatus(s.value);
              setAnnouncement("");
            }}
          >
            {s.label}
          </Button>
        ))}
      </div>

      <section aria-labelledby="reports-heading" aria-busy={state.status === "loading" ? true : undefined}>
        <h2 id="reports-heading" ref={headingRef} tabIndex={-1} className="display-md mb-4 !text-2xl outline-offset-2">
          {current} reports
        </h2>

        {state.status === "loading" && <p className="text-sm text-muted">Loading…</p>}

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

        {state.status === "ready" && state.items.length === 0 && (
          <EmptyState title={status === "open" ? "Nothing to review" : "None yet"} />
        )}

        {state.status === "ready" && state.items.length > 0 && (
          <ul className="flex flex-col gap-6">
            {state.items.map((report, _i, items) => (
              <ReportItem
                key={report.reportId}
                report={report}
                getToken={getToken}
                onResolved={(resolved, action) =>
                  removed(resolved, items, action === "suspend" ? "Member suspended. Report closed." : "Report dismissed.")
                }
                onGone={(gone) => removed(gone, items, "That report was already resolved by someone else.")}
              />
            ))}
          </ul>
        )}

        {state.status === "ready" && state.nextCursor && (
          <div className="mt-6 flex flex-col items-start gap-3">
            {moreError && <Notice tone="danger">{moreError}</Notice>}
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

function ReportItem({
  report,
  getToken,
  onResolved,
  onGone,
}: {
  report: AdminReport;
  getToken: () => Promise<string>;
  onResolved: (report: AdminReport, action: "dismiss" | "suspend") => void;
  onGone: (report: AdminReport) => void;
}) {
  const [note, setNote] = useState("");
  const [noteError, setNoteError] = useState<string | null>(null);
  const [confirmSuspend, setConfirmSuspend] = useState(false);
  const [busy, setBusy] = useState<"dismiss" | "suspend" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const name = report.reportedDisplayName ?? "Unknown member";
  const open = report.status === "open";
  const noteId = `note-${report.reportId}`;
  const canSuspend = report.reportedAccountExists && !report.reportedSuspended;
  // Opening the suspend confirm focuses its safe choice (Cancel); Cancel returns to "Suspend member".
  const pendingFocus = useRef<string | null>(null);

  useEffect(() => {
    if (!pendingFocus.current) return;
    const element = document.getElementById(pendingFocus.current);
    if (!element) return; // Not rendered yet: the mount's effect can run after the click.
    pendingFocus.current = null;
    element.focus();
  }, [confirmSuspend]);

  async function resolve(action: "dismiss" | "suspend") {
    if (busy) return;
    setError(null);
    const invalid = validateMessage(note, { label: "Notes", optional: true });
    setNoteError(invalid);
    if (invalid) {
      document.getElementById(noteId)?.focus();
      return;
    }
    setBusy(action);
    try {
      await adminResolveReport(report.reportId, { action, note: note.trim() || undefined }, getToken);
      onResolved(report, action);
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        onGone(report);
        return;
      }
      if (err instanceof ApiError && err.fieldErrors?.note) {
        setNoteError(err.fieldErrors.note);
        document.getElementById(noteId)?.focus();
      } else {
        setError(errorText(err, "Couldn’t save that. Try again."));
      }
      setBusy(null);
    }
  }

  return (
    <li className="border-t border-foreground pt-4">
      <article aria-labelledby={`report-${report.reportId}`} className="flex flex-col gap-4">
        <header className="flex flex-col gap-1">
          <h3
            id={`report-${report.reportId}`}
            tabIndex={-1}
            className="font-sans text-base font-semibold normal-case tracking-normal break-words outline-offset-2"
          >
            {reportReasonLabel(report.reason)}: {name}
          </h3>
          <p className="text-xs text-muted">
            Reported {formatMessageTime(report.createdAt)}
            {report.eventTitle && <> · Met at {report.eventTitle}</>}
            {!report.reportedAccountExists && <> · Account deleted</>}
            {report.reportedSuspended && <> · Currently suspended</>}
          </p>
        </header>

        {report.details && (
          <div>
            <p className="eyebrow text-muted">Reporter&rsquo;s details</p>
            <p className="mt-1 text-sm break-words whitespace-pre-wrap">{report.details}</p>
          </div>
        )}

        {report.messageBody && (
          <div>
            <p className="eyebrow text-muted">Reported message</p>
            <p className="mt-1 bg-surface px-3 py-2 text-sm break-words whitespace-pre-wrap">{report.messageBody}</p>
          </div>
        )}

        {report.context.length > 0 && (
          <details className="group text-sm">
            <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 font-semibold [&::-webkit-details-marker]:hidden">
              <span aria-hidden="true" className="inline-block motion-safe:transition-transform group-open:rotate-90">
                ▸
              </span>
              Conversation before the report ({report.context.length})
            </summary>
            <ol className="mt-2 flex flex-col gap-2">
              {report.context.map((line, index) => (
                <li key={index} className="flex flex-col gap-0.5">
                  <span className="text-xs text-muted">
                    {line.from === "reported" ? name : "Reporter"} · {formatMessageTime(line.sentAt)}
                  </span>
                  <span className="break-words whitespace-pre-wrap">{line.body}</span>
                </li>
              ))}
            </ol>
          </details>
        )}

        {!open && (
          <p className="text-xs text-muted">
            {report.status === "actioned" ? "Suspended" : "Dismissed"}
            {report.resolvedAt && <> {formatMessageTime(report.resolvedAt)}</>}
            {report.resolutionNote && (
              <>
                {" "}
                · Note: <span className="break-words whitespace-pre-wrap text-foreground">{report.resolutionNote}</span>
              </>
            )}
          </p>
        )}

        {open && (
          <div className="flex flex-col gap-3 border-t border-surface-border pt-4">
            <MessageField
              id={noteId}
              label="Note (admins only, optional)"
              value={note}
              onChange={setNote}
              error={noteError}
              rows={2}
            />
            {error && (
              <Notice tone="danger" role="alert">
                {error}
              </Notice>
            )}
            {confirmSuspend ? (
              <div role="group" aria-labelledby={`suspend-${report.reportId}`} className="flex flex-col gap-3">
                <p id={`suspend-${report.reportId}`} className="text-sm font-semibold">
                  Suspend {name}? They&rsquo;ll be hidden from Who&rsquo;s Going, and can&rsquo;t send messages or
                  change their profile.
                </p>
                <div className="flex flex-wrap gap-2">
                  <Button variant="danger" size="sm" className="min-h-11" busy={busy !== null} onClick={() => resolve("suspend")}>
                    {busy === "suspend" ? "Suspending…" : "Yes, suspend"}
                  </Button>
                  <Button
                    id={`suspend-cancel-${report.reportId}`}
                    variant="outline"
                    size="sm"
                    className="min-h-11"
                    busy={busy !== null}
                    onClick={() => {
                      pendingFocus.current = `suspend-open-${report.reportId}`;
                      setConfirmSuspend(false);
                    }}
                  >
                    Cancel
                  </Button>
                </div>
              </div>
            ) : (
              <div className="flex flex-wrap gap-2">
                <Button variant="outline" size="sm" className="min-h-11" busy={busy !== null} onClick={() => resolve("dismiss")}>
                  {busy === "dismiss" ? "Dismissing…" : "Dismiss"}
                </Button>
                {/* Nothing to suspend: the account is gone, or it's suspended already. */}
                {canSuspend && (
                  <Button
                    id={`suspend-open-${report.reportId}`}
                    variant="danger"
                    size="sm"
                    className="min-h-11"
                    busy={busy !== null}
                    onClick={() => {
                      setError(null);
                      pendingFocus.current = `suspend-cancel-${report.reportId}`;
                      setConfirmSuspend(true);
                    }}
                  >
                    Suspend member
                  </Button>
                )}
              </div>
            )}
            {!canSuspend && (
              <p className="text-xs text-muted">
                {!report.reportedAccountExists
                  ? "Suspending isn’t available: they’ve deleted their account."
                  : "They’re already suspended, so there’s nothing more to do than dismiss this."}
              </p>
            )}
          </div>
        )}
      </article>
    </li>
  );
}
