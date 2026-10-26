import Link from "next/link";
import { useId } from "react";
import EventArt from "@/components/EventArt";
import ClipPlayButton from "@/components/events/ClipPlayButton";
import SaveButton from "@/components/favourites/SaveButton";
import QuickBuyLink from "@/components/QuickBuyLink";
import CardPrice from "@/components/ui/CardPrice";
import PlaceLines from "@/components/ui/PlaceLines";
import { isApiConfigured } from "@/lib/api/client";
import { cardCta, cardDateLabel, cardGoing, cardState, categoryLabel, placeLabel, signalLabel } from "@/lib/event-card";
import type { TrendingSignal } from "@/lib/home-sections";
import { organiserProfileHref } from "@/lib/sample-organisers";
import type { SheltuhEvent } from "@/lib/types";

export type EventCardVariant = "rail" | "grid";

/**
 * A rail card is a fixed width at every size, never stretched to fill a row
 * (the home's rails scroll sideways at every width: owner, 23 Oct 2026):
 * 198 / 232 / 240px at 320 / 375 / 430, then 256px from 640px.
 */
const WIDTH: Record<EventCardVariant, string> = {
  rail: "w-[min(62vw,15rem)] shrink-0 sm:w-64",
  grid: "w-full",
};
/**
 * 18/24 titles. The two-column phone grid (cards 134–189px wide) is 16/22 until
 * 640px: at 18px a 134px card fits about eleven characters a line, so most
 * titles would be cut at two lines.
 */
const TITLE: Record<EventCardVariant, string> = {
  rail: "text-lg leading-6",
  grid: "text-base leading-[1.375rem] sm:text-lg sm:leading-6",
};
/** Date, place and price: 14/20 on every card, at every width. */
const SMALL = "text-sm leading-5";
/**
 * The price line's box. The phone grid's price nearly always wraps to two
 * lines ("From A$36.90 incl. / booking fee" at 134px), so there it keeps two
 * lines' room whatever it says, and "Sold out" lines up with its neighbours.
 */
const PRICE_BOX: Record<EventCardVariant, string> = {
  rail: "",
  grid: "min-h-10 sm:min-h-0",
};
/**
 * The media box (Refinement, 22 Oct 2026: shorter cards). A rail card is
 * 4:3 at every width (owner, 23 Oct 2026: "the pictures still way too big";
 * it was square from 640px): 149 / 174 / 180px tall at 320 / 375 / 430, and
 * 192px for the 256px card from 640px, so a card's image and title fit a
 * phone's first screen under the hero. Portrait posters show whole
 * (`fit="auto"` letterboxes them on black rather than cropping them to a
 * strip); photos cover. A grid card (/events, profiles) stays square.
 */
const MEDIA: Record<EventCardVariant, string> = {
  rail: "aspect-[4/3]",
  grid: "aspect-square",
};
/**
 * `wide` (a `rail` card in a home rail of one or two, HomeRail's pair): from
 * 1024px the card fills its half of the page column (468–532px) and its
 * image is a wide landscape strip, 12:5 (2.4:1) and never taller than 200px
 * (195px at 1024, 200px from about 1100; owner, 23 Oct 2026: "the pictures
 * still way too big", it was 16:9 and up to 299px), so the pair reads as a
 * compact row, not a hero, at about a rail card's image height (192px).
 * Below 1024px it's an ordinary rail card.
 */
const WIDE = { width: "lg:w-full", media: "lg:aspect-[12/5] lg:max-h-50" } as const;

/**
 * The one event card (docs/design/mobile-redesign.md §6.2 and its
 * Refinement, 22 Oct 2026), image first with no container, in the order a
 * visitor decides: the photo or poster (only the Save heart on it), the
 * title, the date and time, the venue · suburb, then one small secondary
 * line (category, any trending qualifier, reserved seating and the
 * attendance count); then, pinned to the card's foot, the all-inclusive
 * price and the ticket action. Each ticket state reads differently
 * (`data-card-state`): paid and seated ("Choose seats") are priced and
 * orange; free says "Free"; sold out says so with an outline "Join
 * waitlist"; external names where tickets are sold; ended says "Ended", has
 * no action and a greyed image. `rail` is the home's sideways rails (a fixed
 * width at every size); `grid` is the results grids
 * (/events, /search, /saved, profiles).
 *
 * Attendance is a count only, never faces: list payloads carry no names or
 * photos. A demo count is labelled "(sample)"; below three, nothing.
 *
 * The whole card opens the event: the title's link stretches over the card
 * (`::after`), and Save, the ticket action and the organiser link sit above
 * it (z-10) as siblings, so nothing interactive is nested in a link. The
 * link is named title first, then the date, place, price and going count
 * (the category is seen, not repeated in every link's name). An event with
 * a clip also has a Play button at the image's bottom-left
 * (docs/design/event-clips.md §5.1). Tab order: the card's link, Play (with
 * a clip), Save, the ticket action, then "By {organiser}". Keyboard
 * focus rings the whole card (the link's own ring is suppressed in
 * globals.css, only where `:has()` works).
 *
 * Sibling cards line up: a rail's or grid's cells stretch to the row's
 * height, the card is a flex column, and its foot (price, ticket action, "By
 * {organiser}") is pushed to the bottom with `mt-auto`, so the prices and
 * buttons share a line whatever the titles' lengths. Rows that only some
 * cards have keep their room in the foot (no ticket action: an empty
 * button-high row; a grid organiser without a profile: the name as text).
 *
 * `signal` (Popular right now) adds one qualifier to the secondary line. `mode` decides the going count (default: the app's mode).
 * `wide` (rail only) is a pair's card: full cell width and a 12:5 image, at most 200px tall, from 1024px (`WIDE`).
 */
export default function EventCard({
  event,
  variant,
  mode = isApiConfigured ? "live" : "demo",
  signal,
  showSave = true,
  showOrganiser = true,
  wide = false,
  now = new Date(),
  className = "",
}: {
  event: SheltuhEvent;
  variant: EventCardVariant;
  mode?: "demo" | "live";
  signal?: TrendingSignal;
  showSave?: boolean;
  /** `rail` only: a card in a rail of one or two, which fills its grid cell with a landscape image from 1024px. */
  wide?: boolean;
  /** `grid` only: "By {organiser}", where the organiser has a profile (off on their own profile). */
  showOrganiser?: boolean;
  now?: Date;
  className?: string;
}) {
  const href = `/events/${event.slug}`;
  const external = event.ticketingMode === "external";
  const state = cardState(event, now);
  const qualifier = signal ? signalLabel(signal, external) : null;
  const date = cardDateLabel(event, now);
  const place = placeLabel(event);
  const going = cardGoing(event, mode, signal);
  const secondary = [categoryLabel(event), qualifier, state === "seated" ? "Reserved seating" : null].filter(Boolean).join(" · ");
  const showOrganiserRow = variant === "grid" && showOrganiser;
  const organiserHref = showOrganiserRow ? organiserProfileHref(event) : null;
  const hasCta = cardCta(event, now) !== null;
  const isWide = wide && variant === "rail";

  const id = useId();
  const ids = {
    title: `${id}-title`,
    date: `${id}-date`,
    place: `${id}-place`,
    price: `${id}-price`,
    going: `${id}-going`,
  };
  const labelledBy = [ids.title, ids.date, place ? ids.place : null, ids.price, going ? ids.going : null]
    .filter(Boolean)
    .join(" ");

  return (
    <div
      data-event-card=""
      data-variant={variant}
      data-wide={isWide ? "" : undefined}
      data-card-state={state}
      className={`group/card relative flex min-w-0 flex-col has-[[data-card-link]:focus-visible]:rounded-card has-[[data-card-link]:focus-visible]:outline-2 has-[[data-card-link]:focus-visible]:outline-offset-4 has-[[data-card-link]:focus-visible]:outline-foreground motion-safe:transition-transform motion-safe:duration-150 motion-safe:has-[[data-card-link]:active]:scale-[0.98] ${WIDTH[variant]} ${isWide ? WIDE.width : ""} ${className}`.replace(/\s+/g, " ").trim()}
    >
      <div data-card-media="" className="relative overflow-hidden rounded-card">
        <EventArt
          poster={event.poster}
          imageUrl={event.imageUrl}
          title={event.title}
          fit={variant === "rail" ? "auto" : "cover"}
          // An ended event's image is greyed: it's still there to look at, but nothing's on.
          className={`${MEDIA[variant]} ${isWide ? WIDE.media : ""} w-full motion-safe:transition-transform motion-safe:duration-300 motion-safe:ease-out motion-safe:group-hover/card:scale-[1.03] ${state === "ended" ? "grayscale" : ""}`.replace(/\s+/g, " ").trim()}
        />
      </div>
      <div className="flex min-w-0 flex-col pt-3">
        {/* The heading is named by the title alone (its link's name is the whole card's). */}
        <h3 aria-labelledby={ids.title} className={`line-clamp-2 font-semibold tracking-[-0.01em] break-words ${TITLE[variant]}`}>
          <Link
            href={href}
            data-card-link=""
            aria-labelledby={labelledBy}
            className="underline-offset-4 group-hover/card:underline after:absolute after:inset-0 after:z-0 after:content-['']"
          >
            <span id={ids.title}>{event.title}</span>
          </Link>
        </h3>
        <p id={ids.date} className={`mt-1 font-medium ${SMALL}`}>
          {"running" in date ? (
            date.running
          ) : (
            // Each part stays whole: a narrow card wraps between them, never inside "7:00 pm",
            // and the separator goes down with the time, so no line ends on "·". The zone ("Perth
            // time") is a part of its own, so it wraps under the time rather than out of the card.
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
        </p>
        {/* The venue, then "Suburb, STATE", a line each: a narrow card cuts each short, never the state off. */}
        <PlaceLines event={event} id={ids.place} className={`text-muted ${SMALL}`} />
        {/* Secondary and small: what kind of event, and how many are going (a count only). */}
        <p data-card-secondary="" className="mt-1 line-clamp-2 text-xs leading-4 text-muted">
          {secondary}
          {going && (
            <>
              {" · "}
              <span id={ids.going}>
                {going.count} going{going.sample ? " (sample)" : ""}
              </span>
            </>
          )}
        </p>
      </div>
      {event.clip && (
        // The clip's Play (docs/design/event-clips.md §5.1): after the card's link and before Save in
        // the DOM (tab order: link, Play, Save, ticket action), at the image's bottom-left on screen.
        // The frame repeats the image's own box (its aspect classes), so nothing is measured; only the
        // button in it takes pointer events, so a tap anywhere else on the image still opens the event.
        <div
          data-clip-frame=""
          className={`pointer-events-none absolute inset-x-0 top-0 z-10 ${MEDIA[variant]} ${isWide ? WIDE.media : ""}`.trim()}
        >
          <ClipPlayButton event={event} className="pointer-events-auto absolute bottom-1 left-2" />
        </div>
      )}
      {showSave && (
        // After the text in the DOM (so it follows the card's link in tab order), over the photo's corner on screen.
        <SaveButton
          event={{ id: event.id, title: event.title, slug: event.slug }}
          variant="overlay"
          className="absolute top-1 right-1 z-10"
        />
      )}
      {/* The foot: mt-auto pins it to the bottom of an equal-height card, so the price and the
          button line up across a rail or grid row. Not z-10 itself: a tap on the price still
          opens the event; only the button and the organiser link sit above the card's link. */}
      <div data-card-foot="" className="mt-auto flex flex-col pt-3">
        <CardPrice id={ids.price} event={event} now={now} className={`${SMALL} ${PRICE_BOX[variant]}`.trim()} />
        {hasCta ? (
          <QuickBuyLink event={event} now={now} narrow={variant === "grid"} className="relative z-10 pt-2" />
        ) : (
          // No ticket action (none on sale yet, or ended): the button's room stays, so this
          // card's price sits level with its neighbours'.
          <div aria-hidden="true" data-cta-placeholder="" className="pt-2">
            <div className="min-h-11 sm:min-h-10" />
          </div>
        )}
        {organiserHref ? (
          <Link
            href={organiserHref}
            className="relative z-10 inline-flex min-h-11 max-w-full items-center self-start text-sm text-muted underline underline-offset-4 hover:text-foreground"
          >
            {/* A long name wraps to a second line, then is cut short. */}
            <span className="line-clamp-2 min-w-0 break-words">By {event.organiserName}</span>
          </Link>
        ) : (
          showOrganiserRow &&
          event.organiserName && (
            // No profile to link to: the name as plain text, in the same row, so the cards' feet match.
            <p className="flex min-h-11 max-w-full items-center text-sm text-muted">
              <span className="line-clamp-2 min-w-0 break-words">By {event.organiserName}</span>
            </p>
          )
        )}
      </div>
    </div>
  );
}

/** A card's shape while events load: the variant's media box and three text bars. No shimmer. */
export function EventCardPlaceholder({ variant, className = "" }: { variant: EventCardVariant; className?: string }) {
  return (
    <div aria-hidden="true" className={`flex flex-col ${WIDTH[variant]} ${className}`.trim()}>
      <div className={`${MEDIA[variant]} rounded-card bg-surface`} />
      <div className="flex flex-col gap-2 pt-3">
        <div className="h-4 w-full bg-surface" />
        <div className="h-3 w-24 max-w-full bg-surface" />
        <div className="h-3 w-32 max-w-full bg-surface" />
      </div>
    </div>
  );
}
