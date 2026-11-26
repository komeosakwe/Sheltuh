import Link from "next/link";
import EventArt from "@/components/EventArt";
import SaveButton from "@/components/favourites/SaveButton";
import CardPrice from "@/components/ui/CardPrice";
import GoingRow from "@/components/ui/GoingRow";
import { isApiConfigured } from "@/lib/api/client";
import { cardGoing, cardGoingFaces, cardState, categoryLabel, placeParts } from "@/lib/event-card";
import type { SheltuhEvent } from "@/lib/types";

/** "Brunswick · Royal Exhibition Annex": the suburb, then the venue, whichever exist. */
export function savedPlaceLine(event: SheltuhEvent): string {
  const { venue, place } = placeParts(event);
  return [place?.suburb ?? "", venue].filter(Boolean).join(" · ");
}

/**
 * A saved event on /saved, as Latte's Saved frames draw it ("Event card", 470:8106 / 531:11946 /
 * 531:12258): no fill and no border, 16px padding, radius 16; a 144px photo (radius 8) with the
 * Save heart in its top-right corner; the category tag (32px, Label/Tag in its tint); the title
 * (Heading/H3); "Suburb · Venue" in IBM Plex Mono 12/16, text/secondary, one line; then who's
 * going and the orange price label on one line.
 *
 * As EventCard: the title's link is the card's only link, stretched over it (so it's named by
 * the title alone), Save sits above it as a sibling, and hover or keyboard focus fills the card
 * cream (surface/card-hover) and underlines the title. Ended and sold-out events keep the shared
 * card's look: greyed or 60% image, no price label.
 */
export default function SavedEventCard({
  event,
  now,
  priority = false,
}: {
  event: SheltuhEvent;
  now: Date;
  priority?: boolean;
}) {
  const state = cardState(event, now);
  const going = cardGoing(event, isApiConfigured ? "live" : "demo");
  const faces = cardGoingFaces(event, going).map((name) => ({ name }));
  const place = savedPlaceLine(event);

  return (
    <div
      data-saved-card=""
      data-card-state={state}
      className="group/card relative isolate flex w-full min-w-0 flex-col gap-2 rounded-card p-4 hover:bg-hover has-[[data-card-link]:focus-visible]:bg-hover has-[[data-card-link]:active]:bg-hover motion-safe:transition-colors motion-safe:duration-200 motion-safe:ease-out"
    >
      <div className="relative h-36 overflow-hidden rounded-control">
        <EventArt
          poster={event.poster}
          imageUrl={event.imageUrl}
          imageFocus={event.imageFocus}
          title={event.title}
          fit="poster"
          priority={priority}
          // The saved grid's one, two and three columns (SAVED_GRID).
          sizes="(min-width: 1280px) 33vw, (min-width: 768px) 50vw, 100vw"
          className={`size-full ${state === "ended" ? "grayscale" : state === "sold-out" ? "opacity-60" : ""}`.trim()}
        />
      </div>
      <p className="flex min-w-0 flex-wrap gap-2">
        <span data-tag={event.category} className="label-tag inline-flex h-8 max-w-full items-center rounded-badge px-2">
          <span className="truncate">{categoryLabel(event)}</span>
        </span>
        {state === "sold-out" && (
          <span data-tag="neutral" className="label-tag inline-flex h-8 items-center rounded-badge px-2">
            Sold out
          </span>
        )}
      </p>
      <h3 className="heading-h3 line-clamp-2 break-words max-md:text-2xl max-md:leading-8">
        <Link
          href={`/events/${event.slug}`}
          data-card-link=""
          className="underline decoration-transparent underline-offset-4 group-hover/card:decoration-current focus-visible:decoration-current after:absolute after:inset-0 after:z-0 after:rounded-card after:content-['']"
        >
          {event.title}
        </Link>
      </h3>
      {place && <p className="truncate font-mono text-xs leading-4 text-muted">{place}</p>}
      <div className="mt-auto flex min-h-10 items-center gap-2">
        {going && <GoingRow going={going} faces={faces} />}
        <CardPrice event={event} now={now} variant="tag" className="ml-auto shrink-0" />
      </div>
      <SaveButton
        event={{ id: event.id, title: event.title, slug: event.slug }}
        variant="overlay"
        className="absolute top-4 right-4 z-10"
      />
    </div>
  );
}
