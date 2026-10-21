import Link from "next/link";
import { Suspense } from "react";
import AddToCalendar from "@/components/AddToCalendar";
import EventViewBeacon from "@/components/analytics/EventViewBeacon";
import DotsMark from "@/components/brand/DotsMark";
import DemoNotice from "@/components/DemoNotice";
import EventArt from "@/components/EventArt";
import ExternalTicketLink from "@/components/ExternalTicketLink";
import SaveButton from "@/components/favourites/SaveButton";
import SaveOnReturn from "@/components/favourites/SaveOnReturn";
import ShareButton from "@/components/ShareButton";
import TicketSelector from "@/components/TicketSelector";
import TicketsHashFocus from "@/components/TicketsHashFocus";
import { buttonClass } from "@/components/ui/Button";
import { Panel } from "@/components/ui/Section";
import WhosGoing from "@/components/WhosGoing";
import { WhosGoingProvider } from "@/components/whos-going/WhosGoingProvider";
import WhosGoingSummaryLink from "@/components/whos-going/WhosGoingSummaryLink";
import { isSafeTicketUrl } from "@/lib/event-url";
import { formatEventDateShort, formatEventDateTimeRange, formatEventTime } from "@/lib/format";
import { externalProviderLabel, formatFeedPriceParts, isSoldOut } from "@/lib/pricing";
import { quickBuyLabel } from "@/lib/quick-buy";
import { EVENT_CATEGORIES, type SheltuhEvent } from "@/lib/types";

const asideRowClass = "border-t border-foreground py-3";

/**
 * "Fri 25 Sep, 8:00 pm – Sat 26 Sep, midnight": the shared range, with
 * midnight said in words (people misread "12:00 am"). The formatter always
 * writes the hour as "12:00 am" for midnight, so this is a whole-word swap.
 */
function whenLabel(startsAt: string, endsAt?: string): string {
  return formatEventDateTimeRange(startsAt, endsAt).replace(/\b12:00 am\b/g, "midnight");
}

/**
 * The event page (docs/design/brand-direction-one.md §6.10): the photo, a
 * strap with Save and Share, the title and key facts, then When / Where /
 * Organiser, Who's Going and the tickets. An external event (tickets sold on
 * another site) has a "Get tickets on {provider}" link instead of the ticket
 * selector, and no price or Who's Going (docs/architecture.md, "External
 * ticketing").
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
  // (§6.10, §6.11). Once a sold-out event has ended there's nothing to join.
  const soldOut = isSoldOut(event);
  const ended = Date.parse(event.endsAt ?? event.startsAt) <= new Date().getTime();
  const buyBarLabel = soldOut && ended ? "See tickets" : (quickBuyLabel(event) ?? "Buy tickets");
  const shareText = `${event.title} · ${formatEventDateShort(event.startsAt)}, ${formatEventTime(event.startsAt)} · ${event.venueName}`;
  const saveTarget = { id: event.id, title: event.title, slug: event.slug };
  const outboundLink = (className: string) => (
    <ExternalTicketLink eventId={event.id} url={ticketUrl} provider={provider} className={className} />
  );

  return (
    // Phones: tight above the photo, so the title, date and venue are on the first screen,
    // above the sticky buy bar (owner request, 21 Oct 2026; e2e/event-page.spec.ts).
    <div className="mx-auto flex max-w-6xl flex-col gap-2 px-5 pb-12 sm:gap-10 sm:px-8 sm:py-14">
      {/* 44px tap target below lg; the desktop link keeps its original height. */}
      <Link
        href="/"
        className="eyebrow inline-flex min-h-11 w-fit items-center underline underline-offset-4 lg:min-h-0"
      >
        &larr; Back to all events
      </Link>

      {/* Live only: one cookie-free view count per session, and finishing a save
          started before signing in. Neither renders anything. */}
      {!demo && <EventViewBeacon eventId={event.id} />}
      <Suspense fallback={null}>
        <SaveOnReturn event={saveTarget} />
      </Suspense>
      <TicketsHashFocus />

      {/* One Who's Going load, shared by the phone summary link and the panel
          (always closed, with no request, for an external event). */}
      <WhosGoingProvider
        event={{
          id: event.id,
          slug: event.slug,
          title: event.title,
          organiserId: event.organiserId,
          ticketingMode: event.ticketingMode,
        }}
      >
        <div className="grid grid-cols-1 gap-8 lg:grid-cols-12 lg:gap-14">
          <div className="flex flex-col gap-4 sm:gap-10 lg:col-span-7">
            <div className="flex flex-col gap-3 sm:gap-5">
              <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
                <p className="eyebrow flex items-center gap-2 text-foreground">
                  <DotsMark size="xs" className="text-signal" />
                  <span>
                    {categoryLabel} · {event.suburb}
                  </span>
                </p>
                <div className="flex items-center gap-2">
                  <SaveButton event={saveTarget} variant="pill" />
                  <ShareButton slug={event.slug} title={event.title} text={shareText} />
                </div>
              </div>
              <h1 className="display-lg max-w-[20ch] break-words">{event.title}</h1>
              {/* Below lg the When/Where aside comes much later, so the key facts sit
                  under the title (desktop shows them in the aside beside it). */}
              <p className="flex flex-col items-start gap-1 lg:hidden">
                <span className="meta text-foreground">{when}</span>
                <span className="text-sm text-muted">
                  {event.venueName} · {event.suburb}
                </span>
                <WhosGoingSummaryLink />
              </p>
            </div>

            {/* The photo first on phones and tablets (it's aria-hidden, so reading and
                focus order are unaffected): full-bleed 4:3 on phones, never more than
                36% of the screen's height so the title, date and venue still fit above
                the buy bar (cropped, object-cover); a 3:2 rounded card from sm, and
                after the title from lg. The page's LCP image. */}
            <EventArt
              poster={event.poster}
              imageUrl={event.imageUrl}
              title={event.title}
              priority
              className="order-first -mx-5 aspect-[4/3] max-h-[36svh] w-[calc(100%+2.5rem)] sm:mx-0 sm:aspect-[3/2] sm:max-h-none sm:w-full sm:rounded-card lg:order-none"
            />

            {demo && (
              <DemoNotice>This listing is fictional sample data for this local prototype.</DemoNotice>
            )}

            <p className="max-w-2xl text-base leading-7 sm:text-lg">{event.description}</p>

            {goodToKnow.length > 0 && (
              <Panel title="Good to know" titleId="good-to-know-title">
                <dl className="flex flex-col gap-4 text-sm">
                  {goodToKnow.map((item) => (
                    <div key={item.label} className="grid grid-cols-1 gap-1 sm:grid-cols-[10rem_1fr]">
                      <dt className="eyebrow text-muted">{item.label}</dt>
                      <dd>{item.value}</dd>
                    </div>
                  ))}
                </dl>
                <p className="mt-4 text-xs text-muted">As provided by the organiser.</p>
              </Panel>
            )}
          </div>

          {/* Unstuck while Who's Going is expanded, so a tall aside can't hide the
              tickets below the fold. */}
          <aside className="flex flex-col gap-6 sm:gap-8 lg:col-span-5 lg:sticky lg:top-24 lg:self-start lg:has-[[data-wg-expanded]]:static">
            <dl className="flex flex-col">
              <div className={asideRowClass}>
                <dt className="eyebrow text-muted">When</dt>
                <dd className="mt-1 text-base leading-6">
                  {when}
                  <span className="block text-sm text-muted">Melbourne time</span>
                </dd>
                <dd>
                  <AddToCalendar event={event} />
                </dd>
              </div>
              <div className={asideRowClass}>
                <dt className="eyebrow text-muted">Where</dt>
                <dd className="mt-1 text-base leading-6">
                  {event.venueName}, {event.venueAddress}
                </dd>
              </div>
              <div className={asideRowClass}>
                <dt className="eyebrow text-muted">Organiser</dt>
                <dd className="mt-1 text-base leading-6">
                  Organised by{" "}
                  {/* Only live events have an organiser (and so a profile) to link to. */}
                  {event.organiserId ? (
                    <Link
                      href={`/organisers/${encodeURIComponent(event.organiserId)}`}
                      className="underline underline-offset-4"
                    >
                      {event.organiserName}
                    </Link>
                  ) : (
                    event.organiserName
                  )}
                </dd>
              </div>
            </dl>

            {!external && <WhosGoing />}

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
                ) : event.ticketTypes.length === 0 ? (
                  // Nothing on sale yet: no fee to explain and nothing to select.
                  <p className="text-sm text-muted">Tickets coming soon.</p>
                ) : (
                  <TicketSelector event={event} />
                )}
              </Panel>
            </div>
          </aside>

          {/* Buy bar, below lg only, on an ink surface. Sticky to the bottom of the
              viewport all the way down the page, and last in the grid, so it settles
              under the tickets at the very end rather than parking mid-page (focus
              scrolls clear of it: globals.css pads by --buybar-h). The page wrapper's
              padding is what -mx bleeds it across. At 320 the heart doesn't fit: the
              one by the title stays. */}
          {price && (
            <div
              data-buy-bar
              data-surface="ink"
              className="sticky bottom-0 z-20 -mx-5 flex min-h-18 items-center justify-between gap-4 px-5 pt-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] sm:-mx-8 sm:px-8 lg:hidden"
            >
              <div className="min-w-0">
                <p className="text-base leading-5 font-semibold tabular-nums">{price.amount}</p>
                {price.note && <p className="text-xs leading-4 text-muted">{price.note}</p>}
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <SaveButton event={saveTarget} variant="onDark" className="hidden min-[375px]:flex" />
                <a href="#tickets" className={buttonClass("signal", "lg", "shrink-0 px-5 sm:px-7")}>
                  {/* "Buy tickets", or "Get free tickets" when every tier is free, in demo
                      mode too (owner, 21 Oct 2026); "Join waitlist" when sold out. */}
                  {buyBarLabel}
                </a>
              </div>
            </div>
          )}
          {/* An external event's buy bar: where tickets are sold (never a price), and
              the outbound link itself, not a jump to #tickets. */}
          {ticketUrl && (
            <div
              data-buy-bar
              data-surface="ink"
              className="sticky bottom-0 z-20 -mx-5 flex min-h-18 items-center justify-between gap-4 px-5 pt-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] sm:-mx-8 sm:px-8 lg:hidden"
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
              <div className="flex shrink-0 items-center gap-2">
                <SaveButton event={saveTarget} variant="onDark" className="hidden min-[375px]:flex" />
                <ExternalTicketLink
                  eventId={event.id}
                  url={ticketUrl}
                  provider={provider}
                  short
                  className={buttonClass("signal", "lg", "shrink-0 px-5 sm:px-7")}
                />
              </div>
            </div>
          )}
        </div>
      </WhosGoingProvider>
    </div>
  );
}
