import { apiFetch, type GetToken } from "./client";
import type {
  AdminHolderMessage,
  AdminHolderMessageDetail,
  HolderMessageInput,
  HolderMessageSent,
  HolderMessagesState,
  Paginated,
} from "./types";

/**
 * Messages to ticket holders (docs/architecture.md, "Messages to ticket
 * holders"): an approved organiser sends one short plain-text email about
 * their event to everyone holding a ticket for it. Sheltüh sends it; the
 * organiser never sees an address. Live mode only.
 */

/**
 * How many people a message sent now would reach, whether one can be sent
 * (and `blockedReason` if not), the allowances left, and the messages already
 * sent for the event with how many have gone out. ApiError 403 not an
 * approved organiser, 404 not the caller's event.
 */
export async function getHolderMessages(eventId: string, getToken: GetToken) {
  const token = await getToken();
  return apiFetch<HolderMessagesState>(`/events/${encodeURIComponent(eventId)}/holder-messages`, { token });
}

/**
 * Sends a message to the event's ticket holders. Returns at once; the emails
 * follow. Make `requestId` once per compose form (crypto.randomUUID()): sending
 * the same one again is the same message (200, `replayed: true`), so a double
 * click or a retry after a lost response is safe. `expectedRecipients` is the
 * `audienceCount` the organiser confirmed.
 *
 * ApiError 400 fieldErrors (`requestId`, `subject`, `body`, `attest`,
 * `expectedRecipients`), 403 not an approved organiser, 404 not the caller's
 * event, 409 with `body.code` `not_published`, `external`, `outside_window`,
 * `no_recipients`, `too_many` or `audience_changed` (`body.audienceCount` is
 * the current count: show it and ask again), 429 with `body.code`
 * `event_day_cap`, `event_total_cap` or `rate_limited`.
 */
export async function sendHolderMessage(eventId: string, input: HolderMessageInput, getToken: GetToken) {
  const token = await getToken();
  return apiFetch<HolderMessageSent>(`/events/${encodeURIComponent(eventId)}/holder-messages`, {
    method: "POST",
    body: input,
    token,
  });
}

/** Admin: messages, newest first (no text), optionally for one event. */
export async function adminListHolderMessages(
  params: { eventId?: string; cursor?: string; limit?: number },
  getToken: GetToken,
) {
  const token = await getToken();
  const qs = new URLSearchParams();
  if (params.eventId) qs.set("eventId", params.eventId);
  if (params.cursor) qs.set("cursor", params.cursor);
  if (params.limit) qs.set("limit", String(params.limit));
  const query = qs.toString();
  return apiFetch<Paginated<AdminHolderMessage>>(`/admin/holder-messages${query ? `?${query}` : ""}`, { token });
}

/** Admin: one message with its text and counts. ApiError 404 unknown. */
export async function adminGetHolderMessage(messageId: string, getToken: GetToken) {
  const token = await getToken();
  return apiFetch<AdminHolderMessageDetail>(`/admin/holder-messages/${encodeURIComponent(messageId)}`, { token });
}

/**
 * Admin: stops a message, so whatever hasn't gone out never does. Returns the
 * message (also when it was stopped already). ApiError 404 unknown.
 */
export async function adminCancelHolderMessage(messageId: string, getToken: GetToken) {
  const token = await getToken();
  return apiFetch<AdminHolderMessageDetail>(`/admin/holder-messages/${encodeURIComponent(messageId)}/cancel`, {
    method: "POST",
    token,
  });
}
