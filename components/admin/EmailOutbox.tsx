"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { EmptyState, Notice } from "@/components/ui/Section";
import { adminListEmailJobs, adminResendEmailJob } from "@/lib/api/admin";
import { ApiError } from "@/lib/api/client";
import type { AdminEmailJob, EmailJobStatus } from "@/lib/api/types";
import { useAuth } from "@/lib/auth/AuthContext";
import { formatMessageTime } from "@/lib/format";
import { LoadingState } from "@/components/ui/ProgressLoader";

const STATUSES: { value: EmailJobStatus; label: string }[] = [
  { value: "failed", label: "Failed" },
  { value: "pending", label: "Retrying" },
  { value: "sending", label: "Sending" },
  { value: "sent", label: "Sent" },
];

type LoadState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; items: AdminEmailJob[]; nextCursor?: string };

function errorText(err: unknown, fallback: string) {
  return err instanceof ApiError && err.status >= 400 && err.status < 500 ? err.message : fallback;
}

/**
 * /admin/emails: ticket emails by delivery status, with a manual resend.
 * Orders appear by their short reference and a masked address only.
 */
export default function EmailOutbox() {
  const auth = useAuth();
  const getToken = auth.getAccessToken;
  const [status, setStatus] = useState<EmailJobStatus>("failed");
  const [attempt, setAttempt] = useState(0);
  const key = `${status}#${attempt}`;
  const [result, setResult] = useState<{ key: string; state: LoadState } | null>(null);
  const state: LoadState = result?.key === key ? result.state : { status: "loading" };
  const [loadingMore, setLoadingMore] = useState(false);
  const [moreError, setMoreError] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState("");
  // Where focus goes once a resent email has left the list (its button,
  // which had focus, is gone): an element id, applied after the re-render.
  const focusAfterRemoval = useRef<string | null>(null);

  useEffect(() => {
    if (!focusAfterRemoval.current) return;
    const element = document.getElementById(focusAfterRemoval.current);
    if (!element) return; // Not rendered yet: an earlier render's effects can run first.
    focusAfterRemoval.current = null;
    element.focus();
  });

  useEffect(() => {
    let cancelled = false;
    adminListEmailJobs(status, getToken).then(
      (page) => {
        if (!cancelled) setResult({ key, state: { status: "ready", items: page.items, nextCursor: page.nextCursor } });
      },
      (err: unknown) => {
        if (!cancelled) setResult({ key, state: { status: "error", message: errorText(err, "Couldn’t load emails.") } });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [status, getToken, key]);

  /**
   * After a resend: a job still in this view is updated in place; one whose
   * new status belongs to another view (a failed email is now retrying)
   * leaves the list, and focus moves to the next email (or the previous one,
   * or the list heading when none are left).
   */
  function resent(job: AdminEmailJob) {
    const label = STATUSES.find((s) => s.value === job.status)?.label ?? job.status;
    if (job.status === status) {
      setResult((current) =>
        current && current.key === key && current.state.status === "ready"
          ? {
              key,
              state: { ...current.state, items: current.state.items.map((j) => (j.jobId === job.jobId ? job : j)) },
            }
          : current,
      );
      setAnnouncement(`Resending the email for order ${job.orderReference}.`);
      return;
    }
    if (state.status === "ready") {
      const index = state.items.findIndex((j) => j.jobId === job.jobId);
      const neighbour = state.items[index + 1] ?? state.items[index - 1];
      focusAfterRemoval.current = neighbour && neighbour.jobId !== job.jobId ? jobHeadingId(neighbour) : "emails-heading";
    }
    setResult((current) =>
      current && current.key === key && current.state.status === "ready"
        ? { key, state: { ...current.state, items: current.state.items.filter((j) => j.jobId !== job.jobId) } }
        : current,
    );
    setAnnouncement(`Resending the email for order ${job.orderReference}. It’s moved to ${label}.`);
  }

  async function loadMore() {
    if (state.status !== "ready" || !state.nextCursor || loadingMore) return;
    setLoadingMore(true);
    setMoreError(null);
    try {
      const page = await adminListEmailJobs(status, getToken, state.nextCursor);
      const known = new Set(state.items.map((j) => j.jobId));
      setResult({
        key,
        state: {
          status: "ready",
          items: [...state.items, ...page.items.filter((j) => !known.has(j.jobId))],
          nextCursor: page.nextCursor,
        },
      });
    } catch (err) {
      setMoreError(errorText(err, "Couldn’t load more emails."));
    } finally {
      setLoadingMore(false);
    }
  }

  const current = STATUSES.find((s) => s.value === status)?.label ?? status;

  return (
    <div className="flex flex-col gap-6">
      <div role="group" aria-label="Show emails" className="flex flex-wrap gap-2">
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

      <section aria-labelledby="emails-heading" aria-busy={state.status === "loading" ? true : undefined}>
        <h2 id="emails-heading" tabIndex={-1} className="display-md mb-4 !text-2xl outline-offset-2">
          {current} ticket emails
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

        {state.status === "ready" && state.items.length === 0 && (
          <EmptyState title={status === "failed" ? "Nothing has failed" : "None right now"} />
        )}

        {state.status === "ready" && state.items.length > 0 && (
          <ul className="flex flex-col gap-4">
            {state.items.map((job) => (
              <EmailJobItem
                key={job.jobId}
                job={job}
                getToken={getToken}
                onResent={resent}
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

function jobHeadingId(job: AdminEmailJob) {
  return `email-${job.jobId}`;
}

function EmailJobItem({
  job,
  getToken,
  onResent,
}: {
  job: AdminEmailJob;
  getToken: () => Promise<string>;
  onResent: (job: AdminEmailJob) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const headingId = jobHeadingId(job);

  async function resend() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      onResent(await adminResendEmailJob(job.jobId, getToken));
    } catch (err) {
      setError(errorText(err, "Couldn’t resend that. Try again."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <li className="border-t border-foreground pt-4">
      <article aria-labelledby={headingId} className="flex flex-col gap-2">
        <h3 id={headingId} tabIndex={-1} className="outline-offset-2 font-sans text-base font-semibold normal-case tracking-normal break-words">
          Order {job.orderReference}: {job.eventTitle}
        </h3>
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
          <dt className="text-muted">To</dt>
          <dd>{job.maskedEmail ?? "No address on the order"}</dd>
          <dt className="text-muted">Attempts</dt>
          <dd>{job.attempts}</dd>
          <dt className="text-muted">Queued</dt>
          <dd>{formatMessageTime(job.createdAt)}</dd>
          {job.nextAttemptAt && (
            <>
              <dt className="text-muted">Next try</dt>
              <dd>{formatMessageTime(job.nextAttemptAt)}</dd>
            </>
          )}
          {job.sentAt && (
            <>
              <dt className="text-muted">Sent</dt>
              <dd>{formatMessageTime(job.sentAt)}</dd>
            </>
          )}
          {job.lastError && (
            <>
              <dt className="text-muted">Last error</dt>
              <dd className="break-words">{job.lastError}</dd>
            </>
          )}
          {job.orderStatus !== "paid" && (
            <>
              <dt className="text-muted">Order</dt>
              <dd>Not paid ({job.orderStatus.replace(/_/g, " ")}): resending won&rsquo;t send anything.</dd>
            </>
          )}
        </dl>
        {error && (
          <Notice tone="danger" role="alert">
            {error}
          </Notice>
        )}
        {job.status !== "sending" && (
          <div>
            <Button
              variant="outline"
              size="sm"
              className="min-h-11"
              busy={busy}
              aria-describedby={headingId}
              onClick={resend}
            >
              {busy ? "Resending…" : job.status === "sent" ? "Send again" : "Resend now"}
            </Button>
          </div>
        )}
      </article>
    </li>
  );
}
