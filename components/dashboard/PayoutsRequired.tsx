import Link from "next/link";
import type { Ref } from "react";
import { Notice } from "@/components/ui/Section";

/** Where an organiser connects Stripe (PayoutsPanel). */
export const PAYOUTS_SETUP_HREF = "/dashboard/payouts";

/** Said by the ticket types when an event with paid tickets can't be published until payouts are set up. */
export const PAYOUTS_NEEDED_TO_PUBLISH =
  "Set up payouts before you can publish this event. Paid tickets need a connected Stripe account so you get paid. Free events can be published now.";

/** By the Publish button (its aria-describedby), for the same reason. */
export const PAYOUTS_PUBLISH_HINT =
  "This event has paid tickets, so it can be published once your payouts are set up. You can still save it as a draft.";

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

/** The link, and that leaving for it leaves the editor: unsaved changes would be lost. */
function SetUpPayoutsLine() {
  return (
    <p className="flex flex-wrap items-center gap-x-2">
      <SetUpPayoutsLink />
      <span className="text-muted">(save your changes first)</span>
    </p>
  );
}

/**
 * The organiser's event editor, by its ticket types: this event sells paid
 * tickets through Sheltüh and the organiser's payouts aren't set up, so it
 * can't be published yet (saving a draft is fine). Leaving for the payouts
 * page leaves the editor, so it says to save first.
 */
export function PayoutsNeededNotice() {
  return (
    <Notice>
      <p>{PAYOUTS_NEEDED_TO_PUBLISH}</p>
      <SetUpPayoutsLine />
    </Notice>
  );
}

/** By the Publish button, which names it with aria-describedby: why publishing will be refused. */
export function PayoutsPublishHint({ id }: { id: string }) {
  return (
    <div id={id} className="flex flex-col text-sm text-muted">
      <p>{PAYOUTS_PUBLISH_HINT}</p>
      <SetUpPayoutsLine />
    </div>
  );
}

/**
 * The publish was refused (409 `payouts_required`): the server's message and
 * the way to fix it. Focus moves here (`ref`), as to an error summary, so the
 * link is the next stop. That focus move is what announces it: the group is
 * named by the message, which a screen reader reads on arriving (no
 * role="alert" too, which would read it twice).
 */
export function PayoutsPublishError({ id, message, ref }: { id: string; message: string; ref: Ref<HTMLDivElement> }) {
  return (
    <div
      ref={ref}
      id={id}
      tabIndex={-1}
      role="group"
      aria-labelledby={`${id}-message`}
      data-payouts-error=""
      className="flex flex-col border-l-2 border-danger py-1 pl-4 text-sm text-foreground"
    >
      <p id={`${id}-message`}>{message}</p>
      {/* No "save first": publishing saved the changes before it was refused. */}
      <SetUpPayoutsLink />
    </div>
  );
}
