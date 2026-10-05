import { apiFetch, type GetToken } from "./client";
import type {
  BlockInput,
  BlockRecord,
  ConversationSummary,
  MessagePage,
  MessageRecord,
  Paginated,
  ReportInput,
  ReportReceipt,
  StartConversationInput,
  UnreadCount,
} from "./types";

/**
 * Direct messages between members going to the same event
 * (docs/architecture.md, "Messages"). Everything here needs a signed-in
 * member; listing, reading and sending also need a verified email (ApiError
 * 403). A conversation the caller can't see is always ApiError 404.
 */

const conversation = (conversationId: string) => `/conversations/${encodeURIComponent(conversationId)}`;

/** The caller's conversations, most recent activity first, up to 50 a page. */
export async function listConversations(getToken: GetToken, cursor?: string) {
  const token = await getToken();
  const suffix = cursor ? `?cursor=${encodeURIComponent(cursor)}` : "";
  return apiFetch<Paginated<ConversationSummary>>(`/conversations${suffix}`, { token });
}

/**
 * Sends a first message (a request) to a member on the same event's Who's
 * Going list. ApiError 400 (invalid body, links, messaging yourself), 403
 * (caller not going to that event, or suspended), 404 (member not available),
 * 409 (a conversation with them already exists), 429 (rate-limited).
 */
export async function startConversation(input: StartConversationInput, getToken: GetToken) {
  const token = await getToken();
  return apiFetch<ConversationSummary>("/conversations", { method: "POST", body: input, token });
}

/**
 * Messages, oldest first. By default the newest 50. `after`: the next ones
 * after that message id (for polling). `before`: the 50 before it (for
 * scrolling back).
 */
export async function getMessages(
  conversationId: string,
  getToken: GetToken,
  page: { after?: string; before?: string } = {},
) {
  const token = await getToken();
  const qs = new URLSearchParams();
  if (page.after) qs.set("after", page.after);
  if (page.before) qs.set("before", page.before);
  const query = qs.toString();
  const suffix = query ? `?${query}` : "";
  return apiFetch<MessagePage>(`${conversation(conversationId)}/messages${suffix}`, { token });
}

/**
 * Sends a message. Replying to a request accepts it. ApiError 409 while the
 * caller's own request is still waiting for a reply, 429 when rate-limited.
 */
export async function sendMessage(conversationId: string, body: string, getToken: GetToken) {
  const token = await getToken();
  return apiFetch<MessageRecord>(`${conversation(conversationId)}/messages`, {
    method: "POST",
    body: { body },
    token,
  });
}

/** Declines a request the caller received. Silent: the sender isn't told. Idempotent. */
export async function declineConversation(conversationId: string, getToken: GetToken) {
  const token = await getToken();
  await apiFetch<void>(`${conversation(conversationId)}/decline`, { method: "POST", token });
}

/** Marks messages read up to `lastReadMessageId` (default: everything so far). */
export async function markConversationRead(conversationId: string, getToken: GetToken, lastReadMessageId?: string) {
  const token = await getToken();
  await apiFetch<void>(`${conversation(conversationId)}/read`, {
    method: "POST",
    body: lastReadMessageId ? { lastReadMessageId } : {},
    token,
  });
}

/** How many conversations have something unread (for a badge). */
export async function getUnreadCount(getToken: GetToken) {
  const token = await getToken();
  return apiFetch<UnreadCount>("/conversations/unread", { token });
}

/** Members the caller has blocked, newest first, up to 50 a page. */
export async function listBlocks(getToken: GetToken, cursor?: string) {
  const token = await getToken();
  const suffix = cursor ? `?cursor=${encodeURIComponent(cursor)}` : "";
  return apiFetch<Paginated<BlockRecord>>(`/blocks${suffix}`, { token });
}

/**
 * Blocks a member, by a conversation with them or their attendeeId. Silent:
 * they aren't told. Each disappears from the other's conversations and
 * Who's Going lists, and neither can message the other. Idempotent.
 */
export async function blockMember(input: BlockInput, getToken: GetToken) {
  const token = await getToken();
  return apiFetch<BlockRecord>("/blocks", { method: "POST", body: input, token });
}

/** Unblocks. Idempotent. */
export async function unblockMember(blockId: string, getToken: GetToken) {
  const token = await getToken();
  await apiFetch<void>(`/blocks/${encodeURIComponent(blockId)}`, { method: "DELETE", token });
}

/** Reports a member to Sheltüh. A copy of the messages is kept for review. ApiError 429 when rate-limited. */
export async function reportMember(input: ReportInput, getToken: GetToken) {
  const token = await getToken();
  return apiFetch<ReportReceipt>("/reports", { method: "POST", body: input, token });
}
