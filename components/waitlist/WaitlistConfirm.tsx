"use client";

import EmailLinkAction, { linkActionError } from "@/components/EmailLinkAction";
import { confirmWaitlist } from "@/lib/api/waitlist";

/**
 * /waitlist/confirm#token=…: a guest confirms joining a sold-out event's
 * waitlist from the emailed link, by pressing Confirm (never on opening it).
 * Then a link to the event's tickets, which may be on sale again already.
 */
export default function WaitlistConfirm() {
  return (
    <EmailLinkAction
      title="Join the waitlist"
      intro={
        <p>
          Press Confirm and we&rsquo;ll email you if tickets for this event are released. Joining doesn&rsquo;t
          reserve a ticket or charge you. Didn&rsquo;t ask for this? Just close this page: nothing happens.
        </p>
      }
      action="Confirm"
      busyLabel="Confirming…"
      working="Confirming…"
      run={confirmWaitlist}
      done={(result) => ({
        title: "You’re on the waitlist",
        body: result.ticketsAvailable ? (
          <p>
            For {result.eventTitle}. Good news: some tickets are on sale right now. It&rsquo;s first come, first
            served.
          </p>
        ) : (
          <p>
            For {result.eventTitle}. We&rsquo;ll email you if tickets come up. It&rsquo;s first come, first served,
            and every email has a link to leave the waitlist.
          </p>
        ),
        links: [
          {
            href: `/events/${encodeURIComponent(result.eventSlug)}#tickets`,
            label: result.ticketsAvailable ? "Get tickets" : "Back to the event",
          },
        ],
      })}
      error={(err) =>
        linkActionError(err, "add you to the waitlist", (apiError) =>
          apiError.status === 409
            ? { title: "The waitlist is closed", message: apiError.message, retry: false }
            : null,
        )
      }
    />
  );
}
