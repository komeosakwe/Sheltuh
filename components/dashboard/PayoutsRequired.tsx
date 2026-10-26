import Link from "next/link";
import type { Ref } from "react";
import { Notice } from "@/components/ui/Section";

/** Where an organiser connects Stripe (PayoutsPanel). */
export const PAYOUTS_SETUP_HREF = "/dashboard/payouts";

/** Said by the ticket types when an event with paid tickets can't be submitted until payouts are set up. */
export const PAYOUTS_NEEDED_TO_SUBMIT =
  "Set up payouts before you can submit this event. Paid tickets need a connected Stripe account so you get paid. Free events can be submitted now.";

/** By the Submit button (its aria-describedby), for the same reason. */
export const PAYOUTS_SUBMIT_HINT =
  "This event has paid tickets, so it can be submitted once your payouts are set up. You can still save it as a draft.";

/** Its own line, so it's a 44px target. */
function SetUpPayoutsLink() {
  return (
    <Link
      href={PAYOUTS_SETUP_HREF}
      className="inline-flex min-h-11 w-fit items-center font-semibold text-accent underline underline-offset-4"
    >
      Set up payouts
    </Link>
  );
}

/**
 * The organiser's event editor, by its ticket types: this event sells paid
 * tickets through Sheltüh and the organiser's payouts aren't set up, so it
 * can't be submitted yet (saving a draft is fine). Leaving for the payouts
 * page leaves the editor, so it says to save first.
 */
export function PayoutsNeededNotice() {
  return (
    <Notice>
      <p>{PAYOUTS_NEEDED_TO_SUBMIT}</p>
      <p className="flex flex-wrap items-center gap-x-2">
        <SetUpPayoutsLink />
        <span className="text-muted">(save your changes first)</span>
      </p>
    </Notice>
  );
}

/** By the Submit button, which names it with aria-describedby: why submitting will be refused. */
export function PayoutsSubmitHint({ id }: { id: string }) {
  return (
    <div id={id} className="flex flex-col text-sm text-muted">
      <p>{PAYOUTS_SUBMIT_HINT}</p>
      <SetUpPayoutsLink />
    </div>
  );
}

/**
 * The submit was refused (409 `payouts_required`): the server's message (an
 * alert) and the way to fix it. Focus moves here (`ref`), as to an error
 * summary, so the link is the next stop.
 */
export function PayoutsSubmitError({ id, message, ref }: { id: string; message: string; ref: Ref<HTMLDivElement> }) {
  return (
    <div
      ref={ref}
      id={id}
      tabIndex={-1}
      data-payouts-error=""
      className="flex flex-col border-l-2 border-danger py-1 pl-4 text-sm text-foreground"
    >
      <p role="alert">{message}</p>
      <SetUpPayoutsLink />
    </div>
  );
}
