import Link from "next/link";
import { Suspense } from "react";
import AddToCalendar from "@/components/AddToCalendar";
import EventViewBeacon from "@/components/analytics/EventViewBeacon";
import EventArt from "@/components/EventArt";
import ExternalTicketLink from "@/components/ExternalTicketLink";
import SaveButton from "@/components/favourites/SaveButton";
import { ArrowRightIcon, CalendarIcon, ExternalIcon, PinIcon } from "@/components/home/icons";
import SaveOnReturn from "@/components/favourites/SaveOnReturn";
import SeatedTicketsPanel from "@/components/seating/SeatedTicketsPanel";
import ShareButton from "@/components/ShareButton";
import TicketSelector from "@/components/TicketSelector";
import TicketsHashFocus from "@/components/TicketsHashFocus";
import BackLink from "@/components/ui/BackLink";
import InitialsAvatar from "@/components/ui/InitialsAvatar";
import { buttonClass } from "@/components/ui/Button";
import { Panel } from "@/components/ui/Section";
import WhosGoing from "@/components/WhosGoing";
import { WhosGoingProvider } from "@/components/whos-going/WhosGoingProvider";
import WhosGoingSummaryLink from "@/components/whos-going/WhosGoingSummaryLink";
import { isSafeTicketUrl } from "@/lib/event-url";
import { formatEventDateShort, formatEventDateTimeRange, formatEventTime, formatTimeZoneLabel } from "@/lib/format";
import { directionsHref } from "@/lib/maps";
import { externalProviderLabel, formatFeedPriceParts, isSoldOut } from "@/lib/pricing";
import { goesToSeatPage, quickBuyLabel } from "@/lib/quick-buy";
import { organiserProfileHref } from "@/lib/sample-organisers";
import { EVENT_CATEGORIES, type SheltuhEvent } from "@/lib/types";

/** One fact under the title: a 20px icon (with the fact's name for screen readers), then the fact. */
// Each term column is the organiser avatar's width, so every row's text starts on the same line.
const factRowClass = "flex gap-3 [&>dt]:flex [&>dt]:w-8 [&>dt]:shrink-0 [&>dt]:justify-center";
const factIconClass = "mt-0.5 size-5 shrink-0 text-muted";
/** The facts' secondary actions (Get directions, More from): 44px tall, underlined. */
const factActionClass =
  "inline-flex min-h-11 items-center gap-1 text-sm leading-5 font-semibold underline underline-offset-4 hover:decoration-2";

/** A time in a date range ("10:00 am", "midnight"): the capture keeps it in `split`'s output. */
const TIME_PATTERN = /(\d{1,2}:\d{2} [ap]m|midnight)/;

/** An ended event, at the top of the Tickets panel (there is no buy bar then). */
const ENDED_TEXT = "This event has ended.";

/**
 * Refunds beside the tickets (docs/design/mobile-redesign.md §6.5), only
 * where a paid purchase on Sheltüh is possible: an external event's own site
 * has its terms, and nothing is refunded on a free-only or ended event. It
 * points at the existing Purchase Terms and refund pages and invents no
 * policy. (The age restriction is in Good to know, once.)
 */
function BookingInfo() {
  const linkClass = "underline underline-offset-4 hover:decoration-2";
  return (
    <dl data-booking-info="" className="mt-4 flex flex-col gap-2 border-t border-surface-border pt-4 text-sm leading-5">
      <div>
        <dt className="eyebrow text-muted">Refunds</dt>
        <dd className="mt-1">
          Refund conditions are in our{" "}
          <Link href="/purchase-terms" className={linkClass}>
            Purchase Terms
          </Link>
          . To ask for one, use{" "}
          <Link href="/refunds" className={linkClass}>
            Request a refund
          </Link>
          .
        </dd>
      </div>
    </dl>
  );
}

/**
 * "Fri 25 Sep, 8:00 pm – Sat 26 Sep, midnight": the shared range, with
 * midnight said in words (people misread "12:00 am"). The formatter always
 * writes the hour as "12:00 am" for midnight, so this is a whole-word swap.
 */
function whenLabel(startsAt: string, endsAt?: string): string {
  return formatEventDateTimeRange(startsAt, endsAt).replace(/\b12:00 am\b/g, "midnight");
}

/**
 * The event page (docs/design/brand-direction-one.md §6.10; order from
 * docs/design/mobile-redesign.md, Refinement 22 Oct 2026). In reading order:
 * the photo, then the title (sentence case, title-lg), then one block of
 * facts (when, with the time zone and Add to calendar; where, with Get
 * directions; the organiser, with More from), the going count, and one
 * secondary row with Save and Share (the page's only Save). Then the
 * tickets and Who's Going, then About and Good to know. On phones that's one
 * column; from 1024px the tickets and Who's Going are the right-hand column
 * (sticky), beside the photo, title and facts, and About below those. Below
 * 1024px a compact buy bar sticks to the bottom (price and the one ticket
 * action, no Save) until it settles under the content at the page's end.
 *
 * An external event (tickets sold on another site) has a "Get tickets on
 * {provider}" link instead of the ticket selector, and no price or Who's
 * Going (docs/architecture.md, "External ticketing"). In the demo, the
 * page's sample-data disclosure is the banner at the top (DemoBanner); the
 * ticket panel says nothing can be booked.
 */
export default function EventDetailsView({ event, demo }: { event: SheltuhEvent; demo: boolean }) {
  const categoryLabel =
    EVENT_CATEGORIES.find((category) => category.value === event.category)?.label ?? event.category;

  const goodToKnow = [
    { label: "Who it’s for", value: event.audience },
    { label: "What to expect", value: event.whatToExpect },
    { label: "Age restriction", value: event.ageRestriction },
    { label: "Accessibility", value: event.accessibility },
  ].filter((item) => item.value);

  const external = event.ticketingMode === "external";
  const provider = externalProviderLabel(event);
  // Defence in depth: only an https ticket link is ever shown (or the buy bar with it).
  const ticketUrl = external && isSafeTicketUrl(event.externalTicketUrl) ? event.externalTicketUrl : undefined;
  // No price for an external event: we can't vouch for another site's.
  const price = external ? null : formatFeedPriceParts(event);
  const when = whenLabel(event.startsAt, event.endsAt);
  // The buy bar's action: to #tickets, where a sold-out event has its waitlist
  // (§6.10, §6.11). Once an event has ended there's nothing to buy, so there's
  // no bar (docs/design/mobile-redesign.md §6.5).
  const soldOut = isSoldOut(event);
  const ended = Date.parse(event.endsAt ?? event.startsAt) <= new Date().getTime();
  const buyBarLabel = quickBuyLabel(event) ?? "Buy tickets";
  const seatPage = goesToSeatPage(event) && !ended;
  // Refunds only matter where someone can pay: a paid tier, not ended (external has no Booking info at all).
  const paidPurchasePossible = !ended && event.ticketTypes.some((ticket) => ticket.priceCents > 0);
  const shareText = `${event.title} · ${formatEventDateShort(event.startsAt)}, ${formatEventTime(event.startsAt)} · ${event.venueName}`;
  const saveTarget = { id: event.id, title: event.title, slug: event.slug };
  const organiserHref = organiserProfileHref(event);
  const directions = directionsHref(event);
  const address = [event.venueName, event.venueAddress].filter(Boolean).join(", ");
  const outboundLink = (className: string) => (
    <ExternalTicketLink eventId={event.id} url={ticketUrl} provider={provider} className={className} />
  );

  return (
    // Phones: tight above the photo, so the title, date and venue are on the first screen,
    // above the sticky buy bar (e2e/event-page.spec.ts).
    <div className="mx-auto flex max-w-6xl flex-col gap-2 px-5 pb-12 sm:gap-6 sm:px-8 sm:py-10">
      <BackLink href="/">Back to all events</BackLink>

      {/* Live only: one cookie-free view count per session, and finishing a save
          started before signing in. Neither renders anything. */}
      {!demo && <EventViewBeacon eventId={event.id} />}
      <Suspense fallback={null}>
        <SaveOnReturn event={saveTarget} />
      </Suspense>
      <TicketsHashFocus />

      {/* One Who's Going load, shared by the summary link and the panel
          (always closed, with no request, for an external event). */}
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
        <div className="grid grid-cols-1 gap-8 lg:grid-cols-12 lg:gap-x-14 lg:gap-y-10">
          <div className="flex flex-col gap-4 lg:col-span-7">
            {/* The photo first at every width (it's aria-hidden, so reading order is the title
                first): full-bleed 4:3 on phones, never more than 30% of the screen's height so
                the title, date and venue still fit above the buy bar; a 3:2 rounded card from sm.
                The page's LCP image. */}
            <EventArt
              poster={event.poster}
              imageUrl={event.imageUrl}
              title={event.title}
              priority
              fit="auto"
              className="-mx-5 aspect-[4/3] max-h-[30svh] w-[calc(100%+2.5rem)] sm:mx-0 sm:aspect-[3/2] sm:max-h-none sm:w-full sm:rounded-card"
            />
            <div className="flex flex-col gap-3">
              <p className="text-sm leading-5 text-muted">{categoryLabel}</p>
              <h1 className="title-lg -mt-2 max-w-[24ch] break-words">{event.title}</h1>
              {/* The one date/time and venue block (no second copy further down): when, where
                  and who, each with its action. */}
              <dl data-event-facts="" className="mt-1 flex flex-col gap-2">
                <div className={factRowClass}>
                  <dt>
                    <CalendarIcon className={factIconClass} />
                    <span className="sr-only">When</span>
                  </dt>
                  <dd className="min-w-0">
                    <p className="text-base leading-6 font-semibold">
                      {/* Each time stays whole ("4:00 pm", never "4:00 / pm"); the rest wraps where it must,
                          so a long range fits a 320px screen. */}
                      {when.split(TIME_PATTERN).map((part, i) =>
                        i % 2 === 1 ? (
                          <span key={i} className="whitespace-nowrap">
                            {part}
                          </span>
                        ) : (
                          part
                        ),
                      )}
                    </p>
                    <p className="text-sm leading-5 text-muted">{formatTimeZoneLabel(event.startsAt)}</p>
                    {/* On its own row, starting at the column's edge, so its menu stays on screen. */}
                    <AddToCalendar event={event} />
                  </dd>
                </div>
                <div className={factRowClass}>
                  <dt>
                    <PinIcon className={factIconClass} />
                    <span className="sr-only">Where</span>
                  </dt>
                  {directions ? (
                    // One link for the whole place: the address, then the obvious action. It opens
                    // the maps app where there is one (lib/maps.ts), in a new tab otherwise.
                    <dd className="min-w-0">
                      <a
                        href={directions}
                        target="_blank"
                        rel="noopener noreferrer"
                        data-directions=""
                        // Spelled out: it starts with the action, holds the visible address, and says
                        // where it goes and that it opens a new tab.
                        aria-label={`Get directions to ${address} (opens Google Maps in a new tab)`}
                        className="flex w-fit max-w-full flex-col"
                      >
                        <span className="text-base leading-6 break-words">{address}</span>
                        <span className={factActionClass}>
                          Get directions
                          <ExternalIcon />
                        </span>
                      </a>
                    </dd>
                  ) : (
                    <dd className="min-w-0 text-base leading-6 break-words">{address}</dd>
                  )}
                </div>
                <div className={factRowClass}>
                  <dt>
                    {/* Their profile mark: initials in the avatar square (organisers have no photo
                        yet). Decorative and out of the tab order: the name beside it is the link. */}
                    {organiserHref ? (
                      <Link href={organiserHref} aria-hidden="true" tabIndex={-1} data-organiser-avatar="" className="flex">
                        <InitialsAvatar name={event.organiserName} />
                      </Link>
                    ) : (
                      <span data-organiser-avatar="" className="flex">
                        <InitialsAvatar name={event.organiserName} />
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
                    {organiserHref && (
                      // Their other events: the "Upcoming events" section of the same profile.
                      <Link href={`${organiserHref}#organiser-upcoming`} className={factActionClass}>
                        More from {event.organiserName}
                        <ArrowRightIcon />
                      </Link>
                    )}
                  </dd>
                </div>
              </dl>
              {/* Below lg Who's Going comes after the tickets, so its count is linked here too
                  (the panel is beside this from lg). */}
              <div className="lg:hidden">
                <WhosGoingSummaryLink />
              </div>
              {/* The one secondary row: Save (the page's only Save) and Share. */}
              <div data-event-actions="" className="flex flex-wrap items-center gap-2">
                <SaveButton event={saveTarget} variant="action" />
                <ShareButton slug={event.slug} title={event.title} text={shareText} />
              </div>
            </div>
          </div>

          {/* Tickets, then Who's Going: straight after the facts on phones; the right-hand column
              from lg (sticky, unstuck while Who's Going is expanded so a tall column can't hide
              the tickets). */}
          <aside className="flex flex-col gap-8 lg:col-span-5 lg:col-start-8 lg:row-span-2 lg:row-start-1 lg:sticky lg:top-24 lg:self-start lg:has-[[data-wg-expanded]]:static">
            {/* The buy bar's target: focusable, so jumping here moves keyboard and
                screen-reader focus to the tickets too, with the global focus-visible
                ring around the section to show where you've landed. */}
            <div id="tickets" tabIndex={-1} className="rounded-card">
              <Panel title="Tickets" titleId="tickets-title">
                {external ? (
                  <div className="flex flex-col gap-4 rounded-card border border-foreground bg-card p-4 sm:p-5">
                    {event.externalFree && <p className="text-base leading-6 font-semibold">Free entry</p>}
                    <p className="text-sm text-muted">
                      Tickets for this event are sold and priced by {provider}, not Sheltüh, so there&rsquo;s no
                      Sheltüh booking fee. Their terms apply.
                    </p>
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
                    {paidPurchasePossible && <BookingInfo />}
                  </>
                )}
              </Panel>
            </div>

            {!external && <WhosGoing />}
          </aside>

          <div className="flex flex-col gap-8 lg:col-span-7 lg:row-start-2">
            <Panel title="About this event" titleId="about-title">
              <p className="max-w-2xl text-base leading-7">{event.description}</p>
            </Panel>

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
                <p className="mt-4 text-xs text-muted">As provided by the organiser.</p>
              </Panel>
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
              className="sticky bottom-0 z-20 -mx-5 flex min-h-16 items-center justify-between gap-4 px-5 pt-2 pb-[calc(0.5rem+env(safe-area-inset-bottom))] sm:-mx-8 sm:px-8 lg:hidden dark:border-t dark:border-foreground"
            >
              <div className="min-w-0">
                <p className="text-base leading-5 font-semibold tabular-nums">{price.amount}</p>
                {price.note && <p className="text-xs leading-4 text-muted">{price.note}</p>}
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
          {/* An external event's buy bar: where tickets are sold (never a price), and
              the outbound link itself, not a jump to #tickets. None once it has ended. */}
          {ticketUrl && !ended && (
            <div
              data-buy-bar
              data-surface="ink"
              className="sticky bottom-0 z-20 -mx-5 flex min-h-16 items-center justify-between gap-4 px-5 pt-2 pb-[calc(0.5rem+env(safe-area-inset-bottom))] sm:-mx-8 sm:px-8 lg:hidden dark:border-t dark:border-foreground"
            >
              <div className="min-w-0">
                {event.externalFree ? (
                  <>
                    <p className="text-base leading-5 font-semibold">Free</p>
                    <p className="text-xs leading-4 text-muted">Tickets on {provider}</p>
                  </>
                ) : (
                  <p className="text-sm leading-5 font-semibold">Tickets on {provider}</p>
                )}
              </div>
              <ExternalTicketLink
                eventId={event.id}
                url={ticketUrl}
                provider={provider}
                short
                className={buttonClass("signal", "lg", "shrink-0 px-5 sm:px-7")}
              />
            </div>
          )}
        </div>
      </WhosGoingProvider>
    </div>
  );
}
