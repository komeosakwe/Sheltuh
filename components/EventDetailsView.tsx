import Link from "next/link";
import { Suspense, type ReactNode } from "react";
import AddToCalendar from "@/components/AddToCalendar";
import BeforeYouGo from "@/components/events/BeforeYouGo";
import EventViewBeacon from "@/components/analytics/EventViewBeacon";
import EventViewedTracker from "@/components/analytics/EventViewedTracker";
import EventArt from "@/components/EventArt";
import EventHost from "@/components/events/EventHost";
import EventLocation from "@/components/events/EventLocation";
import { EventOrganiserProvider } from "@/components/events/EventOrganiserProvider";
import ClipPlayButton from "@/components/events/ClipPlayButton";
import MoreFromOrganiser from "@/components/events/MoreFromOrganiser";
import SimilarNearby from "@/components/events/SimilarNearby";
import ExternalTicketLink from "@/components/ExternalTicketLink";
import OrganiserLogo from "@/components/organisers/OrganiserLogo";
import SaveButton from "@/components/favourites/SaveButton";
import { ArrowUpRightIcon, CalendarIcon, PinIcon } from "@/components/home/icons";
import SaveOnReturn from "@/components/favourites/SaveOnReturn";
import { BarPrice, BuyArrow, BuyBarProvider, GaBuyBar, GaBuyPanel, PanelPrice, TICKETS_HEADING_ID } from "@/components/checkout/BuyBar";
import SeatedTicketsPanel from "@/components/seating/SeatedTicketsPanel";
import ShareButton from "@/components/ShareButton";
import TicketSelector from "@/components/TicketSelector";
import TicketsHashFocus from "@/components/TicketsHashFocus";
import BackLink from "@/components/ui/BackLink";
import { buttonClass } from "@/components/ui/Button";
import CategoryTag from "@/components/ui/CategoryTag";
import SoonTag from "@/components/ui/SoonTag";
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
import { venueLines } from "@/lib/place";
import { externalPriceFromLabel, formatFeedPriceParts, isSoldOut, startingPrice } from "@/lib/pricing";
import { goesToSeatPage, quickBuyLabel } from "@/lib/quick-buy";
import { EVENT_PAGE_PHOTO_SIZES } from "@/lib/responsive-image";
import { soonFields, type SoonFields } from "@/lib/soon";
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
 * ticket link or waitlist. A general admission event with tickets on sale is "Choose your tickets" over
 * "Choose how many tickets you want." (the owner's event reference, 13 Nov 2026; UX review's wording); every other state (seats,
 * an outside ticket link, sold out, ended, none yet) is "Tickets". The ticket panel beside the photo (and
 * the phone's buy bar) is the way here.
 */
function TicketsSection({
  selects,
  soon,
  children,
}: {
  selects: boolean;
  /** The event's times for the "🔥 Tomorrow" tag beside the heading; none for a draft without a date. */
  soon?: SoonFields;
  children: ReactNode;
}) {
  return (
    <section aria-labelledby={TICKETS_HEADING_ID}>
      {/* The heading, and beside it (under it where there's no room) the soon tag, outside the heading so its name
          stays "Choose your tickets". */}
      <div data-tickets-head="" className="flex flex-wrap items-center gap-x-3 gap-y-2">
        {/* Focusable from script (the desktop panel's action lands here, scrolled to the top); never a Tab stop. It's
            not a control, so no focus ring (owner, 25 Nov 2026), as with the other headings focused by script.
            Important (`!`): the global :focus-visible ring in globals.css is unlayered, so it beats any utility otherwise. */}
        <h2
          id={TICKETS_HEADING_ID}
          tabIndex={-1}
          className="heading-section min-w-0 rounded-control break-words focus:outline-none!"
        >
          {selects ? "Choose your tickets" : "Tickets"}
        </h2>
        {soon && <SoonTag event={soon} />}
      </div>
      {selects && <p className="body-m mt-1 text-muted">Choose how many tickets you want.</p>}
      <div className="mt-4">{children}</div>
    </section>
  );
}

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
 * From 1024px: the photo (radius 16; no date chip, the date line under the title says it) on the left; on
 * the right the tags (the category, and a short age tag only when the organiser gave an age restriction),
 * the title in display type, "Hosted by {organiser}" as a byline under it (the name the link to their
 * profile), the date and the venue as two groups with an icon each (the date with Add to calendar under it,
 * the venue itself the directions link), the Who's going row, and the ticket panel: just the all-inclusive
 * "From A$X incl. booking fee" and the one orange action (Buy tickets, Free tickets, Join waitlist, Choose
 * seats, or the outside ticket link). The panel sticks under the header while the details scroll by. Save
 * and Share sit on the photo's top-right corner, each action on its object (owner, 27 Nov 2026: Option A;
 * no row of buttons at any width). Below the photo: the tickets (#tickets: the selector, seats, outside link
 * or waitlist), About, Who's Going, Before you go (the organiser's note, when there is one), Location,
 * Refunds, Good to know, the Organiser card and Report this event; then "More from {organiser}" and
 * "Similar nearby", each the one EventCard, loaded after the first paint.
 *
 * Phones and tablets: one column in the same reading order, with the panel's price and action in the
 * sticky bottom buy bar instead (one orange action in view), and no panel. The bar sticks to the bottom of
 * the screen all the way down and settles under the content at the very end; once the event has ended
 * there's no bar (nothing's for sale, and the tickets section says so).
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
  // The venue group's two lines (lib/place.ts venueLines): the venue's name, then its street address (or, without
  // one, its suburb, as the Location section does). A venue with no name, or whose name is only its street line
  // (a Google address pick, Round 2), leads with the address, then the suburb: never the address twice.
  const { first: venueLine, second: addressLine } = venueLines(event);
  const address = [venueLine, addressLine].filter(Boolean).join(", ");
  const outboundLink = (className: string) => (
    <ExternalTicketLink eventId={event.id} url={ticketUrl} className={className} preview={Boolean(preview)} />
  );
  const externalOnSale = Boolean(ticketUrl) && !ended;
  // The bars' date line under the price: the start, "Thu 19 Nov · 7:00 pm". None for a draft without a
  // date: its start is only a stand-in (preview-event.ts), and the facts say "Date and time to be added".
  const dateLine = missing?.when ? undefined : `${formatEventDateShort(event.startsAt, zone)} · ${formatEventTime(event.startsAt, zone)}`;
  // The "🔥 Tomorrow" tag's times (lib/soon.ts), beside the category, the tickets heading and the bars' date line;
  // none for a draft without a date (its start is only a stand-in).
  const soon = missing?.when ? undefined : soonFields(event);
  // The general admission ticket types that can be chosen now (the panel says how many as it takes you there): not
  // sold out, and not waiting for the one above to sell out.
  const releases = event.ticketTypes.filter((ticket) => !ticket.seated && ticket.soldOut !== true && !ticket.opensAfter).length;

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
    // Phones: 8px above the photo (it never touches the header), so the title, date, venue, and Save and Share on the
    // photo, are on the first screen, above the sticky buy bar (e2e/event-page.spec.ts).
    // Below lg a buy bar is last on the page and settles there at the very end: no bottom padding
    // then, so it meets the footer instead of leaving a white strip under it (owner, 30 Oct 2026).
    <div className={`page-container flex flex-col gap-2 pt-2 sm:pt-6 lg:pt-8 ${hasBuyBar ? "pb-0 lg:pb-24" : "pb-12 lg:pb-24"}`}>
      {/* From 640px only (owner, 27 Nov 2026: Option A, S2). On a phone the way home is the header's wordmark and the
          browser's own back, and the photo comes first. Hidden, not removed: it adds no gap (display: none). */}
      {!preview && (
        <div className="max-sm:hidden">
          <BackLink href="/">Back to all events</BackLink>
        </div>
      )}

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
          {/* The photo, with Save and Share on it; no date chip (owner, 27 Nov 2026: the date line under the title
              already gives the date). The page's LCP image. On phones never more than 22% of the screen's height,
              so the title and facts fit above the buy bar (owner request, 26 Oct 2026: e2e/event-page.spec.ts). On a short phone (below 640px wide and up to 700px tall,
              an iPhone SE's 667) 8px less: what the phone header gained (56 to 64px, the "Header / Mobile" board),
              so everything under the photo sits where it did there; taller phones have room and keep the 22%. A
              7:2 strip on tablets; 3:2 beside
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
              // Not in the editor's preview, whose photo is the organiser's draft or upload (used as it is).
              sizes={preview ? undefined : EVENT_PAGE_PHOTO_SIZES}
              className="aspect-[4/3] max-h-[22svh] w-full rounded-card max-sm:[@media(max-height:700px)]:max-h-[calc(22svh-0.5rem)] sm:aspect-video sm:max-h-none md:aspect-[7/2] lg:aspect-[3/2]"
            />
            <ClipPlayButton event={event} size="hero" className="absolute bottom-2 left-2 sm:bottom-4 sm:left-4" />
            {/* Save (the page's one Save) and Share, on the photo's top-right corner as the heart is on every event
                card (owner, 27 Nov 2026: Option A). Below 640px two 40px white marks in 48px targets that touch, so
                the marks are 8px in from the photo's edges and 8px apart; from 640px labelled 44px chips, 12px in
                and 8px apart. They come before the title in reading and tab order, since they're drawn before it
                (DOM order follows what you see), and each name carries the title ("Save {title}", "Share {title}"),
                so it makes sense on its own. In the editor's preview too (inert there), so organisers see what
                covers their photo's corner. */}
            <div data-event-actions="" className="absolute top-1 right-1 flex sm:top-3 sm:right-3 sm:gap-2">
              <ShareButton slug={event.slug} title={event.title} text={shareText} look="photo" />
              <SaveButton event={saveTarget} variant="photo" />
            </div>
          </div>

          {/* The key facts and the ticket panel: beside the photo from lg, and down the page with it (its rows
              span the photo's and the details'), so the panel can stick while the details scroll by. Below lg, 12px
              between its rows and a hairline under it, before the tickets (the owner's event reference). */}
          <div className="flex min-w-0 flex-col gap-3 max-lg:border-b max-lg:border-surface-border max-lg:pb-6 lg:col-span-5 lg:col-start-8 lg:row-span-2 lg:row-start-1 xl:col-span-4 xl:col-start-9">
            <div data-event-tags="" className="flex flex-wrap gap-2">
              <CategoryTag tone={event.category}>{categoryLabel}</CategoryTag>
              {soon && <SoonTag event={soon} />}
              {ageTag && (
                <CategoryTag tone="neutral">
                  <span className="sr-only">Age restriction: </span>
                  {ageTag}
                </CategoryTag>
              )}
            </div>
            {/* Display type as entered, a step under the home's (globals.css event-title): 32px up to 1024px (a long
                title in two lines at 390), 40px beside the photo (the mock's). */}
            <h1 className="event-title break-words">
              {missing?.title ? <Placeholder>Untitled event</Placeholder> : event.title}
            </h1>
            {/* Who's hosting, as a byline straight under the title at every width (owner, 27 Nov 2026: no View
                organiser, "the name should just be clickable", under the event's name): their mark, then "Hosted by
                {name}" with the name itself the link to their profile (plain text with no profile). 8px under the
                title. The name is an inline-block, so a long name (or 200% text) drops under "Hosted by" and wraps
                there; below lg its 10px padding, cancelled by an equal negative margin, makes a 44px target on one
                line (as Add to calendar's does under the date) that grows with the name, never overlapping the lines
                around it. */}
            <div data-event-organiser="" className="-mt-1 flex items-center gap-2">
              {/* Their profile mark (32px): their logo in the avatar square, or their initials (no logo, the demo, or
                  it didn't load). Decorative and out of the tab order: the name is the link. */}
              {organiserHref ? (
                <Link href={organiserHref} aria-hidden="true" tabIndex={-1} data-organiser-avatar="" className="flex shrink-0">
                  <OrganiserLogo name={event.organiserName} url={event.organiserLogoThumbUrl} size="md" fallback="initials" />
                </Link>
              ) : (
                <span data-organiser-avatar="" className="flex shrink-0">
                  <OrganiserLogo name={event.organiserName} url={event.organiserLogoThumbUrl} size="md" fallback="initials" />
                </span>
              )}
              <p className="body-m min-w-0 break-words">
                Hosted by{" "}
                {/* A live event's organiser profile, or in the demo the sample organiser's. */}
                {organiserHref ? (
                  <Link
                    href={organiserHref}
                    className="inline-block max-w-full font-semibold underline underline-offset-4 hover:decoration-2 max-lg:-my-2.5 max-lg:py-2.5"
                  >
                    {event.organiserName}
                  </Link>
                ) : (
                  <span className="font-semibold">{event.organiserName}</span>
                )}
              </p>
            </div>
            {/* The one date/time and venue block (no second copy further down), as two groups with an icon each (the
                owner's event reference, 13 Nov 2026), in Instrument Sans as written: when (16px 500), its zone under it
                (14px, muted) and Add to calendar under that; where: the venue (16px 500) and its full address under it,
                together the directions link (owner, 27 Nov 2026: Option A). Long names and addresses wrap. */}
            <dl data-event-facts="" className="mt-1 flex flex-col gap-3">
              <div data-event-when="" className="flex gap-3">
                <dt className="flex shrink-0 pt-0.5">
                  <CalendarIcon className="size-5" />
                  <span className="sr-only">When</span>
                </dt>
                <dd className="min-w-0">
                  <p className="body-m font-medium">
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
                    <p className="body-s text-muted">{formatTimeZoneLabel(event.startsAt, zone, event.state)}</p>
                  )}
                  {/* Add to calendar on the date it adds (owner, 27 Nov 2026: Option A): a 44px target that takes only
                      its 24px line (10px over the zone line above and into the 12px gap below, neither pressable).
                      None for a draft without a date. */}
                  {!missing?.when && <AddToCalendar event={event} className="-my-2.5" />}
                </dd>
              </div>
              <div data-event-where="" className="flex gap-3">
                <dt className="flex shrink-0 pt-0.5">
                  <PinIcon className="size-5" />
                  <span className="sr-only">Where</span>
                </dt>
                {missing?.where ? (
                  <dd className="body-m">
                    <Placeholder>Venue to be added</Placeholder>
                  </dd>
                ) : (
                  <dd className="flex min-w-0 flex-col items-start">
                    {directions ? (
                      // The venue is the directions link (owner, 27 Nov 2026: Option A, S1): its name and its address
                      // together, one target (24 + 20 = 44px tall), the name underlined with ↗ after it (it goes
                      // elsewhere: lib/maps.ts, Google Maps in a new tab). Named in full: the visible words first
                      // (WCAG 2.5.3), then where it goes and that it opens a new tab. A link, so iOS adds no address
                      // link of its own over the address (and app/layout.tsx turns that off site-wide).
                      <a
                        href={directions}
                        target="_blank"
                        rel="noopener noreferrer"
                        data-directions=""
                        aria-label={`${address}: get directions (opens Google Maps in a new tab)`}
                        className="group/dir flex max-w-full flex-col items-start"
                      >
                        {venueLine && (
                          <span className="body-m font-medium break-words underline decoration-1 underline-offset-4 group-hover/dir:decoration-2">
                            {venueLine}
                            <ArrowUpRightIcon className="ml-1 inline size-4 align-[-2px]" />
                          </span>
                        )}
                        {addressLine && (
                          <span data-venue-address="" className="body-s break-words text-muted">
                            {addressLine}
                          </span>
                        )}
                      </a>
                    ) : (
                      <>
                        {venueLine && <p className="body-m font-medium break-words">{venueLine}</p>}
                        {addressLine && (
                          <p data-venue-address="" className="body-s break-words text-muted">
                            {addressLine}
                          </p>
                        )}
                      </>
                    )}
                  </dd>
                )}
              </div>
            </dl>
            {/* The ticket panel, from lg only: just the price and the one orange action (owner, 27 Nov 2026: Option A;
                Save and Share are on the photo), boxed, sticky under the header while the details scroll by, and last
                in the column (after Who's going, as in the mock). None once the event has ended, or before anything's
                on sale; below lg the buy bar has them, so there's no panel at all (and no empty gap). */}
            {panelBuy && (
              <div
                data-ticket-panel=""
                className={`max-lg:hidden lg:order-last lg:mt-2 lg:rounded-card lg:border lg:border-foreground lg:p-6 ${preview ? "" : "lg:sticky lg:top-[calc(var(--header-h)+2rem)]"}`}
              >
                <h2 className="sr-only">Price and tickets</h2>
                {panelBuy}
              </div>
            )}
            {/* Who's going (the owner's event mock): the count, a few faces and I'm going (or See who's going, View
                attendees), to the panel further down. Nothing while there's no count to show and nothing to do. */}
            {!preview && <WhosGoingCard />}
          </div>

          <div className="flex min-w-0 flex-col gap-10 max-lg:pt-4 lg:col-span-7 lg:row-start-2 lg:gap-12 xl:col-span-8">
            {/* The buy bar's and the panel's target: focusable, so jumping here moves keyboard and
                screen-reader focus to the tickets too, with the global focus-visible ring around the
                section to show where you've landed. None for an external event on sale (owner, 15 Nov 2026): its
                price and "Buy tickets" are already in the panel and the phone buy bar, so a box here only repeated
                them. Once it has ended, or without a usable link, the section stays to say so (with no price or link once ended). */}
            {!(external && externalOnSale) && (
              <div id="tickets" tabIndex={-1} className="rounded-card lg:max-w-xl">
                <TicketsSection selects={selectsTickets} soon={soon}>
                  {external && ended ? (
                    // Nothing to buy any more: no price, and no link to the other site (owner, 15 Nov 2026).
                    <p className="text-sm font-semibold">{ENDED_TEXT}</p>
                  ) : external ? (
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
            )}

            <Panel title="About this event" titleId="about-title" variant="plain">
              <p className="body-l max-w-2xl break-words whitespace-pre-line">
                {missing?.description ? <Placeholder>Add a description</Placeholder> : event.description}
              </p>
            </Panel>

            {/* Owner's order (30 Oct 2026): About, Who's Going, Location, Refunds, then Good to know. */}
            {!external && !preview && <WhosGoing />}
            {external && !preview && <ExternalGoing event={event} />}

            {/* The organiser's "Before you go" rows (doors, age limit, what to bring), when there are any: "The essentials.",
                just before Location, so what to know before setting out sits with where to go. Not in the key facts by the
                photo: on phones the title, facts, Save and Share stay on the first screen (e2e/event-page.spec.ts). */}
            {event.beforeYouGo && <BeforeYouGo items={event.beforeYouGo} className="max-w-2xl" />}

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
              action; Save is on the photo). Sticky to the bottom of the viewport
              all the way down the page, and last in the grid, so it settles under the content at
              the very end rather than covering it. Focus scrolls clear of it (globals.css pads
              by --buybar-h), and its bottom padding clears the home indicator. The page
              container's margin is what it bleeds across. Once the event has ended there's no
              bar at all: nothing's for sale, and the Tickets panel says so. In Dark it gains a
              1px white top rule, so the black bar doesn't merge with the black page. */}
          {price && !ended && seatPage && (
            <div data-buy-bar className={buyBarClass}>
              <BarPrice amount={startingPrice(price.amount)} note={price.note} dateLine={dateLine} soon={soon} />
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
          {price && !ended && !seatPage && <GaBuyBar price={price} label={buyBarLabel} dateLine={dateLine} soon={soon} className={buyBarClass} />}
          {/* An external event's buy bar: the organiser's price if given (never the site's name), and
              the outbound link itself, not a jump to #tickets. None once it has ended. */}
          {externalOnSale && (
            <div data-buy-bar className={buyBarClass}>
              {/* Never the ticket site's name (owner, 31 Oct 2026): buyers go through our link. */}
              <BarPrice amount={event.externalFree ? "Free" : (externalFrom ?? undefined)} dateLine={dateLine} soon={soon} />
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
