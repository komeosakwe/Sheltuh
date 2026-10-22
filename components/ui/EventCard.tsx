import Link from "next/link";
import { useId } from "react";
import EventArt from "@/components/EventArt";
import SaveButton from "@/components/favourites/SaveButton";
import QuickBuyLink from "@/components/QuickBuyLink";
import CardPrice from "@/components/ui/CardPrice";
import GoingStack from "@/components/ui/GoingStack";
import { isApiConfigured } from "@/lib/api/client";
import { cardCta, cardDateLabel, cardGoing, categoryLabel, placeLabel, signalLabel } from "@/lib/event-card";
import type { TrendingSignal } from "@/lib/home-sections";
import { organiserProfileHref } from "@/lib/sample-organisers";
import type { SheltuhEvent } from "@/lib/types";

export type EventCardVariant = "rail" | "grid";

/** Phones: a fixed-width rail item (198 / 232 / 240px at 320 / 375 / 430); from 640px it fills its grid cell. */
const WIDTH: Record<EventCardVariant, string> = {
  rail: "w-[min(62vw,15rem)] shrink-0 sm:w-full",
  grid: "w-full",
};
/**
 * 18/24 titles. The two-column phone grid (cards 134–189px wide) is 16/24 until
 * 640px: at 18px a 134px card fits about eleven characters a line, so most
 * titles would be cut at two lines.
 */
const TITLE: Record<EventCardVariant, string> = {
  rail: "text-lg leading-6",
  grid: "text-base leading-6 sm:text-lg",
};
/** Venue, price and going: 14/20 on every card, at every width. */
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
 * The media box. A phone rail card is square, so the photo and the text fit
 * one screen with the next card peeking (a 4:5 rail card ran too tall);
 * portrait posters show whole there (`fit="auto"` letterboxes them on black
 * rather than cropping). Everywhere else, 4:5.
 */
const MEDIA: Record<EventCardVariant, string> = {
  rail: "aspect-square sm:aspect-[4/5]",
  grid: "aspect-[4/5]",
};

/**
 * The one event card (docs/design/mobile-redesign.md §6.2), image first with
 * no container: the 4:5 photo or poster (only the Save heart on it), then
 * the category, date and time, title, venue · suburb and who's going (real
 * or demo-sample, else nothing); then, pinned to the card's foot, the
 * all-inclusive price and the ticket action. `rail` is the home's sideways rails (a fixed width on phones, the
 * grid cell from 640px); `grid` is the results grids (/events, /search,
 * /saved, profiles).
 *
 * The whole card opens the event: the title's link stretches over the card
 * (`::after`), and Save, the ticket action and the organiser link sit above
 * it (z-10) as siblings, so nothing interactive is nested in a link. The
 * link is named title first, then the date, place, price and going count
 * (the category line is seen, not repeated in every link's name). Tab order: the card's link, Save, the ticket action, then "By
 * {organiser}". Keyboard focus rings the whole card (the link's own ring is
 * suppressed in globals.css, only where `:has()` works).
 *
 * Sibling cards line up: a rail's or grid's cells stretch to the row's
 * height, the card is a flex column, and its foot (price, ticket action, "By
 * {organiser}") is pushed to the bottom with `mt-auto`, so the prices and
 * buttons share a line whatever the titles' lengths. Rows that only some
 * cards have keep their room in the foot (no ticket action yet: an empty
 * button-high row; a grid organiser without a profile: the name as text), so
 * nothing in the foot moves up on one card and not its neighbours.
 *
 * `signal` (Popular right now) adds one qualifier to the category line. `mode` decides the going row (default: the app's mode).
 */
export default function EventCard({
  event,
  variant,
  mode = isApiConfigured ? "live" : "demo",
  signal,
  showSave = true,
  showOrganiser = true,
  now = new Date(),
  className = "",
}: {
  event: SheltuhEvent;
  variant: EventCardVariant;
  mode?: "demo" | "live";
  signal?: TrendingSignal;
  showSave?: boolean;
  /** `grid` only: "By {organiser}", where the organiser has a profile (off on their own profile). */
  showOrganiser?: boolean;
  now?: Date;
  className?: string;
}) {
  const href = `/events/${event.slug}`;
  const external = event.ticketingMode === "external";
  const qualifier = signal ? signalLabel(signal, external) : null;
  const category = [categoryLabel(event), qualifier].filter(Boolean).join(" · ");
  const date = cardDateLabel(event, now);
  const place = placeLabel(event);
  const going = cardGoing(event, mode, signal);
  const showOrganiserRow = variant === "grid" && showOrganiser;
  const organiserHref = showOrganiserRow ? organiserProfileHref(event) : null;
  const hasCta = cardCta(event, now) !== null;

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
      className={`group/card relative flex min-w-0 flex-col has-[[data-card-link]:focus-visible]:rounded-card has-[[data-card-link]:focus-visible]:outline-2 has-[[data-card-link]:focus-visible]:outline-offset-4 has-[[data-card-link]:focus-visible]:outline-foreground motion-safe:transition-transform motion-safe:duration-150 motion-safe:has-[[data-card-link]:active]:scale-[0.98] ${WIDTH[variant]} ${className}`.trim()}
    >
      <div className="relative overflow-hidden rounded-card">
        <EventArt
          poster={event.poster}
          imageUrl={event.imageUrl}
          title={event.title}
          fit={variant === "rail" ? "auto" : "cover"}
          className={`${MEDIA[variant]} w-full motion-safe:transition-transform motion-safe:duration-300 motion-safe:ease-out motion-safe:group-hover/card:scale-[1.03]`}
        />
      </div>
      {/* 8px between the lines (category, date, title, place, going): room to read each one. */}
      <div className="flex min-w-0 flex-col gap-2 pt-3">
        <p className="eyebrow truncate text-muted">{category}</p>
        <p id={ids.date} className="meta">
          {"running" in date ? (
            date.running
          ) : (
            // Each part stays whole: a narrow card wraps between them, never inside "7:00 pm",
            // and the separator goes down with the time, so no line ends on "·".
            <>
              <span className="whitespace-nowrap">{date.date}</span>{" "}
              <span className="whitespace-nowrap">· {date.time}</span>
            </>
          )}
        </p>
        {/* The heading is named by the title alone (its link's name is the whole card's). */}
        <h3
          aria-labelledby={ids.title}
          className={`line-clamp-2 font-sans font-semibold tracking-[-0.01em] break-words normal-case ${TITLE[variant]}`}
        >
          <Link
            href={href}
            data-card-link=""
            aria-labelledby={labelledBy}
            className="underline-offset-4 group-hover/card:underline after:absolute after:inset-0 after:z-0 after:content-['']"
          >
            <span id={ids.title}>{event.title}</span>
          </Link>
        </h3>
        {place && (
          // Two lines at most, so a narrow card shows the suburb rather than cutting it off.
          <p id={ids.place} className={`line-clamp-2 break-words text-muted ${SMALL}`}>
            {place}
          </p>
        )}
        {going && (
          <div id={ids.going}>
            <GoingStack count={going.count} initials={going.initials} textClassName={SMALL} />
          </div>
        )}
      </div>
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
          <QuickBuyLink event={event} now={now} narrow={variant === "grid"} className="relative z-10 pt-3" />
        ) : (
          // No ticket action (none on sale yet, or ended): the button's room stays, so this
          // card's price sits level with its neighbours'.
          <div aria-hidden="true" data-cta-placeholder="" className="pt-3">
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

/** A card's shape while events load: the variant's media box and four text bars. No shimmer. */
export function EventCardPlaceholder({ variant, className = "" }: { variant: EventCardVariant; className?: string }) {
  return (
    <div aria-hidden="true" className={`flex flex-col ${WIDTH[variant]} ${className}`.trim()}>
      <div className={`${MEDIA[variant]} rounded-card bg-surface`} />
      <div className="flex flex-col gap-2 pt-3">
        <div className="h-3 w-16 max-w-full bg-surface" />
        <div className="h-3 w-24 max-w-full bg-surface" />
        <div className="h-4 w-full bg-surface" />
        <div className="h-3 w-32 max-w-full bg-surface" />
      </div>
    </div>
  );
}
