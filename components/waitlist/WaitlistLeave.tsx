"use client";

import EmailLinkAction, { linkActionError } from "@/components/EmailLinkAction";
import { leaveWaitlist } from "@/lib/api/waitlist";

/**
 * /waitlist/leave#token=…: the leave link in a "tickets are available again"
 * email. Leaves that event's waitlist when the button is pressed.
 */
export default function WaitlistLeave() {
  return (
    <EmailLinkAction
      title="Leave the waitlist"
      intro={<p>We&rsquo;ll stop emailing you about this event.</p>}
      action="Leave the waitlist"
      busyLabel="Leaving…"
      working="Leaving the waitlist…"
      run={(token) => leaveWaitlist({ token })}
      done={(result) => ({
        title: "You’ve left the waitlist",
        body: (
          <p>
            We won&rsquo;t email you about {result.eventTitle ?? "that event"} again.
          </p>
        ),
        links: [{ href: "/events", label: "Browse events" }],
      })}
      error={(err) => linkActionError(err, "take you off the waitlist")}
    />
  );
}
