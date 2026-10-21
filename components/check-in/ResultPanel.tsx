"use client";

import type { ReactNode, RefObject } from "react";
import { Button, ButtonLink } from "@/components/ui/Button";
import type { CheckInTicket } from "@/lib/api/types";
import {
  canRetry,
  formatCheckedInAt,
  ownScanNote,
  toneOf,
  UNKNOWN_OUTCOME_DETAIL,
  UNVERIFIED_DETAIL,
  type DoorResult,
  type DoorTone,
  type UndoTarget,
} from "@/lib/check-in/door-copy";
import { withNext } from "@/lib/safe-next-path";
import { doorBusyClass } from "./busy-class";
import DoorIcon, { type DoorIconName } from "./DoorIcon";

/** Each panel resets the tokens locally, so text, focus ring and outline pills follow its fill (§5.A4). */
const TONE_CLASS: Record<DoorTone, string> = {
  admit: "[--background:var(--door-admit)] [--foreground:var(--door-admit-foreground)] bg-background text-foreground",
  refuse: "[--background:var(--door-refuse)] [--foreground:var(--door-refuse-foreground)] bg-background text-foreground",
  hold: "border-2 border-door-hold bg-background text-foreground",
};

const HEADLINE: Record<DoorTone, string> = { admit: "Let in", refuse: "Don’t let in", hold: "Not verified" };
const ICON: Record<DoorTone, DoorIconName> = { admit: "check", refuse: "cross", hold: "alert" };

/** A hard-edged caution band (not decoration): the Not-verified frame's top and bottom. */
function HazardBand() {
  return (
    <div
      aria-hidden="true"
      className="h-2 shrink-0 bg-[repeating-linear-gradient(-45deg,var(--door-hold)_0_8px,transparent_8px_16px)] forced-colors:hidden"
    />
  );
}

function TicketLine({ ticket }: { ticket: CheckInTicket }) {
  return (
    <>
      <p className="text-base font-semibold">{ticket.ticketTypeName}</p>
      <p className="text-base">
        Ticket {ticket.ticketNumber} of {ticket.ticketCount} · Code ends {ticket.codeLast4}
      </p>
    </>
  );
}

function reasonAndDetails(result: DoorResult, now: Date): { reason: string; details: ReactNode } {
  if (result.kind === "foreign") {
    return {
      reason: "Not a Sheltüh ticket",
      details: (
        <p className="text-base">
          This QR code isn’t a Sheltüh ticket. Ask for the ticket email or the Sheltüh confirmation page.
        </p>
      ),
    };
  }
  if (result.kind === "unverified") {
    return { reason: "Don’t let in yet", details: <p className="text-base">{UNVERIFIED_DETAIL[result.reason]}</p> };
  }
  const { outcome, ticket, checkedInAt, otherEventTitle } = result.result;
  switch (outcome) {
    case "admitted":
      return { reason: "Checked in", details: ticket ? <TicketLine ticket={ticket} /> : null };
    case "already_checked_in":
      return {
        reason: "Already checked in",
        details: (
          <>
            {ticket && <TicketLine ticket={ticket} />}
            {checkedInAt && <p className="text-base">First checked in {formatCheckedInAt(checkedInAt, now)}</p>}
            {result.ownAgoMs !== null && <p className="text-base">{ownScanNote(result.ownAgoMs)}</p>}
          </>
        ),
      };
    case "not_admissible":
      return {
        reason: "Ticket void",
        details: (
          <>
            {ticket && <TicketLine ticket={ticket} />}
            <p className="text-base">Its order was refunded or isn’t paid.</p>
          </>
        ),
      };
    case "other_event":
      return {
        reason: "Wrong event",
        details: (
          <>
            <p className="text-base">
              This ticket is for <strong className="font-semibold">{otherEventTitle ?? "another event"}</strong>.
            </p>
            {ticket && (
              <p className="text-base">
                {ticket.ticketTypeName} · Ticket {ticket.ticketNumber} of {ticket.ticketCount} · Code ends {ticket.codeLast4}
              </p>
            )}
          </>
        ),
      };
    case "invalid":
      return {
        reason: "Not a valid ticket",
        details: <p className="text-base">This code isn’t a ticket for any of your events.</p>,
      };
    default:
      // An answer this client doesn't know fails closed: toneOf makes it Not verified, never Let in.
      return { reason: "Don’t let in yet", details: <p className="text-base">{UNKNOWN_OUTCOME_DETAIL}</p> };
  }
}

interface Props {
  result: DoorResult;
  retrying: boolean;
  /** Where Sign in comes back to (this page). */
  returnTo: string;
  panelRef: RefObject<HTMLDivElement | null>;
  onRetry: () => void;
  onDismiss: () => void;
  /**
   * Opens the undo dialog for an `already_checked_in` result's current
   * admission. The panel only offers Undo check-in when the result carries
   * what the dialog needs (`undoTargetOf`) and this is given.
   */
  onUndo?: (target: UndoTarget) => void;
  /** Focus or a pointer is inside: auto-return waits. */
  onPauseChange: (paused: boolean) => void;
}

/**
 * What undoing the admission behind an `already_checked_in` result needs:
 * its id (the ticket's current check-in), when it was, and the ticket's type
 * and last four characters. Null when the server didn't send an id (nothing
 * to undo) or any other outcome.
 */
export function undoTargetOf(result: DoorResult): UndoTarget | null {
  if (result.kind !== "server") return null;
  const { outcome, checkInId, checkedInAt, ticket } = result.result;
  if (outcome !== "already_checked_in" || !checkInId || !checkedInAt || !ticket) return null;
  return { checkInId, at: checkedInAt, codeLast4: ticket.codeLast4, ticketTypeName: ticket.ticketTypeName };
}

/**
 * One scan's answer (docs/design/check-in.md §5.A4): let in, don't let in,
 * or not verified, each with its own headline, icon and panel treatment.
 * Not a live region and never focused: the assertive announcer speaks it.
 */
export default function ResultPanel({ result, retrying, returnTo, panelRef, onRetry, onDismiss, onUndo, onPauseChange }: Props) {
  const tone = toneOf(result);
  const { reason, details } = reasonAndDetails(result, new Date());

  let actions: ReactNode = null;
  if (result.kind === "unverified") {
    const scanAnother = (
      <Button variant="outline" size="lg" busy={retrying} onClick={onDismiss} className={`w-full sm:w-auto ${doorBusyClass}`}>
        Scan another
      </Button>
    );
    actions = (
      <>
        {canRetry(result.reason) && (
          <Button variant="solid" size="lg" busy={retrying} onClick={onRetry} className={`w-full sm:w-auto ${doorBusyClass}`}>
            {retrying ? "Retrying…" : "Retry"}
          </Button>
        )}
        {result.reason === "signed-out" && (
          <ButtonLink variant="solid" size="lg" href={withNext("/login", returnTo)} className="w-full sm:w-auto">
            Sign in
          </ButtonLink>
        )}
        {result.reason === "no-access" && (
          <ButtonLink variant="solid" size="lg" href="/dashboard" className="w-full sm:w-auto">
            Back to your events
          </ButtonLink>
        )}
        {scanAnother}
      </>
    );
  } else if (tone === "hold") {
    // A server answer this client doesn't recognise: no Retry (the same request id replays the same answer).
    actions = (
      <Button variant="outline" size="lg" onClick={onDismiss} className="w-full sm:w-auto">
        Scan another
      </Button>
    );
  } else if (tone === "refuse") {
    const undoTarget = onUndo ? undoTargetOf(result) : null;
    actions = (
      <>
        <Button variant="outline" size="lg" onClick={onDismiss} className="w-full sm:w-auto">
          Scan next
        </Button>
        {undoTarget && onUndo && (
          <Button variant="outline" size="lg" onClick={() => onUndo(undoTarget)} className="w-full sm:w-auto">
            Undo check-in
          </Button>
        )}
      </>
    );
  }

  return (
    <div
      ref={panelRef}
      data-result={tone}
      onFocus={() => onPauseChange(true)}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) onPauseChange(false);
      }}
      onPointerEnter={() => onPauseChange(true)}
      onPointerLeave={() => onPauseChange(false)}
      className={`relative [grid-area:1/1] flex flex-col forced-colors:border-4 forced-colors:border-[CanvasText] ${TONE_CLASS[tone]}`}
    >
      {tone === "hold" && <HazardBand />}
      <div className="flex flex-1 flex-col gap-2 p-4 sm:p-6">
        <div className="flex items-start gap-3">
          <DoorIcon name={ICON[tone]} className={`size-12 ${tone === "hold" ? "text-door-hold" : ""}`.trim()} />
          <p
            className={`font-heading text-[2.5rem] leading-[2.375rem] font-extrabold tracking-[-0.01em] uppercase sm:text-6xl sm:leading-[3.5rem] ${
              tone === "hold" ? "text-door-hold" : ""
            }`.trim()}
          >
            {HEADLINE[tone]}
          </p>
        </div>
        <p className="text-xl font-semibold">{reason}</p>
        {details}
        {actions && <div className="mt-auto flex flex-col gap-2 pt-2 sm:flex-row">{actions}</div>}
      </div>
      {tone === "hold" && <HazardBand />}
    </div>
  );
}
