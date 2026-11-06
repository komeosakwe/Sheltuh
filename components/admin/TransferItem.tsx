"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Notice } from "@/components/ui/Section";
import { adminTransferAction } from "@/lib/api/admin";
import { ApiError } from "@/lib/api/client";
import type { AdminTransfer, TransferAction } from "@/lib/api/types";
import { formatAud, formatDayWithYear, formatMessageTime } from "@/lib/format";
import TransferConfirmDialog from "./TransferConfirmDialog";
import {
  TRANSFER_ACTION_LABEL,
  TRANSFER_STATUS_LABEL,
  transferActions,
  transferErrorWords,
  transferHeadingId,
} from "./transfer-copy";

/** What an action's refusal (409) says to an admin, by the API's `code`; otherwise the API's own message. */
const CONFLICT_WORDS: Record<string, string> = {
  transfer_in_progress: "That transfer is being sent right now. Try again in a minute.",
  transfer_state_conflict: "That transfer has changed since this list loaded. Reload the list.",
  transfer_not_payable: "The order was refunded, so its transfer can’t be sent. Cancel it instead.",
};

export function actionErrorText(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.status === 409) {
      const code = typeof err.body?.code === "string" ? err.body.code : "";
      return CONFLICT_WORDS[code] ?? err.message;
    }
    if (err.status >= 400 && err.status < 500) return err.message;
  }
  return "Couldn’t do that. Nothing changed. Try again.";
}

const DOING: Record<TransferAction, string> = { retry: "Retrying…", release: "Releasing…", cancel: "Cancelling…" };

/** One transfer: what it is, why it's stuck (if it is) and the actions that apply. */
export default function TransferItem({
  transfer,
  getToken,
  onChanged,
}: {
  transfer: AdminTransfer;
  getToken: () => Promise<string>;
  onChanged: (before: AdminTransfer, after: AdminTransfer, action: TransferAction) => void;
}) {
  const [busy, setBusy] = useState<TransferAction | null>(null);
  const [confirming, setConfirming] = useState<"release" | "cancel" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const headingId = transferHeadingId(transfer);
  const actions = transferActions(transfer.status);
  const amount = formatAud(transfer.amountCents);

  async function run(action: TransferAction) {
    if (busy) return;
    setConfirming(null);
    setBusy(action);
    setError(null);
    try {
      onChanged(transfer, await adminTransferAction(transfer.transferId, action, getToken), action);
    } catch (err) {
      setError(actionErrorText(err));
    } finally {
      setBusy(null);
    }
  }

  function choose(action: TransferAction) {
    if (action === "retry") void run(action);
    else setConfirming(action);
  }

  return (
    <li className="border-t border-foreground pt-4">
      <article aria-labelledby={headingId} className="flex flex-col gap-2">
        <h3
          id={headingId}
          tabIndex={-1}
          className="outline-offset-2 font-sans text-base font-semibold normal-case tracking-normal break-words"
        >
          Order {transfer.orderReference}: {transfer.eventTitle}
        </h3>
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
          <dt className="text-muted">Status</dt>
          <dd className="font-semibold">{TRANSFER_STATUS_LABEL[transfer.status]}</dd>
          <dt className="text-muted">Organiser</dt>
          <dd className="break-words">{transfer.organiserName}</dd>
          <dt className="text-muted">Amount</dt>
          <dd>{amount}</dd>
          <dt className="text-muted">Event ended</dt>
          <dd>{formatDayWithYear(transfer.eventEndsAt)}</dd>
          {transfer.lastError && (
            <>
              <dt className="text-muted">Why</dt>
              <dd className="break-words">{transferErrorWords(transfer.lastError)}</dd>
            </>
          )}
          <dt className="text-muted">Attempts</dt>
          <dd>{transfer.attempts}</dd>
          {transfer.nextAttemptAt && (
            <>
              <dt className="text-muted">Next try</dt>
              <dd>{formatMessageTime(transfer.nextAttemptAt)}</dd>
            </>
          )}
          {transfer.sentAt && (
            <>
              <dt className="text-muted">Sent</dt>
              <dd>{formatMessageTime(transfer.sentAt)}</dd>
            </>
          )}
          {transfer.stripeTransferId && (
            <>
              <dt className="text-muted">Stripe</dt>
              <dd className="break-all">{transfer.stripeTransferId}</dd>
            </>
          )}
          {transfer.lastAdminAction && (
            <>
              <dt className="text-muted">Last action</dt>
              <dd>
                {TRANSFER_ACTION_LABEL[transfer.lastAdminAction.action]}, {formatMessageTime(transfer.lastAdminAction.at)}
              </dd>
            </>
          )}
          {transfer.orderStatus !== "paid" && (
            <>
              <dt className="text-muted">Order</dt>
              <dd>Not paid ({transfer.orderStatus.replace(/_/g, " ")})</dd>
            </>
          )}
        </dl>
        {error && (
          <Notice tone="danger" role="alert">
            {error}
          </Notice>
        )}
        {actions.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {actions.map((action) => (
              <Button
                key={action}
                variant="outline"
                size="sm"
                className="min-h-11"
                busy={busy === action}
                disabled={busy !== null && busy !== action}
                aria-describedby={headingId}
                onClick={() => choose(action)}
              >
                {busy === action ? DOING[action] : TRANSFER_ACTION_LABEL[action]}
              </Button>
            ))}
          </div>
        )}
        {confirming === "cancel" && (
          <TransferConfirmDialog
            titleId={`${headingId}-confirm`}
            title="Cancel this transfer?"
            confirmLabel="Cancel transfer"
            keepLabel="Keep it"
            danger
            onConfirm={() => void run("cancel")}
            onClose={() => setConfirming(null)}
          >
            <p>
              {amount} for {transfer.organiserName} (order {transfer.orderReference}) will never be sent.
            </p>
            <p>You’ll need to pay the organiser by hand.</p>
          </TransferConfirmDialog>
        )}
        {confirming === "release" && (
          <TransferConfirmDialog
            titleId={`${headingId}-confirm`}
            title="Release this transfer?"
            confirmLabel="Release"
            keepLabel="Keep held"
            onConfirm={() => void run("release")}
            onClose={() => setConfirming(null)}
          >
            <p>
              {amount} for {transfer.organiserName} (order {transfer.orderReference}) will go out with the next payouts
              run.
            </p>
            {transfer.lastError && <p>It’s held because: {transferErrorWords(transfer.lastError)}.</p>}
          </TransferConfirmDialog>
        )}
      </article>
    </li>
  );
}
