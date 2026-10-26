"use client";

import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { useStatusParam } from "@/components/admin/admin-list-url";
import { Button } from "@/components/ui/Button";
import { SelectedDots } from "@/components/ui/FilterChip";
import { LoadingState } from "@/components/ui/ProgressLoader";
import { EmptyState, Notice } from "@/components/ui/Section";
import { adminListInvites, adminResendInvite, adminRevokeInvite } from "@/lib/api/admin";
import { ApiError, type GetToken } from "@/lib/api/client";
import type { AdminInviteRecord, InviteStatus } from "@/lib/api/types";
import { SessionExpiredError } from "@/lib/auth/session-token";
import { formatDayTime } from "@/lib/format";
import { INVITE_LINK_DAYS } from "@/lib/invites";
import AdminSessionExpired from "./AdminSessionExpired";
import { INVITES_UNAVAILABLE } from "./InviteForm";

export const INVITES_PATH = "/admin/invites";
export const INVITES_HEADING_ID = "invites-heading";

/** Each filter's label, its list's heading, and how a loaded list is announced ("3 invites waiting"). */
export const INVITE_STATUSES: {
  value: InviteStatus;
  label: string;
  heading: string;
  empty: string;
  one: string;
  many: string;
}[] = [
  {
    value: "pending",
    label: "Waiting",
    heading: "Invites waiting to be accepted",
    empty: "No invites waiting",
    one: "invite waiting",
    many: "invites waiting",
  },
  { value: "expired", label: "Expired", heading: "Expired invites", empty: "No expired invites", one: "expired invite", many: "expired invites" },
  { value: "accepted", label: "Accepted", heading: "Accepted invites", empty: "None accepted yet", one: "accepted invite", many: "accepted invites" },
  { value: "revoked", label: "Revoked", heading: "Revoked invites", empty: "None revoked", one: "revoked invite", many: "revoked invites" },
];

/** The list's names for the page's one sign-in form (InvitesAdmin's `reauthOwner`): its load, Load more, or an invite. */
const QUEUE_OWNER = "queue:";
const LIST_OWNER = `${QUEUE_OWNER}list`;
const MORE_OWNER = `${QUEUE_OWNER}more`;
const itemOwner = (inviteId: string) => `${QUEUE_OWNER}invite:${inviteId}`;

/** The sign-in form belongs to the list (not the invite form): a reload of the list ends its claim. */
export function isQueueReauthOwner(owner: string | null): boolean {
  return owner !== null && owner.startsWith(QUEUE_OWNER);
}

type LoadState =
  | { status: "loading" }
  | { status: "error"; message: string; sessionExpired: boolean }
  | { status: "ready"; items: AdminInviteRecord[]; nextCursor?: string };

/** Load more failed: a message, or the session ran out. */
type MoreError = { message: string } | { sessionExpired: true };

function errorText(err: unknown, fallback: string) {
  if (err instanceof ApiError && err.status === 503) return INVITES_UNAVAILABLE;
  return err instanceof ApiError && (err.status === 0 || (err.status >= 400 && err.status < 500)) ? err.message : fallback;
}

/** What a finished load is announced as: "3 invites waiting", "No expired invites". */
export function loadedMessage(status: InviteStatus, items: number, more: boolean): string {
  const s = INVITE_STATUSES.find((entry) => entry.value === status) ?? INVITE_STATUSES[0];
  if (items === 0) return `${s.empty}.`;
  return `${items.toLocaleString("en-AU")} ${items === 1 ? s.one : s.many}${more ? " shown, more to load" : ""}.`;
}

function headingId(invite: AdminInviteRecord) {
  return `invite-${invite.inviteId}`;
}

/**
 * /admin/invites' list: invites by status (`?status=`, Waiting by default),
 * newest first, with Load more (focus moves to the first new invite). A
 * waiting or expired invite can be resent (a new link, INVITE_LINK_DAYS days
 * from now; the old one stops working); a waiting one can be revoked, after
 * a confirmation (Escape cancels it). An invite that leaves the list it's in
 * (a revoked one, a resent expired one) goes, and focus moves to the next
 * invite (or the list's heading); each outcome is shown and announced, and a
 * load asked for (a filter, Try again) is announced. An expired session
 * offers the sign-in form where it happened, when the list holds it.
 * `refreshKey`: bumped when an invite is created, to reload the list.
 */
export default function InviteQueue({
  getToken,
  refreshKey,
  reauthOwner,
  onClaimReauth,
}: {
  getToken: GetToken;
  refreshKey: number;
  /** Who shows the page's one sign-in form after a session expired. */
  reauthOwner: string | null;
  onClaimReauth: (owner: string | null) => void;
}) {
  const [status, setStatus] = useStatusParam(INVITES_PATH, INVITE_STATUSES, "pending");
  const [attempt, setAttempt] = useState(0);
  const key = `${status}#${attempt}#${refreshKey}`;
  const [result, setResult] = useState<{ key: string; state: LoadState } | null>(null);
  const state: LoadState = result?.key === key ? result.state : { status: "loading" };
  const [loadingMore, setLoadingMore] = useState(false);
  const [moreError, setMoreError] = useState<MoreError | null>(null);
  /** What the last resend or revoke did: shown, and announced. */
  const [announcement, setAnnouncement] = useState("");
  /** The result of a load the admin asked for (a filter, Try again): screen readers only. */
  const [loadAnnouncement, setLoadAnnouncement] = useState("");
  const headingRef = useRef<HTMLHeadingElement>(null);
  /** An element id to focus once it's rendered: the next invite after one left, or the first one Load more added. */
  const pendingFocus = useRef<string | null>(null);
  /** Try again: the heading takes focus once the list has loaded (or failed again). */
  const focusHeadingAfterLoad = useRef(false);
  /** The next load finishing is announced (it was asked for, not the first page load). */
  const announceLoad = useRef(false);
  /** The list on screen: replaced whenever another is asked for, so an earlier list's Load more can tell. */
  const listToken = useRef<object>({});

  useEffect(() => {
    listToken.current = {};
  }, [key]);

  useEffect(() => {
    if (!pendingFocus.current) return;
    const element = document.getElementById(pendingFocus.current);
    if (!element) return; // Not rendered yet.
    pendingFocus.current = null;
    element.focus();
  });

  useEffect(() => {
    if (!focusHeadingAfterLoad.current || state.status === "loading") return;
    focusHeadingAfterLoad.current = false;
    headingRef.current?.focus();
  });

  useEffect(() => {
    let cancelled = false;
    adminListInvites(status, getToken).then(
      (page) => {
        if (cancelled) return;
        setResult({ key, state: { status: "ready", items: page.items, nextCursor: page.nextCursor } });
        if (announceLoad.current) {
          announceLoad.current = false;
          setLoadAnnouncement(loadedMessage(status, page.items.length, Boolean(page.nextCursor)));
        }
      },
      (err: unknown) => {
        if (cancelled) return;
        announceLoad.current = false; // The error is an alert itself.
        const sessionExpired = err instanceof SessionExpiredError;
        setResult({
          key,
          state: { status: "error", message: errorText(err, "Couldn’t load invites."), sessionExpired },
        });
        if (sessionExpired) onClaimReauth(LIST_OWNER);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [status, getToken, key, onClaimReauth]);

  /** Whatever the list on screen had going no longer applies: another one is loading. */
  function reset() {
    listToken.current = {};
    pendingFocus.current = null;
    announceLoad.current = true;
    setLoadingMore(false);
    setMoreError(null);
    setAnnouncement("");
    setLoadAnnouncement("");
    if (isQueueReauthOwner(reauthOwner)) onClaimReauth(null);
  }

  function show(next: InviteStatus) {
    reset();
    // The filter already shown: the URL won't change, so load it again.
    if (next === status) setAttempt((n) => n + 1);
    else setStatus(next);
  }

  function retryLoad() {
    reset();
    focusHeadingAfterLoad.current = true;
    setAttempt((n) => n + 1);
  }

  function setItems(change: (items: AdminInviteRecord[]) => AdminInviteRecord[], nextCursor?: string | null) {
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

  /** An invite changed: kept in place if it still belongs here, otherwise taken off the list. */
  function changed(invite: AdminInviteRecord, message: string) {
    setAnnouncement(message);
    if (invite.status === status) {
      setItems((items) => items.map((i) => (i.inviteId === invite.inviteId ? invite : i)));
      return;
    }
    if (state.status === "ready") {
      const index = state.items.findIndex((i) => i.inviteId === invite.inviteId);
      const neighbour = index === -1 ? undefined : (state.items[index + 1] ?? state.items[index - 1]);
      pendingFocus.current = neighbour ? headingId(neighbour) : INVITES_HEADING_ID;
    }
    if (reauthOwner === itemOwner(invite.inviteId)) onClaimReauth(null);
    setItems((items) => items.filter((i) => i.inviteId !== invite.inviteId));
  }

  async function loadMore() {
    if (state.status !== "ready" || !state.nextCursor || loadingMore) return;
    const token = listToken.current;
    setLoadingMore(true);
    setMoreError(null);
    if (reauthOwner === MORE_OWNER) onClaimReauth(null);
    try {
      const page = await adminListInvites(status, getToken, state.nextCursor);
      if (token !== listToken.current) return;
      const known = new Set(state.items.map((i) => i.inviteId));
      const fresh = page.items.filter((i) => !known.has(i.inviteId));
      setItems((items) => [...items, ...fresh], page.nextCursor ?? null);
      if (fresh[0]) pendingFocus.current = headingId(fresh[0]);
    } catch (err) {
      if (token !== listToken.current) return;
      if (err instanceof SessionExpiredError) {
        setMoreError({ sessionExpired: true });
        onClaimReauth(MORE_OWNER);
      } else {
        setMoreError({ message: errorText(err, "Couldn’t load more invites.") });
      }
    } finally {
      if (token === listToken.current) setLoadingMore(false);
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
            onClick={() => show(s.value)}
          >
            {status === s.value && <SelectedDots />}
            {s.label}
          </Button>
        ))}
      </div>

      {/* Always rendered so each result is announced; empty, it takes no space. */}
      <p role="status" className="border-l-2 border-foreground py-1 pl-4 text-sm empty:sr-only">
        {announcement}
      </p>
      <p id="invites-load-status" role="status" className="sr-only">
        {loadAnnouncement}
      </p>

      <section aria-labelledby={INVITES_HEADING_ID} aria-busy={state.status === "loading" ? true : undefined}>
        <h2
          id={INVITES_HEADING_ID}
          ref={headingRef}
          tabIndex={-1}
          className="display-md mb-4 scroll-mt-24 !text-2xl outline-offset-2"
        >
          {current.heading}
        </h2>

        {state.status === "loading" && <LoadingState text="Loading…" />}

        {state.status === "error" && (
          <div className="flex flex-col items-start gap-3">
            {state.sessionExpired ? (
              <AdminSessionExpired then="try again" withForm={reauthOwner === LIST_OWNER} onSignedIn={retryLoad} />
            ) : (
              <Notice tone="danger" role="alert">
                {state.message}
              </Notice>
            )}
            <Button variant="outline" size="sm" className="min-h-11" onClick={retryLoad}>
              Try again
            </Button>
          </div>
        )}

        {state.status === "ready" && state.items.length === 0 && <EmptyState title={current.empty} />}

        {state.status === "ready" && state.items.length > 0 && (
          <ul className="flex flex-col gap-4">
            {state.items.map((invite) => (
              <InviteItem
                key={invite.inviteId}
                invite={invite}
                getToken={getToken}
                onChanged={changed}
                reauthOwner={reauthOwner}
                onClaimReauth={onClaimReauth}
              />
            ))}
          </ul>
        )}

        {state.status === "ready" && state.nextCursor && (
          <div className="mt-6 flex flex-col items-start gap-3">
            {moreError &&
              ("sessionExpired" in moreError ? (
                <AdminSessionExpired
                  then="load more"
                  withForm={reauthOwner === MORE_OWNER}
                  onSignedIn={() => {
                    setMoreError(null);
                    onClaimReauth(null);
                  }}
                />
              ) : (
                <Notice tone="danger" role="alert">
                  {moreError.message}
                </Notice>
              ))}
            <Button variant="outline" busy={loadingMore} onClick={loadMore} className="min-h-11">
              {loadingMore ? "Loading…" : "Load more"}
            </Button>
          </div>
        )}
      </section>
    </div>
  );
}

function InviteItem({
  invite,
  getToken,
  onChanged,
  reauthOwner,
  onClaimReauth,
}: {
  invite: AdminInviteRecord;
  getToken: GetToken;
  onChanged: (invite: AdminInviteRecord, message: string) => void;
  reauthOwner: string | null;
  onClaimReauth: (owner: string | null) => void;
}) {
  const [busy, setBusy] = useState<"resend" | "revoke" | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** The session ran out during this action: sign in again, then try it again. */
  const [expired, setExpired] = useState<"resend" | "revoke" | null>(null);
  const pendingFocus = useRef<string | null>(null);
  const id = headingId(invite);
  const owner = itemOwner(invite.inviteId);
  const ids = { resend: `${id}-resend`, revoke: `${id}-revoke`, cancel: `${id}-cancel`, question: `${id}-question` };

  useEffect(() => {
    if (!pendingFocus.current) return;
    const element = document.getElementById(pendingFocus.current);
    if (!element) return;
    pendingFocus.current = null;
    element.focus();
  });

  function clearErrors() {
    setError(null);
    if (expired) {
      setExpired(null);
      if (reauthOwner === owner) onClaimReauth(null);
    }
  }

  function failed(err: unknown, action: "resend" | "revoke", fallback: string) {
    if (err instanceof SessionExpiredError) {
      setExpired(action);
      onClaimReauth(owner);
    } else {
      setError(errorText(err, fallback));
    }
  }

  async function resend() {
    if (busy) return;
    setBusy("resend");
    clearErrors();
    try {
      const result = await adminResendInvite(invite.inviteId, getToken);
      onChanged(
        result.invite,
        result.emailSent
          ? `Sent a new link to ${invite.email}. It works for ${INVITE_LINK_DAYS} days; the old one has stopped working.`
          : `Made a new link for ${invite.email}, but the email didn’t send. Try Resend again.`,
      );
    } catch (err) {
      failed(err, "resend", "Couldn’t resend the invite. Try again.");
    } finally {
      setBusy(null);
    }
  }

  function openConfirm() {
    clearErrors();
    pendingFocus.current = ids.cancel;
    setConfirming(true);
  }

  function closeConfirm() {
    pendingFocus.current = ids.revoke;
    setConfirming(false);
  }

  function confirmKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key !== "Escape" || busy) return;
    event.preventDefault();
    closeConfirm();
  }

  async function revoke() {
    if (busy) return;
    setBusy("revoke");
    clearErrors();
    try {
      const revoked = await adminRevokeInvite(invite.inviteId, getToken);
      onChanged(revoked, `Revoked the invite for ${invite.email}. Its link has stopped working.`);
    } catch (err) {
      failed(err, "revoke", "Couldn’t revoke the invite. Try again.");
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
          <dd>{formatDayTime(invite.createdAt)}</dd>
          {invite.lastSentAt && (
            <>
              <dt className="text-muted">Last sent</dt>
              <dd>
                {formatDayTime(invite.lastSentAt)} ({invite.sendCount} {invite.sendCount === 1 ? "email" : "emails"})
              </dd>
            </>
          )}
          {(invite.status === "pending" || invite.status === "expired") && (
            <>
              <dt className="text-muted">{invite.status === "expired" ? "Link expired" : "Link works until"}</dt>
              <dd>{formatDayTime(invite.expiresAt)}</dd>
            </>
          )}
          {invite.acceptedAt && (
            <>
              <dt className="text-muted">Accepted</dt>
              <dd>{formatDayTime(invite.acceptedAt)}</dd>
            </>
          )}
          {invite.revokedAt && (
            <>
              <dt className="text-muted">Revoked</dt>
              <dd>{formatDayTime(invite.revokedAt)}</dd>
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
        {expired && (
          <AdminSessionExpired
            then={expired === "resend" ? "resend the invite" : "revoke the invite"}
            withForm={reauthOwner === owner}
            onSignedIn={() => {
              pendingFocus.current = expired === "resend" ? ids.resend : ids.revoke;
              setExpired(null);
              onClaimReauth(null);
            }}
          />
        )}

        {confirming ? (
          // Escape cancels, as Cancel does.
          <div role="group" aria-labelledby={ids.question} onKeyDown={confirmKeyDown} className="flex flex-col gap-2">
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
                  id={ids.resend}
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
