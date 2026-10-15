"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import { EmptyState, Notice } from "@/components/ui/Section";
import { adminListEmailJobs, adminResendEmailJob } from "@/lib/api/admin";
import { ApiError } from "@/lib/api/client";
import type { AdminEmailJob, EmailJobStatus } from "@/lib/api/types";
import { useAuth } from "@/lib/auth/AuthContext";
import { formatMessageTime } from "@/lib/format";

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

  function replace(job: AdminEmailJob) {
    setResult((current) =>
      current && current.key === key && current.state.status === "ready"
        ? {
            key,
            state: { ...current.state, items: current.state.items.map((j) => (j.jobId === job.jobId ? job : j)) },
          }
        : current,
    );
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
        <h2 id="emails-heading" className="display-md mb-4 !text-2xl">
          {current} ticket emails
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
          <EmptyState title={status === "failed" ? "Nothing has failed" : "None right now"} />
        )}

        {state.status === "ready" && state.items.length > 0 && (
          <ul className="flex flex-col gap-4">
            {state.items.map((job) => (
              <EmailJobItem
                key={job.jobId}
                job={job}
                getToken={getToken}
                onResent={(updated) => {
                  replace(updated);
                  setAnnouncement(`Resending the email for order ${updated.orderReference}.`);
                }}
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
  const headingId = `email-${job.jobId}`;

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
        <h3 id={headingId} className="font-sans text-base font-semibold normal-case tracking-normal break-words">
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
