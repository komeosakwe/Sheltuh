/**
 * Messages to ticket holders (docs/architecture.md, "Messages to ticket
 * holders"; supabase/migrations/20261118000100_ticket_holder_messages.sql):
 * an approved organiser sends one short plain-text email about their own
 * event to everyone holding a ticket for it, without ever seeing an address.
 * Sheltüh sends it. Everything is rechecked, under locks, in
 * private.send_holder_message; the admin can read every message and stop one.
 */
import type {
  AdminHolderMessage,
  AdminHolderMessageDetail,
  HolderMessageBlockReason,
  HolderMessageInput,
  HolderMessageLimits,
  HolderMessageSent,
  HolderMessagesState,
  Paginated,
} from "@/lib/api/types";
import { requireAdmin, requireCaller } from "../auth";
import type { Deps } from "../deps";
import { sendHolderMessagesSoon } from "../email-outbox";
import { createdPrivate, HttpError, okPrivate, readJson } from "../http";
import { parseMessageText } from "../message-input";
import { decodeCursor, isUuid, parseLimit, toPage } from "../pagination";
import { containsLink } from "../profile-input";
import {
  adminHolderMessageSelect,
  HOLDER_MESSAGE_SELECT,
  toAdminHolderMessage,
  toAdminHolderMessageDetail,
  toHolderMessageSummary,
} from "../records";
import type { Handler } from "../route";
import { fail } from "../validation";
import { requireApprovedOrganiser } from "./organiser-guard";

/** What the compose form and the API enforce. The database enforces the lengths and the recipient count again. */
export const HOLDER_MESSAGE_LIMITS: HolderMessageLimits = {
  subjectMin: 5,
  subjectMax: 100,
  bodyMin: 20,
  bodyMax: 1500,
  maxRecipients: 1000,
  perEventPerDay: 2,
  perEventTotal: 6,
  perOrganiserPerDay: 4,
};

/** A message can be sent until this long after the event ends. */
const AFTER_END = "2 days";
/** Per organiser account (take_rate_limit bucket 'holder_messages'). */
const ORGANISER_WINDOW = "24 hours";
/** Most messages an event's history lists (its total cap is 6, so this is never reached). */
const HISTORY_LIMIT = 20;

const EVENT_NOT_FOUND = "Event not found.";
const MESSAGE_NOT_FOUND = "Message not found.";

/** An address ("a@b"): organisers can't put one in a message (a handle like "@name" is fine). */
const EMAIL_LIKE = /\S+@\S+/;
/** Most an expected audience size can be (far above the real cap, below any integer overflow). */
const MAX_EXPECTED = 100_000;

/** One field of the message: cleaned plain text within its length, with no links or email addresses. */
function parseField(
  value: unknown,
  field: "subject" | "body",
  errors: Record<string, string>,
): string {
  const subject = field === "subject";
  const label = subject ? "The subject" : "The message";
  const min = subject ? HOLDER_MESSAGE_LIMITS.subjectMin : HOLDER_MESSAGE_LIMITS.bodyMin;
  const max = subject ? HOLDER_MESSAGE_LIMITS.subjectMax : HOLDER_MESSAGE_LIMITS.bodyMax;
  const text = parseMessageText(value, field, errors, { allowLinks: true, label, maxLength: max });
  if (!text) return "";
  if (subject && /[\r\n\t]/.test(text)) {
    errors[field] = "The subject must be on one line.";
    return "";
  }
  if (containsLink(text)) {
    errors[field] = `${label} can't include links or web addresses.`;
    return "";
  }
  if (EMAIL_LIKE.test(text)) {
    errors[field] = `${label} can't include email addresses.`;
    return "";
  }
  if (Array.from(text).length < min) {
    errors[field] = `${label} must be at least ${min} characters.`;
    return "";
  }
  return text;
}

function parseSendInput(body: Record<string, unknown>): HolderMessageInput {
  const errors: Record<string, string> = {};
  const requestId = typeof body.requestId === "string" && isUuid(body.requestId) ? body.requestId : "";
  if (!requestId) errors.requestId = "Missing or invalid request id.";
  const subject = parseField(body.subject, "subject", errors);
  const text = parseField(body.body, "body", errors);
  if (body.attest !== true) errors.attest = "Confirm that this is about the event and has no promotion.";
  const expected = body.expectedRecipients;
  if (typeof expected !== "number" || !Number.isInteger(expected) || expected < 1 || expected > MAX_EXPECTED) {
    errors.expectedRecipients = "Must be the number of ticket holders you confirmed.";
  }
  if (Object.keys(errors).length > 0) fail(errors);
  return { requestId, subject, body: text, attest: true, expectedRecipients: expected as number };
}

/** GET /api/events/{eventId}/holder-messages — the audience, what can be sent, and the history. 404 unless the event is the caller's own. */
export const getHolderMessages: Handler<{ eventId: string }> = async (req, { eventId }, deps) => {
  const caller = await requireCaller(req, deps.verifyAccessToken);
  const organiser = await requireApprovedOrganiser(deps.db, caller);
  if (!isUuid(eventId)) throw new HttpError(404, EVENT_NOT_FOUND);

  const [event] = await deps.db.query<{ status: string; ticketing_mode: string; outside_window: boolean }>(
    `select e.status::text as status, e.ticketing_mode::text as ticketing_mode,
            e.ends_at + $3::interval <= now() as outside_window
       from public.events e where e.id = $1 and e.organiser_id = $2`,
    [eventId, organiser.organiserId, AFTER_END],
  );
  if (!event) throw new HttpError(404, EVENT_NOT_FOUND);

  const [audience] = await deps.db.query<{ n: number }>(`select count(*)::integer as n from private.holder_message_audience($1)`, [
    eventId,
  ]);
  const [counts] = await deps.db.query<{ today: number; total: number }>(
    `select (count(*) filter (where m.created_at > now() - interval '24 hours'))::integer as today, count(*)::integer as total
       from private.holder_messages m where m.event_id = $1`,
    [eventId],
  );
  const [used] = await deps.db.query<{ hits: number }>(
    `select r.hits from private.rate_limits r
      where r.user_id = $1 and r.bucket = 'holder_messages' and r.window_started_at > now() - $2::interval`,
    [caller.userId, ORGANISER_WINDOW],
  );
  const rows = await deps.db.query(
    `${HOLDER_MESSAGE_SELECT} where m.event_id = $1 order by m.created_at desc, m.id desc limit $2`,
    [eventId, HISTORY_LIMIT],
  );

  const limits = HOLDER_MESSAGE_LIMITS;
  const remaining = {
    eventToday: Math.max(0, limits.perEventPerDay - counts.today),
    eventTotal: Math.max(0, limits.perEventTotal - counts.total),
    organiserToday: Math.max(0, limits.perOrganiserPerDay - (used?.hits ?? 0)),
  };
  let blockedReason: HolderMessageBlockReason | undefined;
  if (event.status !== "published") blockedReason = "not_published";
  else if (event.ticketing_mode !== "sheltuh") blockedReason = "external";
  else if (event.outside_window) blockedReason = "outside_window";
  else if (audience.n === 0) blockedReason = "no_recipients";
  else if (audience.n > limits.maxRecipients) blockedReason = "too_many";
  else if (remaining.eventTotal === 0) blockedReason = "event_total_cap";
  else if (remaining.eventToday === 0) blockedReason = "event_day_cap";
  else if (remaining.organiserToday === 0) blockedReason = "rate_limited";

  const state: HolderMessagesState = {
    eventId,
    audienceCount: audience.n,
    canSend: blockedReason === undefined,
    ...(blockedReason ? { blockedReason } : {}),
    limits,
    remaining,
    messages: rows.map(toHolderMessageSummary),
  };
  return okPrivate(state);
};

/** A refusal the compose form can tell apart: `code` in the body (HolderMessageBlockReason, or `audience_changed`). */
function refusal(status: 409 | 429, message: string, code: string, extra: Record<string, unknown> = {}): HttpError {
  return new HttpError(status, message, undefined, { code, ...extra });
}

/**
 * POST /api/events/{eventId}/holder-messages — queues the message for every
 * ticket holder and returns at once (the sending follows the response). 201
 * with the message; 200 with `replayed: true` for a `requestId` already sent
 * for this event. 400 fieldErrors (`requestId`, `subject`, `body`, `attest`,
 * `expectedRecipients`); 401; 403 not an approved organiser; 404 not the
 * caller's event; 409 `code` not_published, external, outside_window,
 * no_recipients, too_many or audience_changed (with `audienceCount`); 429
 * `code` event_day_cap, event_total_cap or rate_limited.
 */
export const sendHolderMessage: Handler<{ eventId: string }> = async (req, { eventId }, deps) => {
  const caller = await requireCaller(req, deps.verifyAccessToken);
  const organiser = await requireApprovedOrganiser(deps.db, caller);
  if (!isUuid(eventId)) throw new HttpError(404, EVENT_NOT_FOUND);
  const input = parseSendInput(await readJson(req));
  const limits = HOLDER_MESSAGE_LIMITS;

  const [row] = await deps.db.query<{
    result: string;
    out_message_id: string | null;
    out_audience: number | null;
    out_created_at: string | Date | null;
  }>(
    `select result, out_message_id, out_audience, out_created_at
       from private.send_holder_message($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::interval, $11, $12, $13, $14::interval)`,
    [
      eventId,
      organiser.organiserId,
      caller.userId,
      input.requestId,
      input.subject,
      input.body,
      input.attest,
      input.expectedRecipients,
      limits.maxRecipients,
      AFTER_END,
      limits.perEventPerDay,
      limits.perEventTotal,
      limits.perOrganiserPerDay,
      ORGANISER_WINDOW,
    ],
  );

  switch (row.result) {
    case "sent":
    case "replayed": {
      const sent: HolderMessageSent = {
        messageId: row.out_message_id as string,
        recipientCount: row.out_audience as number,
        createdAt: new Date(row.out_created_at as string | Date).toISOString(),
        replayed: row.result === "replayed",
      };
      if (row.result === "replayed") return okPrivate(sent);
      // Sent straight after the response; whatever it doesn't finish waits for the cron route.
      sendHolderMessagesSoon(deps);
      return createdPrivate(sent);
    }
    case "not_found":
      throw new HttpError(404, EVENT_NOT_FOUND);
    case "not_approved":
      throw new HttpError(403, "Your organiser application must be approved before you can message ticket holders.");
    case "not_published":
      throw refusal(409, "You can only message the ticket holders of a published event.", "not_published");
    case "external":
      throw refusal(
        409,
        "Tickets for this event are sold on another site, so Sheltüh has no ticket holders to message.",
        "external",
      );
    case "outside_window":
      throw refusal(409, "This event ended too long ago to message its ticket holders.", "outside_window");
    case "no_recipients":
      throw refusal(409, "Nobody holds a ticket for this event yet.", "no_recipients");
    case "too_many":
      throw refusal(409, "There are too many ticket holders to message at once. Contact support.", "too_many", {
        audienceCount: row.out_audience,
      });
    case "audience_changed":
      throw refusal(409, "The number of ticket holders changed. Check it and confirm again.", "audience_changed", {
        audienceCount: row.out_audience,
      });
    case "event_day_cap":
      throw refusal(429, "This event has sent its messages for today. Try again tomorrow.", "event_day_cap");
    case "event_total_cap":
      throw refusal(429, "This event has used all of its messages.", "event_total_cap");
    case "rate_limited":
      throw refusal(429, "You've sent a lot of messages today. Try again tomorrow.", "rate_limited");
  }
  throw new Error("send_holder_message returned an unknown result.");
};

// ---------------------------------------------------------------------------
// Admin
// ---------------------------------------------------------------------------

/** GET /api/admin/holder-messages?eventId&cursor&limit — newest first. No bodies, no addresses. */
export const adminListHolderMessages: Handler = async (req, _params, deps) => {
  await requireAdmin(req, deps.verifyAccessToken);
  const qs = new URL(req.url).searchParams;
  const eventId = qs.get("eventId");
  if (eventId !== null && !isUuid(eventId)) throw new HttpError(400, "eventId must be a valid id.");
  const limit = parseLimit(qs.get("limit"));
  const offset = decodeCursor(qs.get("cursor"));
  const rows = await deps.db.query(
    `${adminHolderMessageSelect(false)}
      where ($1::uuid is null or m.event_id = $1::uuid)
      order by m.created_at desc, m.id desc limit $2 offset $3`,
    [eventId, limit + 1, offset],
  );
  const page: Paginated<AdminHolderMessage> = toPage(rows.map(toAdminHolderMessage), offset, limit);
  return okPrivate(page);
};

async function readAdminMessage(deps: Deps, messageId: string): Promise<AdminHolderMessageDetail> {
  if (!isUuid(messageId)) throw new HttpError(404, MESSAGE_NOT_FOUND);
  const [row] = await deps.db.query(`${adminHolderMessageSelect(true)} where m.id = $1`, [messageId]);
  if (!row) throw new HttpError(404, MESSAGE_NOT_FOUND);
  return toAdminHolderMessageDetail(row);
}

/** GET /api/admin/holder-messages/{messageId} — the message with its text and counts. */
export const adminGetHolderMessage: Handler<{ messageId: string }> = async (req, { messageId }, deps) => {
  await requireAdmin(req, deps.verifyAccessToken);
  return okPrivate(await readAdminMessage(deps, messageId));
};

/**
 * POST /api/admin/holder-messages/{messageId}/cancel — stops the message:
 * whatever hasn't been sent is never sent (each send checks again). 200 with
 * the message, also when it was stopped already; 404 unknown.
 */
export const adminCancelHolderMessage: Handler<{ messageId: string }> = async (req, { messageId }, deps) => {
  const admin = await requireAdmin(req, deps.verifyAccessToken);
  if (!isUuid(messageId)) throw new HttpError(404, MESSAGE_NOT_FOUND);
  const [row] = await deps.db.query<{ result: string }>(`select result from private.cancel_holder_message($1, $2)`, [
    messageId,
    admin.userId,
  ]);
  if (row.result === "not_found") throw new HttpError(404, MESSAGE_NOT_FOUND);
  return okPrivate(await readAdminMessage(deps, messageId));
};
