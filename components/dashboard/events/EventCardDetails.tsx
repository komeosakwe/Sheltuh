import Link from "next/link";
import { PAYOUTS_SETUP_HREF } from "@/components/dashboard/PayoutsRequired";
import type { OrganiserEventSummary } from "@/lib/api/types";
import { needsPayouts, stageHint } from "@/lib/organiser-event-card";

/** A link inside a card's line: above the card's hit area (the card's own link covers the rest). */
const INLINE_LINK = "relative z-10 font-semibold text-foreground underline underline-offset-4 hover:decoration-2";

/**
 * The lines an Events tab card adds under its bar for the states Latte doesn't draw (organiser-dashboard
 * plan §2.3), so nothing the list said before is lost: Sheltüh's note when it sent an event back or took
 * it down, what to do next (In review, Changes needed, Unpublished), and, for a paid draft while payouts
 * aren't set up, that they must be first. Body/S, text/secondary (the note in text/primary). Nothing for
 * the drawn states.
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
      {hint && <p className="text-muted">{hint}</p>}
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
