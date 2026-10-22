import Link from "next/link";
import { useId } from "react";
import EventArt from "@/components/EventArt";
import SaveButton from "@/components/favourites/SaveButton";
import QuickBuyLink from "@/components/QuickBuyLink";
import CardPrice from "@/components/ui/CardPrice";
import GoingStack from "@/components/ui/GoingStack";
import { isApiConfigured } from "@/lib/api/client";
import { cardDateLabel, cardGoing, categoryLabel, placeLabel, signalLabel } from "@/lib/event-card";
import type { TrendingSignal } from "@/lib/home-sections";
import { organiserProfileHref } from "@/lib/sample-organisers";
import type { SheltuhEvent } from "@/lib/types";

export type EventCardVariant = "rail" | "grid";

/** Phones: a fixed-width rail item (198 / 232 / 240px at 320 / 375 / 430); from 640px it fills its grid cell. */
const WIDTH: Record<EventCardVariant, string> = {
  rail: "w-[min(62vw,15rem)] shrink-0 sm:w-full",
  grid: "w-full",
};
const TITLE: Record<EventCardVariant, string> = {
  rail: "text-base leading-[1.375rem]",
  grid: "text-sm leading-5 sm:text-base sm:leading-[1.375rem]",
};
/** Venue, price and going. */
const SMALL: Record<EventCardVariant, string> = {
  rail: "text-sm leading-5",
  grid: "text-xs leading-4 sm:text-sm sm:leading-5",
};

/**
 * The one event card (docs/design/mobile-redesign.md §6.2), image first with
 * no container: the 4:5 photo or poster (only the Save heart on it), then
 * the category, date and time, title, venue · suburb, the all-inclusive
 * price, who's going (real or demo-sample, else nothing), then the ticket
 * action. `rail` is the home's sideways rails (a fixed width on phones, the
 * grid cell from 640px); `grid` is the results grids (/events, /search,
 * /saved, profiles).
 *
 * The whole card opens the event: the title's link stretches over the card
 * (`::after`), and Save, the ticket action and the organiser link sit above
 * it (z-10) as siblings, so nothing interactive is nested in a link. The
 * link is named title first, then the date, place, price, category line and
 * going count. Tab order: the card's link, Save, the ticket action, then "By
 * {organiser}". Keyboard focus rings the whole card (the link's own ring is
 * suppressed in globals.css, only where `:has()` works).
 *
 * `signal` (Trending) and `badge` (Free & low-cost) add one qualifier to the
 * category line. `mode` decides the going row (default: the app's mode).
 */
export default function EventCard({
  event,
  variant,
  mode = isApiConfigured ? "live" : "demo",
  signal,
  badge,
  showSave = true,
  showOrganiser = true,
  now = new Date(),
  className = "",
}: {
  event: SheltuhEvent;
  variant: EventCardVariant;
  mode?: "demo" | "live";
  signal?: TrendingSignal;
  badge?: "free" | "low-cost";
  showSave?: boolean;
  /** `grid` only: "By {organiser}", where the organiser has a profile (off on their own profile). */
  showOrganiser?: boolean;
  now?: Date;
  className?: string;
}) {
  const href = `/events/${event.slug}`;
  const external = event.ticketingMode === "external";
  const qualifier = signal ? signalLabel(signal, external) : badge ? (badge === "free" ? "Free" : "Under A$20") : null;
  const category = [categoryLabel(event), qualifier].filter(Boolean).join(" · ");
  const date = cardDateLabel(event, now);
  const place = placeLabel(event);
  const going = cardGoing(event, mode, signal);
  const organiserHref = variant === "grid" && showOrganiser ? organiserProfileHref(event) : null;

  const id = useId();
  const ids = {
    title: `${id}-title`,
    date: `${id}-date`,
    place: `${id}-place`,
    price: `${id}-price`,
    category: `${id}-category`,
    going: `${id}-going`,
  };
  const labelledBy = [ids.title, ids.date, place ? ids.place : null, ids.price, ids.category, going ? ids.going : null]
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
          className="aspect-[4/5] w-full motion-safe:transition-transform motion-safe:duration-300 motion-safe:ease-out motion-safe:group-hover/card:scale-[1.03]"
        />
      </div>
      <div className="flex min-w-0 flex-col gap-1 pt-3">
        <p id={ids.category} className="eyebrow truncate text-muted">
          {category}
        </p>
        <p id={ids.date} className="meta">
          {"running" in date ? (
            date.running
          ) : (
            // Each part stays whole: a narrow card wraps between them, never inside "7:00 pm".
            <>
              <span className="whitespace-nowrap">{date.date}</span> ·{" "}
              <span className="whitespace-nowrap">{date.time}</span>
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
          <p id={ids.place} className={`truncate text-muted ${SMALL[variant]}`}>
            {place}
          </p>
        )}
        <CardPrice id={ids.price} event={event} now={now} className={SMALL[variant]} />
        {going && (
          <div id={ids.going} className="mt-1">
            <GoingStack count={going.count} initials={going.initials} textClassName={SMALL[variant]} />
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
      {/* mt-auto lines the buttons up along a grid row; pt-3 keeps them clear of the text. */}
      <QuickBuyLink event={event} now={now} narrow={variant === "grid"} className="relative z-10 mt-auto pt-3" />
      {organiserHref && (
        <Link
          href={organiserHref}
          className="relative z-10 inline-flex min-h-11 max-w-full items-center self-start text-sm text-muted underline underline-offset-4 hover:text-foreground"
        >
          {/* A long name wraps to a second line, then is cut short. */}
          <span className="line-clamp-2 min-w-0 break-words">By {event.organiserName}</span>
        </Link>
      )}
    </div>
  );
}

/** A card's shape while events load: 4:5 media and four text bars. No shimmer. */
export function EventCardPlaceholder({ variant, className = "" }: { variant: EventCardVariant; className?: string }) {
  return (
    <div aria-hidden="true" className={`flex flex-col ${WIDTH[variant]} ${className}`.trim()}>
      <div className="aspect-[4/5] rounded-card bg-surface" />
      <div className="flex flex-col gap-2 pt-3">
        <div className="h-3 w-16 max-w-full bg-surface" />
        <div className="h-3 w-24 max-w-full bg-surface" />
        <div className="h-4 w-full bg-surface" />
        <div className="h-3 w-32 max-w-full bg-surface" />
      </div>
    </div>
  );
}
