"use client";

import EventRow from "@/components/events/EventRow";
import { useEventOrganiser } from "@/components/events/EventOrganiserProvider";
import RowLoadError from "@/components/events/RowLoadError";
import { organiserProfileHref } from "@/lib/sample-organisers";
import { moreFromOrganiser } from "@/lib/similar-events";
import type { SheltuhEvent } from "@/lib/types";

/**
 * "More from {organiser}" under the event's details (the audit's fix: the page used to end at the
 * organiser): their other upcoming events from the page's one profile read (EventOrganiserProvider),
 * with "See all" to their profile. Nothing while it loads, and nothing when they have no other
 * upcoming event or no public profile; a failed read says so, with Try again.
 */
export default function MoreFromOrganiser({ event }: { event: SheltuhEvent }) {
  const { load, retry, retrying } = useEventOrganiser();
  const id = "more-from-organiser";
  const title = `More from ${event.organiserName}`;
  if (load.status === "error") {
    return (
      <EventRow id={id} title={title}>
        <RowLoadError onRetry={retry} retrying={retrying} />
      </EventRow>
    );
  }
  if (load.status !== "ready") return null;
  const events = moreFromOrganiser(event, load.upcoming, new Date());
  if (events.length === 0) return null;
  const profile = organiserProfileHref(event);
  return (
    <EventRow
      id={id}
      title={title}
      seeAll={profile ? { href: profile, srLabel: `events by ${event.organiserName}` } : undefined}
      events={events}
    />
  );
}
