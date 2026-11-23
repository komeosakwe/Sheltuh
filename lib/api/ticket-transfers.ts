import { apiFetch, type GetToken } from "./client";
import {
  ORDER_ACCESS_HEADER,
  type ReceivedTicket,
  type TicketOffer,
  type TicketOfferAccepted,
  type TicketTransferCancelled,
  type TicketTransferCreated,
  type TicketTransferInput,
} from "./types";

/**
 * Ticket transfers ("Send ticket to a friend"; docs/architecture.md, "Ticket
 * transfers"). The offer link's token only ever goes in a request body,
 * never a URL. Errors are ApiError: read `err.body.code`
 * (TicketTransferErrorCode / TicketOfferErrorCode).
 */

/** A bearer token if one can be had, else none (the paying browser's token may be enough). */
async function optionalToken(getToken?: GetToken): Promise<string | undefined> {
  if (!getToken) return undefined;
  try {
    return await getToken();
  } catch {
    return undefined;
  }
}

function orderHeaders(orderAccess?: string): Record<string, string> | undefined {
  return orderAccess ? { [ORDER_ACCESS_HEADER]: orderAccess } : undefined;
}

/**
 * Sends ticket number `input.ticket` of an order. Needs control of the
 * order: the paying browser's `orderAccess`, or `getToken` signed in with the
 * buying email (403 `order_owner_only` otherwise). 201 with the order as the
 * page shows it now; 400 fieldErrors (or `email_typo` / `email_no_mail` with
 * a `suggestion`); 404 sending is off or unknown order; 409
 * TicketTransferErrorCode; 429 `rate_limited`.
 */
export async function sendTicket(
  sessionId: string,
  input: TicketTransferInput,
  orderAccess?: string,
  getToken?: GetToken,
): Promise<TicketTransferCreated> {
  return apiFetch<TicketTransferCreated>(`/orders/by-session/${encodeURIComponent(sessionId)}/ticket-transfers`, {
    method: "POST",
    body: input,
    token: await optionalToken(getToken),
    headers: orderHeaders(orderAccess),
  });
}

/** Takes back an offer that hasn't been accepted (control as sendTicket). 409 `transfer_not_pending` once it can't be. */
export async function cancelTicketTransfer(
  sessionId: string,
  transferId: string,
  orderAccess?: string,
  getToken?: GetToken,
): Promise<TicketTransferCancelled> {
  return apiFetch<TicketTransferCancelled>(
    `/orders/by-session/${encodeURIComponent(sessionId)}/ticket-transfers/${encodeURIComponent(transferId)}/cancel`,
    { method: "POST", body: {}, token: await optionalToken(getToken), headers: orderHeaders(orderAccess) },
  );
}

/** The offer behind a link's token (signed in or not). 404 for every offer that can't be opened (one message for all). */
export async function viewTicketOffer(token: string, getToken?: GetToken): Promise<TicketOffer> {
  return apiFetch<TicketOffer>(`/ticket-transfers/view`, {
    method: "POST",
    body: { token },
    token: await optionalToken(getToken),
  });
}

/** Accepts the offer with the signed-in, verified account (401 / 403 otherwise) and the name it confirms. */
export async function acceptTicketOffer(token: string, holderName: string, getToken: GetToken): Promise<TicketOfferAccepted> {
  return apiFetch<TicketOfferAccepted>(`/ticket-transfers/accept`, {
    method: "POST",
    body: { token, holderName },
    token: await getToken(),
  });
}

/** Declines the offer (no sign-in). */
export async function declineTicketOffer(token: string): Promise<{ status: "declined" }> {
  return apiFetch<{ status: "declined" }>(`/ticket-transfers/decline`, { method: "POST", body: { token } });
}

/** A ticket the signed-in account accepted. */
export async function getReceivedTicket(transferId: string, getToken: GetToken): Promise<ReceivedTicket> {
  return apiFetch<ReceivedTicket>(`/me/received-tickets/${encodeURIComponent(transferId)}`, { token: await getToken() });
}
