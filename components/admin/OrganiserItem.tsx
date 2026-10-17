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
import OrganiserEditLog from "./OrganiserEditLog";
import { formatOrganiserFieldValue, ORGANISER_FIELD_LABELS } from "./organiser-fields";

/** A failed action's message: the API's for a 4xx, an expired session's, otherwise `fallback`. */
export function actionErrorText(err: unknown, fallback: string): string {
  if (err instanceof SessionExpiredError) return err.message;
  return err instanceof ApiError && err.status >= 400 && err.status < 500 ? err.message : fallback;
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
 * once approved (the dialog itself is the queue's).
 */
export default function OrganiserItem({
  item,
  getToken,
  onRemoved,
  onSuspend,
}: {
  item: AdminOrganiserRecord;
  getToken: GetToken;
  /** It left this list (approved or rejected here); `message` is announced. */
  onRemoved: (item: AdminOrganiserRecord, message: string) => void;
  onSuspend: (item: AdminOrganiserRecord) => void;
}) {
  const id = item.organiserId;
  const headingId = organiserHeadingId(id);

  return (
    <li className="border-t border-foreground pt-4">
      <article aria-labelledby={headingId} className="flex flex-col gap-4">
        <header className="flex flex-col gap-1">
          <h3
            id={headingId}
            tabIndex={-1}
            className="font-sans text-base font-semibold normal-case tracking-normal break-words outline-offset-2"
          >
            {item.displayName}
          </h3>
          <p className="text-sm break-all text-muted">{item.contactEmail}</p>
          <p className="text-xs text-muted">
            Applied {formatDayTime(item.createdAt)}
            {item.reviewedAt && <> · Reviewed {formatDayTime(item.reviewedAt)}</>}
          </p>
        </header>

        <p className="text-sm break-words whitespace-pre-wrap">{item.description}</p>

        <dl className="flex flex-col gap-1 text-sm">
          <div className="flex flex-wrap gap-x-2">
            <dt className="text-muted">Categories</dt>
            <dd>{item.categories.map(categoryLabel).join(", ")}</dd>
          </div>
          <WebsiteRow url={item.websiteUrl} />
          {SOCIAL_HANDLE_FIELDS.map(({ field }) => {
            const value = item[field];
            return (
              <div key={field} className="flex flex-wrap gap-x-2">
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

        {item.rejectionReason && (
          <p className="text-sm break-words whitespace-pre-wrap">
            <span className="text-muted">{item.status === "rejected" ? "Reason given: " : "Earlier rejection: "}</span>
            {item.rejectionReason}
          </p>
        )}

        <OrganiserEditLog edits={item.recentEdits} />

        {item.status === "pending" && <ReviewActions item={item} getToken={getToken} onRemoved={onRemoved} />}

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

/**
 * The organiser's website for an admin: the full URL exactly as stored (so
 * a misleading address can be spotted), plus a link to open it when it's an
 * http(s) URL. Organiser-supplied, so the link is nofollow ugc and opens
 * without a referrer or opener.
 */
function WebsiteRow({ url }: { url?: string }) {
  const hostname = url ? websiteHostname(url) : null;
  return (
    <div className="flex flex-wrap gap-x-2">
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
}: {
  item: AdminOrganiserRecord;
  getToken: GetToken;
  onRemoved: (item: AdminOrganiserRecord, message: string) => void;
}) {
  const id = item.organiserId;
  const reasonId = `reject-reason-${id}`;
  const rejectOpenId = `reject-open-${id}`;
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState("");
  const [reasonError, setReasonError] = useState<string | null>(null);
  const [busy, setBusy] = useState<"approve" | "reject" | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Opening the reject form focuses its reason; Cancel returns to "Reject".
  const pendingFocus = useRef<string | null>(null);

  useEffect(() => {
    if (!pendingFocus.current) return;
    const element = document.getElementById(pendingFocus.current);
    if (!element) return; // Not rendered yet.
    pendingFocus.current = null;
    element.focus();
  }, [rejecting]);

  async function approve() {
    if (busy) return;
    setError(null);
    setBusy("approve");
    try {
      await adminApproveOrganiser(id, getToken);
      onRemoved(item, `Approved ${item.displayName}.`);
    } catch (err) {
      setError(actionErrorText(err, "Couldn’t approve this application. Try again."));
      setBusy(null);
    }
  }

  async function reject() {
    if (busy) return;
    setError(null);
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
      } else {
        setError(actionErrorText(err, "Couldn’t reject this application. Try again."));
      }
      setBusy(null);
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
      <div className="flex flex-wrap gap-2">
        {rejecting ? (
          <>
            <Button variant="danger" size="sm" className="min-h-11" busy={busy !== null} onClick={reject}>
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
            <Button variant="solid" size="sm" className="min-h-11" busy={busy !== null} onClick={approve}>
              {busy === "approve" ? "Approving…" : "Approve"}
            </Button>
            <Button
              id={rejectOpenId}
              variant="danger"
              size="sm"
              className="min-h-11"
              busy={busy !== null}
              onClick={() => {
                setError(null);
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
