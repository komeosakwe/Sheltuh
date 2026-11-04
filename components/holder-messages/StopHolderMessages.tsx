"use client";

import EmailLinkAction, { linkActionError } from "@/components/EmailLinkAction";
import { stopHolderMessages } from "@/lib/api/holder-messages";

/**
 * /holder-messages/stop#token=…: the "Stop messages from {organiser}" link in
 * a message an organiser sent to their ticket holders. Nothing changes until
 * the button is pressed (a mail scanner opening the link stops no one). Your
 * tickets and their reminders are not affected.
 */
export default function StopHolderMessages() {
  return (
    <EmailLinkAction
      title="Stop messages from this organiser"
      intro={
        <p>
          This organiser won&rsquo;t be able to send you messages about their events any more. Your tickets and
          Sheltüh&rsquo;s own reminders aren&rsquo;t affected.
        </p>
      }
      action="Stop messages"
      busyLabel="Stopping…"
      working="Stopping messages…"
      run={stopHolderMessages}
      done={(result) => ({
        title: "Messages stopped",
        body: <p>{result.organiserName ?? "This organiser"} won&rsquo;t message you about their events again.</p>,
        links: [{ href: "/events", label: "Browse events" }],
      })}
      error={(err) => linkActionError(err, "stop these messages")}
    />
  );
}
