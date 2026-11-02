import Link from "next/link";
import EventArt from "@/components/EventArt";
import SaveButton from "@/components/favourites/SaveButton";
import { ButtonLink } from "@/components/ui/Button";
import CardPrice from "@/components/ui/CardPrice";
import PlaceLines from "@/components/ui/PlaceLines";
import { cardDateLabel, categoryLabel } from "@/lib/event-card";
import type { SheltuhEvent } from "@/lib/types";
import { clearSwipePosition } from "./swipePosition";

/** The phone home's screen height: what's visible under the sticky site header (its `--header-h` and the safe area). */
export const INLINE_SCREEN_MIN_H = "min-h-[calc(100svh-var(--header-h)-env(safe-area-inset-top))]";

/**
 * One event's screen in the swipe feed (/swipe): the photo (or the generated
 * poster art) filling the screen, a dark gradient under the text, then the
 * eyebrow (the section, then the category), title (an h2), date and time,
 * place and all-inclusive price, with View event and Save at the foot. An
 * article named by the event's title, number `position` of `total` in the feed.
 * `hint` (the first screen, when there's more to swipe to) adds "Swipe up".
 * `inline` is the phone home's screen (components/home/HomeInlineFeed): as
 * tall as the area under the sticky site header (`--header-h` and the safe
 * area) instead of the window, with no Close button to clear above the
 * text. It snaps to the page's scroller flush under the header: the root's
 * `scroll-padding-top` already clears the header and 0.5rem more, which the
 * negative scroll margin takes back. The first inline screen has no snap
 * point: Chrome's proximity reach is about 30% of the window, so a snap point
 * at the first event would pull a tall phone's page past the hero and search
 * (on load, and after any small scroll). It is reached by scrolling, and the
 * snapping starts at the second.
 *
 * At least a screen high, taller when the text needs it (a 320×256 window, a
 * phone on its side): nothing is clipped, the feed scrolls instead. The text
 * block clears the Close button at the top.
 *
 * Text is white on the veil and gradient: solid black at the foot, and dark
 * enough behind the whole text block that it passes WCAG AA (4.5:1) over any
 * photo, a white one included.
 */
export default function SwipeScreen({
  event,
  section,
  position,
  total,
  now,
  first = false,
  hint = false,
  inline = false,
}: {
  event: SheltuhEvent;
  /** The home section's title, as a small eyebrow. */
  section: string;
  /** 1-based place in the feed, and how many events it holds. */
  position: number;
  total: number;
  now: Date;
  /** The feed's first screen: its photo loads at once. */
  first?: boolean;
  hint?: boolean;
  inline?: boolean;
}) {
  const date = cardDateLabel(event, now);
  return (
    <article
      aria-label={event.title}
      aria-posinset={position}
      aria-setsize={total}
      data-swipe-screen=""
      data-event-id={event.id}
      data-surface={inline ? "ink" : undefined}
      className={`relative flex flex-col justify-end bg-ink text-paper ${
        inline ? `${INLINE_SCREEN_MIN_H} -scroll-mt-2 ${first ? "" : "snap-start snap-always"}` : "min-h-dvh snap-start snap-always"
      }`}
    >
      <div className="absolute inset-0 overflow-hidden">
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
      {/* The top padding keeps the text below the Close button (0.75rem + 44px) however short the window. */}
      <div
        className={`relative flex flex-col px-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))] ${
          inline ? "pt-12" : "pt-[calc(4.5rem+env(safe-area-inset-top))]"
        }`}
      >
        <p className="text-sm leading-5 font-semibold">
          <span data-swipe-section="">{section}</span> · {categoryLabel(event)}
        </p>
        <h2 className="mt-1 line-clamp-3 text-3xl leading-9 font-bold tracking-[-0.02em] break-words">{event.title}</h2>
        <p data-swipe-date="" className="mt-3 text-base leading-6 font-semibold">
          {"running" in date ? date.running : [date.date, date.time, date.zone].filter(Boolean).join(" · ")}
        </p>
        <PlaceLines event={event} className="text-base leading-6" />
        <CardPrice event={event} now={now} className="mt-1 text-base leading-6 text-paper" />
        <div className="mt-4 flex items-center gap-3">
          <ButtonLink href={`/events/${event.slug}`} variant="signal" size="lg" className="min-w-0 flex-1">
            {/* One inline run inside the button's flex box, so the hidden title keeps its space. */}
            <span>
              View event <span className="sr-only">{event.title}</span>
            </span>
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

/** The top-left Close: back to the home (the feed starts over next time), 44px, readable over any photo. */
export function SwipeClose() {
  return (
    <Link
      href="/"
      aria-label="Close, back to home"
      onClick={clearSwipePosition}
      className="flex size-11 items-center justify-center rounded-control bg-ink/70 text-paper hover:bg-ink"
    >
      <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="size-5">
        <path d="M6 6l12 12M18 6 6 18" />
      </svg>
    </Link>
  );
}
