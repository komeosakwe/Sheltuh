import Link from "next/link";
import { useId } from "react";
import { ButtonLink } from "@/components/ui/Button";
import { Notice } from "@/components/ui/Section";
import type { EventSeating } from "@/lib/api/types";

/**
 * How an event's tickets are sold: general admission (quantities), or
 * reserved seating (buyers pick seats on the event's seat map;
 * docs/architecture.md, "Reserved seating"). Not a stored field: an existing
 * event is "reserved" when it has a seat map; for a new event it decides where
 * saving goes next (the seat-map page, to draw the map).
 */
export type SeatingChoice = "general" | "reserved";

/** The choice an event starts with: reserved when it already has a seat map. */
export function initialSeatingChoice(event: { seating?: EventSeating } | undefined): SeatingChoice {
  return event?.seating ? "reserved" : "general";
}

/** An event's seat-map page: the organiser's editor, or the admin's preview, replace and remove page. */
export function seatMapHref(eventId: string, admin: boolean): string {
  const id = encodeURIComponent(eventId);
  return admin ? `/admin/events/${id}/seat-map` : `/dashboard/${id}/seat-map`;
}

/** The seat-map link's words: its size once there's a map, else an invitation to add one. */
export function seatMapLinkLabel(seating: EventSeating | undefined): string {
  return seating ? `Seat map · ${seating.seatCount} seats` : "Add a seat map";
}

const OPTIONS: { value: SeatingChoice; title: string }[] = [
  {
    value: "general",
    title: "General admission (no assigned seats)",
  },
  {
    value: "reserved",
    title: "Reserved seating (buyers pick seats on a map)",
  },
];

interface Props {
  value: SeatingChoice;
  onChange: (value: SeatingChoice) => void;
  /** The saved event, when editing one (absent for a new event). */
  event?: { eventId: string; seating?: EventSeating };
  /** Admin authoring: links go to the admin's seat-map page. */
  admin: boolean;
  /** The organiser can no longer change the seating (the event has been approved before). */
  locked: boolean;
  /** The legend's style: the editor's section title. */
  legendClassName: string;
}

/**
 * The "Seating" section of the event editor (Sheltüh-ticketed events only):
 * a radio group with a one-line explanation per choice, then what the choice
 * means for this event, with a link to its seat map once the event exists.
 * Choosing general admission never removes a map: it says where to remove it.
 */
export default function SeatingChoiceField({ value, onChange, event, admin, locked, legendClassName }: Props) {
  const id = useId();
  const seating = event?.seating;
  const href = event ? seatMapHref(event.eventId, admin) : null;

  return (
    <fieldset className="flex min-w-0 flex-col gap-3">
      <legend className="mb-3">
        <h3 className={legendClassName}>Seating</h3>
      </legend>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {OPTIONS.map((option) => (
          <label
            key={option.value}
            className="flex min-h-11 min-w-0 cursor-pointer items-start gap-3 rounded-control border border-foreground bg-card p-3 text-sm text-foreground has-[:checked]:bg-surface has-[:disabled]:cursor-not-allowed"
          >
            <input
              type="radio"
              name={`${id}-seating`}
              value={option.value}
              checked={value === option.value}
              disabled={locked}
              onChange={() => onChange(option.value)}
              aria-labelledby={`${id}-${option.value}-title`}
              className="mt-0.5 size-5 shrink-0"
            />
            <span className="flex min-w-0 flex-col gap-1">
              <span id={`${id}-${option.value}-title`} className="font-semibold">
                {option.title}
              </span>
            </span>
          </label>
        ))}
      </div>

      {locked && (
        <Notice>
          Seating is locked because this event was approved. Contact Sheltüh to change it.
        </Notice>
      )}

      {value === "reserved" && !event && (
        <Notice>
          <p>
            The ticket types below are the seat map&rsquo;s price tiers (up to 5). Quantities come from its seats.
          </p>
          <p className="mt-1">
            Saving takes you to the seat map.
            {admin && " Until a map is saved, tickets sell as general admission."}
          </p>
        </Notice>
      )}

      {value === "reserved" && event && href && (
        <div className="flex flex-col gap-3">
          {!locked && (
            <Notice>
              {seating
                ? `${seating.seatCount} seats. Each seat’s tier is one of the ticket types below.`
                : "The ticket types below are the seat map’s price tiers. Save changes before adding seats."}
            </Notice>
          )}
          {/* Locked without a map: there's nothing to open (the organiser can't add one now). */}
          {(seating || !locked) && (
            <ButtonLink variant="outline" size="sm" className="min-h-11 w-fit" href={href}>
              {seatMapLinkLabel(seating)}
            </ButtonLink>
          )}
        </div>
      )}

      {/* Only reachable while the choice can change (locked keeps the event's own). */}
      {value === "general" && seating && href && (
        <div className="flex flex-col gap-3">
          <Notice>
            This event has a seat map ({seating.seatCount} seats). Saving here doesn&rsquo;t remove it: remove the map
            on its seat map page.
          </Notice>
          <Link
            href={href}
            className="inline-flex min-h-11 w-fit items-center text-sm font-medium text-foreground underline underline-offset-4"
          >
            Open the seat map to remove it
          </Link>
        </div>
      )}
    </fieldset>
  );
}
