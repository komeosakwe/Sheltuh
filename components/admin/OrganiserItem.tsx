"use client";

import { useEffect, useRef, useState } from "react";
import MessageField from "@/components/messages/MessageField";
import { Button } from "@/components/ui/Button";
import { Notice } from "@/components/ui/Section";
import { adminApproveOrganiser, adminRejectOrganiser } from "@/lib/api/admin";
import { ApiError, type GetToken } from "@/lib/api/client";
import type { AdminOrganiserRecord } from "@/lib/api/types";
import { SessionExpiredError } from "@/lib/auth/session-token";
import { formatDayTime } from "@/lib/format";
import { validateMessage } from "@/lib/message-text";
import { SOCIAL_HANDLE_FIELDS, websiteHostname } from "@/lib/organiser-profile";
import { EVENT_CATEGORIES } from "@/lib/types";
import AdminSessionExpired from "./AdminSessionExpired";
import OrganiserEditLog from "./OrganiserEditLog";
import { formatOrganiserFieldValue, ORGANISER_FIELD_LABELS } from "./organiser-fields";

/** A failed action's message: the API's for a 4xx, an expired session's, otherwise `fallback`. */
export function actionErrorText(err: unknown, fallback: string): string {
  if (err instanceof SessionExpiredError) return "Your session has expired. Sign in again to continue.";
  return err instanceof ApiError && err.status >= 400 && err.status < 500 ? err.message : fallback;
}

/** How a no-longer-pending organiser stands: rejected at review, or suspended (taken down) by an admin. */
export type OrganiserStanding =
  | { kind: "suspended"; at: string; reason?: string }
  | { kind: "rejected"; at?: string; reason?: string };

/**
 * A rejected organiser was suspended when their newest log entry of kind
 * "suspended" is their latest review (a takedown sets reviewedAt in the same
 * transaction); a later rejection, after they reapplied, makes it a plain
 * rejection again. The API has no flag for it. Null unless rejected.
 */
export function organiserStanding(item: AdminOrganiserRecord): OrganiserStanding | null {
  if (item.status !== "rejected") return null;
  const suspension = item.recentEdits.find((entry) => entry.kind === "suspended");
  if (suspension && (!item.reviewedAt || Date.parse(suspension.at) >= Date.parse(item.reviewedAt))) {
    return { kind: "suspended", at: suspension.at, reason: item.rejectionReason ?? suspension.reason };
  }
  return { kind: "rejected", at: item.reviewedAt, reason: item.rejectionReason };
}

/** The heading's id: focus moves here when the item before it leaves the list. */
export function organiserHeadingId(organiserId: string) {
  return `organiser-${organiserId}`;
}

/** The "Suspend…" button's id: focus comes back here when the dialog is cancelled. */
export function suspendButtonId(organiserId: string) {
  return `suspend-open-${organiserId}`;
}

function categoryLabel(value: string) {
  return EVENT_CATEGORIES.find((c) => c.value === value)?.label ?? value;
}

/**
 * One organiser in the admin queue: who they are, everything they've put on
 * (or for) their public profile as plain text, their recent profile changes,
 * and the actions for their status: Approve / Reject while pending, Suspend…
 * once approved (the dialog itself is the queue's). Rejected organisers say
 * whether they were rejected or suspended, when, and why.
 */
export default function OrganiserItem({
  item,
  getToken,
  onRemoved,
  onSuspend,
  headingDescribedBy,
  reauthOwner,
  onClaimReauth,
}: {
  item: AdminOrganiserRecord;
  getToken: GetToken;
  /** It left this list (approved or rejected here, or already reviewed); `message` is announced. */
  onRemoved: (item: AdminOrganiserRecord, message: string) => void;
  onSuspend: (item: AdminOrganiserRecord) => void;
  /** Set when focus moved to this heading after a removal: the announcement's id. */
  headingDescribedBy?: string;
  /** Who shows the sign-in form after a session expired (only one may). */
  reauthOwner: string | null;
  onClaimReauth: (owner: string | null) => void;
}) {
  const id = item.organiserId;
  const headingId = organiserHeadingId(id);
  const standing = organiserStanding(item);

  return (
    <li className="border-t border-foreground pt-4">
      <article aria-labelledby={headingId} className="flex flex-col gap-4">
        <header className="flex flex-col gap-1">
          {standing && (
            <p className={`eyebrow ${standing.kind === "suspended" ? "text-danger" : "text-muted"}`}>
              {standing.kind === "suspended" ? "Suspended" : "Rejected"}
            </p>
          )}
          <h3
            id={headingId}
            tabIndex={-1}
            aria-describedby={headingDescribedBy}
            className="font-sans text-base font-semibold normal-case tracking-normal break-words outline-offset-2"
          >
            {item.displayName}
          </h3>
          <a
            href={`mailto:${item.contactEmail}`}
            className="inline-flex min-h-6 w-fit items-center text-sm break-all text-muted underline underline-offset-4 hover:text-foreground hover:decoration-2"
          >
            {item.contactEmail}
          </a>
          <p className="text-xs text-muted">
            Applied {formatDayTime(item.createdAt)}
            {item.reviewedAt && <> · Reviewed {formatDayTime(item.reviewedAt)}</>}
          </p>
        </header>

        <p className="text-sm break-words whitespace-pre-wrap">{item.description}</p>

        {/* Label above value on phones; from sm, labels in a column with their values aligned beside them. */}
        <dl className="flex flex-col gap-2 text-sm sm:grid sm:grid-cols-[6rem_1fr] sm:gap-x-3 sm:gap-y-1">
          <div className={ROW_CLASS}>
            <dt className="text-muted">Categories</dt>
            <dd className="min-w-0 break-words">{item.categories.map(categoryLabel).join(", ")}</dd>
          </div>
          <WebsiteRow url={item.websiteUrl} />
          {SOCIAL_HANDLE_FIELDS.map(({ field }) => {
            const value = item[field];
            return (
              <div key={field} className={ROW_CLASS}>
                <dt className="text-muted">{ORGANISER_FIELD_LABELS[field]}</dt>
                <dd className="min-w-0 break-all">
                  {value ? (
                    formatOrganiserFieldValue(field, value)
                  ) : (
                    <span className="text-muted italic">Not given</span>
                  )}
                </dd>
              </div>
            );
          })}
        </dl>

        {standing && <StandingLine standing={standing} />}

        {!standing && item.rejectionReason && (
          <p className="text-sm break-words whitespace-pre-wrap">
            <span className="text-muted">Earlier rejection: </span>
            {item.rejectionReason}
          </p>
        )}

        <OrganiserEditLog edits={item.recentEdits} />

        {item.status === "pending" && (
          <ReviewActions
            item={item}
            getToken={getToken}
            onRemoved={onRemoved}
            reauthOwner={reauthOwner}
            onClaimReauth={onClaimReauth}
          />
        )}

        {item.status === "approved" && (
          <div className="border-t border-surface-border pt-4">
            <Button
              id={suspendButtonId(id)}
              variant="danger"
              size="sm"
              className="min-h-11"
              onClick={() => onSuspend(item)}
            >
              Suspend…
            </Button>
          </div>
        )}
      </article>
    </li>
  );
}

/** "Suspended Tue 20 Oct, 3:10 pm · Reason: …" (or "Rejected …"). */
function StandingLine({ standing }: { standing: OrganiserStanding }) {
  const verb = standing.kind === "suspended" ? "Suspended" : "Rejected";
  return (
    <p className="text-sm break-words whitespace-pre-wrap">
      <span className={standing.kind === "suspended" ? "font-semibold text-danger" : "font-semibold"}>{verb}</span>
      {standing.at && (
        <>
          {" "}
          <time dateTime={standing.at}>{formatDayTime(standing.at)}</time>
        </>
      )}
      {standing.reason && (
        <>
          <span className="text-muted"> · Reason: </span>
          {standing.reason}
        </>
      )}
    </p>
  );
}

/** A label/value row: stacked on phones, cells of the list's grid from sm. */
const ROW_CLASS = "flex flex-col sm:contents";

/**
 * The organiser's website for an admin: the full URL exactly as stored (so
 * a misleading address can be spotted), plus a link to open it when it's an
 * http(s) URL. Organiser-supplied, so the link is nofollow ugc and opens
 * without a referrer or opener.
 */
function WebsiteRow({ url }: { url?: string }) {
  const hostname = url ? websiteHostname(url) : null;
  return (
    <div className={ROW_CLASS}>
      <dt className="text-muted">Website</dt>
      <dd className="flex min-w-0 flex-col items-start">
        {url ? (
          <>
            <span className="break-all">{url}</span>
            {hostname && (
              <a
                href={url}
                target="_blank"
                rel="noopener noreferrer nofollow ugc"
                className="inline-flex min-h-11 items-center break-all underline underline-offset-4 hover:decoration-2"
              >
                Open {hostname} <span className="sr-only">(opens in a new tab)</span>
                <span aria-hidden="true">&nbsp;↗</span>
              </a>
            )}
          </>
        ) : (
          <span className="text-muted italic">Not given</span>
        )}
      </dd>
    </div>
  );
}

function ReviewActions({
  item,
  getToken,
  onRemoved,
  reauthOwner,
  onClaimReauth,
}: {
  item: AdminOrganiserRecord;
  getToken: GetToken;
  onRemoved: (item: AdminOrganiserRecord, message: string) => void;
  reauthOwner: string | null;
  onClaimReauth: (owner: string | null) => void;
}) {
  const id = item.organiserId;
  const reasonId = `reject-reason-${id}`;
  const rejectOpenId = `reject-open-${id}`;
  const approveId = `approve-${id}`;
  const rejectConfirmId = `reject-confirm-${id}`;
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState("");
  const [reasonError, setReasonError] = useState<string | null>(null);
  const [busy, setBusy] = useState<"approve" | "reject" | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** The session ran out during this action: sign in again (the reason is kept), then retry it. */
  const [expired, setExpired] = useState<"approve" | "reject" | null>(null);
  // Opening the reject form focuses its reason; Cancel returns to "Reject";
  // signing in again returns to the action that failed.
  const pendingFocus = useRef<string | null>(null);

  useEffect(() => {
    if (!pendingFocus.current) return;
    const element = document.getElementById(pendingFocus.current);
    if (!element) return; // Not rendered yet.
    pendingFocus.current = null;
    element.focus();
  });

  /** A failure that isn't about the reason: already reviewed (it leaves the list), session, or a message. */
  function failed(err: unknown, action: "approve" | "reject", fallback: string) {
    if (err instanceof ApiError && (err.status === 409 || err.status === 404)) {
      onRemoved(item, `${item.displayName} was already reviewed, so it’s been taken off this list.`);
      return;
    }
    if (err instanceof SessionExpiredError) {
      setExpired(action);
      onClaimReauth(id);
    } else {
      setError(actionErrorText(err, fallback));
    }
    setBusy(null);
  }

  function clearErrors() {
    setError(null);
    if (expired) {
      setExpired(null);
      if (reauthOwner === id) onClaimReauth(null);
    }
  }

  async function approve() {
    if (busy) return;
    clearErrors();
    setBusy("approve");
    try {
      await adminApproveOrganiser(id, getToken);
      onRemoved(item, `Approved ${item.displayName}.`);
    } catch (err) {
      failed(err, "approve", "Couldn’t approve this application. Try again.");
    }
  }

  async function reject() {
    if (busy) return;
    clearErrors();
    const invalid = validateMessage(reason, { label: "Reasons", empty: "Enter a reason." });
    setReasonError(invalid);
    if (invalid) {
      document.getElementById(reasonId)?.focus();
      return;
    }
    setBusy("reject");
    try {
      await adminRejectOrganiser(id, reason.trim(), getToken);
      onRemoved(item, `Rejected ${item.displayName}.`);
    } catch (err) {
      if (err instanceof ApiError && err.fieldErrors?.reason) {
        setReasonError(err.fieldErrors.reason);
        document.getElementById(reasonId)?.focus();
        setBusy(null);
      } else {
        failed(err, "reject", "Couldn’t reject this application. Try again.");
      }
    }
  }

  return (
    <div className="flex flex-col gap-3 border-t border-surface-border pt-4">
      {rejecting && (
        <MessageField
          id={reasonId}
          label="Reason (shown to the applicant)"
          value={reason}
          onChange={(value) => {
            setReason(value);
            if (reasonError) setReasonError(null);
          }}
          error={reasonError}
          rows={2}
        />
      )}
      {error && (
        <Notice tone="danger" role="alert">
          {error}
        </Notice>
      )}
      {expired && (
        <AdminSessionExpired
          then={expired === "approve" ? "approve this application" : "confirm the rejection"}
          withForm={reauthOwner === id}
          onSignedIn={() => {
            pendingFocus.current = expired === "approve" || !rejecting ? approveId : rejectConfirmId;
            setExpired(null);
            onClaimReauth(null);
          }}
        />
      )}
      <div className="flex flex-wrap gap-2">
        {rejecting ? (
          <>
            <Button
              id={rejectConfirmId}
              variant="danger"
              size="sm"
              className="min-h-11"
              busy={busy !== null}
              onClick={reject}
            >
              {busy === "reject" ? "Rejecting…" : "Confirm rejection"}
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="min-h-11"
              busy={busy !== null}
              onClick={() => {
                pendingFocus.current = rejectOpenId;
                setRejecting(false);
                setReasonError(null);
              }}
            >
              Cancel
            </Button>
          </>
        ) : (
          <>
            <Button
              id={approveId}
              variant="solid"
              size="sm"
              className="min-h-11"
              busy={busy !== null}
              onClick={approve}
            >
              {busy === "approve" ? "Approving…" : "Approve"}
            </Button>
            <Button
              id={rejectOpenId}
              variant="danger"
              size="sm"
              className="min-h-11"
              busy={busy !== null}
              onClick={() => {
                clearErrors();
                pendingFocus.current = reasonId;
                setRejecting(true);
              }}
            >
              Reject
            </Button>
          </>
        )}
      </div>
    </div>
  );
}
