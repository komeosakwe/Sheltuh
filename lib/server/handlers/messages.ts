import { requireCaller, requireVerifiedCaller } from "../auth";
import type { Db } from "../db";
import { createdPrivate, HttpError, noContentPrivate, okPrivate, readJson } from "../http";
import { MEMBER_UNAVAILABLE, parseMessageId, parseSendMessage, parseStartConversation } from "../message-input";
import { decodeCursor, isUuid, parseLimit, toPage } from "../pagination";
import {
  conversationSelect,
  conversationVisibleTo,
  hasUnread,
  messageColumns,
  toConversation,
  toMessage,
} from "../records";
import type { Handler } from "../route";
import type { ConversationSummary, MessagePage, UnreadCount } from "../types";

/**
 * Direct messages between members (docs/architecture.md, "Messages"). A
 * conversation is addressed only by its opaque id, and every query is keyed
 * on the caller's user id from the token: one they aren't in, or can't see
 * (blocked, the other member suspended, a request they declined), is a 404.
 * The other member only ever appears as a display name. Responses are
 * private and never cached.
 */

/** Messages per sender per window, requests included. Conversation-paced, well below a flood. */
export const MESSAGE_RATE_LIMIT = { hits: 60, window: "1 hour" } as const;
/** New conversation requests per sender per window. */
export const REQUEST_RATE_LIMIT = { hits: 10, window: "24 hours" } as const;
/** Messages per page. */
export const MESSAGE_PAGE_SIZE = 50;

const NOT_FOUND = "Conversation not found.";
const SUSPENDED = "Your profile can't send messages right now.";

async function findConversation(db: Db, viewerId: string, conversationId: string) {
  const [row] = await db.query(`${conversationSelect("$1")} where c.id = $2 and ${conversationVisibleTo("$1")}`, [
    viewerId,
    conversationId,
  ]);
  return row ? toConversation(row) : undefined;
}

async function requireConversation(db: Db, viewerId: string, conversationId: string): Promise<ConversationSummary> {
  const conversation = isUuid(conversationId) ? await findConversation(db, viewerId, conversationId) : undefined;
  if (!conversation) throw new HttpError(404, NOT_FOUND);
  return conversation;
}

/** GET /api/conversations?cursor — the caller's conversations, most recent activity first, up to 50 a page. */
export const listConversations: Handler = async (req, _params, { db, verifyAccessToken }) => {
  const caller = await requireVerifiedCaller(req, verifyAccessToken);
  const qs = new URL(req.url).searchParams;
  const limit = parseLimit(qs.get("limit"));
  const offset = decodeCursor(qs.get("cursor"));
  const rows = await db.query(
    `${conversationSelect("$1")} where ${conversationVisibleTo("$1")}
      order by c.last_message_at desc, c.id limit $2 offset $3`,
    [caller.userId, limit + 1, offset],
  );
  return okPrivate(toPage(rows.map(toConversation), offset, limit));
};

/**
 * POST /api/conversations {attendeeId, body} — a first message (request) to a
 * member on an event's Who's Going list. Both must be opted in to that event
 * while it's open; decided in one atomic step by private.request_conversation.
 */
export const startConversation: Handler = async (req, _params, { db, verifyAccessToken }) => {
  const caller = await requireVerifiedCaller(req, verifyAccessToken);
  const input = parseStartConversation(await readJson(req));

  const [{ result, new_conversation_id: conversationId }] = await db.query<{
    result: string;
    new_conversation_id: string | null;
  }>(`select * from private.request_conversation($1, $2, $3, $4, $5::interval, $6, $7::interval)`, [
    caller.userId,
    input.attendeeId,
    input.body,
    REQUEST_RATE_LIMIT.hits,
    REQUEST_RATE_LIMIT.window,
    MESSAGE_RATE_LIMIT.hits,
    MESSAGE_RATE_LIMIT.window,
  ]);
  switch (result) {
    case "sent":
      break;
    case "sender_suspended":
      throw new HttpError(403, SUSPENDED);
    case "not_going":
      throw new HttpError(403, "You can only message people going to the same event as you.");
    case "unavailable":
      throw new HttpError(404, MEMBER_UNAVAILABLE);
    case "self":
      throw new HttpError(400, "You can't message yourself.");
    case "exists":
      throw new HttpError(409, "You already have a conversation with this member. Find it in your messages.");
    case "rate_limited":
      throw new HttpError(429, "You've sent a lot of new message requests. Try again tomorrow.");
    default:
      throw new Error(`Unexpected request_conversation result: ${result}`);
  }
  return createdPrivate(await requireConversation(db, caller.userId, conversationId as string));
};

/**
 * GET /api/conversations/[conversationId]/messages?after|before — oldest
 * first. By default the newest 50; `after` pages forward from a message id
 * (polling for new ones), `before` pages back.
 */
export const getMessages: Handler<{ conversationId: string }> = async (
  req,
  { conversationId },
  { db, verifyAccessToken },
) => {
  const caller = await requireVerifiedCaller(req, verifyAccessToken);
  const qs = new URL(req.url).searchParams;
  const after = parseMessageId(qs.get("after"), "after");
  const before = parseMessageId(qs.get("before"), "before");
  if (after && before) throw new HttpError(400, "Use either after or before, not both.");
  const conversation = await requireConversation(db, caller.userId, conversationId);

  const params = [conversationId, caller.userId, MESSAGE_PAGE_SIZE + 1];
  let rows;
  if (after) {
    rows = await db.query(
      `select ${messageColumns("$2")} from public.messages m
        where m.conversation_id = $1 and m.id > $4::bigint order by m.id limit $3`,
      [...params, after],
    );
  } else {
    rows = await db.query(
      `select ${messageColumns("$2")} from public.messages m
        where m.conversation_id = $1 ${before ? "and m.id < $4::bigint" : ""} order by m.id desc limit $3`,
      before ? [...params, before] : params,
    );
  }
  const hasMore = rows.length > MESSAGE_PAGE_SIZE;
  const page = rows.slice(0, MESSAGE_PAGE_SIZE).map(toMessage);
  const body: MessagePage = { conversation, items: after ? page : page.reverse(), hasMore };
  return okPrivate(body);
};

/**
 * POST /api/conversations/[conversationId]/messages {body}. Replying to a
 * request accepts it. Atomic in private.send_message.
 */
export const sendMessage: Handler<{ conversationId: string }> = async (
  req,
  { conversationId },
  { db, verifyAccessToken },
) => {
  const caller = await requireVerifiedCaller(req, verifyAccessToken);
  const input = parseSendMessage(await readJson(req));
  if (!isUuid(conversationId)) throw new HttpError(404, NOT_FOUND);

  const [{ result, new_message_id: messageId }] = await db.query<{ result: string; new_message_id: string | null }>(
    `select result, new_message_id::text from private.send_message($1, $2, $3, $4, $5::interval)`,
    [conversationId, caller.userId, input.body, MESSAGE_RATE_LIMIT.hits, MESSAGE_RATE_LIMIT.window],
  );
  switch (result) {
    case "sent":
      break;
    case "sender_suspended":
      throw new HttpError(403, SUSPENDED);
    case "not_found":
      throw new HttpError(404, NOT_FOUND);
    case "awaiting_reply":
      throw new HttpError(409, "Wait for a reply before sending another message.");
    case "rate_limited":
      throw new HttpError(429, "You're sending messages too quickly. Try again later.");
    default:
      throw new Error(`Unexpected send_message result: ${result}`);
  }
  const [row] = await db.query(`select ${messageColumns("$2")} from public.messages m where m.id = $1::bigint`, [
    messageId,
    caller.userId,
  ]);
  return createdPrivate(toMessage(row));
};

/**
 * POST /api/conversations/[conversationId]/decline — the recipient declines a
 * request. Silent: the sender still sees it as waiting, and can't send
 * another. It disappears for the recipient. Idempotent. 409 on anything
 * other than a request the caller received. Signed in is enough: saying no
 * is never gated on verification.
 */
export const declineConversation: Handler<{ conversationId: string }> = async (
  req,
  { conversationId },
  { db, verifyAccessToken },
) => {
  const caller = await requireCaller(req, verifyAccessToken);
  if (!isUuid(conversationId)) throw new HttpError(404, NOT_FOUND);
  const declined = await db.query(
    `update public.conversations c set status = 'declined'
      where c.id = $1 and (c.user_low = $2 or c.user_high = $2) and c.initiator_id <> $2
        and c.status in ('requested', 'declined')
     returning c.id`,
    [conversationId, caller.userId],
  );
  if (declined.length > 0) return noContentPrivate();
  if (await findConversation(db, caller.userId, conversationId)) {
    throw new HttpError(409, "Only a message request you've received can be declined.");
  }
  throw new HttpError(404, NOT_FOUND);
};

/**
 * POST /api/conversations/[conversationId]/read {lastReadMessageId?} — marks
 * messages read up to that id (default: all so far). Never moves backwards.
 */
export const markConversationRead: Handler<{ conversationId: string }> = async (
  req,
  { conversationId },
  { db, verifyAccessToken },
) => {
  const caller = await requireVerifiedCaller(req, verifyAccessToken);
  const body = await readJson(req);
  const upTo = parseMessageId(body.lastReadMessageId, "lastReadMessageId") ?? null;
  if (!isUuid(conversationId)) throw new HttpError(404, NOT_FOUND);
  const updated = await db.query(
    `update public.conversations c
        set low_last_read_id = case when c.user_low = $2 then greatest(c.low_last_read_id, least(coalesce($3::bigint, top.id), top.id)) else c.low_last_read_id end,
            high_last_read_id = case when c.user_high = $2 then greatest(c.high_last_read_id, least(coalesce($3::bigint, top.id), top.id)) else c.high_last_read_id end
       from (select coalesce(max(m.id), 0) as id from public.messages m where m.conversation_id = $1) top
      where c.id = $1 and ${conversationVisibleTo("$2")}
     returning c.id`,
    [conversationId, caller.userId, upTo],
  );
  if (updated.length === 0) throw new HttpError(404, NOT_FOUND);
  return noContentPrivate();
};

/** GET /api/conversations/unread — how many of the caller's conversations have something unread. */
export const getUnreadCount: Handler = async (req, _params, { db, verifyAccessToken }) => {
  const caller = await requireVerifiedCaller(req, verifyAccessToken);
  const [{ count }] = await db.query<UnreadCount>(
    `select count(*)::int as count from public.conversations c
      where ${conversationVisibleTo("$1")} and ${hasUnread("$1")}`,
    [caller.userId],
  );
  return okPrivate({ count } satisfies UnreadCount);
};
