import { apiFetch, type GetToken } from "./client";
import type { CheckInInput, CheckInResult, CheckInSummary, UndoCheckInInput, UndoCheckInResult } from "./types";

/**
 * Ticket check-in at the door (docs/architecture.md, "Check-in"). The
 * approved organiser who owns the event, or an admin for a platform-managed
 * organiser's event: ApiError 404 for anyone else's event (admins included),
 * 403 without an approved organiser (non-admins), 401 signed out.
 *
 * Every ticket outcome (admitted, already checked in, invalid, ...) resolves
 * normally. A thrown error means the ticket could NOT be verified and nothing
 * was marked: ApiError 0 (network), 400, 404, 409 (the request id was used
 * before for a different code), 413, 429 (over 600 check-ins and undos per
 * 5 minutes) or 5xx; or the abort error if `signal` aborted.
 * Retry a scan with the same `requestId` and the server returns the original
 * result (an admission that lost its response still says `admitted`).
 */

const checkIns = (eventId: string) => `/organisers/me/events/${encodeURIComponent(eventId)}/check-ins`;

/** Checks in what was scanned or typed (`XXXX-XXXX` or `SH1:XXXX-XXXX`). `requestId`: a fresh uuid per scan, reused for its retries. */
export async function checkInTicket(
  eventId: string,
  code: string,
  requestId: string,
  getToken: GetToken,
  signal?: AbortSignal,
): Promise<CheckInResult> {
  const token = await getToken();
  const body: CheckInInput = { code, requestId };
  return apiFetch<CheckInResult>(checkIns(eventId), { method: "POST", body, token, signal });
}

/**
 * Reverses an admission (a `checkInId` from an `admitted` or `already_checked_in` result, or an `undoable` log
 * entry: an opaque uuid), with a 3–200 character reason (ApiError 400 `fieldErrors.reason` otherwise; 404 for an
 * id that isn't an admission of this event).
 */
export async function undoCheckIn(
  eventId: string,
  checkInId: string,
  reason: string,
  getToken: GetToken,
): Promise<UndoCheckInResult> {
  const token = await getToken();
  const body: UndoCheckInInput = { reason };
  return apiFetch<UndoCheckInResult>(`${checkIns(eventId)}/${encodeURIComponent(checkInId)}/undo`, {
    method: "POST",
    body,
    token,
  });
}

/** Live counters and the newest 20 log entries. */
export async function getCheckInSummary(eventId: string, getToken: GetToken, signal?: AbortSignal): Promise<CheckInSummary> {
  const token = await getToken();
  return apiFetch<CheckInSummary>(checkIns(eventId), { token, signal });
}
