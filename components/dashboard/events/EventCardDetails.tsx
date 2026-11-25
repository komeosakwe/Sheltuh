import Link from "next/link";
import { PAYOUTS_SETUP_HREF } from "@/components/dashboard/PayoutsRequired";
import type { OrganiserEventSummary } from "@/lib/api/types";
import { SUPPORT_EMAIL } from "@/lib/contact";
import { needsPayouts, stageHint } from "@/lib/organiser-event-card";

/** A link inside a card's line (the block sits above the card's hit area). */
const INLINE_LINK = "font-semibold text-foreground underline underline-offset-4 hover:decoration-2";

/**
 * The lines an Events tab card adds under its bar for the states Latte doesn't draw (organiser-dashboard
 * plan §2.3), so nothing the list said before is lost: Sheltüh's note when it sent an event back or took
 * it down, what to do next (In review, Changes needed, Unpublished; a published event is "Live on
 * Sheltüh. Contact Sheltüh to change it."), and, for a paid draft while payouts aren't set up, that they
 * must be first. Body/S, text/secondary (the note in text/primary). Nothing for a plain draft. The
 * card lifts this block above its hit area, so the words can be selected and the links pressed.
 */
export default function EventCardDetails({ event, payoutsEnabled }: { event: OrganiserEventSummary; payoutsEnabled: boolean }) {
  const hint = stageHint(event.stage);
  const reason = event.rejectionReason?.trim();
  const payouts = needsPayouts(event, payoutsEnabled);
  if (!hint && !reason && !payouts) return null;
  return (
    <div data-card-details="" className="body-s flex flex-col gap-1 px-1 text-pretty">
      {reason && (
        <p data-rejection-reason="" className="break-words text-foreground">
          <span className="font-semibold">Sheltüh’s note:</span> {reason}
        </p>
      )}
      {hint && (
        <p className="text-muted">
          {hint.text}
          {hint.contactToChange && (
            <>
              {" "}
              <a href={`mailto:${SUPPORT_EMAIL}`} className={INLINE_LINK}>
                Contact Sheltüh
              </a>{" "}
              to change it.
            </>
          )}
        </p>
      )}
      {payouts && (
        <p className="text-foreground">
          Paid tickets:{" "}
          <Link href={PAYOUTS_SETUP_HREF} className={INLINE_LINK}>
            set up payouts
          </Link>{" "}
          before you publish it.
        </p>
      )}
    </div>
  );
}
