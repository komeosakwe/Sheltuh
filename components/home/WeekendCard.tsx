import Link from "next/link";
import EventArt from "@/components/EventArt";
import ClipPlayButton from "@/components/events/ClipPlayButton";
import SaveButton from "@/components/favourites/SaveButton";
import { ArrowRightIcon, CalendarIcon, ChevronRightIcon, PinIcon } from "@/components/home/icons";
import CardPrice from "@/components/ui/CardPrice";
import InitialsAvatar from "@/components/ui/InitialsAvatar";
import { isApiConfigured } from "@/lib/api/client";
import { cardDateLabel, cardGoing, cardGoingFaces, cardState, categoryLabel, placeParts } from "@/lib/event-card";
import type { TrendingSignal } from "@/lib/home-sections";
import type { SheltuhEvent } from "@/lib/types";

/**
 * The card's width: about 1.15 cards across a phone (80% of the screen, at most 320px), so the next
 * one peeks in; 256px from 640px, where the rail shows two to four and a part.
 */
export const WEEKEND_CARD_WIDTH = "w-[min(80vw,20rem)] shrink-0 sm:w-64";

/** The media box: the mockup's 13:9 (258 × 179px at its width). */
const MEDIA = "aspect-13/9";

/**
 * A This weekend card (owner's mockup, 8 Nov 2026): an ivory rounded card on a soft shadow, the
 * photo or poster on top with the Save heart in a glass square, then the title in bold capitals,
 * the date and time, the venue (as entered) with "Suburb, STATE" under it, the category in a lilac
 * pill, the going strip, and at the foot the all-inclusive price and an orange arrow to the event.
 * No "Featured" badge (owner: not until promoted listings exist).
 *
 * The data is EventCard's (lib/event-card.ts): the date in the event's own zone (or "Now on ·
 * until …"), placeParts, categoryLabel, CardPrice's price line (Free, From, Sold out, Ended) and
 * cardGoing's count: the demo's sample count, or live a thresholded trending count, and nothing
 * under three. The strip shows only with a count; its faces are the demo's sample names as
 * initials (cardGoingFaces), and none live (list payloads carry no names).
 *
 * The title's link stretches over the card (`::after`), so the whole card opens the event; Save and
 * the arrow ("Open {title}", the same page) sit above it as siblings, so no link is nested in
 * another. Keyboard focus rings the whole card (globals.css drops the link's own ring). Tab order:
 * the card, Play (with a clip), Save, the arrow.
 */
export default function WeekendCard({
  event,
  mode = isApiConfigured ? "live" : "demo",
  signal,
  priority = false,
  now = new Date(),
}: {
  event: SheltuhEvent;
  mode?: "demo" | "live";
  signal?: TrendingSignal;
  priority?: boolean;
  now?: Date;
}) {
  const href = `/events/${event.slug}`;
  const state = cardState(event, now);
  const date = cardDateLabel(event, now);
  const going = cardGoing(event, mode, signal);
  const faces = cardGoingFaces(event, going);
  const { venue, place } = placeParts(event);

  return (
    <div
      data-event-card=""
      data-variant="weekend"
      data-card-state={state}
      className={`group/card relative flex min-w-0 flex-col rounded-panel border border-surface-border/60 bg-panel shadow-soft has-[[data-card-link]:focus-visible]:outline-2 has-[[data-card-link]:focus-visible]:outline-offset-4 has-[[data-card-link]:focus-visible]:outline-foreground motion-safe:transition-transform motion-safe:duration-150 motion-safe:[@media(hover:hover)]:hover:-translate-y-0.5 motion-safe:has-[[data-card-link]:active]:scale-[0.98] motion-reduce:has-[[data-card-link]:active]:opacity-80 ${WEEKEND_CARD_WIDTH}`}
    >
      <div data-card-media="" className="relative overflow-hidden rounded-t-panel">
        <EventArt
          poster={event.poster}
          imageUrl={event.imageUrl}
          imageFocus={event.imageFocus}
          title={event.title}
          fit="cover"
          priority={priority}
          className={`${MEDIA} w-full motion-safe:transition-transform motion-safe:duration-300 motion-safe:ease-out motion-safe:group-hover/card:scale-[1.03] ${state === "ended" ? "grayscale" : ""}`.trim()}
        />
      </div>
      <div className="flex min-w-0 flex-col px-4 pt-2">
        {/* The card's one link, named by the title alone (the rest is read as the text after it). */}
        <h3 className="line-clamp-2 text-xl leading-6 font-bold tracking-tight break-words uppercase">
          <Link
            href={href}
            data-card-link=""
            className="underline-offset-4 group-hover/card:underline after:absolute after:inset-0 after:z-0 after:rounded-panel after:content-['']"
          >
            {event.title}
          </Link>
        </h3>
        <p data-card-date="" className="mt-1 flex gap-1.5 text-sm leading-5 font-medium">
          <CalendarIcon className="size-5 shrink-0" />
          <span className="min-w-0">
            {"running" in date ? (
              date.running
            ) : (
              // Each part stays whole: a narrow card wraps between them, never inside "5:00 pm".
              <>
                <span className="whitespace-nowrap">{date.date}</span>{" "}
                <span className="whitespace-nowrap">· {date.time}</span>
                {date.zone && (
                  <>
                    {" "}
                    <span className="whitespace-nowrap">{date.zone}</span>
                  </>
                )}
              </>
            )}
          </span>
        </p>
        {(venue || place) && (
          // The venue, then "Suburb, STATE" quieter under it; a hidden " · " joins them when read.
          <p data-place-lines="" className="mt-1 flex min-w-0 gap-1.5 text-sm leading-4">
            <PinIcon className="mt-px size-5 shrink-0" />
            <span className="flex min-w-0 flex-col pt-0.5">
              {venue && <span className="truncate">{venue}</span>}
              {venue && place && <span className="sr-only"> · </span>}
              {place && (
                <span className="flex min-w-0 text-muted">
                  <span className="truncate">{place.suburb},</span>{" "}
                  <span className="shrink-0 ps-1">{place.state}</span>
                </span>
              )}
            </span>
          </p>
        )}
        <p className="mt-2 flex">
          <span data-card-category="" className="inline-flex h-6 items-center rounded-full bg-lilac px-3 text-xs leading-4 text-foreground">
            {categoryLabel(event)}
          </span>
        </p>
        {going && (
          <p
            data-card-going=""
            className="-mx-1 mt-2 flex min-h-10 items-center gap-2.5 rounded-full bg-sand py-1 ps-3 pe-3 text-sm leading-4 font-bold"
          >
            {faces.length > 0 && (
              // The demo's sample names as initials (decorative: the count beside them says it).
              <span aria-hidden="true" data-card-faces="" className="flex shrink-0">
                {faces.map((name, i) => (
                  <span key={`${name}-${i}`} className={`flex rounded-full ring-1 ring-paper ${i > 0 ? "-ml-0.5" : ""}`.trim()}>
                    <InitialsAvatar name={name} index={i} size="strip" round />
                  </span>
                ))}
              </span>
            )}
            {/* Wraps rather than cuts "(sample)" short on a narrow card. */}
            <span className="min-w-0 tabular-nums">
              {going.count} going
              {going.sample && <span className="text-xs leading-4 font-medium"> (sample)</span>}
            </span>
            <ChevronRightIcon className="-ms-1 size-4 shrink-0" />
          </p>
        )}
      </div>
      {event.clip && (
        // The clip's Play, at the photo's bottom-left (docs/design/event-clips.md §5.1), as on EventCard.
        <div data-clip-frame="" className={`pointer-events-none absolute inset-x-0 top-0 z-10 ${MEDIA}`}>
          <ClipPlayButton event={event} className="pointer-events-auto absolute bottom-1 left-2" />
        </div>
      )}
      <SaveButton event={{ id: event.id, title: event.title, slug: event.slug }} variant="glass" className="absolute top-1.5 right-2 z-10" />
      {/* The foot, pinned to the bottom so prices line up across the rail. Not z-10 itself: a tap on
          the price still opens the event; only the arrow sits above the card's link. */}
      {/* Bottom-aligned: a price that wraps to two lines keeps the arrow on the same line as its
          neighbours'; the price's last line sits centred on the arrow (its 6px of bottom padding). */}
      <div data-card-foot="" className="mt-auto flex items-end justify-between gap-2 px-4 pt-2 pb-3">
        {/* The note's size sits on a wrapper, not on CardPrice's <p>: "Free", "Sold out" and "Ended" put
            amountClassName on that same <p>, where two text sizes would clash. */}
        <div className="min-w-0 pb-1.5 text-sm leading-5">
          <CardPrice event={event} now={now} amountClassName="text-base leading-5 font-bold" />
        </div>
        <Link
          href={href}
          aria-label={`Open ${event.title}`}
          className="group/open relative z-10 -my-1.5 -me-0.5 flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-full"
        >
          <span className="flex h-8 w-10.5 items-center justify-center rounded-full bg-signal text-paper group-hover/open:bg-signal/90">
            <ArrowRightIcon className="size-5" />
          </span>
        </Link>
      </div>
    </div>
  );
}
