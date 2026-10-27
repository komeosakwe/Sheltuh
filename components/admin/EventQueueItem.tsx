"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useClipViewer } from "@/components/events/ClipViewer";
import MessageField from "@/components/messages/MessageField";
import { Button, buttonClass } from "@/components/ui/Button";
import { Notice } from "@/components/ui/Section";
import { adminApproveEvent, adminRejectEvent, adminUnpublishEvent } from "@/lib/api/admin";
import { getClipPreview } from "@/lib/api/clips";
import { ApiError, type GetToken } from "@/lib/api/client";
import { isPayoutsRequiredError } from "@/lib/api/events";
import type { AdminEventRecord, EventStatus } from "@/lib/api/types";
import { SessionExpiredError } from "@/lib/auth/session-token";
import { clipPlayName, clipTimeLabel } from "@/lib/clip-display";
import { formatDayTime, formatEventWhen, formatTimeAgo } from "@/lib/format";
import { validateMessage } from "@/lib/message-text";
import { formatTicketBreakdown, formatTicketHeadline } from "@/lib/pricing";
import { ticketProviderName } from "@/lib/ticketing";
import AdminSessionExpired from "./AdminSessionExpired";
import { actionErrorText } from "./OrganiserItem";
import PrivateEventImage from "./PrivateEventImage";
import { googlePlaceHref, pinMapHref } from "@/lib/maps";
import { eventPlaceName } from "@/lib/place";

/** The API's limit for a rejection reason (lib/server/handlers/admin.ts, requireReason). */
export const EVENT_REJECT_REASON_MAX = 1000;

/** The API's limit for an unpublish reason (lib/server/handlers/admin.ts, as a takedown's). */
export const EVENT_UNPUBLISH_REASON_MAX = 500;

/**
 * adminUnpublishEvent, as it's called here: with `reviewFuture` (also turn on
 * review of the organiser's events, so their next ones come to the queue
 * instead of going live) when that's asked for.
 */
type UnpublishEvent = (
  eventId: string,
  getToken: GetToken,
  reason?: string,
  options?: { reviewFuture?: boolean },
) => Promise<unknown>;
const unpublishEvent: UnpublishEvent = adminUnpublishEvent;

/** The heading's id: focus moves here when the event before it leaves the list. */
export function eventHeadingId(eventId: string) {
  return `event-${eventId}`;
}

/**
 * The clip row's name when it holds the queue's sign-in form (its own, so it
 * and the row's actions never both show the form's fixed ids).
 */
export function clipReauthOwner(eventId: string) {
  return `clip:${eventId}`;
}

/** Admins run the door for a Sheltüh-run organiser's Sheltüh-ticketed event (docs/architecture.md, "Check-in"). */
export function hasAdminDoor(item: AdminEventRecord) {
  return item.organiserPlatformManaged && item.ticketingMode !== "external";
}

type Action = "approve" | "reject" | "unpublish";

/**
 * One event in the admin queue: what it is, who it's for, when and where,
 * its tickets with the all-inclusive prices buyers will see (lib/pricing.ts),
 * its seat map, who published it and when (published events), and the
 * actions for its status. Approve and Unpublish ask first, saying what will
 * happen (Unpublish with an optional note the organiser sees); Reject asks
 * for the reason the organiser will see. An event that has ended can't be unpublished from here (there's
 * nothing left to take offline). `onRemoved` is called when it leaves the
 * list (or turns out to have left it already), with what to announce.
 */
export default function EventQueueItem({
  item,
  listStatus,
  getToken,
  onRemoved,
  reauthOwner,
  onClaimReauth,
  now,
}: {
  item: AdminEventRecord;
  /** The list it's in: which actions it offers. */
  listStatus: EventStatus;
  getToken: GetToken;
  onRemoved: (item: AdminEventRecord, message: string) => void;
  /** Who shows the sign-in form after a session expired (only one may). */
  reauthOwner: string | null;
  onClaimReauth: (owner: string | null) => void;
  /** When "ended" is judged from (ms). */
  now: number;
}) {
  const id = item.eventId;
  const headingId = eventHeadingId(id);
  const ended = Date.parse(item.endsAt) <= now;
  const editHref = `/admin/events/${encodeURIComponent(id)}/edit`;

  return (
    <li className="border-t border-foreground py-4">
      <article aria-labelledby={headingId} className="flex flex-col gap-3">
        {item.imageUrl && <PrivateEventImage imageUrl={item.imageUrl} getToken={getToken} />}
        <header className="flex flex-col gap-1">
          <h3
            id={headingId}
            tabIndex={-1}
            className="font-sans text-base font-semibold normal-case tracking-normal break-words outline-offset-2"
          >
            {item.title}
          </h3>
          <p className="text-sm text-muted">
            {item.organiserName}
            {item.organiserPlatformManaged && <> &middot; Sheltüh-run organiser (no account of its own)</>}
          </p>
          <p className="text-sm text-muted">
            {formatEventWhen(item.startsAt, item.endsAt, item.timeZone, item.state)}
            {ended && (
              <>
                {" "}
                &middot; <span className="font-semibold text-foreground">Ended</span>
              </>
            )}
          </p>
          {item.publishedAt && item.publishedBy && (
            <p className="text-sm text-foreground" data-published-by={item.publishedBy}>
              <span className={item.publishedBy === "organiser" ? "font-semibold" : undefined}>
                {item.publishedBy === "organiser" ? "Published by the organiser" : "Published by Sheltüh"}
              </span>{" "}
              &middot;{" "}
              <time dateTime={item.publishedAt} title={formatDayTime(item.publishedAt)}>
                {formatTimeAgo(item.publishedAt, now)}
              </time>
            </p>
          )}
          {(item.curation.excluded || item.curation.boost !== 1) && (
            <p className="text-sm text-foreground" data-curation>
              Trending:{" "}
              <span className="font-semibold">
                {item.curation.excluded ? "Kept out of Trending" : `Boost ×${item.curation.boost}`}
              </span>
            </p>
          )}
          <p className="meta text-muted">
            {[item.venueName, eventPlaceName(item)].filter(Boolean).join(", ")}
          </p>
          <VenueLocationLine item={item} />
        </header>

        <p className="text-sm break-words whitespace-pre-wrap text-foreground">{item.description}</p>

        <Tickets item={item} />

        {item.seating && (
          // Reserved seating (docs/design/seating.md §5.14).
          <div className="flex flex-wrap items-center gap-x-3 border-t border-surface-border pt-2">
            <span className="eyebrow text-muted">Seat map</span>
            <span className="meta">{item.seating.seatCount} seats</span>
            <Link
              href={`/admin/events/${encodeURIComponent(id)}/seat-map`}
              aria-label={`Preview and view in editor: ${item.title} seat map`}
              className="inline-flex min-h-11 items-center text-sm underline underline-offset-4"
            >
              Preview and view in editor
            </Link>
          </div>
        )}

        {item.rejectionReason && (
          <p className="text-sm text-muted">
            <span className="font-semibold text-foreground">Reason given to the organiser:</span> {item.rejectionReason}
          </p>
        )}

        {/* Before the actions, so a reviewer reaches the clip before Approve… (docs/design/event-clips.md §5.5).
            Whenever there's a clip: the upload flag never hides one that exists from review. */}
        {item.clip && (
          <ClipRow
            item={item}
            clip={item.clip}
            getToken={getToken}
            reauthOwner={reauthOwner}
            onClaimReauth={onClaimReauth}
          />
        )}

        <Actions
          item={item}
          listStatus={listStatus}
          ended={ended}
          editHref={editHref}
          getToken={getToken}
          onRemoved={onRemoved}
          reauthOwner={reauthOwner}
          onClaimReauth={onClaimReauth}
        />
      </article>
    </li>
  );
}

/**
 * The event's clip for review (docs/design/event-clips.md §5.5): its length
 * and description, and Play clip, which fetches a short-lived preview URL
 * (the clip isn't public until the event is) and opens the page's clip viewer.
 * Named "Play clip: {title}, 0:12". An expired session asks to sign in again,
 * as the row's other actions do.
 */
function ClipRow({
  item,
  clip,
  getToken,
  reauthOwner,
  onClaimReauth,
}: {
  item: AdminEventRecord;
  clip: NonNullable<AdminEventRecord["clip"]>;
  getToken: GetToken;
  reauthOwner: string | null;
  onClaimReauth: (owner: string | null) => void;
}) {
  const viewer = useClipViewer();
  const owner = clipReauthOwner(item.eventId);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const [expired, setExpired] = useState(false);
  const playRef = useRef<HTMLButtonElement>(null);
  /** Signed in again: back to Play clip, once the sign-in form has gone. */
  const refocus = useRef(false);

  useEffect(() => {
    if (!refocus.current || expired) return;
    refocus.current = false;
    playRef.current?.focus();
  });

  async function play(trigger: HTMLButtonElement) {
    if (loading || !viewer) return;
    setFailed(false);
    if (expired) {
      setExpired(false);
      if (reauthOwner === owner) onClaimReauth(null);
    }
    setLoading(true);
    try {
      const preview = await getClipPreview(item.eventId, getToken);
      viewer.open({
        title: item.title,
        clip: { url: preview.url, description: clip.description, width: clip.width, height: clip.height },
        trigger,
      });
    } catch (err) {
      if (err instanceof SessionExpiredError) {
        setExpired(true);
        onClaimReauth(owner);
      } else {
        setFailed(true);
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <div data-clip-row="" className="flex flex-col items-start gap-2 border-t border-surface-border pt-2">
      <p className="eyebrow text-muted">Clip · {clipTimeLabel(clip.durationMs)}</p>
      <p className="text-sm leading-5 break-words text-foreground">{clip.description}</p>
      <Button
        ref={playRef}
        variant="outline"
        size="sm"
        className="min-h-11"
        busy={loading}
        // Contains the visible "Play clip" (Label in Name).
        aria-label={loading ? undefined : clipPlayName(item.title, clip.durationMs)}
        aria-haspopup="dialog"
        onClick={(e) => void play(e.currentTarget)}
      >
        {loading ? "Loading clip…" : "Play clip"}
      </Button>
      {failed && (
        <Notice tone="danger" role="alert">
          Couldn’t load the clip. Try again.
        </Notice>
      )}
      {expired && (
        <AdminSessionExpired
          then="play the clip"
          withForm={reauthOwner === owner}
          onSignedIn={() => {
            refocus.current = true;
            setExpired(false);
            onClaimReauth(null);
          }}
        />
      )}
    </div>
  );
}

/** The tickets as buyers will see them: each tier's all-inclusive price first, the breakdown after. */
function Tickets({ item }: { item: AdminEventRecord }) {
  if (item.ticketingMode === "external") {
    const provider =
      item.externalProvider ?? (item.externalTicketUrl ? ticketProviderName(item.externalTicketUrl) : null);
    return (
      <div className="flex flex-col gap-1 text-sm">
        <p className="eyebrow text-muted">Tickets</p>
        <p>
          Sold on {provider ?? "the organiser’s site"}
          {item.externalFree ? " · free entry, the organiser says" : ""}
        </p>
        {item.externalTicketUrl && (
          <a
            href={item.externalTicketUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex min-h-6 w-fit items-center break-all text-muted underline underline-offset-4 hover:text-foreground"
          >
            {item.externalTicketUrl} <span className="sr-only">(opens in a new tab)</span>
          </a>
        )}
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-1 text-sm">
      <p className="eyebrow text-muted">Tickets</p>
      {item.ticketTypes.length === 0 ? (
        <p className="text-muted">No ticket types yet.</p>
      ) : (
        <ul className="flex flex-col gap-1">
          {item.ticketTypes.map((ticket) => {
            const breakdown = formatTicketBreakdown(ticket);
            return (
              <li key={ticket.id} className="break-words">
                <span className="font-semibold">{ticket.name}:</span>{" "}
                <span className="tabular-nums">{formatTicketHeadline(ticket)}</span>
                <span className="text-muted">
                  {breakdown && <> ({breakdown})</>} &middot; {ticket.quantityAvailable.toLocaleString("en-AU")}{" "}
                  {ticket.seated ? "seats" : "available"}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function Actions({
  item,
  listStatus,
  ended,
  editHref,
  getToken,
  onRemoved,
  reauthOwner,
  onClaimReauth,
}: {
  item: AdminEventRecord;
  listStatus: EventStatus;
  ended: boolean;
  editHref: string;
  getToken: GetToken;
  onRemoved: (item: AdminEventRecord, message: string) => void;
  reauthOwner: string | null;
  onClaimReauth: (owner: string | null) => void;
}) {
  const id = item.eventId;
  const ids = {
    approve: `approve-${id}`,
    rejectOpen: `reject-open-${id}`,
    rejectConfirm: `reject-confirm-${id}`,
    reason: `reject-reason-${id}`,
    unpublish: `unpublish-${id}`,
    unpublishReason: `unpublish-reason-${id}`,
    reviewFuture: `unpublish-review-future-${id}`,
    cancel: `cancel-${id}`,
    question: `confirm-question-${id}`,
  };
  /** Which question is open: Approve and Unpublish confirm; Reject asks for a reason. */
  const [open, setOpen] = useState<Action | null>(null);
  const [reason, setReason] = useState("");
  const [reasonError, setReasonError] = useState<string | null>(null);
  /** Unpublish's optional note to the organiser (EventRecord.rejectionReason), kept while the question is reopened. */
  const [unpublishReason, setUnpublishReason] = useState("");
  const [unpublishReasonError, setUnpublishReasonError] = useState<string | null>(null);
  /** Unpublish also turns on review of the organiser's next events (a recreated listing can't go straight back up). */
  const [reviewFuture, setReviewFuture] = useState(false);
  const [busy, setBusy] = useState<Action | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** The session ran out during this action: sign in again (the reason is kept), then retry it. */
  const [expired, setExpired] = useState<Action | null>(null);
  const pendingFocus = useRef<string | null>(null);

  useEffect(() => {
    if (!pendingFocus.current) return;
    const element = document.getElementById(pendingFocus.current);
    if (!element) return; // Not rendered yet.
    pendingFocus.current = null;
    element.focus();
  });

  function clearErrors() {
    setError(null);
    if (expired) {
      setExpired(null);
      if (reauthOwner === id) onClaimReauth(null);
    }
  }

  function openQuestion(action: Action) {
    clearErrors();
    setReasonError(null);
    setUnpublishReasonError(null);
    // The safe choice first: Cancel for Approve, the reason box for a rejection, and the optional
    // note for Unpublish (the question describes it, so it's read on arriving).
    pendingFocus.current = action === "reject" ? ids.reason : action === "unpublish" ? ids.unpublishReason : ids.cancel;
    setOpen(action);
  }

  function closeQuestion() {
    const opener = open === "approve" ? ids.approve : open === "reject" ? ids.rejectOpen : ids.unpublish;
    clearErrors();
    setReasonError(null);
    setUnpublishReasonError(null);
    pendingFocus.current = opener;
    setOpen(null);
  }

  function failed(err: unknown, action: Action, fallback: string) {
    if (isPayoutsRequiredError(err)) {
      // Still waiting for review: its organiser's payouts aren't set up (any more). Say why, here; it stays
      // listed. The question is over (publishing can't work yet): close it, keep the notice, and put focus
      // back on Approve…, where the admin started.
      setError(err.message);
      setBusy(null);
      if (action === "approve") {
        pendingFocus.current = ids.approve;
        setOpen(null);
      }
      return;
    }
    if (err instanceof ApiError && (err.status === 409 || err.status === 404)) {
      // Someone else got there first (or the organiser was suspended): say so, and drop it from this list.
      onRemoved(item, `${item.title} couldn’t be changed: ${err.message} It’s been taken off this list.`);
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

  async function approve() {
    if (busy) return;
    clearErrors();
    setBusy("approve");
    try {
      await adminApproveEvent(id, getToken);
      onRemoved(item, `Published ${item.title}. It’s live, and its organiser’s followers are being emailed.`);
    } catch (err) {
      failed(err, "approve", "Couldn’t publish this event. Try again.");
    }
  }

  async function reject() {
    if (busy) return;
    clearErrors();
    const invalid = validateMessage(reason, {
      label: "Reasons",
      empty: "Enter a reason.",
      max: EVENT_REJECT_REASON_MAX,
    });
    setReasonError(invalid);
    if (invalid) {
      document.getElementById(ids.reason)?.focus();
      return;
    }
    setBusy("reject");
    try {
      await adminRejectEvent(id, reason.trim(), getToken);
      onRemoved(item, `Rejected ${item.title}. The organiser can see your reason.`);
    } catch (err) {
      if (err instanceof ApiError && err.fieldErrors?.reason) {
        setReasonError(err.fieldErrors.reason);
        document.getElementById(ids.reason)?.focus();
        setBusy(null);
      } else {
        failed(err, "reject", "Couldn’t reject this event. Try again.");
      }
    }
  }

  async function unpublish() {
    if (busy) return;
    clearErrors();
    const invalid = validateMessage(unpublishReason, {
      label: "Reasons",
      optional: true,
      max: EVENT_UNPUBLISH_REASON_MAX,
    });
    setUnpublishReasonError(invalid);
    if (invalid) {
      document.getElementById(ids.unpublishReason)?.focus();
      return;
    }
    const note = unpublishReason.trim();
    setBusy("unpublish");
    try {
      if (reviewFuture) await unpublishEvent(id, getToken, note || undefined, { reviewFuture: true });
      else await unpublishEvent(id, getToken, note || undefined);
      onRemoved(
        item,
        `Unpublished ${item.title}. It’s off the site and back with the organiser as a draft${note ? ", with your note" : ""}.${
          reviewFuture ? " Their next events come to you for review." : ""
        }`,
      );
    } catch (err) {
      if (err instanceof ApiError && err.fieldErrors?.reason) {
        setUnpublishReasonError(err.fieldErrors.reason);
        document.getElementById(ids.unpublishReason)?.focus();
        setBusy(null);
      } else {
        failed(err, "unpublish", "Couldn’t unpublish this event. Try again.");
      }
    }
  }

  const reviewing = listStatus === "pending_review";
  const published = listStatus === "published";
  const door = published && !ended && hasAdminDoor(item);
  /** A Sheltüh-run event sold elsewhere: listed with the Sheltüh-run events, but there's no door here to run. */
  const noDoor = published && !ended && item.organiserPlatformManaged && item.ticketingMode === "external";

  return (
    <div className="flex flex-col gap-3 border-t border-surface-border pt-3">
      {noDoor && !open && (
        <p className="text-sm text-muted">No door check-in here: tickets are sold on another site.</p>
      )}
      {open === "reject" && (
        <MessageField
          id={ids.reason}
          label="Reason (the organiser sees this: say what to change)"
          value={reason}
          onChange={(value) => {
            setReason(value);
            if (reasonError) setReasonError(null);
          }}
          error={reasonError}
          rows={3}
          max={EVENT_REJECT_REASON_MAX}
        />
      )}

      {(open === "approve" || open === "unpublish") && (
        <p id={ids.question} className="text-sm font-semibold">
          {open === "approve"
            ? `Publish ${item.title} now? It goes live on Sheltüh straight away, and the first time an event goes live its organiser’s followers are emailed (emails can’t be unsent).`
            : `Unpublish ${item.title}? Its page and checkout go offline straight away, and it goes back to the organiser as a draft. If they publish it again it comes to you for review. Tickets already sold stay valid; refunds are a separate decision in Stripe.`}
        </p>
      )}
      {open === "unpublish" && (
        <MessageField
          id={ids.unpublishReason}
          label="Reason (optional; the organiser sees this)"
          hint="Shown to the organiser on their event, so they know what to change."
          describedBy={ids.question}
          value={unpublishReason}
          onChange={(value) => {
            setUnpublishReason(value);
            if (unpublishReasonError) setUnpublishReasonError(null);
          }}
          error={unpublishReasonError}
          rows={2}
          max={EVENT_UNPUBLISH_REASON_MAX}
        />
      )}
      {open === "unpublish" && !item.organiserPlatformManaged && (
        <label htmlFor={ids.reviewFuture} className="flex min-h-11 items-center gap-3 text-sm font-medium">
          <input
            id={ids.reviewFuture}
            type="checkbox"
            checked={reviewFuture}
            onChange={(event) => setReviewFuture(event.target.checked)}
            className="size-5 shrink-0"
          />
          Also review this organiser&rsquo;s next events
        </label>
      )}

      {error && (
        <Notice tone="danger" role="alert">
          {error}
        </Notice>
      )}
      {expired && (
        <AdminSessionExpired
          then={expired === "approve" ? "publish it" : expired === "reject" ? "confirm the rejection" : "unpublish it"}
          withForm={reauthOwner === id}
          onSignedIn={() => {
            pendingFocus.current =
              expired === "approve" ? ids.approve : expired === "reject" ? ids.rejectConfirm : ids.unpublish;
            setExpired(null);
            onClaimReauth(null);
          }}
        />
      )}

      <div
        role={open ? "group" : undefined}
        aria-labelledby={open === "approve" || open === "unpublish" ? ids.question : undefined}
        aria-label={open === "reject" ? `Reject ${item.title}` : undefined}
        className="flex flex-wrap gap-2"
      >
        {open === "approve" && (
          <Button id={ids.approve} variant="solid" size="sm" className="min-h-11" busy={busy !== null} onClick={approve}>
            {busy === "approve" ? "Publishing…" : "Publish and email followers"}
          </Button>
        )}
        {open === "reject" && (
          <Button
            id={ids.rejectConfirm}
            variant="danger"
            size="sm"
            className="min-h-11"
            busy={busy !== null}
            onClick={reject}
          >
            {busy === "reject" ? "Rejecting…" : "Confirm rejection"}
          </Button>
        )}
        {open === "unpublish" && (
          <Button id={ids.unpublish} variant="danger" size="sm" className="min-h-11" busy={busy !== null} onClick={unpublish}>
            {busy === "unpublish" ? "Unpublishing…" : "Yes, unpublish"}
          </Button>
        )}
        {open && (
          <Button id={ids.cancel} variant="outline" size="sm" className="min-h-11" busy={busy !== null} onClick={closeQuestion}>
            Cancel
          </Button>
        )}

        {!open && (
          <>
            {reviewing && (
              <>
                <Button
                  id={ids.approve}
                  variant="solid"
                  size="sm"
                  className="min-h-11"
                  aria-label={`Approve ${item.title}…`}
                  onClick={() => openQuestion("approve")}
                >
                  Approve…
                </Button>
                <Button
                  id={ids.rejectOpen}
                  variant="danger"
                  size="sm"
                  className="min-h-11"
                  aria-label={`Reject ${item.title}…`}
                  onClick={() => openQuestion("reject")}
                >
                  Reject…
                </Button>
              </>
            )}
            {door && (
              <Link
                href={`/dashboard/${encodeURIComponent(item.eventId)}/check-in`}
                aria-label={`Door check-in: ${item.title}`}
                className={buttonClass("solid", "sm", "min-h-11")}
              >
                Door check-in
              </Link>
            )}
            <Link href={editHref} aria-label={`Edit ${item.title}`} className={buttonClass("outline", "sm", "min-h-11")}>
              Edit
            </Link>
            {published && !ended && (
              <Button
                id={ids.unpublish}
                variant="outline"
                size="sm"
                className="min-h-11"
                aria-label={`Unpublish ${item.title}…`}
                onClick={() => openQuestion("unpublish")}
              >
                Unpublish…
              </Button>
            )}
          </>
        )}
      </div>
    </div>
  );
}

/**
 * How the venue is located (docs/architecture.md, "Venue location"): linked
 * to a Google Maps place (and whether the organiser checked its pin), a pin
 * alone, or the address only (an event from before venue locations, or none
 * added yet). With a link to check it on Google Maps.
 */
function VenueLocationLine({ item }: { item: AdminEventRecord }) {
  const location = item.location;
  let label: string;
  let href: string | null = null;
  let linkText = "";
  if (location?.source === "places" && location.placeId) {
    label = location.pin ? "Linked to Google Maps, pin checked" : "Linked to Google Maps (pin not checked yet)";
    href = googlePlaceHref({ ...item, venuePlaceId: location.placeId });
    linkText = "Check on Google Maps";
  } else if (location?.pin) {
    label = "Pinned";
    href = pinMapHref(location.pin);
    linkText = "Check the pin on Google Maps";
  } else {
    label = "Address only";
  }
  return (
    <p className="flex flex-wrap items-center gap-x-3 text-sm text-foreground" data-venue-location={location?.source ?? "none"}>
      <span>
        <span className="text-muted">Location:</span> {label}
      </span>
      {href && (
        <a
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={`${linkText}: ${item.venueName || item.title} (opens in a new tab)`}
          className="inline-flex min-h-11 items-center underline underline-offset-4 sm:min-h-6"
        >
          {linkText}
          <span aria-hidden="true">&nbsp;↗</span>
        </a>
      )}
    </p>
  );
}
