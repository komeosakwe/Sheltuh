import Link from "next/link";
import { useId } from "react";
import EventArt from "@/components/EventArt";
import SaveButton from "@/components/favourites/SaveButton";
import QuickBuyLink from "@/components/QuickBuyLink";
import { firstSentence, type TrendingSignal } from "@/lib/home-sections";
import { formatDateBadge, formatEventDateShort, formatEventTime } from "@/lib/format";
import { EVENT_CATEGORIES, type SheltuhEvent } from "@/lib/types";
import CardPrice from "./CardPrice";
import GoingStack from "./GoingStack";
import { demoGoing } from "./going";

export type HomeCardVariant = "standard" | "wide" | "compact";

const categoryLabel = (event: SheltuhEvent) =>
  EVENT_CATEGORIES.find((category) => category.value === event.category)?.label ?? event.category;

/** "Popular this week" stands in for a going count on an external event, which has no Who's Going. */
export function trendingChipText(signal: TrendingSignal, external: boolean): string {
  if (signal.kind === "going") return external ? "Popular this week" : `${signal.count} going`;
  return signal.kind === "just-announced" ? "Just announced" : "Popular this week";
}

const linkClass =
  "group flex flex-col gap-3 motion-safe:transition-transform motion-safe:duration-150 motion-safe:active:scale-[0.98]";
/** The photo grows a little under a pointer (Tailwind's hover variants only apply where hover exists). */
const mediaArtClass = "motion-safe:transition-transform motion-safe:duration-300 motion-safe:ease-out motion-safe:group-hover:scale-[1.03]";
const titleClass =
  "font-sans normal-case tracking-[-0.01em] font-semibold group-hover:underline underline-offset-4";
const chipClass = "eyebrow absolute rounded-badge px-2 py-0.5";
/** "Sat 24 Oct · 7:30 pm", each part kept whole: a narrow card wraps between them, never inside one. */
const dateLine = (event: SheltuhEvent) => (
  <>
    <span className="whitespace-nowrap">{formatEventDateShort(event.startsAt)}</span> ·{" "}
    <span className="whitespace-nowrap">{formatEventTime(event.startsAt)}</span>
  </>
);
const place = (event: SheltuhEvent) => [event.venueName, event.suburb].filter(Boolean).join(" · ");

/**
 * The home's event card (docs/design/brand-direction-one.md §6.5): image
 * first with no container, the text on the page beneath it. `standard`
 * (Trending, Coming up), `wide` (This weekend), `compact` (Free & low-cost).
 * Below 640px each is a fixed-width rail item; from 640px it fills its grid
 * cell. The Save heart and the quick-buy link are siblings of the card's
 * link, never inside it.
 *
 * Going counts are real or absent: demo cards show the sample count; live
 * cards show none until the list API carries one (no request per card); an
 * external event never shows one (no Who's Going there).
 *
 * The link's name starts with the title, then the date, place, price, chip
 * or badge and going count (aria-labelledby). The wide card's date badge
 * repeats the date line and is hidden; its description stays out of the name.
 */
export default function HomeEventCard({
  event,
  variant,
  mode,
  badge,
  signal,
}: {
  event: SheltuhEvent;
  variant: HomeCardVariant;
  mode: "demo" | "live";
  /** Free & low-cost only. */
  badge?: "free" | "low-cost";
  /** Trending only: replaces the category chip, and the going row. */
  signal?: TrendingSignal;
}) {
  const href = `/events/${event.slug}`;
  const external = event.ticketingMode === "external";
  const going = mode === "demo" && !external && !signal ? demoGoing(event.id) : null;
  const art = { poster: event.poster, imageUrl: event.imageUrl, title: event.title };
  const target = { id: event.id, title: event.title, slug: event.slug };
  const id = useId();
  const ids = {
    title: `${id}-title`,
    date: `${id}-date`,
    place: `${id}-place`,
    price: `${id}-price`,
    chip: `${id}-chip`,
    going: `${id}-going`,
  };
  const hasChip = variant === "compact" ? Boolean(badge) : true;
  const labelledBy = [ids.title, ids.date, ids.place, ids.price, hasChip ? ids.chip : null, going ? ids.going : null]
    .filter(Boolean)
    .join(" ");

  if (variant === "compact") {
    return (
      <div className="relative flex w-[78vw] max-w-75 flex-col border-t border-surface-border pt-3 sm:w-full sm:max-w-none">
        <Link
          href={href}
          aria-labelledby={labelledBy}
          className={`${linkClass} grid grid-cols-[6rem_1fr] sm:grid-cols-[7rem_1fr]`}
        >
          <div className="overflow-hidden rounded-control">
            <EventArt {...art} className={`aspect-square ${mediaArtClass}`} />
          </div>
          <div className="flex min-w-0 flex-col gap-1 pr-11">
            {badge && (
              <span
                id={ids.chip}
                className={`eyebrow self-start rounded-badge px-2 py-0.5 ${
                  badge === "free" ? "border border-foreground bg-foreground text-background" : "border border-foreground bg-card"
                }`}
              >
                {badge === "free" ? "Free" : "Under A$20"}
              </span>
            )}
            <p id={ids.date} className="meta">
              {dateLine(event)}
            </p>
            <h3 id={ids.title} className={`${titleClass} line-clamp-2 text-sm leading-5 sm:text-base sm:leading-[1.375rem]`}>
              {event.title}
            </h3>
            <p id={ids.place} className="truncate text-xs leading-4 text-muted sm:text-sm sm:leading-5">
              {place(event)}
            </p>
            <CardPrice id={ids.price} event={event} className="text-xs leading-4 sm:text-sm sm:leading-5" />
          </div>
        </Link>
        <SaveButton event={target} variant="plain" className="absolute right-0 top-3" />
        {/* Indented to the text column: the 6rem (7rem) thumbnail plus the 0.75rem gap. mt-auto lines the rows up in a grid. */}
        <QuickBuyLink event={event} fullWidthOnPhones className="mt-auto pt-3 pl-27 sm:pl-31" />
      </div>
    );
  }

  const wide = variant === "wide";
  const date = wide ? formatDateBadge(event.startsAt, event.endsAt) : null;
  return (
    <div
      className={`relative flex flex-col sm:w-full sm:max-w-none ${wide ? "w-[80vw] max-w-80" : "w-[62vw] max-w-60"}`}
    >
      <Link href={href} aria-labelledby={labelledBy} className={linkClass}>
        {/* Chips and badges sit beside the art, not inside it: the art is aria-hidden, they're content. */}
        <div className="relative overflow-hidden rounded-card">
          <EventArt {...art} className={`${wide ? "aspect-[3/2]" : "aspect-[4/3]"} ${mediaArtClass}`} />
          {date && (
            <p
              aria-hidden="true"
              className="absolute left-2 top-2 flex flex-col items-center rounded-badge bg-cream px-2 py-1 text-center text-ink"
            >
              <span className="text-sm leading-4 font-bold">{date.range}</span>{" "}
              <span className="eyebrow text-[0.625rem] leading-3">{date.month}</span>
            </p>
          )}
          {signal ? (
            <span id={ids.chip} className={`${chipClass} left-2 top-2 bg-foreground text-background`}>
              {trendingChipText(signal, external)}
            </span>
          ) : (
            <span id={ids.chip} className={`${chipClass} bg-cream text-ink ${wide ? "bottom-2 left-2" : "left-2 top-2"}`}>
              {categoryLabel(event)}
            </span>
          )}
        </div>
        <div className="flex flex-col gap-1">
          <p id={ids.date} className="meta">
            {dateLine(event)}
          </p>
          <h3
            id={ids.title}
            className={`${titleClass} line-clamp-2 ${
              wide ? "text-base leading-[1.375rem]" : "text-sm leading-5 sm:text-base sm:leading-[1.375rem]"
            }`}
          >
            {event.title}
          </h3>
          <p id={ids.place} className="truncate text-xs leading-4 text-muted sm:text-sm sm:leading-5">
            {place(event)}
          </p>
          {wide && <p className="line-clamp-2 text-sm leading-5 text-muted">{firstSentence(event.description)}</p>}
          <CardPrice id={ids.price} event={event} className="text-xs leading-4 sm:text-sm sm:leading-5" />
          {going && (
            <div id={ids.going} className="mt-1">
              <GoingStack count={going.count} initials={going.initials} />
            </div>
          )}
        </div>
      </Link>
      <SaveButton event={target} variant="overlay" className="absolute right-1 top-1" />
      {/* mt-auto lines the buttons up along a grid row; pt-3 keeps them clear of the text. */}
      <QuickBuyLink event={event} className="mt-auto pt-3" />
    </div>
  );
}

/** A card's shape while events load: media at the card's ratio and three text bars. No shimmer. */
export function HomeEventCardPlaceholder({ className = "" }: { className?: string }) {
  return (
    <div aria-hidden="true" className={`flex w-[62vw] max-w-60 flex-col gap-3 sm:w-full sm:max-w-none ${className}`.trim()}>
      <div className="aspect-[4/3] rounded-card bg-surface" />
      <div className="flex flex-col gap-2">
        <div className="h-3 w-24 bg-surface" />
        <div className="h-4 w-full bg-surface" />
        <div className="h-3 w-32 bg-surface" />
      </div>
    </div>
  );
}
