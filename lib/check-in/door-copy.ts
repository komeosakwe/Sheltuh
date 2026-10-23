/**
 * The door scanner's results and words (docs/design/check-in.md §5.A4,
 * §5.A8, §5.A9), kept apart from the components so the exact strings are
 * tested in one place.
 */
import { ApiError } from "@/lib/api/client";
import type { CheckInLogEntry, CheckInResult } from "@/lib/api/types";
import { formatDayTime, formatEventTime } from "@/lib/format";
import { speakSeatLine } from "@/lib/seating/format";

/** One scan: the canonical code and its request id (reused by its retries). */
export interface DoorScan {
  code: string;
  requestId: string;
}

/** Why a scan couldn't be verified (nothing was marked). */
export type UnverifiedReason = "network" | "rate-limited" | "server" | "signed-out" | "no-access" | "unsendable";

/** What the result panel shows. */
export type DoorResult =
  /** The server answered. `ownAgoMs`: this device admitted this code that long ago (within the last minute). */
  | { kind: "server"; scan: DoorScan; result: CheckInResult; ownAgoMs: number | null }
  /** A QR code that isn't a Sheltüh ticket: shown locally, never sent. */
  | { kind: "foreign" }
  | { kind: "unverified"; scan: DoorScan; reason: UnverifiedReason };

/** Let in, don't let in, or not verified: the panel's treatment, sound and vibration. */
export type DoorTone = "admit" | "refuse" | "hold";

/** The outcomes this client knows how to show. */
const KNOWN_OUTCOMES: ReadonlySet<string> = new Set<CheckInResult["outcome"]>([
  "admitted",
  "already_checked_in",
  "not_admissible",
  "other_event",
  "invalid",
]);

/**
 * Whether the server's answer is one this client understands. An outcome it
 * doesn't know (a newer server, a bad response) fails closed: Not verified,
 * never let in and never a definite refusal.
 */
export function isKnownOutcome(result: CheckInResult): boolean {
  return KNOWN_OUTCOMES.has(result.outcome);
}

export function toneOf(result: DoorResult): DoorTone {
  if (result.kind === "unverified") return "hold";
  if (result.kind === "server" && !isKnownOutcome(result.result)) return "hold";
  if (result.kind === "server" && result.result.outcome === "admitted") return "admit";
  return "refuse";
}

/** Shown and said for a server answer this client doesn't recognise (fail closed). */
export const UNKNOWN_OUTCOME_DETAIL = "Sheltüh sent an answer this page doesn’t recognise. Reload the page, then check the code again.";

/**
 * A thrown check-in error, read for the Not-verified panel. Aborts and
 * timeouts (and anything unexpected) count as "couldn't reach Sheltüh".
 */
export function unverifiedReason(error: unknown): UnverifiedReason {
  if (!(error instanceof ApiError) || error.status === 0) return "network";
  if (error.status === 429) return "rate-limited";
  if (error.status === 401) return "signed-out";
  if (error.status === 403 || error.status === 404) return "no-access";
  if (error.status === 400 || error.status === 413) return "unsendable";
  return "server";
}

/** The Not-verified detail line for each reason (§5.A4). */
export const UNVERIFIED_DETAIL: Record<UnverifiedReason, string> = {
  network: "Couldn’t reach Sheltüh. Nothing was marked. Retry when you have signal.",
  "rate-limited": "Too many scans in the last few minutes. Nothing was marked. Wait a few seconds, then retry.",
  server: "Sheltüh had a problem. Nothing was marked. Retry in a moment.",
  "signed-out": "You’ve been signed out. Nothing was marked. Sign in again, then retry.",
  "no-access": "This account can’t check people in for this event. Nothing was marked.",
  unsendable: "This scan couldn’t be sent. Nothing was marked. Type the code below instead.",
};

/** Whether a Not-verified result offers Retry (resending can't help a 400/413, 401 or 403/404). */
export function canRetry(reason: UnverifiedReason): boolean {
  return reason === "network" || reason === "rate-limited" || reason === "server";
}

/**
 * What the Not-verified announcement adds per reason (§5.A8). Only the
 * reasons that offer Retry mention retrying, so nobody listens for a button
 * that isn't there.
 */
export const UNVERIFIED_SPOKEN: Record<UnverifiedReason, string> = {
  network: "Couldn’t reach Sheltüh. Retry when you have signal.",
  "rate-limited": "Too many scans. Wait a few seconds, then retry.",
  server: "Sheltüh had a problem. Retry in a moment.",
  "signed-out": "You’ve been signed out. Sign in again.",
  "no-access": "This account can’t check people in for this event.",
  unsendable: "This scan couldn’t be sent. Type the code instead.",
};

/** How much of `total` `value` is, as a 0–100 share for a bar (0 when nothing has sold). */
export function checkedInPercent(value: number, total: number): number {
  return total > 0 ? Math.min(100, Math.max(0, (value / total) * 100)) : 0;
}

/** "just now", "14 min ago", "1 hr 5 min ago" (under a day). */
export function relativeAgo(ms: number): string {
  const minutes = Math.floor(Math.max(0, ms) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${hours} hr ago` : `${hours} hr ${rest} min ago`;
}

/** "8:42 pm (14 min ago)", or "Fri 25 Sep, 8:42 pm" once it's over a day ago. */
export function formatCheckedInAt(iso: string, now: Date = new Date()): string {
  const ago = now.getTime() - new Date(iso).getTime();
  if (ago >= 24 * 60 * 60 * 1000) return formatDayTime(iso, now);
  return `${formatEventTime(iso)} (${relativeAgo(ago)})`;
}

/** "Checked in on this device 4 sec ago." */
export function ownScanNote(agoMs: number): string {
  const seconds = Math.max(1, Math.round(agoMs / 1000));
  return `Checked in on this device ${seconds} sec ago.`;
}

/** The assertive announcement for a result (§5.A8). */
export function resultAnnouncement(result: DoorResult): string {
  if (result.kind === "foreign") return "Don’t let in. Not a Sheltüh ticket.";
  if (result.kind === "unverified") return `Not verified. Don’t let in yet. ${UNVERIFIED_SPOKEN[result.reason]}`;
  const { outcome, ticket, checkedInAt, otherEventTitle } = result.result;
  // The seat, spoken after the rest (docs/design/seating.md §5.15): "Stalls, Row F, Seat 12."
  const seat = ticket?.seat ? ` ${speakSeatLine(ticket.seat)}.` : "";
  switch (outcome) {
    case "admitted":
      return ticket ? `Let in. ${ticket.ticketTypeName}, ticket ${ticket.ticketNumber} of ${ticket.ticketCount}.${seat}` : "Let in.";
    case "already_checked_in":
      return checkedInAt
        ? `Don’t let in. Already checked in at ${formatEventTime(checkedInAt)}.${seat}`
        : `Don’t let in. Already checked in.${seat}`;
    case "not_admissible":
      return "Don’t let in. Ticket void.";
    case "other_event":
      return otherEventTitle ? `Don’t let in. Ticket for ${otherEventTitle}.` : "Don’t let in. Wrong event.";
    case "invalid":
      return "Don’t let in. Not a valid ticket.";
    default:
      return "Not verified. Don’t let in yet. Reload the page, then check the code again.";
  }
}

/** "General admission · Code ends 2HXD" style detail for a log entry. */
function typeAndCode(entry: CheckInLogEntry): string {
  return [entry.ticketTypeName, entry.codeLast4 ? `Code ends ${entry.codeLast4}` : null].filter(Boolean).join(" · ");
}

/** A Recent-scans row's label and detail (§5.A9). */
export function recentRow(entry: CheckInLogEntry): { label: string; detail: string; icon: "check" | "cross" | "undo" } {
  switch (entry.result) {
    case "admitted":
      return { label: "Checked in", detail: typeAndCode(entry), icon: "check" };
    case "already_checked_in":
      return { label: "Already checked in", detail: typeAndCode(entry), icon: "cross" };
    case "not_admissible":
      return { label: "Void", detail: typeAndCode(entry), icon: "cross" };
    case "other_event":
      return {
        label: "Wrong event",
        detail: [entry.otherEventTitle ? `For ${entry.otherEventTitle}` : null, entry.codeLast4 ? `Code ends ${entry.codeLast4}` : null]
          .filter(Boolean)
          .join(" · "),
        icon: "cross",
      };
    case "invalid":
      return { label: "Not valid", detail: "Code not recorded", icon: "cross" };
    case "undone":
      return {
        label: "Undone",
        detail: [typeAndCode(entry), entry.reason ? `Reason: ${entry.reason}` : null].filter(Boolean).join(" · "),
        icon: "undo",
      };
    default:
      // A result this client doesn't know: listed, never shown as an admission.
      return { label: "Unknown result", detail: typeAndCode(entry), icon: "cross" };
  }
}

/**
 * The admission an undo reverses, from a Recent-scans entry or an
 * `already_checked_in` result: its id, when it was, and the ticket's type and
 * last four characters.
 */
export type UndoTarget = Pick<CheckInLogEntry, "checkInId" | "at" | "codeLast4" | "ticketTypeName">;

/** What an undo is about: "General admission · code ends 2HXD · checked in 8:42 pm". */
export function undoAbout(entry: UndoTarget): string {
  return [
    entry.ticketTypeName,
    entry.codeLast4 ? `code ends ${entry.codeLast4}` : null,
    `checked in ${formatEventTime(entry.at)}`,
  ]
    .filter(Boolean)
    .join(" · ");
}
