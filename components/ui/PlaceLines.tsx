import { placeParts } from "@/lib/event-card";
import type { SheltuhEvent } from "@/lib/types";

/**
 * An event's venue and "Suburb, STATE" (owner decision D4) on a line each
 * (visual QA, 26 Oct 2026): in a narrow card a long venue is cut short on
 * its own line, and so is a long suburb's name, but never its state
 * ("Fortitude Va… QLD"). A hidden " · " joins the lines, so the text read
 * out is placeLabel's "The Depot
 * Theatre · Coburg, VIC". Nothing when there's neither.
 */
export default function PlaceLines({
  event,
  className = "",
}: {
  event: SheltuhEvent;
  className?: string;
}) {
  const { venue, place } = placeParts(event);
  if (!venue && !place) return null;
  return (
    <p data-place-lines="" className={`min-w-0 ${className}`.trim()}>
      {venue && <span className="block truncate">{venue}</span>}
      {/* Spaces as text of their own (between blocks they take no room), so a name computed from the
          parts' text still has them: "The Depot Theatre · Coburg, VIC". */}
      {venue && place && (
        <>
          {" "}
          <span className="sr-only">·</span>{" "}
        </>
      )}
      {place && (
        // The comma goes with the name, so a cut one reads "Fortitude Va… QLD". The space is text of
        // its own for the words read out ("Fortitude Valley, QLD"); between flex items it takes no
        // room, so the state's padding stands in for it on screen.
        <span className="flex min-w-0">
          <span className="truncate">{place.suburb},</span>{" "}
          <span className="shrink-0 ps-1">{place.state}</span>
        </span>
      )}
    </p>
  );
}
