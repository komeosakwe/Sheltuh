import Link from "next/link";
import { Suspense, type ReactNode } from "react";
import AddToCalendar from "@/components/AddToCalendar";
import EventViewBeacon from "@/components/analytics/EventViewBeacon";
import EventViewedTracker from "@/components/analytics/EventViewedTracker";
import EventArt from "@/components/EventArt";
import EventHost from "@/components/events/EventHost";
import EventLocation from "@/components/events/EventLocation";
import { EventOrganiserProvider } from "@/components/events/EventOrganiserProvider";
import ClipPlayButton from "@/components/events/ClipPlayButton";
import MoreFromOrganiser from "@/components/events/MoreFromOrganiser";
import OrganiserUpcoming from "@/components/events/OrganiserUpcoming";
import SimilarNearby from "@/components/events/SimilarNearby";
import ExternalTicketLink from "@/components/ExternalTicketLink";
import OrganiserLogo from "@/components/organisers/OrganiserLogo";
import SaveButton from "@/components/favourites/SaveButton";
import { ExternalIcon } from "@/components/home/icons";
import SaveOnReturn from "@/components/favourites/SaveOnReturn";
import { BarPrice, BuyArrow, BuyBarProvider, GaBuyBar, GaBuyPanel, PanelPrice, TICKETS_HEADING_ID } from "@/components/checkout/BuyBar";
import SeatedTicketsPanel from "@/components/seating/SeatedTicketsPanel";
import ShareButton from "@/components/ShareButton";
import TicketSelector from "@/components/TicketSelector";
import TicketsHashFocus from "@/components/TicketsHashFocus";
import BackLink from "@/components/ui/BackLink";
import { buttonClass } from "@/components/ui/Button";
import CategoryTag from "@/components/ui/CategoryTag";
import DateChip from "@/components/ui/DateChip";
import { Panel } from "@/components/ui/Section";
import ExternalGoing from "@/components/ExternalGoing";
import WhosGoing from "@/components/WhosGoing";
import { WhosGoingProvider } from "@/components/whos-going/WhosGoingProvider";
import type { PreviewMissing } from "@/components/dashboard/editor/preview-event";
import WhosGoingCard from "@/components/whos-going/WhosGoingCard";
import { ageTagLabel } from "@/lib/age-tag";
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

/**
 * Who's Going's one shared load, around the page, the buy bar's (and panel's) link to the ticket selector,
 * and the one read of the organiser's profile; none in a preview (it has no Who's Going or organiser rows,
 * and nothing in it can be pressed).
 */
function GoingScope({
  event,
  preview,
  demo,
  children,
}: {
  event: SheltuhEvent;
  preview: boolean;
  demo: boolean;
  children: ReactNode;
}) {
  if (preview) return <>{children}</>;
  return (
    <BuyBarProvider>
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
        <EventOrganiserProvider event={event} demo={demo}>
          {children}
        </EventOrganiserProvider>
      </WhosGoingProvider>
    </BuyBarProvider>
  );
}

/** A preview's stand-in for what the draft hasn't got yet. */
function Placeholder({ children }: { children: ReactNode }) {
  return <span className="text-muted">{children}</span>;
}

/**
 * The tickets section (#tickets), first in the main column: the existing selector, seat panel, outside
 * ticket link or waitlist, unchanged. A general admission event with tickets on sale is "Select your
 * tickets" over its subheading (owner, 6 Nov 2026); every other state (seats, an outside ticket link, sold
 * out, ended, none yet) is "Tickets". The ticket panel beside the photo (and the phone's buy bar) is the
 * way here.
 */
function TicketsSection({ selects, children }: { selects: boolean; children: ReactNode }) {
  return (
    <section aria-labelledby={TICKETS_HEADING_ID}>
      {/* Focusable from script (the desktop panel's action lands here), with a ring when it does, whatever the
          pointer did before; never a Tab stop. */}
      <h2
        id={TICKETS_HEADING_ID}
        tabIndex={-1}
        className="heading-h2 rounded-control break-words focus:outline-2 focus:outline-offset-4 focus:outline-foreground"
      >
        {selects ? "Select your tickets" : "Tickets"}
      </h2>
      {selects && <p className="body-m mt-2 text-muted">Choose a release to secure your spot.</p>}
      <div className={selects ? "mt-6" : "mt-4"}>{children}</div>
    </section>
  );
}

/**
 * Save, Share and Add to calendar in the ticket panel's row: the rules' Secondary button, filling a third of the row,
 * 48px on phones and 40px beside the photo, in Label/Button, wrapping onto two lines where a label doesn't fit.
 */
const ACTION_ROW_BUTTON = "w-full justify-center px-2 text-center lg:min-h-10 lg:px-1 lg:text-sm!";

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
    <dl data-booking-info="" className="flex flex-col gap-2 text-sm leading-5">
      <div>
        <dt className="eyebrow text-muted">Refunds</dt>
        <dd className="mt-2 flex flex-col gap-2">
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
 * The event page (the owner's event mock; the audit's fix: "make the hero the event card, enlarged").
 *
 * From 1024px: the photo (radius 16, with the date chip) on the left; on the right the tags (the
 * category, and a short age tag only when the organiser gave an age restriction), the title in display
 * type, the date and the venue in mono (the venue linked to directions), "by {organiser}" with their
 * upcoming count, the Who's going row, and the ticket panel: the all-inclusive "From A$X incl. booking
 * fee", the one orange action (Buy tickets, Free tickets, Join waitlist, Choose seats, or the outside
 * ticket link) and Save, Share and Add to calendar as Secondary buttons. The panel sticks under the header
 * while the details scroll by. Below the photo: the tickets (#tickets: the selector, seats, outside link
 * or waitlist), About, Who's Going, Location, Refunds, Good to know, the Organiser card and Report this
 * event; then "More from {organiser}" and "Similar nearby", each the one EventCard, loaded after the
 * first paint.
 *
 * Phones and tablets: one column in the same reading order, with the panel's price and action in the
 * sticky bottom buy bar instead (one orange action in view), so the panel is just Save, Share and Add to
 * calendar under the title. The bar sticks to the bottom of the screen all the way down and settles under
 * the content at the very end; once the event has ended there's no bar (nothing's for sale, and the
 * tickets section says so).
 *
 * An external event (tickets sold on another site) has a "Buy tickets" link (never naming the site)
 * instead of the ticket selector, and no price or Who's Going of ours (docs/architecture.md, "External
 * ticketing"). In the demo, the page's sample-data disclosure is the banner at the top (DemoBanner); the
 * ticket section says nothing can be booked.
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
  // The one class for every buy bar: sticky to the bottom of the screen (static in the editor's preview), bled across
  // the page's margins: the page's own surface (white, black in Dark), square, with a rule along its top (the owner's
  // 390 mock).
  const buyBarClass = `${preview ? "static" : "sticky"} bottom-0 z-20 -mx-(--page-margin) flex min-h-16 items-center justify-between gap-3 border-t border-foreground bg-background px-(--page-margin) pt-2 pb-[calc(0.5rem+env(safe-area-inset-bottom))] lg:hidden`;
  const categoryLabel =
    EVENT_CATEGORIES.find((category) => category.value === event.category)?.label ?? event.category;
  const ageTag = ageTagLabel(event.ageRestriction);

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
  // A general admission event with tickets on sale: its panel is "Select your tickets" (owner, 6 Nov 2026);
  // otherwise (seats, sold out, none yet) it stays "Tickets".
  const selectsTickets = !external && !event.seating && !ended && !soldOut && event.ticketTypes.length > 0;
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
  const externalOnSale = Boolean(ticketUrl) && !ended;
  // The bars' mono line under the price: the start, "Thu 19 Nov · 7:00 pm". None for a draft without a
  // date: its start is only a stand-in (preview-event.ts), and the facts say "Date and time to be added".
  const dateLine = missing?.when ? undefined : `${formatEventDateShort(event.startsAt, zone)} · ${formatEventTime(event.startsAt, zone)}`;
  // The general admission releases to choose from (the panel says how many as it takes you there).
  const releases = event.ticketTypes.filter((ticket) => !ticket.seated).length;

  // The ticket panel's price and one orange action, from 1024px (below that the buy bar has them). The same
  // conditions as the bars below; nothing once the event has ended, or with nothing on sale yet.
  const panelBuy =
    price && !ended && seatPage ? (
      <div className="flex flex-col gap-4">
        <PanelPrice amount={price.amount} note={price.note} />
        <Link href={`/events/${event.slug}/seats`} className={buttonClass("signal", "lg", "w-full gap-2")}>
          {buyBarLabel}
          <BuyArrow />
        </Link>
      </div>
    ) : price && !ended ? (
      <GaBuyPanel price={price} label={buyBarLabel} releases={selectsTickets ? releases : 0} />
    ) : externalOnSale ? (
      <div className="flex flex-col gap-4">
        {event.externalFree ? (
          <PanelPrice amount="Free" />
        ) : externalFrom ? (
          <PanelPrice amount={externalFrom} note="Price set by the organiser." />
        ) : null}
        {outboundLink(buttonClass("signal", "lg", "w-full gap-2"))}
      </div>
    ) : null;

  return (
    // Phones: tight above the photo, so the title, date, venue and Save and Share are on the first screen,
    // above the sticky buy bar (e2e/event-page.spec.ts).
    // Below lg a buy bar is last on the page and settles there at the very end: no bottom padding
    // then, so it meets the footer instead of leaving a white strip under it (owner, 30 Oct 2026).
    <div className={`page-container flex flex-col gap-2 sm:pt-6 lg:pt-8 ${hasBuyBar ? "pb-0 lg:pb-24" : "pb-12 lg:pb-24"}`}>
      {!preview && <BackLink href="/">Back to all events</BackLink>}

      {/* Live only: one cookie-free view count per session, and finishing a save
          started before signing in. Neither renders anything. */}
      {!demo && !preview && <EventViewBeacon eventId={event.id} />}
      {/* Usage analytics' event_viewed (lib/analytics.ts): nothing unless analytics is on. */}
      {!preview && (
        <EventViewedTracker slug={event.slug} category={event.category} ticketingMode={event.ticketingMode ?? "sheltuh"} />
      )}
      {!preview && (
        <Suspense fallback={null}>
          <SaveOnReturn event={saveTarget} />
        </Suspense>
      )}
      {!preview && <TicketsHashFocus />}

      {/* One Who's Going load, shared by the row under the title and the panel further down
          (always closed, with no request, for an external event), and one read of the organiser's profile. */}
      <GoingScope event={event} preview={Boolean(preview)} demo={demo}>
        <div className="grid grid-cols-1 gap-y-2 sm:gap-y-6 lg:grid-cols-12 lg:gap-x-8 lg:gap-y-24">
          {/* The photo, with the date chip on it (decorative: the date line says it). The page's LCP image. On
              phones never more than 22% of the screen's height, so the title, facts, Save and Share fit above
              the buy bar (owner request, 26 Oct 2026: e2e/event-page.spec.ts); a 7:2 strip on tablets; 3:2 beside
              the panel from 1024px. An event's clip Play sits on its bottom-left (docs/design/event-clips.md §5.3);
              absolutely placed, so nothing shifts. */}
          <div className="relative lg:col-span-7 xl:col-span-8">
            <EventArt
              poster={event.poster}
              imageUrl={event.imageUrl}
              imageFocus={event.imageFocus}
              title={event.title}
              priority
              fit="auto"
              className="aspect-[4/3] max-h-[22svh] w-full rounded-card sm:aspect-video sm:max-h-none md:aspect-[7/2] lg:aspect-[3/2]"
            />
            {!missing?.when && <DateChip event={event} size="page" className="absolute top-2 left-2 sm:top-4 sm:left-4" />}
            <ClipPlayButton event={event} size="hero" className="absolute bottom-2 left-2 sm:bottom-4 sm:left-4" />
          </div>

          {/* The key facts and the ticket panel: beside the photo from lg, and down the page with it (its rows
              span the photo's and the details'), so the panel can stick while the details scroll by. */}
          <div className="flex min-w-0 flex-col gap-2 max-lg:pb-8 lg:col-span-5 lg:col-start-8 lg:row-span-2 lg:row-start-1 xl:col-span-4 xl:col-start-9">
            <div data-event-tags="" className="flex flex-wrap gap-2">
              <CategoryTag tone={event.category}>{categoryLabel}</CategoryTag>
              {ageTag && (
                <CategoryTag tone="neutral">
                  <span className="sr-only">Age restriction: </span>
                  {ageTag}
                </CategoryTag>
              )}
            </div>
            {/* Display type in capitals, a step under the home's (globals.css event-title): 32px up to 1024px (a long
                title in two lines at 390), 40px beside the photo (the mock's). */}
            <h1 className="event-title break-words">
              {missing?.title ? <Placeholder>Untitled event</Placeholder> : event.title}
            </h1>
            {/* The one date/time and venue block (no second copy further down), in mono capitals as written
                (CSS sets the case, so it reads as written): when, with its zone; where, linked to directions;
                and who, linked to their profile. */}
            <dl data-event-facts="" className="flex flex-col gap-2">
              <div>
                <dt className="sr-only">When</dt>
                <dd>
                  <p className="mono-m uppercase">
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
                  {!missing?.when && (
                    <p className="mono-s text-muted uppercase">{formatTimeZoneLabel(event.startsAt, zone, event.state)}</p>
                  )}
                </dd>
              </div>
              <div>
                <dt className="sr-only">Where</dt>
                {missing?.where ? (
                  <dd className="mono-m">
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
                      // The address is the link, muted mono like the mock's, with the "opens elsewhere" mark to say
                      // it's one; 44px tall to tap on phones, 24px with a pointer.
                      className="mono-m inline-block min-h-6 max-w-full break-words text-muted uppercase underline-offset-4 hover:text-foreground hover:underline max-lg:min-h-11"
                    >
                      {address}
                      {/* Inline after the last word, so it stays beside the text when it wraps. */}
                      <ExternalIcon className="ml-1 inline size-4 align-[-2px]" />
                    </a>
                  </dd>
                ) : (
                  <dd className="mono-m min-w-0 break-words text-muted uppercase">{address}</dd>
                )}
              </div>
              <div className="flex items-center gap-2">
                <dt className="flex shrink-0">
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
                <dd className="body-s min-w-0">
                  by{" "}
                  {/* A live event's organiser profile, or in the demo the sample organiser's. */}
                  {organiserHref ? (
                    <Link href={organiserHref} className="font-semibold underline-offset-4 hover:underline">
                      {event.organiserName}
                    </Link>
                  ) : (
                    <span className="font-semibold">{event.organiserName}</span>
                  )}
                  {!preview && <OrganiserUpcoming />}
                </dd>
              </div>
            </dl>
            {/* The ticket panel: sticky under the header from lg while the details scroll by, boxed when it has a price
                and action (none once the event has ended, or before anything's on sale), and last in the column there
                (after Who's going, as in the mock). Below lg its price and action are the buy bar's, so it's just the
                secondary row, straight after the facts so Save and Share stay above the bar. */}
            <div
              data-ticket-panel=""
              className={`flex flex-col gap-4 lg:order-last lg:mt-2 ${panelBuy ? "lg:rounded-card lg:border lg:border-foreground lg:p-6" : ""} ${preview ? "" : "lg:sticky lg:top-32"}`}
            >
              {panelBuy && (
                <div className="max-lg:hidden">
                  <h2 className="sr-only">Price and tickets</h2>
                  {panelBuy}
                </div>
              )}
              {/* The one secondary row: Save (the page's only Save), Share and Add to calendar, a third each. Top-aligned,
                  so Share's "Link copied" under it pushes the page down rather than covering anything. */}
              <div data-event-actions="" className="grid grid-cols-3 items-start gap-2">
                <SaveButton event={saveTarget} variant="action" className={ACTION_ROW_BUTTON} />
                <ShareButton slug={event.slug} title={event.title} text={shareText} fill />
                {!missing?.when && <AddToCalendar event={event} look="button" />}
              </div>
            </div>
            {/* Who's going (the owner's event mock): the count, a few faces and I'm going (or See who's going, View
                attendees), to the panel further down. Nothing while there's no count to show and nothing to do. */}
            {!preview && <WhosGoingCard className="mt-2" />}
          </div>

          <div className="flex min-w-0 flex-col gap-12 lg:col-span-7 lg:row-start-2 xl:col-span-8">
            {/* The buy bar's and the panel's target: focusable, so jumping here moves keyboard and
                screen-reader focus to the tickets too, with the global focus-visible ring around the
                section to show where you've landed. */}
            <div id="tickets" tabIndex={-1} className="rounded-card lg:max-w-xl">
              <TicketsSection selects={selectsTickets}>
                {external ? (
                  <div className="flex flex-col gap-4 rounded-card border border-foreground bg-card p-4 sm:p-6">
                    {event.externalFree && <p className="text-base leading-6 font-semibold">Free entry</p>}
                    {externalFrom && (
                      <div>
                        <p className="text-base leading-6 font-semibold tabular-nums">{externalFrom}</p>
                        <p className="text-sm text-muted">Price set by the organiser.</p>
                      </div>
                    )}
                    {/* Black here: the orange one is the panel's (or the bar's). */}
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
              </TicketsSection>
            </div>

            <Panel title="About this event" titleId="about-title" variant="plain">
              <p className="body-l max-w-2xl break-words whitespace-pre-line">
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
              <Panel title="Good to know" titleId="good-to-know-title" variant="plain">
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

            {/* The organiser again, with Follow and their links: not in the editor's preview (it has no organiser profile). */}
            {!preview && <EventHost event={event} demo={demo} />}

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

          {/* Where to go next (the audit's fix: the page used to end at the organiser): read after the first paint,
              each hidden when there's nothing to show, and never in the editor's preview. */}
          {!preview && (
            <div className="flex flex-col gap-16 pt-8 lg:col-span-12 lg:gap-24 lg:pt-0">
              <MoreFromOrganiser event={event} />
              <SimilarNearby event={event} demo={demo} />
            </div>
          )}

          {/* Buy bar, below lg only, on an ink surface: compact (the price and the one ticket
              action; Save is in the row under the title). Sticky to the bottom of the viewport
              all the way down the page, and last in the grid, so it settles under the content at
              the very end rather than covering it. Focus scrolls clear of it (globals.css pads
              by --buybar-h), and its bottom padding clears the home indicator. The page
              container's margin is what it bleeds across. Once the event has ended there's no
              bar at all: nothing's for sale, and the Tickets panel says so. In Dark it gains a
              1px white top rule, so the black bar doesn't merge with the black page. */}
          {price && !ended && seatPage && (
            <div data-buy-bar className={buyBarClass}>
              <BarPrice amount={price.amount} note={price.note} dateLine={dateLine} />
              {/* A seated event's buy bar goes straight to its seat page (manager decision 2,
                  docs/design/seating.md). */}
              <Link href={`/events/${event.slug}/seats`} className={buttonClass("signal", "lg", "shrink-0 gap-2 px-5 sm:px-7")}>
                {buyBarLabel}
                <BuyArrow />
              </Link>
            </div>
          )}
          {/* General admission: the bar checks out once tickets are chosen, as the panel's Checkout does (the
              selector drives it: components/checkout/BuyBar.tsx), and the way to the tickets until
              then ("Buy tickets", or "Free tickets" when every tier is free, in demo mode too (owner,
              21 Oct 2026); "Join waitlist" when sold out). */}
          {price && !ended && !seatPage && <GaBuyBar price={price} label={buyBarLabel} dateLine={dateLine} className={buyBarClass} />}
          {/* An external event's buy bar: the organiser's price if given (never the site's name), and
              the outbound link itself, not a jump to #tickets. None once it has ended. */}
          {externalOnSale && (
            <div data-buy-bar className={buyBarClass}>
              {/* Never the ticket site's name (owner, 31 Oct 2026): buyers go through our link. */}
              <BarPrice amount={event.externalFree ? "Free" : (externalFrom ?? undefined)} dateLine={dateLine} />
              <ExternalTicketLink
                eventId={event.id}
                url={ticketUrl}
                preview={Boolean(preview)}
                className={buttonClass("signal", "lg", "shrink-0 gap-2 px-5 sm:px-7")}
              />
            </div>
          )}
        </div>
      </GoingScope>
    </div>
  );
}
