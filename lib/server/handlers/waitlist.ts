import { createHash, randomBytes } from "node:crypto";
import type {
  ConfirmWaitlistResult,
  JoinWaitlistResult,
  LeaveWaitlistResult,
  WaitlistStatus,
} from "@/lib/api/types";
import { requireCaller, type Caller } from "../auth";
import { maskEmail, redactForLog } from "../email-address";
import { HttpError, noContentPrivate, okPrivate, PRIVATE_NO_STORE, readJson } from "../http";
import { isUuid } from "../pagination";
import type { Handler } from "../route";
import { fail, requireEmail } from "../validation";
import { buildWaitlistConfirmationEmail, waitlistConfirmLink } from "../waitlist-email";
import { findEventById } from "./event-queries";
import { optionalCaller } from "./free-orders";

/**
 * The waitlist for sold-out events (docs/architecture.md, "Waitlist";
 * supabase/migrations/20261024000000_waitlist.sql). A signed-in member
 * joining with their own verified email is on the list at once; anyone else
 * confirms by an emailed link first, as for guest free tickets, under the
 * same kind of caps, and is never told anything about an address. When
 * tickets free up, private.notify_waitlist queues the emails
 * (lib/server/email-outbox.ts sends them).
 */
export const WAITLIST_LIMITS = {
  confirmHours: 24,
  /** Confirmation links per address (normalised, any event) per hour. */
  addressHourly: { hits: 3, window: "1 hour" },
  /**
   * Confirmation emails, platform-wide. They share the Workspace SMTP quota
   * (about 2,000 a day) with ticket emails and guest free-ticket links
   * (docs/architecture.md, "Accepted risks (waitlist)").
   */
  platformHourly: { hits: 30, window: "1 hour" },
  platformDaily: { hits: 200, window: "24 hours" },
} as const;

/**
 * private.notify_waitlist's rules, which live in SQL (it runs from database
 * triggers): up to `perTicketLeft` people per ticket left, at most
 * `maxPerWindow` per event within `windowHours`, each person at most once per
 * `windowHours`, and at most `platformDaily` a day across the platform.
 * Mirrored here for documentation and tests only; change both together.
 */
export const WAITLIST_NOTIFY = { perTicketLeft: 3, maxPerWindow: 100, windowHours: 12, platformDaily: 500 } as const;

/** 32 random bytes, base64url: 43 characters. */
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const hashToken = (token: string) => createHash("sha256").update(token, "utf8").digest("hex");

const EVENT_NOT_FOUND = "Event not found.";
const LINK_NOT_FOUND = "This link isn't valid. Check it's the whole link from your email.";
export const WAITLIST_CLOSED = "The waitlist for this event is closed.";
export const WAITLIST_NOT_SOLD_OUT = "Tickets for this event are still on sale, so there's no waitlist.";
export const WAITLIST_EXTERNAL = "Tickets for this event are sold on another site, so there's no Sheltüh waitlist.";

/** A refusal from private.waitlist_join_state: about the event, never the address. */
function refuseJoin(state: string): never {
  switch (state) {
    case "not_found":
      throw new HttpError(404, EVENT_NOT_FOUND);
    case "external":
      throw new HttpError(409, WAITLIST_EXTERNAL);
    case "not_sold_out":
      throw new HttpError(409, WAITLIST_NOT_SOLD_OUT);
    case "ended":
      throw new HttpError(409, WAITLIST_CLOSED);
    default:
      throw new Error(`Unexpected waitlist result: ${state}`);
  }
}

/** Whether `email` is the caller's own verified address (ignoring case). */
function isOwnVerifiedEmail(caller: Caller | null, email: string): caller is Caller & { email: string } {
  return caller?.emailVerified === true && !!caller.email && caller.email.trim().toLowerCase() === email.toLowerCase();
}

/**
 * SQL: waitlist entry `w` is the caller's, $2 being their user id and $3 their
 * verified email (null when it isn't verified): joined from their account,
 * or with that address (it's theirs, so a guest link they confirmed counts).
 */
const CALLERS_ENTRY = `(w.user_id = $2 or ($3::text is not null and w.email_key = private.email_key($3)))`;

const callerParams = (caller: Caller) => [caller.userId, caller.emailVerified && caller.email ? caller.email : null];

/**
 * POST /api/events/[eventId]/waitlist {email?} — public; a member's token is
 * read, optionally. Only a published, Sheltüh-ticketed event that hasn't
 * ended and is sold out (every ticket type): 404 otherwise for an event that
 * isn't published, 409 for the rest. A signed-in member with a verified
 * email who leaves `email` out (or sends that address) is on the list at
 * once: 201, or 200 if they already were. Anyone else gets 202 and a
 * confirmation link by email, the same 202 whatever the address's history
 * (already on the list, or over its hourly cap: then no email is sent).
 * 400 email; 503 platform cap, or the email couldn't be sent.
 */
export const joinWaitlist: Handler<{ eventId: string }> = async (req, { eventId }, deps) => {
  if (!isUuid(eventId)) throw new HttpError(404, EVENT_NOT_FOUND);
  const body = await readJson(req);
  const caller = await optionalCaller(req, deps);

  let email: string;
  if ((body.email === undefined || body.email === null || body.email === "") && caller?.emailVerified && caller.email) {
    email = caller.email.trim();
  } else {
    const errors: Record<string, string> = {};
    email = requireEmail(body.email, "email", errors);
    if (Object.keys(errors).length > 0) fail(errors);
  }

  if (isOwnVerifiedEmail(caller, email)) {
    const [{ result }] = await deps.db.query<{ result: string }>(`select private.join_waitlist($1, $2, $3) as result`, [
      eventId,
      email,
      caller.userId,
    ]);
    if (result !== "joined" && result !== "already_joined") refuseJoin(result);
    const joined: JoinWaitlistResult = { status: "joined", maskedEmail: maskEmail(email), alreadyJoined: result === "already_joined" };
    return Response.json(joined, { status: result === "joined" ? 201 : 200, headers: PRIVATE_NO_STORE });
  }

  const token = randomBytes(32).toString("base64url");
  const tokenHash = hashToken(token);
  const [{ result }] = await deps.db.query<{ result: string }>(
    `select private.request_waitlist_join($1, $2, $3, $4::interval, $5, $6::interval, $7, $8::interval, $9, $10::interval) as result`,
    [
      eventId,
      email,
      tokenHash,
      `${WAITLIST_LIMITS.confirmHours} hours`,
      WAITLIST_LIMITS.addressHourly.hits,
      WAITLIST_LIMITS.addressHourly.window,
      WAITLIST_LIMITS.platformHourly.hits,
      WAITLIST_LIMITS.platformHourly.window,
      WAITLIST_LIMITS.platformDaily.hits,
      WAITLIST_LIMITS.platformDaily.window,
    ],
  );
  const sent: JoinWaitlistResult = { status: "confirmation_sent", expiresInHours: WAITLIST_LIMITS.confirmHours };
  switch (result) {
    case "requested":
      break;
    // The same answer as a sent link: whether an address is on the list, or
    // has had links recently, is nobody else's business.
    case "already_joined":
    case "address_limited":
      return Response.json(sent, { status: 202, headers: PRIVATE_NO_STORE });
    case "platform_limited":
    case "platform_daily_limited":
      throw new HttpError(503, "The waitlist is busy right now. Try again in a few minutes.");
    default:
      refuseJoin(result);
  }

  const event = await findEventById(deps.db, eventId);
  try {
    if (!event) throw new Error("the event no longer exists");
    const link = waitlistConfirmLink(deps.siteUrl(), token);
    await deps.sendEmail(buildWaitlistConfirmationEmail(email, event, link, WAITLIST_LIMITS.confirmHours));
  } catch (err) {
    // Nobody can confirm a link that never arrived: drop it, so it doesn't use the address's hourly cap.
    await deps.db.query(`delete from private.event_waitlist_tokens where token_hash = $1`, [tokenHash]);
    console.error("Waitlist confirmation email failed:", redactForLog(err instanceof Error ? err.message : "unknown error"));
    throw new HttpError(503, "We couldn't send the confirmation email just now. Try again in a few minutes.");
  }
  return Response.json(sent, { status: 202, headers: PRIVATE_NO_STORE });
};

/**
 * GET /api/events/[eventId]/waitlist/status — signed in. Whether the caller
 * is on the event's waitlist: an entry joined from their account, or with
 * their verified email. 404 for an event that isn't published.
 */
export const getWaitlistStatus: Handler<{ eventId: string }> = async (req, { eventId }, deps) => {
  const caller = await requireCaller(req, deps.verifyAccessToken);
  if (!isUuid(eventId)) throw new HttpError(404, EVENT_NOT_FOUND);
  const [event] = await deps.db.query(`select 1 from public.events where id = $1 and status = 'published'`, [eventId]);
  if (!event) throw new HttpError(404, EVENT_NOT_FOUND);
  const [entry] = await deps.db.query<{ email: string }>(
    `select w.email from private.event_waitlist w
      where w.event_id = $1 and w.confirmed_at is not null and w.unsubscribed_at is null and ${CALLERS_ENTRY}
      order by w.confirmed_at, w.id limit 1`,
    [eventId, ...callerParams(caller)],
  );
  const status: WaitlistStatus = entry ? { joined: true, maskedEmail: maskEmail(entry.email) } : { joined: false };
  return okPrivate(status);
};

/**
 * DELETE /api/events/[eventId]/waitlist — signed in. Takes the caller off
 * the event's waitlist (their account's entry, and their verified email's),
 * whatever state the event is in. 204, idempotent.
 */
export const leaveWaitlistAsMember: Handler<{ eventId: string }> = async (req, { eventId }, deps) => {
  const caller = await requireCaller(req, deps.verifyAccessToken);
  if (!isUuid(eventId)) return noContentPrivate();
  await deps.db.query(
    `update private.event_waitlist w set unsubscribed_at = now()
      where w.event_id = $1 and w.unsubscribed_at is null and ${CALLERS_ENTRY}`,
    [eventId, ...callerParams(caller)],
  );
  return noContentPrivate();
};

function readToken(body: Record<string, unknown>): string {
  const token = typeof body.token === "string" ? body.token : "";
  if (!TOKEN_PATTERN.test(token)) fail({ token: "This link is incomplete. Open it from your email again." });
  return token;
}

/**
 * POST /api/waitlist/confirm {token} — public (the emailed token is the
 * credential). Puts the guest on the list. 200 (also when already on it);
 * 400 malformed; 404 unknown; 410 expired, or used and left since; 409 the
 * waitlist is closed (event unpublished, ticketed elsewhere, or ended).
 */
export const confirmWaitlist: Handler = async (req, _params, deps) => {
  const token = readToken(await readJson(req));
  const [row] = await deps.db.query<{ result: string; event_id: string | null }>(
    `select * from private.confirm_waitlist_join($1)`,
    [hashToken(token)],
  );
  switch (row.result) {
    case "joined":
    case "already_joined":
      break;
    case "not_found":
      throw new HttpError(404, LINK_NOT_FOUND);
    case "expired":
      throw new HttpError(410, "This link has expired. Join the waitlist again from the event page.");
    case "used":
      throw new HttpError(410, "This link has already been used. Join the waitlist again from the event page.");
    case "closed":
      throw new HttpError(409, WAITLIST_CLOSED);
    default:
      throw new Error(`Unexpected confirm_waitlist_join result: ${row.result}`);
  }
  const [event] = await deps.db.query<{ title: string; slug: string; published: boolean; available: boolean }>(
    `select e.title, e.slug, e.status = 'published' as published,
            exists (select 1 from public.ticket_types t
                     where t.event_id = e.id and t.quantity_sold < t.quantity_available) as available
       from public.events e where e.id = $1`,
    [row.event_id],
  );
  // Already on the list of an event since unpublished: nothing to link to.
  if (!event?.published) throw new HttpError(409, WAITLIST_CLOSED);
  const result: ConfirmWaitlistResult = {
    status: "joined",
    eventTitle: event.title,
    eventSlug: event.slug,
    ticketsAvailable: event.available,
  };
  return okPrivate(result);
};

/**
 * POST /api/waitlist/leave {token} — public (a notification email's leave
 * link). Takes that person off that event's list; no more emails about it.
 * 200, idempotent; 400 malformed; 404 unknown (or deleted since).
 */
export const leaveWaitlist: Handler = async (req, _params, deps) => {
  const token = readToken(await readJson(req));
  const [row] = await deps.db.query<{ result: string; event_id: string | null }>(
    `select * from private.leave_waitlist($1)`,
    [hashToken(token)],
  );
  if (row.result !== "left") throw new HttpError(404, LINK_NOT_FOUND);
  const [event] = await deps.db.query<{ title: string }>(`select title from public.events where id = $1`, [row.event_id]);
  const result: LeaveWaitlistResult = { status: "left", ...(event ? { eventTitle: event.title } : {}) };
  return okPrivate(result);
};
