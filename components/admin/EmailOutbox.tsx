"use client";

import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/Button";
import { fieldClass } from "@/components/ui/Field";
import { SelectedDots } from "@/components/ui/FilterChip";
import { EmptyState, Notice } from "@/components/ui/Section";
import { adminChangeOrderEmail, adminListEmailJobs, adminResendEmailJob } from "@/lib/api/admin";
import { ApiError } from "@/lib/api/client";
import {
  ADMIN_EMAIL_CHANGE_REASON,
  type AdminEmailJob,
  type AdminOrderEmailChange,
  type AdminOrderEmailChangeResult,
  type EmailJobStatus,
} from "@/lib/api/types";
import { buyerEmailError } from "@/lib/buyer-email";
import { useAuth } from "@/lib/auth/AuthContext";
import { useAdminSummary } from "@/components/admin/AdminSummaryProvider";
import { useStatusParam } from "@/components/admin/admin-list-url";
import { formatMessageTime } from "@/lib/format";
import { LoadingState } from "@/components/ui/ProgressLoader";

/** Each filter's label (what's happening to the emails in it) and its list's heading. */
const STATUSES: { value: EmailJobStatus; label: string; heading: string }[] = [
  { value: "failed", label: "Failed", heading: "Failed ticket emails" },
  { value: "pending", label: "Retrying automatically", heading: "Ticket emails retrying automatically" },
  { value: "sending", label: "Sending now", heading: "Ticket emails sending now" },
  { value: "sent", label: "Sent", heading: "Sent ticket emails" },
];

type LoadState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; items: AdminEmailJob[]; nextCursor?: string };

/** An order's short reference as typed: 8 hex characters, with or without "#" (the API takes either). */
const REFERENCE = /^#?([0-9a-f]{8})$/i;

/** The reason's length, as the API checks it. */
const { min: REASON_MIN, max: REASON_MAX } = ADMIN_EMAIL_CHANGE_REASON;

function errorText(err: unknown, fallback: string) {
  return err instanceof ApiError && err.status >= 400 && err.status < 500 ? err.message : fallback;
}

/**
 * /admin/emails: ticket emails by delivery status, with a manual resend.
 * Orders appear by their short reference and a masked address only. The
 * filter is kept in `?status=`. "Find an order" shows one order's ticket
 * email by its reference, in any status, where support can change the
 * order's email (with a reason) and see its change history.
 */
export default function EmailOutbox() {
  const auth = useAuth();
  const adminSummary = useAdminSummary();
  const getToken = auth.getAccessToken;
  const [status, setStatus] = useStatusParam("/admin/emails", STATUSES, "failed");
  const [attempt, setAttempt] = useState(0);
  // The order reference being looked at ("#7C1F2E0A"), instead of a status's list.
  const [reference, setReference] = useState<string | null>(null);
  const [typedReference, setTypedReference] = useState("");
  const [referenceError, setReferenceError] = useState<string | null>(null);
  const referenceInputRef = useRef<HTMLInputElement>(null);
  const key = `${reference ?? status}#${attempt}`;
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
    (reference ? adminListEmailJobs(status, getToken, undefined, reference) : adminListEmailJobs(status, getToken)).then(
      (page) => {
        if (cancelled) return;
        setResult({ key, state: { status: "ready", items: page.items, nextCursor: page.nextCursor } });
        // Find's answer, said once it's in (the list's heading already names the order).
        if (reference) {
          setAnnouncement(page.items.length > 0 ? `Found order ${reference}.` : `No ticket email for order ${reference}.`);
        }
      },
      (err: unknown) => {
        if (!cancelled) setResult({ key, state: { status: "error", message: errorText(err, "Couldn’t load emails.") } });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [status, reference, getToken, key]);

  /**
   * A job the API has just answered with (after a resend or an email change):
   * still in this view (one order's, found by reference, stays whatever its
   * status; a status list keeps the jobs with its status), it's updated in
   * place and `said`, with focus on `focusInPlace` if given; otherwise (a
   * failed email is now retrying) it leaves the list, `said` with where it's
   * gone, and focus moves to the next email (or the previous one, or the list
   * heading when none are left).
   */
  function jobUpdated(job: AdminEmailJob, said: string, focusInPlace?: string) {
    adminSummary?.refresh(); // The hub's and sub-nav's failed count.
    if (reference || job.status === status) {
      setResult((current) =>
        current && current.key === key && current.state.status === "ready"
          ? { key, state: { ...current.state, items: current.state.items.map((j) => (j.jobId === job.jobId ? job : j)) } }
          : current,
      );
      if (focusInPlace) focusAfterRemoval.current = focusInPlace;
      setAnnouncement(said);
      return;
    }
    const label = STATUSES.find((s) => s.value === job.status)?.label ?? job.status;
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
    setAnnouncement(`${said} It’s moved to ${label}.`);
  }

  function resent(job: AdminEmailJob) {
    jobUpdated(job, `Resending the email for order ${job.orderReference}.`);
  }

  /**
   * After an email change: the job (with its history) as the API has it now, and said; focus on its heading (the
   * form, which had it, is gone), or the next email's when it has left this status's list.
   */
  function emailChanged({ result, job }: AdminOrderEmailChangeResult) {
    jobUpdated(
      job,
      result === "changed"
        ? `Email changed for order ${job.orderReference}. The tickets are being sent to the new address.`
        : `That’s already the email for order ${job.orderReference}. Nothing changed.`,
      jobHeadingId(job),
    );
  }

  function findOrder(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const match = REFERENCE.exec(typedReference.trim());
    if (!match) {
      setReferenceError("Enter the 8-character reference, like #7C1F2E0A.");
      referenceInputRef.current?.focus();
      return;
    }
    setReferenceError(null);
    setAnnouncement("");
    const next = `#${match[1].toUpperCase()}`;
    // The same order again: look it up again (it may have changed), and say so again.
    if (next === reference) setAttempt((n) => n + 1);
    else setReference(next);
  }

  function clearReference() {
    setReference(null);
    setTypedReference("");
    setReferenceError(null);
    setAnnouncement("");
    referenceInputRef.current?.focus();
  }

  async function loadMore() {
    if (state.status !== "ready" || !state.nextCursor || loadingMore) return;
    setLoadingMore(true);
    setMoreError(null);
    try {
      // The same list it continues: a status's, or one order's (found by reference).
      const page = reference
        ? await adminListEmailJobs(status, getToken, state.nextCursor, reference)
        : await adminListEmailJobs(status, getToken, state.nextCursor);
      const known = new Set(state.items.map((j) => j.jobId));
      // Only onto the list it was loaded for: another filter may be showing by now.
      setResult((current) =>
        current && current.key === key && current.state.status === "ready"
          ? {
              key,
              state: {
                status: "ready",
                items: [...current.state.items, ...page.items.filter((j) => !known.has(j.jobId))],
                nextCursor: page.nextCursor,
              },
            }
          : current,
      );
    } catch (err) {
      setMoreError(errorText(err, "Couldn’t load more emails."));
    } finally {
      setLoadingMore(false);
    }
  }

  const current = reference
    ? `Ticket email for order ${reference}`
    : (STATUSES.find((s) => s.value === status)?.heading ?? status);

  return (
    <div className="flex flex-col gap-6">
      <div role="group" aria-label="Show emails" className="flex flex-wrap gap-2">
        {STATUSES.map((s) => {
          const selected = !reference && status === s.value;
          return (
            <Button
              key={s.value}
              variant={selected ? "solid" : "outline"}
              size="sm"
              className="min-h-11"
              aria-pressed={selected}
              onClick={() => {
                setReference(null);
                setReferenceError(null);
                setStatus(s.value);
                setAnnouncement("");
              }}
            >
              {selected && <SelectedDots />}
              {s.label}
            </Button>
          );
        })}
      </div>

      <form role="search" aria-label="Find an order" noValidate onSubmit={findOrder} className="flex flex-wrap items-end gap-2">
        <div className="flex w-full max-w-xs min-w-0 flex-col gap-1">
          <label htmlFor="email-order-reference" className="eyebrow text-muted">
            Find an order by reference
          </label>
          <input
            ref={referenceInputRef}
            id="email-order-reference"
            name="reference"
            type="search"
            value={typedReference}
            onChange={(e) => {
              setTypedReference(e.target.value);
              setReferenceError(null);
            }}
            placeholder="#7C1F2E0A"
            autoComplete="off"
            spellCheck={false}
            maxLength={20}
            aria-invalid={referenceError ? true : undefined}
            aria-describedby={referenceError ? "email-order-reference-error" : undefined}
            className={`${fieldClass} font-mono`}
          />
        </div>
        <Button type="submit" variant="solid" size="sm" className="min-h-11">
          Find
        </Button>
        {reference && (
          <Button variant="outline" size="sm" className="min-h-11" onClick={clearReference}>
            Clear
          </Button>
        )}
        {referenceError && (
          <p id="email-order-reference-error" role="alert" className="basis-full text-sm text-danger">
            {referenceError}
          </p>
        )}
      </form>

      <section aria-labelledby="emails-heading" aria-busy={state.status === "loading" ? true : undefined}>
        <h2 id="emails-heading" tabIndex={-1} className="display-md mb-4 !text-2xl outline-offset-2">
          {current}
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
          <EmptyState
            title={reference ? `No ticket email for order ${reference}` : status === "failed" ? "Nothing has failed" : "None right now"}
          />
        )}

        {state.status === "ready" && state.items.length > 0 && (
          <ul className="flex flex-col gap-4">
            {state.items.map((job) => (
              <EmailJobItem
                key={job.jobId}
                job={job}
                getToken={getToken}
                onResent={resent}
                onEmailChanged={emailChanged}
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
  onEmailChanged,
}: {
  job: AdminEmailJob;
  getToken: () => Promise<string>;
  onResent: (job: AdminEmailJob) => void;
  onEmailChanged: (outcome: AdminOrderEmailChangeResult) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [changing, setChanging] = useState(false);
  const changeButtonRef = useRef<HTMLButtonElement>(null);
  // Cancelled: focus goes back to Change email once it's rendered again.
  const refocusChange = useRef(false);
  const headingId = jobHeadingId(job);

  useEffect(() => {
    if (!refocusChange.current || changing) return;
    refocusChange.current = false;
    changeButtonRef.current?.focus();
  });

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
        {job.emailChanges && job.emailChanges.length > 0 && <EmailChangeHistory changes={job.emailChanges} />}
        {changing ? (
          <ChangeEmailForm
            job={job}
            getToken={getToken}
            onDone={(outcome) => {
              setChanging(false);
              if (outcome) onEmailChanged(outcome);
              else refocusChange.current = true;
            }}
          />
        ) : (
          <div className="flex flex-wrap gap-2">
            {job.status !== "sending" && (
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
            )}
            {/* Only a paid order's email can change (the API refuses a free or refunded one). */}
            {job.orderStatus === "paid" && (
              <Button
                ref={changeButtonRef}
                variant="outline"
                size="sm"
                className="min-h-11"
                aria-describedby={headingId}
                onClick={() => setChanging(true)}
              >
                Change email
              </Button>
            )}
          </div>
        )}
      </article>
    </li>
  );
}

/** The order's email changes, newest first (both addresses masked; an admin's with their reason). */
function EmailChangeHistory({ changes }: { changes: AdminOrderEmailChange[] }) {
  return (
    <div className="flex flex-col gap-1">
      <h4 className="text-sm font-semibold">Email changes</h4>
      <ul className="flex flex-col gap-2 text-sm">
        {changes.map((change, index) => (
          <li key={`${change.changedAt}-${index}`} className="border-l-2 border-surface-border pl-3">
            <p>
              {change.oldMaskedEmail ?? "No address"} &rarr; {change.newMaskedEmail}
            </p>
            <p className="text-muted">
              {change.changedBy === "admin" ? "By support" : "By the buyer"}, {formatMessageTime(change.changedAt)}
            </p>
            {change.reason && <p className="break-words">Reason: {change.reason}</p>}
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * Support moves the order to another address and the tickets are sent there
 * now: any time, any address (checked for mail, not against the typo list:
 * support has confirmed it with the buyer), with a reason that's logged.
 * `onDone({result, job})` once the API has answered (`unchanged` for the
 * same address: nothing was done); `onDone(null)` on Cancel.
 */
function ChangeEmailForm({
  job,
  getToken,
  onDone,
}: {
  job: AdminEmailJob;
  getToken: () => Promise<string>;
  onDone: (outcome: AdminOrderEmailChangeResult | null) => void;
}) {
  const id = useId();
  const emailId = `${id}-email`;
  const reasonId = `${id}-reason`;
  const [email, setEmail] = useState("");
  const [reason, setReason] = useState("");
  const [emailError, setEmailError] = useState<string | null>(null);
  const [reasonError, setReasonError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const emailRef = useRef<HTMLInputElement>(null);
  const reasonRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    emailRef.current?.focus();
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setFormError(null);
    const emailProblem = buyerEmailError(email) ? "Enter the new email address." : null;
    const trimmed = reason.trim();
    const reasonProblem =
      Array.from(trimmed).length < REASON_MIN
        ? "Say why, in a few words."
        : Array.from(trimmed).length > REASON_MAX
          ? `Use ${REASON_MAX} characters or fewer.`
          : null;
    setEmailError(emailProblem);
    setReasonError(reasonProblem);
    if (emailProblem) {
      emailRef.current?.focus();
      return;
    }
    if (reasonProblem) {
      reasonRef.current?.focus();
      return;
    }
    setBusy(true);
    try {
      onDone(await adminChangeOrderEmail(job.jobId, { email: email.trim(), reason: trimmed }, getToken));
    } catch (err) {
      setBusy(false);
      if (err instanceof ApiError && err.fieldErrors && (err.fieldErrors.email || err.fieldErrors.reason)) {
        setEmailError(err.fieldErrors.email ?? null);
        setReasonError(err.fieldErrors.reason ?? null);
        if (err.fieldErrors.email) emailRef.current?.focus();
        else reasonRef.current?.focus();
        return;
      }
      setFormError(errorText(err, "Couldn’t change the email. Try again."));
    }
  }

  return (
    <form
      noValidate
      onSubmit={submit}
      aria-label={`Change email for order ${job.orderReference}`}
      // A hairline sets the form apart from the order's details and history above it.
      className="mt-2 flex max-w-md flex-col gap-3 border-t border-surface-border pt-4"
    >
      <div className="flex flex-col gap-1">
        <label htmlFor={emailId} className="eyebrow text-muted">
          New email
        </label>
        <input
          ref={emailRef}
          id={emailId}
          type="email"
          inputMode="email"
          autoComplete="off"
          spellCheck={false}
          autoCapitalize="none"
          value={email}
          onChange={(e) => {
            setEmail(e.target.value);
            setEmailError(null);
          }}
          aria-invalid={emailError ? true : undefined}
          aria-describedby={emailError ? `${emailId}-error` : undefined}
          className={fieldClass}
        />
        {emailError && (
          <p id={`${emailId}-error`} role="alert" className="text-sm text-danger">
            {emailError}
          </p>
        )}
      </div>
      <div className="flex flex-col gap-1">
        <label htmlFor={reasonId} className="eyebrow text-muted">
          Reason
        </label>
        <textarea
          ref={reasonRef}
          id={reasonId}
          rows={3}
          maxLength={REASON_MAX}
          value={reason}
          onChange={(e) => {
            setReason(e.target.value);
            setReasonError(null);
          }}
          aria-invalid={reasonError ? true : undefined}
          aria-describedby={reasonError ? `${reasonId}-hint ${reasonId}-error` : `${reasonId}-hint`}
          className={fieldClass}
        />
        <p id={`${reasonId}-hint`} className="text-sm text-muted">
          What the buyer confirmed. Leave email addresses out.
        </p>
        {reasonError && (
          <p id={`${reasonId}-error`} role="alert" className="text-sm text-danger">
            {reasonError}
          </p>
        )}
      </div>
      {formError && (
        <Notice tone="danger" role="alert">
          {formError}
        </Notice>
      )}
      <p className="text-sm text-muted">The tickets are sent to the new address straight away. QR codes don&rsquo;t change.</p>
      <div className="flex flex-wrap gap-2">
        <Button type="submit" variant="solid" size="sm" className="min-h-11" busy={busy}>
          {busy ? "Changing…" : "Change and send"}
        </Button>
        <Button variant="outline" size="sm" className="min-h-11" onClick={() => onDone(null)}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
