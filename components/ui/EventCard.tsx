import Link from "next/link";
import EventArt from "@/components/EventArt";
import ClipPlayButton from "@/components/events/ClipPlayButton";
import SaveButton from "@/components/favourites/SaveButton";
import CardPrice from "@/components/ui/CardPrice";
import CategoryTag from "@/components/ui/CategoryTag";
import GoingRow from "@/components/ui/GoingRow";
import { isApiConfigured } from "@/lib/api/client";
import { cardGoing, cardGoingFaces, cardMetaParts, cardState, categoryLabel, signalLabel } from "@/lib/event-card";
import type { TrendingSignal } from "@/lib/home-sections";
import type { SheltuhEvent } from "@/lib/types";

/** The image box: 4:3 at every width, radius 16 (the rules' card anatomy). */
const MEDIA = "aspect-[4/3]";

/**
 * The card's meta line, from cardMetaParts, on one line, as written (Instrument Sans in sentence
 * case: owner decision, 13 Nov 2026): cut short with an ellipsis when it doesn't fit (the whole
 * line is still the text read), Mono/S on a narrow card and Mono/M from an 18rem card, so a
 * two-column phone grid never scrolls sideways.
 */
function MetaLine({ parts }: { parts: string[] }) {
  return (
    <p data-card-meta="" className="mono-s truncate text-muted @2xs:mono-m">
      {parts.join(" · ")}
    </p>
  );
}

/**
 * The one event card (the redesign rules' Cards board), on every listing:
 * the home, /events, /search, /saved and profiles.
 *
 * Anatomy, in reading order: the 4:3 photo or poster (radius 16) with the
 * Save heart on its top-right (no date chip on the photo: the owner asked for it gone, 13 Nov; the
 * meta line says the date); the tags (the category in its tint, then
 * any state: "Sold out", "Ended", "Reserved seating", or a trending
 * qualifier; no "Free" tag, since the price label says it); the title
 * (Heading/H4, at most two lines); one meta line "Sat 14 Nov · 5pm · Coburg,
 * VIC" (cardMetaParts, shown as written, never in capitals, cut short if it
 * doesn't fit); then the foot, with who's going on the left and
 * the orange price label on the right. No ticket button and no "By
 * {organiser}": the card opens the event, where both are.
 *
 * The whole card opens the event: the title's link stretches over the card
 * and its hover margin (`::after`), and only Save and a clip's Play sit above
 * it (z-10) as siblings, so nothing interactive is nested in a link. The
 * price label is plain text under the link's stretch: a tap on it opens the
 * event, and it's never a tab stop. The link is named by the title alone;
 * the tags, date, place, going and price are read as the text around it.
 * Tab order: the card's link, Play (with a clip), then Save.
 *
 * Hover (and keyboard focus) fills a cream panel just outside the card (dark:
 * #1a1a1a; 6px out on phones, and 16px
 * from 768px) and underlines the title, over 200ms; no lift and no scale. The
 * panel is absolutely placed, so it never moves the layout. Keyboard focus
 * also rings that panel (the link's own ring is dropped in globals.css, only
 * where `:has()` works). Sold out: the "Sold out" tag and the image at 60%.
 * Ended: the "Ended" tag and a greyed image.
 *
 * Attendance is a count, with colour-dot faces only in the demo (list
 * payloads carry no names live); the demo banner says it's sample data, so
 * the card doesn't repeat it. Below three, nothing. `mode` decides it (default: the app's
 * mode). `signal` (Popular right now) adds one qualifier tag, or the going
 * count it carries.
 *
 * Sibling cards line up: the card is a flex column and its foot is pushed to
 * the bottom with `mt-auto`, keeping a price label's height even when there's
 * no label, so the feet share a line whatever the titles' lengths. The card
 * fills its column. A photo that's a portrait poster is shown whole on a
 * blurred copy of itself.
 */
export default function EventCard({
  event,
  mode = isApiConfigured ? "live" : "demo",
  signal,
  showSave = true,
  priority = false,
  now = new Date(),
  className = "",
}: {
  event: SheltuhEvent;
  mode?: "demo" | "live";
  signal?: TrendingSignal;
  showSave?: boolean;
  /** The image loads eagerly (a card in the page's first row); by default it is lazy. */
  priority?: boolean;
  now?: Date;
  className?: string;
}) {
  const href = `/events/${event.slug}`;
  const external = event.ticketingMode === "external";
  const state = cardState(event, now);
  const qualifier = signal ? signalLabel(signal, external) : null;
  const going = cardGoing(event, mode, signal);
  const faces = cardGoingFaces(event, going).map((name) => ({ name }));
  // No "Free" tag: the price label says "Free" already.
  const stateTag =
    state === "ended" ? "Ended" : state === "sold-out" ? "Sold out" : state === "seated" ? "Reserved seating" : null;
  const tags = [stateTag, qualifier].filter((tag): tag is string => tag !== null);

  return (
    <div
      data-event-card=""
      data-card-state={state}
      className={`group/card @container relative isolate flex w-full min-w-0 flex-col ${className}`.trim()}
    >
      {/* The hover and focus panel: cream just outside the card, behind everything in it. */}
      <span
        aria-hidden="true"
        data-card-hover=""
        className="pointer-events-none absolute -inset-1.5 -z-10 md:-inset-4 rounded-card bg-hover opacity-0 outline-foreground group-hover/card:opacity-100 group-has-[[data-card-link]:focus-visible]/card:opacity-100 group-has-[[data-card-link]:focus-visible]/card:outline-2 motion-safe:transition-opacity motion-safe:duration-200 motion-safe:ease-out"
      />
      <div data-card-media="" className="relative overflow-hidden rounded-card">
        <EventArt
          poster={event.poster}
          imageUrl={event.imageUrl}
          imageFocus={event.imageFocus}
          title={event.title}
          fit="auto"
          priority={priority}
          // Sold out: the image at 60%. Ended: greyed; it's still there to look at, but nothing's on.
          className={`${MEDIA} w-full ${state === "ended" ? "grayscale" : state === "sold-out" ? "opacity-60" : ""}`.trim()}
        />
      </div>
      <div className="flex min-w-0 flex-col gap-2 pt-4">
        <p data-card-tags="" className="flex min-w-0 flex-wrap gap-2">
          <CategoryTag tone={event.category}>{categoryLabel(event)}</CategoryTag>
          {tags.map((tag) => (
            <CategoryTag key={tag} tone="neutral">
              {tag}
            </CategoryTag>
          ))}
        </p>
        {/* The card's one link, named by the title alone (the rest is read as the text around it). */}
        <h3 className="heading-h4 line-clamp-2 break-words">
          <Link
            href={href}
            data-card-link=""
            className="underline decoration-transparent underline-offset-4 group-hover/card:decoration-current after:absolute after:-inset-1.5 after:z-0 md:after:-inset-4 after:content-[''] motion-safe:transition-colors motion-safe:duration-200 motion-safe:ease-out"
          >
            {event.title}
          </Link>
        </h3>
        <MetaLine parts={cardMetaParts(event, now)} />
      </div>
      {event.clip && (
        // The clip's Play (docs/design/event-clips.md §5.1): after the card's link and before Save in
        // the DOM (tab order: link, Play, Save), at the image's bottom-right on screen. The frame repeats
        // the image's own box (its aspect class), so nothing is measured; only the button in it takes
        // pointer events, so a tap anywhere else on the image still opens the event.
        <div data-clip-frame="" className={`pointer-events-none absolute inset-x-0 top-0 z-10 ${MEDIA}`}>
          <ClipPlayButton event={event} className="pointer-events-auto absolute right-2 bottom-2" />
        </div>
      )}
      {showSave && (
        // After the text in the DOM (so it follows the card's link in tab order), over the photo's corner on screen.
        <SaveButton
          event={{ id: event.id, title: event.title, slug: event.slug }}
          variant="overlay"
          className="absolute top-0 right-0 z-10 md:top-1 md:right-1"
        />
      )}
      {/* The foot: mt-auto pins it to the bottom of an equal-height card. Not z-10: the price label
          is text under the card's link, so a tap on it opens the event. min-h-14 keeps a label's
          room when there's none (sold out, ended), so the feet still line up. One line from a 16rem
          card (who's going on the left, the price on the right); on a narrower one (the phone grid)
          the price sits under who's going, on the right, the same on every card in the row. */}
      <div
        data-card-foot=""
        className="mt-auto flex min-h-14 flex-col justify-end gap-2 pt-4 @3xs:flex-row @3xs:items-center @3xs:justify-between"
      >
        {going && <GoingRow going={going} faces={faces} />}
        <CardPrice event={event} now={now} variant="tag" className="shrink-0 self-end @3xs:ml-auto @3xs:self-auto" />
      </div>
    </div>
  );
}

/** A card's shape while events load (the rules: image + 3 bars, surface/muted). No shimmer. */
export function EventCardPlaceholder({ className = "" }: { className?: string }) {
  return (
    <div aria-hidden="true" className={`flex w-full flex-col ${className}`.trim()}>
      <div className={`${MEDIA} rounded-card bg-surface`} />
      <div className="flex flex-col gap-2 pt-4">
        <div className="h-6 w-20 max-w-full rounded-badge bg-surface" />
        <div className="h-4 w-full rounded-badge bg-surface" />
        <div className="h-4 w-32 max-w-full rounded-badge bg-surface" />
      </div>
    </div>
  );
}
