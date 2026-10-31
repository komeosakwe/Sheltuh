import Link from "next/link";
import { Suspense, type ReactNode } from "react";
import AddToCalendar from "@/components/AddToCalendar";
import EventViewBeacon from "@/components/analytics/EventViewBeacon";
import EventArt from "@/components/EventArt";
import EventLocation from "@/components/events/EventLocation";
import ClipPlayButton from "@/components/events/ClipPlayButton";
import ExternalTicketLink from "@/components/ExternalTicketLink";
import OrganiserLogo from "@/components/organisers/OrganiserLogo";
import SaveButton from "@/components/favourites/SaveButton";
import { CalendarIcon, ExternalIcon, PinIcon } from "@/components/home/icons";
import SaveOnReturn from "@/components/favourites/SaveOnReturn";
import SeatedTicketsPanel from "@/components/seating/SeatedTicketsPanel";
import ShareButton from "@/components/ShareButton";
import TicketSelector from "@/components/TicketSelector";
import TicketsHashFocus from "@/components/TicketsHashFocus";
import BackLink from "@/components/ui/BackLink";
import { buttonClass } from "@/components/ui/Button";
import { Panel } from "@/components/ui/Section";
import ExternalGoing from "@/components/ExternalGoing";
import WhosGoing from "@/components/WhosGoing";
import { WhosGoingProvider } from "@/components/whos-going/WhosGoingProvider";
import type { PreviewMissing } from "@/components/dashboard/editor/preview-event";
import WhosGoingSummaryLink from "@/components/whos-going/WhosGoingSummaryLink";
import { SUPPORT_EMAIL } from "@/lib/contact";
import { isSafeTicketUrl, reportEventHref } from "@/lib/event-url";
import { eventZone, formatEventDateShort, formatEventDateTimeRange, formatEventTime, formatTimeZoneLabel, zoneSuffix } from "@/lib/format";
import { directionsHref } from "@/lib/maps";
import { externalPriceFromLabel, formatFeedPriceParts, isSoldOut } from "@/lib/pricing";
import { goesToSeatPage, quickBuyLabel } from "@/lib/quick-buy";
import { DEFAULT_REFUND_POLICY, REFUND_ACL_STATEMENT, refundTermsLine } from "@/lib/refund-policy";
import { organiserProfileHref } from "@/lib/sample-organisers";
import { siteOrigin } from "@/lib/share-metadata";
import { EVENT_CATEGORIES, type SheltuhEvent } from "@/lib/types";

/**
 * The event editor's live preview (components/dashboard/editor/PreviewFrame.tsx): the page as a draft
 * would look, with a muted stand-in for what the draft doesn't have yet (`missing`). Not a live
 * page, so it has none of the page's own behaviour: no view count, no save-on-return, no hash focus,
 * no Who's Going, no back link, no report line, no sticky buy bar, no outbound click count and no
 * map. The editor makes the whole preview `inert` too, so nothing in it is focusable or clickable.
 */
export interface EventPreview {
  missing: PreviewMissing;
}

/** Who's Going's one shared load, around the page; none in a preview (it has no Who's Going at all). */
function GoingScope({ event, preview, children }: { event: SheltuhEvent; preview: boolean; children: ReactNode }) {
  if (preview) return <>{children}</>;
  return (
    <WhosGoingProvider
      event={{
        id: event.id,
        slug: event.slug,
        title: event.title,
        organiserId: event.organiserId,
        ticketingMode: event.ticketingMode,
        startsAt: event.startsAt,
        endsAt: event.endsAt,
      }}
    >
      {children}
    </WhosGoingProvider>
  );
}

/** A preview's stand-in for what the draft hasn't got yet. */
function Placeholder({ children }: { children: ReactNode }) {
  return <span className="text-muted">{children}</span>;
}

/** One fact under the title: a 20px icon (with the fact's name for screen readers), then the fact. */
// Each term column is the organiser avatar's width, so every row's text starts on the same line.
const factRowClass = "flex gap-3 [&>dt]:flex [&>dt]:w-8 [&>dt]:shrink-0 [&>dt]:justify-center";
const factIconClass = "mt-0.5 size-5 shrink-0 text-muted";

/** A time in a date range ("10:00 am", "midnight"): the capture keeps it in `split`'s output. */
const TIME_PATTERN = /(\d{1,2}:\d{2} [ap]m|midnight)/;

/** An ended event, at the top of the Tickets panel (there is no buy bar then). */
const ENDED_TEXT = "This event has ended.";

/**
 * Refunds after Location (owner, 30 Oct 2026; docs/design/mobile-redesign.md §6.5), only
 * where a paid purchase on Sheltüh is possible: an external event's own site
 * has its terms, and nothing is refunded on a free-only or ended event. The
 * event's own refund policy (lib/refund-policy.ts; the default for a demo
 * event), the Australian Consumer Law line that always applies, then the
 * existing Purchase Terms and refund pages. (The age restriction is in Good
 * to know, once.)
 */
function BookingInfo({ event }: { event: SheltuhEvent }) {
  const linkClass = "underline underline-offset-4 hover:decoration-2";
  // Against the start: the date refunds close, or that they have (lib/refund-policy.ts).
  const policy = refundTermsLine(event.refundPolicy ?? DEFAULT_REFUND_POLICY, event.refundDays, event.startsAt, {
    timeZone: eventZone(event.timeZone),
  });
  return (
    <dl data-booking-info="" className="mt-4 flex flex-col gap-2 border-t border-surface-border pt-4 text-sm leading-5">
      <div>
        <dt className="eyebrow text-muted">Refunds</dt>
        <dd className="mt-1 flex flex-col gap-1">
          {policy && (
            <p data-refund-policy="" className="font-semibold">
              {policy}
            </p>
          )}
          {policy && <p className="text-sm text-muted">{REFUND_ACL_STATEMENT}</p>}
          <p>
            Refund conditions are in our{" "}
            <Link href="/purchase-terms" className={linkClass}>
              Purchase Terms
            </Link>
            . To ask for one, use{" "}
            <Link href="/refunds" className={linkClass}>
              Request a refund
            </Link>
            .
          </p>
        </dd>
      </div>
    </dl>
  );
}

/**
 * "Fri 25 Sep, 8:00 pm – Sat 26 Sep, midnight": the shared range, in the
 * event's zone (labelled below it), with midnight said in words (people
 * misread "12:00 am"). The formatter always writes the hour as "12:00 am"
 * for midnight, so this is a whole-word swap.
 */
function whenLabel(startsAt: string, endsAt: string | undefined, timeZone: string): string {
  return formatEventDateTimeRange(startsAt, endsAt, timeZone).replace(/\b12:00 am\b/g, "midnight");
}

/**
 * The event page (docs/design/brand-direction-one.md §6.10; order from
 * docs/design/mobile-redesign.md, Refinement 22 Oct 2026). In reading order:
 * the photo, then the title (sentence case, title-lg), then one block of
 * facts (when, with the time zone and Add to calendar; where, the address
 * linked to directions; the organiser, linked to their profile), the going count, and one
 * secondary row with Save and Share (the page's only Save). Then the
 * tickets, then About, Who's Going, Location (the venue, a small map and
 * Google Maps and Apple Maps links), Refunds and Good to know. On phones that's
 * one column; from 1024px the tickets are the right-hand column (sticky),
 * beside the photo, title and facts, and the rest below those. Below
 * 1024px a compact buy bar sticks to the bottom (price and the one ticket
 * action, no Save) until it settles under the content at the page's end.
 *
 * An external event (tickets sold on another site) has a "Get tickets"
 * link (never naming the site) instead of the ticket selector, and no price or Who's
 * Going (docs/architecture.md, "External ticketing"). In the demo, the
 * page's sample-data disclosure is the banner at the top (DemoBanner); the
 * ticket panel says nothing can be booked.
 */
export default function EventDetailsView({
  event,
  demo,
  preview,
}: {
  event: SheltuhEvent;
  demo: boolean;
  /** The editor's live preview (see EventPreview): the page without its live behaviour. */
  preview?: EventPreview;
}) {
  const missing = preview?.missing;
  const buyBarPosition = preview ? "static" : "sticky";
  const categoryLabel =
    EVENT_CATEGORIES.find((category) => category.value === event.category)?.label ?? event.category;

  const goodToKnow = [
    { label: "Who it’s for", value: event.audience },
    { label: "What to expect", value: event.whatToExpect },
    { label: "Age restriction", value: event.ageRestriction },
    { label: "Accessibility", value: event.accessibility },
  ].filter((item) => item.value);

  const external = event.ticketingMode === "external";
  // Defence in depth: only an https ticket link is ever shown (or the buy bar with it).
  const ticketUrl = external && isSafeTicketUrl(event.externalTicketUrl) ? event.externalTicketUrl : undefined;
  // An external event has no Sheltüh price; the organiser's own "From A$x", if they gave one, shows apart.
  const price = external ? null : formatFeedPriceParts(event);
  const externalFrom = externalPriceFromLabel(event);
  // The event's own zone (Melbourne when it has none), named under the time.
  const zone = eventZone(event.timeZone);
  const when = whenLabel(event.startsAt, event.endsAt, zone);
  // The buy bar's action: to #tickets, where a sold-out event has its waitlist
  // (§6.10, §6.11). Once an event has ended there's nothing to buy, so there's
  // no bar (docs/design/mobile-redesign.md §6.5).
  const soldOut = isSoldOut(event);
  const ended = Date.parse(event.endsAt ?? event.startsAt) <= new Date().getTime();
  // The two buy bars below render on exactly these conditions.
  const hasBuyBar = (Boolean(price) || Boolean(ticketUrl)) && !ended;
  const buyBarLabel = quickBuyLabel(event) ?? "Buy tickets";
  const seatPage = goesToSeatPage(event) && !ended;
  // Refunds only matter where someone can pay: a paid tier, not ended (external has no Booking info at all).
  const paidPurchasePossible = !ended && event.ticketTypes.some((ticket) => ticket.priceCents > 0);
  const shareText = `${event.title} · ${formatEventDateShort(event.startsAt, zone)}, ${formatEventTime(event.startsAt, zone)}${zoneSuffix(event.timeZone, event.state)} · ${event.venueName}`;
  const saveTarget = { id: event.id, title: event.title, slug: event.slug };
  const organiserHref = organiserProfileHref(event);
  const directions = directionsHref(event);
  const address = [event.venueName, event.venueAddress].filter(Boolean).join(", ");
  const outboundLink = (className: string) => (
    <ExternalTicketLink eventId={event.id} url={ticketUrl} className={className} preview={Boolean(preview)} />
  );

  return (
    // Phones: tight above the photo, so the title, date and venue are on the first screen,
    // above the sticky buy bar (e2e/event-page.spec.ts).
    // Below lg a buy bar is last on the page and settles there at the very end: no bottom padding
    // then, so it meets the footer instead of leaving a white strip under it (owner, 30 Oct 2026).
    <div
      className={`mx-auto flex max-w-6xl flex-col gap-2 px-5 sm:gap-6 sm:px-8 sm:pt-10 ${
        hasBuyBar ? "pb-0 lg:pb-10" : "pb-12 sm:pb-10"
      }`}
    >
      {!preview && <BackLink href="/">Back to all events</BackLink>}

      {/* Live only: one cookie-free view count per session, and finishing a save
          started before signing in. Neither renders anything. */}
      {!demo && !preview && <EventViewBeacon eventId={event.id} />}
      {!preview && (
        <Suspense fallback={null}>
          <SaveOnReturn event={saveTarget} />
        </Suspense>
      )}
      {!preview && <TicketsHashFocus />}

      {/* One Who's Going load, shared by the summary link and the panel
          (always closed, with no request, for an external event). */}
      <GoingScope event={event} preview={Boolean(preview)}>
        <div className="grid grid-cols-1 gap-8 lg:grid-cols-12 lg:gap-x-14 lg:gap-y-10">
          <div className="flex flex-col gap-3 sm:gap-4 lg:col-span-7">
            {/* The photo first at every width (it's aria-hidden, so reading order is the title
                first): full-bleed 4:3 on phones, never more than 24% of the screen's height so
                the title, facts and Save/Share still fit above the buy bar (owner request, 26 Oct
                2026: e2e/event-page.spec.ts), with room to spare when the time zone's line wraps
                Add to calendar under it (a slightly wider font, as on Linux); a 3:2 rounded card from sm.
                The page's LCP image. The wrapper is the same box (full-bleed on phones), so an
                event's clip Play can sit on the photo's bottom-left, lined up with the page's text
                edge on phones (docs/design/event-clips.md §5.3); absolutely placed, so nothing shifts. */}
            <div className="relative -mx-5 sm:mx-0">
              <EventArt
                poster={event.poster}
                imageUrl={event.imageUrl}
                title={event.title}
                priority
                fit="auto"
                className="aspect-[4/3] max-h-[24svh] w-full sm:aspect-[3/2] sm:max-h-none sm:rounded-card"
              />
              <ClipPlayButton event={event} size="hero" className="absolute bottom-3 left-5 sm:left-3" />
            </div>
            <div className="flex flex-col gap-3">
              <p className="text-sm leading-5 text-muted">{categoryLabel}</p>
              <h1 className="title-lg -mt-2 max-w-[24ch] break-words">
                {missing?.title ? <Placeholder>Untitled event</Placeholder> : event.title}
              </h1>
              {/* The one date/time and venue block (no second copy further down): when, where
                  and who, each with its action. */}
              <dl data-event-facts="" className="-mt-1 flex flex-col gap-2 sm:mt-1">
                <div className={factRowClass}>
                  <dt>
                    <CalendarIcon className={factIconClass} />
                    <span className="sr-only">When</span>
                  </dt>
                  {/* Positioned: the Add to calendar menu opens from here, at the column's edge. */}
                  <dd className="relative min-w-0 pb-1 lg:pb-0">
                    <p className="text-base leading-6 font-semibold">
                      {/* Each time stays whole ("4:00 pm", never "4:00 / pm"); the rest wraps where it must,
                          so a long range fits a 320px screen. */}
                      {missing?.when ? (
                        <Placeholder>Date and time to be added</Placeholder>
                      ) : (
                        when.split(TIME_PATTERN).map((part, i) =>
                          i % 2 === 1 ? (
                            <span key={i} className="whitespace-nowrap">
                              {part}
                            </span>
                          ) : (
                            part
                          ),
                        )
                      )}
                    </p>
                    {/* The zone, then Add to calendar beside it where there's room (onto its own line
                        where there isn't, e.g. 320px; and on its own row from lg, as before). The
                        button keeps its 44px target, overlapping the lines above and below (neither
                        is a control; the row's bottom padding clears the address link) rather than
                        adding a 44px row. Its menu opens from the dd, so it stays on screen. */}
                    {!missing?.when && (
                      <div className="flex flex-wrap items-center gap-x-2">
                        <p className="text-sm leading-5 text-muted lg:basis-full">
                          {formatTimeZoneLabel(event.startsAt, zone, event.state)}
                        </p>
                        <AddToCalendar event={event} menuFromParent className="-my-3 lg:my-0" />
                      </div>
                    )}
                  </dd>
                </div>
                <div className={factRowClass}>
                  <dt>
                    <PinIcon className={factIconClass} />
                    <span className="sr-only">Where</span>
                  </dt>
                  {missing?.where ? (
                    <dd className="min-w-0 text-base leading-6">
                      <Placeholder>Venue to be added</Placeholder>
                    </dd>
                  ) : directions ? (
                    // The address itself links to directions. It opens the maps app where there is
                    // one (lib/maps.ts), in a new tab otherwise.
                    <dd className="min-w-0">
                      <a
                        href={directions}
                        target="_blank"
                        rel="noopener noreferrer"
                        data-directions=""
                        // Spelled out: it starts with the action, holds the visible address, and says
                        // where it goes and that it opens a new tab.
                        aria-label={`Get directions to ${address} (opens Google Maps in a new tab)`}
                        // The address is the link: underlined, with the "opens elsewhere" mark, and
                        // at least 44px tall so it's an easy target.
                        className="inline-block min-h-11 max-w-full text-base leading-6 break-words underline underline-offset-4 hover:decoration-2"
                      >
                        {address}
                        {/* Inline after the last word, so it stays beside the text when it wraps. */}
                        <ExternalIcon className="ml-1 inline size-4 align-[-2px]" />
                      </a>
                    </dd>
                  ) : (
                    <dd className="min-w-0 text-base leading-6 break-words">{address}</dd>
                  )}
                </div>
                <div className={factRowClass}>
                  <dt>
                    {/* Their profile mark: their logo in the avatar square, or their initials (no
                        logo, the demo, or it didn't load). Decorative and out of the tab order: the
                        name beside it is the link. */}
                    {organiserHref ? (
                      <Link href={organiserHref} aria-hidden="true" tabIndex={-1} data-organiser-avatar="" className="flex">
                        <OrganiserLogo name={event.organiserName} url={event.organiserLogoThumbUrl} size="md" fallback="initials" />
                      </Link>
                    ) : (
                      <span data-organiser-avatar="" className="flex">
                        <OrganiserLogo name={event.organiserName} url={event.organiserLogoThumbUrl} size="md" fallback="initials" />
                      </span>
                    )}
                    <span className="sr-only">Organiser</span>
                  </dt>
                  <dd className="min-w-0">
                    <p className="pt-1 text-base leading-6">
                      Organised by{" "}
                      {/* A live event's organiser profile, or in the demo the sample organiser's. */}
                      {organiserHref ? (
                        <Link href={organiserHref} className="underline underline-offset-4">
                          {event.organiserName}
                        </Link>
                      ) : (
                        event.organiserName
                      )}
                    </p>
                  </dd>
                </div>
              </dl>
              {/* Below lg Who's Going comes after the tickets, so its count is linked here too
                  (the panel is beside this from lg). No gap left behind while there is none. */}
              {!preview && (
                <div className="empty:hidden lg:hidden">
                  <WhosGoingSummaryLink />
                </div>
              )}
              {/* The one secondary row: Save (the page's only Save) and Share. */}
              <div data-event-actions="" className="-mt-1 flex flex-wrap items-center gap-2 sm:mt-0">
                <SaveButton event={saveTarget} variant="action" />
                <ShareButton slug={event.slug} title={event.title} text={shareText} />
              </div>
            </div>
          </div>

          {/* Tickets, then Who's Going: straight after the facts on phones; the right-hand column
              from lg (sticky, unstuck while Who's Going is expanded so a tall column can't hide
              the tickets). */}
          {/* Sticky beside the content from lg, but never taller than the window: a long ticket panel
              (several tiers, Support Sheltüh) scrolls inside it, so Checkout is always reachable. */}
          <aside className="flex flex-col gap-8 lg:col-span-5 lg:col-start-8 lg:row-span-2 lg:row-start-1 lg:sticky lg:top-24 lg:self-start lg:max-h-[calc(100dvh-7rem)] lg:overflow-y-auto lg:overscroll-contain lg:p-1 lg:-m-1">
            {/* The buy bar's target: focusable, so jumping here moves keyboard and
                screen-reader focus to the tickets too, with the global focus-visible
                ring around the section to show where you've landed. */}
            <div id="tickets" tabIndex={-1} className="rounded-card">
              <Panel title="Tickets" titleId="tickets-title">
                {external ? (
                  <div className="flex flex-col gap-4 rounded-card border border-foreground bg-card p-4 sm:p-5">
                    {event.externalFree && <p className="text-base leading-6 font-semibold">Free entry</p>}
                    {externalFrom && (
                      <div>
                        <p className="text-base leading-6 font-semibold tabular-nums">{externalFrom}</p>
                        <p className="text-sm text-muted">Price set by the organiser.</p>
                      </div>
                    )}
                    {ticketUrl ? (
                      outboundLink(buttonClass("solid", "lg", "w-full"))
                    ) : (
                      <p className="text-sm text-foreground">The ticket link isn&rsquo;t available right now.</p>
                    )}
                  </div>
                ) : (
                  <>
                    {/* Ended: said first. A sold-out event keeps its tiers and the closed waitlist
                        below it; anything else has nothing to choose. */}
                    {ended && <p className="text-sm font-semibold">{ENDED_TEXT}</p>}
                    {ended && !soldOut ? null : event.ticketTypes.length === 0 ? (
                      // Nothing on sale yet: no fee to explain and nothing to select.
                      <p className="text-sm text-muted">Tickets coming soon.</p>
                    ) : event.seating ? (
                      // Reserved seating: tiers are chosen on the seat page, never as quantities here.
                      <div className={ended ? "mt-4" : undefined}>
                        <SeatedTicketsPanel event={event} demo={demo} />
                      </div>
                    ) : (
                      <div className={ended ? "mt-4" : undefined}>
                        <TicketSelector event={event} />
                      </div>
                    )}
                  </>
                )}
              </Panel>
            </div>

          </aside>

          <div className="flex flex-col gap-8 lg:col-span-7 lg:row-start-2">
            <Panel title="About this event" titleId="about-title">
              <p className="max-w-2xl text-base leading-7">
                {missing?.description ? <Placeholder>Add a description</Placeholder> : event.description}
              </p>
            </Panel>

            {/* Owner's order (30 Oct 2026): About, Who's Going, Location, Refunds, then Good to know. */}
            {!external && !preview && <WhosGoing />}
            {external && !preview && <ExternalGoing event={event} />}

            {/* Where it is, with a small map and the Google Maps and Apple Maps links (none without a venue or suburb). */}
            <EventLocation event={event} map={!preview} />

            {paidPurchasePossible && <BookingInfo event={event} />}

            {goodToKnow.length > 0 && (
              <Panel title="Good to know" titleId="good-to-know-title">
                <dl className="flex flex-col gap-5 text-sm leading-6">
                  {goodToKnow.map((item) => (
                    <div key={item.label} className="grid grid-cols-1 gap-2 sm:grid-cols-[10rem_1fr]">
                      <dt className="eyebrow text-muted">{item.label}</dt>
                      <dd>{item.value}</dd>
                    </div>
                  ))}
                </dl>
                <p className="mt-4 text-sm leading-5 text-muted">As provided by the organiser.</p>
              </Panel>
            )}

            {/* Events go live without a check first: anyone can tell Sheltüh about one (by email, for now). */}
            {!preview && (
              <p className="text-sm text-muted">
                <a
                  href={reportEventHref(event.title, event.slug, siteOrigin(), SUPPORT_EMAIL)}
                  className="inline-flex min-h-11 items-center text-foreground underline underline-offset-4"
                >
                  Report this event
                </a>
              </p>
            )}
          </div>

          {/* Buy bar, below lg only, on an ink surface: compact (the price and the one ticket
              action; Save is in the row under the title). Sticky to the bottom of the viewport
              all the way down the page, and last in the grid, so it settles under the content at
              the very end rather than covering it. Focus scrolls clear of it (globals.css pads
              by --buybar-h), and its bottom padding clears the home indicator. The page
              wrapper's padding is what -mx bleeds it across. Once the event has ended there's no
              bar at all: nothing's for sale, and the Tickets panel says so. In Dark it gains a
              1px white top rule, so the black bar doesn't merge with the black page. */}
          {price && !ended && (
            <div
              data-buy-bar
              data-surface="ink"
              className={`${buyBarPosition} bottom-0 z-20 -mx-5 flex min-h-16 items-center justify-between gap-4 px-5 pt-2 pb-[calc(0.5rem+env(safe-area-inset-bottom))] sm:-mx-8 sm:px-8 lg:hidden dark:border-t dark:border-foreground`}
            >
              <div className="min-w-0">
                <p className="text-base leading-5 font-semibold tabular-nums">{price.amount}</p>
                {price.note && <p className="text-sm leading-5 text-muted">{price.note}</p>}
              </div>
              {seatPage ? (
                // A seated event's buy bar goes straight to its seat page (manager decision 2,
                // docs/design/seating.md).
                <Link href={`/events/${event.slug}/seats`} className={buttonClass("signal", "lg", "shrink-0 px-5 sm:px-7")}>
                  {buyBarLabel}
                </Link>
              ) : (
                <a href="#tickets" className={buttonClass("signal", "lg", "shrink-0 px-5 sm:px-7")}>
                  {/* "Buy tickets", or "Get free tickets" when every tier is free, in demo
                      mode too (owner, 21 Oct 2026); "Join waitlist" when sold out. */}
                  {buyBarLabel}
                </a>
              )}
            </div>
          )}
          {/* An external event's buy bar: the organiser's price if given (never the site's name), and
              the outbound link itself, not a jump to #tickets. None once it has ended. */}
          {ticketUrl && !ended && (
            <div
              data-buy-bar
              data-surface="ink"
              className={`${buyBarPosition} bottom-0 z-20 -mx-5 flex min-h-16 items-center justify-between gap-4 px-5 pt-2 pb-[calc(0.5rem+env(safe-area-inset-bottom))] sm:-mx-8 sm:px-8 lg:hidden dark:border-t dark:border-foreground`}
            >
              <div className="min-w-0">
                {/* Never the ticket site's name (owner, 31 Oct 2026): buyers go through our link. */}
                {event.externalFree ? (
                  <p className="text-base leading-5 font-semibold">Free</p>
                ) : externalFrom ? (
                  <p className="text-base leading-5 font-semibold tabular-nums">{externalFrom}</p>
                ) : null}
              </div>
              <ExternalTicketLink
                eventId={event.id}
                url={ticketUrl}
                preview={Boolean(preview)}
                className={buttonClass("signal", "lg", "shrink-0 px-5 sm:px-7")}
              />
            </div>
          )}
        </div>
      </GoingScope>
    </div>
  );
}
