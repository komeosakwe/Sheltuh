import Link from "next/link";
import EventArt from "@/components/EventArt";
import SaveButton from "@/components/favourites/SaveButton";
import { ButtonLink } from "@/components/ui/Button";
import CardPrice from "@/components/ui/CardPrice";
import PlaceLines from "@/components/ui/PlaceLines";
import { cardDateLabel, categoryLabel } from "@/lib/event-card";
import type { SheltuhEvent } from "@/lib/types";

/**
 * One event's screen in the swipe feed (/swipe): the photo (or the generated
 * poster art) filling the screen, a dark gradient under the text, then the
 * category, title (an h2), date and time, place and all-inclusive price, with
 * View event and Save at the foot. An article named by the event's title.
 * `hint` (the first screen, when there's more to swipe to) adds "Swipe up".
 *
 * Text is white on the veil and gradient: solid black at the foot, and dark
 * enough behind the whole text block that it passes WCAG AA (4.5:1) over any
 * photo, a white one included.
 */
export default function SwipeScreen({
  event,
  now,
  first = false,
  hint = false,
}: {
  event: SheltuhEvent;
  now: Date;
  /** The feed's first screen: its photo loads at once. */
  first?: boolean;
  hint?: boolean;
}) {
  const date = cardDateLabel(event, now);
  return (
    <article
      aria-label={event.title}
      data-swipe-screen=""
      className="relative h-dvh snap-start snap-always overflow-hidden bg-ink text-paper"
    >
      <div className="absolute inset-0">
        <EventArt
          poster={event.poster}
          imageUrl={event.imageUrl}
          imageFocus={event.imageFocus}
          title={event.title}
          priority={first}
          className="h-full w-full"
        />
      </div>
      {/* A light veil over the whole photo, then the gradient: behind the text, even a white photo is dark enough for white text (4.5:1). */}
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 bg-ink/25" />
      <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 bottom-0 h-4/5 bg-linear-to-t from-ink from-40% via-ink/90 via-70% to-transparent" />
      <div className="absolute inset-x-0 bottom-0 flex flex-col px-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))]">
        <p className="text-sm leading-5 font-semibold">{categoryLabel(event)}</p>
        <h2 className="mt-1 line-clamp-3 text-3xl leading-9 font-bold tracking-[-0.02em] break-words">{event.title}</h2>
        <p data-swipe-date="" className="mt-3 text-base leading-6 font-semibold">
          {"running" in date ? date.running : [date.date, date.time, date.zone].filter(Boolean).join(" · ")}
        </p>
        <PlaceLines event={event} className="text-base leading-6" />
        <CardPrice event={event} now={now} className="mt-1 text-base leading-6 text-paper" />
        <div className="mt-4 flex items-center gap-3">
          <ButtonLink href={`/events/${event.slug}`} variant="signal" size="lg" className="min-w-0 flex-1">
            View event
          </ButtonLink>
          <SaveButton event={{ id: event.id, title: event.title, slug: event.slug }} variant="overlay" />
        </div>
        {hint && (
          <p aria-hidden="true" data-swipe-hint="" className="mt-3 flex items-center justify-center gap-1 text-sm leading-5 font-semibold">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="size-4 motion-safe:animate-bounce">
              <path d="m6 15 6-6 6 6" />
            </svg>
            Swipe up
          </p>
        )}
      </div>
    </article>
  );
}

/** The top-left Close: back to the home, 44px, readable over any photo. */
export function SwipeClose() {
  return (
    <Link
      href="/"
      aria-label="Close"
      className="flex size-11 items-center justify-center rounded-control bg-ink/70 text-paper hover:bg-ink"
    >
      <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="size-5">
        <path d="M6 6l12 12M18 6 6 18" />
      </svg>
    </Link>
  );
}
