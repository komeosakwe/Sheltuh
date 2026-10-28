"use client";

import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { Button } from "@/components/ui/Button";
import { LoadingState } from "@/components/ui/ProgressLoader";
import { Notice } from "@/components/ui/Section";
import { adminCancelOrganiserLink, adminCreateOrganiserLink, adminListOrganiserLinks } from "@/lib/api/admin";
import { ApiError, type GetToken } from "@/lib/api/client";
import type { AdminOrganiserLinkCreated, AdminOrganiserLinkRecord, OrganiserLinkStatus } from "@/lib/api/types";
import { SessionExpiredError } from "@/lib/auth/session-token";
import { formatDayTime, formatDayWithYear } from "@/lib/format";
import { ORGANISER_LINK_DAYS } from "@/lib/invites";
import AdminSessionExpired from "./AdminSessionExpired";

export const ORGANISER_LINKS_HEADING_ID = "organiser-links-heading";
const LIST_HEADING_ID = "organiser-links-list-heading";
const NEW_LINK_INPUT_ID = "new-organiser-link";
const NEW_LINK_NOTE_ID = "new-organiser-link-note";
const COPY_ID = "new-organiser-link-copy";

/** This section's names for the page's one sign-in form (InvitesAdmin's `reauthOwner`). */
const LINKS_OWNER = "links:";
const CREATE_OWNER = `${LINKS_OWNER}create`;
const LIST_OWNER = `${LINKS_OWNER}list`;
const MORE_OWNER = `${LINKS_OWNER}more`;
const itemOwner = (linkId: string) => `${LINKS_OWNER}link:${linkId}`;

const STATUS_LABELS: Record<OrganiserLinkStatus, string> = {
  active: "Waiting to be used",
  used: "Used",
  cancelled: "Cancelled",
  expired: "Expired, never used",
};

type LoadState =
  | { status: "loading" }
  | { status: "error"; message: string; sessionExpired: boolean }
  | { status: "ready"; items: AdminOrganiserLinkRecord[]; nextCursor?: string };

function errorText(err: unknown, fallback: string) {
  return err instanceof ApiError && (err.status === 0 || (err.status >= 400 && err.status < 500)) ? err.message : fallback;
}

/** What the share sheet says with the link. */
function shareText(expiresAt: string) {
  return `You're invited to sell tickets on Sheltüh. Open this link to set up your organiser profile. It works once, until ${formatDayWithYear(expiresAt)}.`;
}

function canShare(): boolean {
  return typeof navigator !== "undefined" && typeof navigator.share === "function";
}

function headingId(link: AdminOrganiserLinkRecord) {
  return `organiser-link-${link.linkId}`;
}

/**
 * /admin/invites' organiser links (docs/architecture.md, "Organiser links"):
 * Create organiser link makes a one-use link (7 days) that needs no email or
 * details, shown once with Copy and, where the device has one, Share (its
 * share sheet: WhatsApp, Messages, email). Below, every link, newest first,
 * with its state, who made it and the organiser it made; an unused one can
 * be cancelled after a confirmation (Escape keeps it). Outcomes are
 * announced. An expired session offers the page's sign-in form where it
 * happened, when this section holds it (`reauthOwner`).
 */
export default function OrganiserLinksAdmin({
  getToken,
  reauthOwner,
  onClaimReauth,
}: {
  getToken: GetToken;
  /** Who shows the page's one sign-in form after a session expired. */
  reauthOwner: string | null;
  onClaimReauth: (owner: string | null) => void;
}) {
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState<{ attempt: number; state: LoadState } | null>(null);
  const state: LoadState = result?.attempt === attempt ? result.state : { status: "loading" };
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [createExpired, setCreateExpired] = useState(false);
  const [created, setCreated] = useState<AdminOrganiserLinkCreated | null>(null);
  /** What the last create, copy, share or cancel did: announced (and shown). */
  const [announcement, setAnnouncement] = useState("");
  const [copyFailed, setCopyFailed] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [moreError, setMoreError] = useState<{ message: string } | { sessionExpired: true } | null>(null);
  const [shareable, setShareable] = useState(false);
  const pendingFocus = useRef<string | null>(null);

  // navigator.share is only known in the browser: checked after hydration, so the server render agrees.
  useEffect(() => {
    queueMicrotask(() => setShareable(canShare()));
  }, []);

  useEffect(() => {
    if (!pendingFocus.current) return;
    const element = document.getElementById(pendingFocus.current);
    if (!element) return;
    pendingFocus.current = null;
    element.focus();
  });

  useEffect(() => {
    let cancelled = false;
    adminListOrganiserLinks(getToken).then(
      (page) => {
        if (!cancelled) setResult({ attempt, state: { status: "ready", items: page.items, nextCursor: page.nextCursor } });
      },
      (err: unknown) => {
        if (cancelled) return;
        const sessionExpired = err instanceof SessionExpiredError;
        setResult({
          attempt,
          state: { status: "error", message: errorText(err, "Couldn’t load the organiser links."), sessionExpired },
        });
        if (sessionExpired) onClaimReauth(LIST_OWNER);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [attempt, getToken, onClaimReauth]);

  function retryLoad() {
    if (reauthOwner === LIST_OWNER || reauthOwner === MORE_OWNER) onClaimReauth(null);
    setMoreError(null);
    setAttempt((n) => n + 1);
  }

  function setItems(change: (items: AdminOrganiserLinkRecord[]) => AdminOrganiserLinkRecord[], nextCursor?: string | null) {
    setResult((current) =>
      current && current.attempt === attempt && current.state.status === "ready"
        ? {
            attempt,
            state: {
              status: "ready",
              items: change(current.state.items),
              nextCursor: nextCursor === undefined ? current.state.nextCursor : (nextCursor ?? undefined),
            },
          }
        : current,
    );
  }

  async function create() {
    if (creating) return;
    setCreating(true);
    setCreateError(null);
    setCopyFailed(false);
    setAnnouncement("");
    if (createExpired) {
      setCreateExpired(false);
      if (reauthOwner === CREATE_OWNER) onClaimReauth(null);
    }
    try {
      const made = await adminCreateOrganiserLink(getToken);
      setCreated(made);
      setItems((items) => [made.link, ...items.filter((l) => l.linkId !== made.link.linkId)]);
      setAnnouncement("Link created. Copy it now: it isn’t shown again.");
      pendingFocus.current = COPY_ID;
    } catch (err) {
      if (err instanceof SessionExpiredError) {
        setCreateExpired(true);
        onClaimReauth(CREATE_OWNER);
      } else {
        setCreateError(errorText(err, "Couldn’t create a link. Try again."));
      }
    } finally {
      setCreating(false);
    }
  }

  async function copy() {
    if (!created) return;
    setCopyFailed(false);
    try {
      if (!navigator.clipboard?.writeText) throw new Error("no clipboard");
      await navigator.clipboard.writeText(created.url);
      setAnnouncement("Link copied. Paste it into a message to the organiser.");
    } catch {
      // Select it for copying by hand.
      setCopyFailed(true);
      setAnnouncement("");
      const input = document.getElementById(NEW_LINK_INPUT_ID);
      if (input instanceof HTMLInputElement) {
        input.focus();
        input.select();
      }
    }
  }

  async function share() {
    if (!created || !canShare()) return;
    try {
      await navigator.share({ title: "Sell tickets on Sheltüh", text: shareText(created.link.expiresAt), url: created.url });
      setAnnouncement("Link shared.");
    } catch (err) {
      // Closing the share sheet is not a failure.
      if (err instanceof DOMException && err.name === "AbortError") return;
      setAnnouncement("Couldn’t open the share sheet. Copy the link instead.");
    }
  }

  async function loadMore() {
    if (state.status !== "ready" || !state.nextCursor || loadingMore) return;
    const forAttempt = attempt;
    setLoadingMore(true);
    setMoreError(null);
    if (reauthOwner === MORE_OWNER) onClaimReauth(null);
    try {
      const page = await adminListOrganiserLinks(getToken, state.nextCursor);
      if (forAttempt !== attempt) return;
      const known = new Set(state.items.map((l) => l.linkId));
      const fresh = page.items.filter((l) => !known.has(l.linkId));
      setItems((items) => [...items, ...fresh], page.nextCursor ?? null);
      if (fresh[0]) pendingFocus.current = headingId(fresh[0]);
    } catch (err) {
      if (err instanceof SessionExpiredError) {
        setMoreError({ sessionExpired: true });
        onClaimReauth(MORE_OWNER);
      } else {
        setMoreError({ message: errorText(err, "Couldn’t load more links.") });
      }
    } finally {
      setLoadingMore(false);
    }
  }

  function changed(link: AdminOrganiserLinkRecord, message: string) {
    setAnnouncement(message);
    setItems((items) => items.map((l) => (l.linkId === link.linkId ? link : l)));
    if (created?.link.linkId === link.linkId) setCreated(null);
  }

  return (
    <section
      aria-labelledby={ORGANISER_LINKS_HEADING_ID}
      className="flex flex-col gap-4 border-t border-foreground pt-5"
    >
      <h2 id={ORGANISER_LINKS_HEADING_ID} className="display-md !text-2xl">
        Organiser links
      </h2>
      <p className="max-w-xl text-sm text-muted">
        Make a link and send it to an organiser, on WhatsApp or by email. Whoever opens it signs up or signs in, types
        their organiser name, and is an approved organiser straight away. Each link works once, for{" "}
        {ORGANISER_LINK_DAYS} days.
      </p>

      <div>
        <Button variant="solid" busy={creating} onClick={create} className="min-h-11 w-full sm:w-auto">
          {creating ? "Creating…" : "Create organiser link"}
        </Button>
      </div>

      {createError && (
        <Notice tone="danger" role="alert">
          {createError}
        </Notice>
      )}
      {createExpired && (
        <AdminSessionExpired
          then="create the link"
          withForm={reauthOwner === CREATE_OWNER}
          onSignedIn={() => {
            setCreateExpired(false);
            onClaimReauth(null);
          }}
        />
      )}

      {created && (
        <div
          role="group"
          aria-label="New organiser link"
          className="flex min-w-0 flex-col gap-3 border border-foreground p-4"
        >
          <label htmlFor={NEW_LINK_INPUT_ID} className="font-semibold text-foreground">
            Your new organiser link
          </label>
          <input
            id={NEW_LINK_INPUT_ID}
            readOnly
            value={created.url}
            aria-describedby={NEW_LINK_NOTE_ID}
            onFocus={(e) => e.currentTarget.select()}
            className="w-full min-w-0 border border-foreground bg-transparent px-3 py-2 font-mono text-sm text-foreground"
          />
          <p id={NEW_LINK_NOTE_ID} className="text-sm text-muted">
            Copy it now: it isn’t shown again. Anyone with this link can become an approved organiser, so send it only
            to the organiser. It works once, until {formatDayTime(created.link.expiresAt)}.
          </p>
          {copyFailed && (
            <Notice tone="danger" role="alert">
              Couldn’t copy it. The link is selected: copy it by hand.
            </Notice>
          )}
          <div className="flex flex-wrap gap-2">
            <Button id={COPY_ID} variant="solid" onClick={copy} className="min-h-11">
              Copy link
            </Button>
            {shareable && (
              <Button variant="outline" onClick={share} className="min-h-11">
                Share…
              </Button>
            )}
          </div>
        </div>
      )}

      {/* Always rendered so each outcome is announced; empty, it takes no space. */}
      <p role="status" className="border-l-2 border-foreground py-1 pl-4 text-sm empty:sr-only">
        {announcement}
      </p>

      <section aria-labelledby={LIST_HEADING_ID} aria-busy={state.status === "loading" ? true : undefined}>
        <h3 id={LIST_HEADING_ID} tabIndex={-1} className="mb-3 font-heading text-lg text-foreground outline-offset-2">
          Links made
        </h3>

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

        {state.status === "ready" && state.items.length === 0 && (
          <p className="text-sm text-muted">No organiser links yet.</p>
        )}

        {state.status === "ready" && state.items.length > 0 && (
          <ul className="flex flex-col gap-4">
            {state.items.map((link) => (
              <LinkItem
                key={link.linkId}
                link={link}
                getToken={getToken}
                onChanged={changed}
                reauthOwner={reauthOwner}
                onClaimReauth={onClaimReauth}
              />
            ))}
          </ul>
        )}

        {state.status === "ready" && state.nextCursor && (
          <div className="mt-4 flex flex-col items-start gap-3">
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
              {loadingMore ? "Loading…" : "Load more links"}
            </Button>
          </div>
        )}
      </section>
    </section>
  );
}

function LinkItem({
  link,
  getToken,
  onChanged,
  reauthOwner,
  onClaimReauth,
}: {
  link: AdminOrganiserLinkRecord;
  getToken: GetToken;
  onChanged: (link: AdminOrganiserLinkRecord, message: string) => void;
  reauthOwner: string | null;
  onClaimReauth: (owner: string | null) => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expired, setExpired] = useState(false);
  const pendingFocus = useRef<string | null>(null);
  const id = headingId(link);
  const owner = itemOwner(link.linkId);
  const ids = { cancel: `${id}-cancel`, keep: `${id}-keep`, question: `${id}-question` };
  const made = formatDayTime(link.createdAt);

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
      setExpired(false);
      if (reauthOwner === owner) onClaimReauth(null);
    }
  }

  function openConfirm() {
    clearErrors();
    pendingFocus.current = ids.keep;
    setConfirming(true);
  }

  function closeConfirm() {
    pendingFocus.current = ids.cancel;
    setConfirming(false);
  }

  function confirmKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key !== "Escape" || busy) return;
    event.preventDefault();
    closeConfirm();
  }

  async function cancelLink() {
    if (busy) return;
    setBusy(true);
    clearErrors();
    try {
      const cancelled = await adminCancelOrganiserLink(link.linkId, getToken);
      // The item stays (now cancelled): focus its heading, as the button has gone.
      pendingFocus.current = id;
      setConfirming(false);
      onChanged(cancelled, `Cancelled the link made ${made}. It has stopped working.`);
    } catch (err) {
      if (err instanceof SessionExpiredError) {
        setExpired(true);
        onClaimReauth(owner);
      } else {
        setError(errorText(err, "Couldn’t cancel the link. Try again."));
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <li className="border-t border-foreground pt-3">
      <article aria-labelledby={id} className="flex flex-col gap-2">
        <h4 id={id} tabIndex={-1} className="font-sans text-base font-semibold tracking-normal normal-case outline-offset-2">
          Link made {made}
        </h4>
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
          <dt className="text-muted">Status</dt>
          <dd>{STATUS_LABELS[link.status]}</dd>
          <dt className="text-muted">Made by</dt>
          <dd className="break-all">{link.createdByEmail ?? "A former admin"}</dd>
          {(link.status === "active" || link.status === "expired") && (
            <>
              <dt className="text-muted">{link.status === "expired" ? "Expired" : "Works until"}</dt>
              <dd>{formatDayTime(link.expiresAt)}</dd>
            </>
          )}
          {link.status === "used" && (
            <>
              <dt className="text-muted">Organiser</dt>
              <dd className="break-words">{link.organiserName ?? "No longer on Sheltüh"}</dd>
              {link.usedAt && (
                <>
                  <dt className="text-muted">Joined</dt>
                  <dd>{formatDayTime(link.usedAt)}</dd>
                </>
              )}
            </>
          )}
          {link.cancelledAt && (
            <>
              <dt className="text-muted">Cancelled</dt>
              <dd>{formatDayTime(link.cancelledAt)}</dd>
            </>
          )}
        </dl>
        {error && (
          <Notice tone="danger" role="alert">
            {error}
          </Notice>
        )}
        {expired && (
          <AdminSessionExpired
            then="cancel the link"
            withForm={reauthOwner === owner}
            onSignedIn={() => {
              pendingFocus.current = ids.cancel;
              setExpired(false);
              onClaimReauth(null);
            }}
          />
        )}
        {link.status === "active" &&
          (confirming ? (
            // Escape keeps the link, as Keep link does.
            <div role="group" aria-labelledby={ids.question} onKeyDown={confirmKeyDown} className="flex flex-col gap-2">
              <p id={ids.question} className="text-sm text-foreground">
                Cancel the link made {made}? It stops working at once, and this can’t be undone (you can make a new
                one).
              </p>
              <div className="flex flex-wrap gap-2">
                <Button id={ids.cancel} variant="danger" size="sm" className="min-h-11" busy={busy} onClick={cancelLink}>
                  {busy ? "Cancelling…" : "Cancel link"}
                </Button>
                <Button id={ids.keep} variant="outline" size="sm" className="min-h-11" busy={busy} onClick={closeConfirm}>
                  Keep link
                </Button>
              </div>
            </div>
          ) : (
            <div>
              <Button id={ids.cancel} variant="outline" size="sm" className="min-h-11" aria-describedby={id} onClick={openConfirm}>
                Cancel link…
              </Button>
            </div>
          ))}
      </article>
    </li>
  );
}
