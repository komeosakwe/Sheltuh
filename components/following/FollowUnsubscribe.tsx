"use client";

import EmailLinkAction, { linkActionError } from "@/components/EmailLinkAction";
import { unsubscribeFromFollowEmails } from "@/lib/api/follows";

/**
 * /following/unsubscribe#token=…: the unsubscribe link in a "New from
 * {organiser}" email (Spam Act 2003). Turns that organiser's emails off when
 * the button is pressed; the follow stays.
 */
export default function FollowUnsubscribe() {
  return (
    <EmailLinkAction
      title="Stop new-event emails"
      intro={
        <p>
          We&rsquo;ll stop emailing you about this organiser&rsquo;s new events. You&rsquo;ll still follow them.
        </p>
      }
      action="Unsubscribe"
      busyLabel="Unsubscribing…"
      working="Unsubscribing…"
      run={unsubscribeFromFollowEmails}
      done={(result) => ({
        title: "You’re unsubscribed",
        body: (
          <p>
            No more new-event emails from {result.organiserName ?? "this organiser"}. You still follow them.
          </p>
        ),
        links: [
          { href: "/following", label: "Organisers you follow" },
          { href: "/events", label: "Browse events" },
        ],
      })}
      error={(err) => linkActionError(err, "unsubscribe you")}
    />
  );
}
