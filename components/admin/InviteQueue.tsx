"use client";

import { useEffect, useRef, useState } from "react";
import { useStatusParam } from "@/components/admin/admin-list-url";
import { Button } from "@/components/ui/Button";
import { SelectedDots } from "@/components/ui/FilterChip";
import { LoadingState } from "@/components/ui/ProgressLoader";
import { EmptyState, Notice } from "@/components/ui/Section";
import { adminListInvites, adminResendInvite, adminRevokeInvite } from "@/lib/api/admin";
import { ApiError, type GetToken } from "@/lib/api/client";
import type { AdminInviteRecord, InviteStatus } from "@/lib/api/types";
import { formatMessageTime } from "@/lib/format";
import { INVITES_UNAVAILABLE } from "./InviteForm";

export const INVITES_PATH = "/admin/invites";

/** Each filter's label and its list's heading. */
export const INVITE_STATUSES: { value: InviteStatus; label: string; heading: string; empty: string }[] = [
  { value: "pending", label: "Waiting", heading: "Invites waiting to be accepted", empty: "No invites waiting" },
  { value: "expired", label: "Expired", heading: "Expired invites", empty: "No expired invites" },
  { value: "accepted", label: "Accepted", heading: "Accepted invites", empty: "None accepted yet" },
  { value: "revoked", label: "Revoked", heading: "Revoked invites", empty: "None revoked" },
];

type LoadState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; items: AdminInviteRecord[]; nextCursor?: string };

function errorText(err: unknown, fallback: string) {
  if (err instanceof ApiError && err.status === 503) return INVITES_UNAVAILABLE;
  return err instanceof ApiError && (err.status === 0 || (err.status >= 400 && err.status < 500)) ? err.message : fallback;
}

function headingId(invite: AdminInviteRecord) {
  return `invite-${invite.inviteId}`;
}

/**
 * /admin/invites' list: invites by status (`?status=`, Waiting by default),
 * newest first, with Load more. A waiting or expired invite can be resent
 * (a new link, 14 days from now; the old one stops working); a waiting one
 * can be revoked, after a confirmation. An invite that leaves the list it's
 * in (a revoked one, a resent expired one) goes, and focus moves to the next
 * invite (or the list's heading); each outcome is announced.
 * `refreshKey`: bumped when an invite is created, to reload the list.
 */
export default function InviteQueue({ getToken, refreshKey }: { getToken: GetToken; refreshKey: number }) {
  const [status, setStatus] = useStatusParam(INVITES_PATH, INVITE_STATUSES, "pending");
  const [attempt, setAttempt] = useState(0);
  const key = `${status}#${attempt}#${refreshKey}`;
  const [result, setResult] = useState<{ key: string; state: LoadState } | null>(null);
  const state: LoadState = result?.key === key ? result.state : { status: "loading" };
  const [loadingMore, setLoadingMore] = useState(false);
  const [moreError, setMoreError] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState("");
  // Where focus goes once an invite has left the list (its button, which had focus, is gone).
  const focusAfterRemoval = useRef<string | null>(null);

  useEffect(() => {
    if (!focusAfterRemoval.current) return;
    const element = document.getElementById(focusAfterRemoval.current);
    if (!element) return; // Not rendered yet.
    focusAfterRemoval.current = null;
    element.focus();
  });

  useEffect(() => {
    let cancelled = false;
    adminListInvites(status, getToken).then(
      (page) => {
        if (!cancelled) setResult({ key, state: { status: "ready", items: page.items, nextCursor: page.nextCursor } });
      },
      (err: unknown) => {
        if (!cancelled) setResult({ key, state: { status: "error", message: errorText(err, "Couldn’t load invites.") } });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [status, getToken, key]);

  /** An invite changed: kept in place if it still belongs here, otherwise taken off the list. */
  function changed(invite: AdminInviteRecord, message: string) {
    setAnnouncement(message);
    if (invite.status === status) {
      setResult((current) =>
        current && current.key === key && current.state.status === "ready"
          ? {
              key,
              state: {
                ...current.state,
                items: current.state.items.map((i) => (i.inviteId === invite.inviteId ? invite : i)),
              },
            }
          : current,
      );
      return;
    }
    if (state.status === "ready") {
      const index = state.items.findIndex((i) => i.inviteId === invite.inviteId);
      const neighbour = state.items[index + 1] ?? state.items[index - 1];
      focusAfterRemoval.current =
        neighbour && neighbour.inviteId !== invite.inviteId ? headingId(neighbour) : "invites-heading";
    }
    setResult((current) =>
      current && current.key === key && current.state.status === "ready"
        ? {
            key,
            state: { ...current.state, items: current.state.items.filter((i) => i.inviteId !== invite.inviteId) },
          }
        : current,
    );
  }

  async function loadMore() {
    if (state.status !== "ready" || !state.nextCursor || loadingMore) return;
    setLoadingMore(true);
    setMoreError(null);
    try {
      const page = await adminListInvites(status, getToken, state.nextCursor);
      const known = new Set(state.items.map((i) => i.inviteId));
      setResult((current) =>
        current && current.key === key && current.state.status === "ready"
          ? {
              key,
              state: {
                status: "ready",
                items: [...current.state.items, ...page.items.filter((i) => !known.has(i.inviteId))],
                nextCursor: page.nextCursor,
              },
            }
          : current,
      );
    } catch (err) {
      setMoreError(errorText(err, "Couldn’t load more invites."));
    } finally {
      setLoadingMore(false);
    }
  }

  const current = INVITE_STATUSES.find((s) => s.value === status) ?? INVITE_STATUSES[0];

  return (
    <div className="flex flex-col gap-6">
      <div role="group" aria-label="Show invites" className="flex flex-wrap gap-2">
        {INVITE_STATUSES.map((s) => (
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
            {status === s.value && <SelectedDots />}
            {s.label}
          </Button>
        ))}
      </div>

      <section aria-labelledby="invites-heading" aria-busy={state.status === "loading" ? true : undefined}>
        <h2 id="invites-heading" tabIndex={-1} className="display-md mb-4 !text-2xl outline-offset-2">
          {current.heading}
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

        {state.status === "ready" && state.items.length === 0 && <EmptyState title={current.empty} />}

        {state.status === "ready" && state.items.length > 0 && (
          <ul className="flex flex-col gap-4">
            {state.items.map((invite) => (
              <InviteItem key={invite.inviteId} invite={invite} getToken={getToken} onChanged={changed} />
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

function InviteItem({
  invite,
  getToken,
  onChanged,
}: {
  invite: AdminInviteRecord;
  getToken: GetToken;
  onChanged: (invite: AdminInviteRecord, message: string) => void;
}) {
  const [busy, setBusy] = useState<"resend" | "revoke" | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pendingFocus = useRef<string | null>(null);
  const id = headingId(invite);
  const ids = { revoke: `${id}-revoke`, cancel: `${id}-cancel`, question: `${id}-question` };

  useEffect(() => {
    if (!pendingFocus.current) return;
    const element = document.getElementById(pendingFocus.current);
    if (!element) return;
    pendingFocus.current = null;
    element.focus();
  });

  async function resend() {
    if (busy) return;
    setBusy("resend");
    setError(null);
    try {
      const result = await adminResendInvite(invite.inviteId, getToken);
      onChanged(
        result.invite,
        result.emailSent
          ? `Sent a new link to ${invite.email}. It works for 14 days; the old one has stopped working.`
          : `Made a new link for ${invite.email}, but the email didn’t send. Try Resend again.`,
      );
    } catch (err) {
      setError(errorText(err, "Couldn’t resend the invite. Try again."));
    } finally {
      setBusy(null);
    }
  }

  function openConfirm() {
    setError(null);
    pendingFocus.current = ids.cancel;
    setConfirming(true);
  }

  function closeConfirm() {
    pendingFocus.current = ids.revoke;
    setConfirming(false);
  }

  async function revoke() {
    if (busy) return;
    setBusy("revoke");
    setError(null);
    try {
      const revoked = await adminRevokeInvite(invite.inviteId, getToken);
      onChanged(revoked, `Revoked the invite for ${invite.email}. Its link has stopped working.`);
    } catch (err) {
      setError(errorText(err, "Couldn’t revoke the invite. Try again."));
      setBusy(null);
    }
  }

  const canResend = invite.status === "pending" || invite.status === "expired";
  const canRevoke = invite.status === "pending";

  return (
    <li className="border-t border-foreground pt-4">
      <article aria-labelledby={id} className="flex flex-col gap-2">
        <h3
          id={id}
          tabIndex={-1}
          className="font-sans text-base font-semibold tracking-normal break-all normal-case outline-offset-2"
        >
          {invite.email}
        </h3>
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
          <dt className="text-muted">As</dt>
          <dd className="break-words">
            {invite.kind === "organiser" ? `Organiser: ${invite.organiserName ?? "unnamed"}` : "Member"}
          </dd>
          <dt className="text-muted">Invited</dt>
          <dd>{formatMessageTime(invite.createdAt)}</dd>
          {invite.lastSentAt && (
            <>
              <dt className="text-muted">Last sent</dt>
              <dd>
                {formatMessageTime(invite.lastSentAt)} ({invite.sendCount} {invite.sendCount === 1 ? "email" : "emails"})
              </dd>
            </>
          )}
          {(invite.status === "pending" || invite.status === "expired") && (
            <>
              <dt className="text-muted">{invite.status === "expired" ? "Link expired" : "Link works until"}</dt>
              <dd>{formatMessageTime(invite.expiresAt)}</dd>
            </>
          )}
          {invite.acceptedAt && (
            <>
              <dt className="text-muted">Accepted</dt>
              <dd>{formatMessageTime(invite.acceptedAt)}</dd>
            </>
          )}
          {invite.revokedAt && (
            <>
              <dt className="text-muted">Revoked</dt>
              <dd>{formatMessageTime(invite.revokedAt)}</dd>
            </>
          )}
        </dl>
        {invite.lastSendFailedAt && canResend && (
          <Notice tone="danger">The last email didn’t send. Resend it.</Notice>
        )}
        {error && (
          <Notice tone="danger" role="alert">
            {error}
          </Notice>
        )}

        {confirming ? (
          <div role="group" aria-labelledby={ids.question} className="flex flex-col gap-2">
            <p id={ids.question} className="text-sm text-foreground">
              Revoke the invite for {invite.email}? Its link stops working at once, and this can’t be undone (you
              can invite them again).
            </p>
            <div className="flex flex-wrap gap-2">
              <Button id={ids.revoke} variant="danger" size="sm" className="min-h-11" busy={busy !== null} onClick={revoke}>
                {busy === "revoke" ? "Revoking…" : "Revoke invite"}
              </Button>
              <Button id={ids.cancel} variant="outline" size="sm" className="min-h-11" busy={busy !== null} onClick={closeConfirm}>
                Cancel
              </Button>
            </div>
          </div>
        ) : (
          (canResend || canRevoke) && (
            <div className="flex flex-wrap gap-2">
              {canResend && (
                <Button
                  variant="outline"
                  size="sm"
                  className="min-h-11"
                  busy={busy !== null}
                  aria-describedby={id}
                  onClick={resend}
                >
                  {busy === "resend" ? "Resending…" : invite.status === "expired" ? "Send a new link" : "Resend"}
                </Button>
              )}
              {canRevoke && (
                <Button
                  id={ids.revoke}
                  variant="outline"
                  size="sm"
                  className="min-h-11"
                  aria-describedby={id}
                  busy={busy !== null}
                  onClick={openConfirm}
                >
                  Revoke…
                </Button>
              )}
            </div>
          )
        )}
      </article>
    </li>
  );
}
