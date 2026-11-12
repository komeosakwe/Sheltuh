"use client";

import { useEventOrganiser } from "@/components/events/EventOrganiserProvider";

/**
 * " · 4 upcoming" after "by {organiser}" under the title (the owner's event mock): how many upcoming events
 * the organiser has, this one included, from the page's one profile read (EventOrganiserProvider). Nothing
 * until it's known, so the line never shows a guess.
 */
export default function OrganiserUpcoming() {
  const { load } = useEventOrganiser();
  if (load.status !== "ready" || load.upcoming.length === 0) return null;
  return (
    <span data-organiser-upcoming="" className="text-muted">
      {" "}
      · {load.upcoming.length} upcoming
    </span>
  );
}
