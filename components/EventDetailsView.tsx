import Link from "next/link";
import DemoNotice from "@/components/DemoNotice";
import EventArt from "@/components/EventArt";
import TicketSelector from "@/components/TicketSelector";
import { Panel } from "@/components/ui/Section";
import { formatEventDateTimeRange } from "@/lib/format";
import { formatFeedPriceParts } from "@/lib/pricing";
import { EVENT_CATEGORIES, type SheltuhEvent } from "@/lib/types";

export default function EventDetailsView({ event, demo }: { event: SheltuhEvent; demo: boolean }) {
  const categoryLabel =
    EVENT_CATEGORIES.find((category) => category.value === event.category)?.label ?? event.category;

  const goodToKnow = [
    { label: "Who it\u2019s for", value: event.audience },
    { label: "What to expect", value: event.whatToExpect },
    { label: "Age restriction", value: event.ageRestriction },
    { label: "Accessibility", value: event.accessibility },
  ].filter((item) => item.value);

  const price = formatFeedPriceParts(event);

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6 px-5 pt-2 pb-12 sm:gap-10 sm:px-8 sm:py-14">
      {/* 44px tap target below lg; the desktop link keeps its original height. */}
      <Link
        href="/"
        className="eyebrow inline-flex min-h-11 w-fit items-center underline underline-offset-4 lg:min-h-0"
      >
        &larr; Back to all events
      </Link>

      <div className="grid grid-cols-1 gap-8 lg:grid-cols-12 lg:gap-14">
        <div className="flex flex-col gap-6 sm:gap-10 lg:col-span-7">
          <div className="flex flex-col gap-5">
            <p className="eyebrow text-muted">{categoryLabel}</p>
            <h1 className="display-lg">{event.title}</h1>
            {/* Below lg the When/Where aside comes much later, so the key facts sit
                under the title (desktop shows them in the aside beside it). */}
            <p className="text-sm leading-5 lg:hidden">
              <span className="block text-foreground">
                {formatEventDateTimeRange(event.startsAt, event.endsAt)}
              </span>
              <span className="block text-muted">
                {event.venueName} · {event.suburb}
              </span>
            </p>
          </div>

          {/* Poster first on phones and tablets (it's aria-hidden, so reading and
              focus order are unaffected); after the title from lg, as before. */}
          <EventArt
            poster={event.poster}
            imageUrl={event.imageUrl}
            title={event.title}
            className="order-first -mx-5 aspect-square w-[calc(100%+2.5rem)] sm:mx-0 sm:aspect-[4/3] sm:w-full lg:order-none"
          />

          {demo && (
            <DemoNotice>This listing is fictional sample data for this local prototype.</DemoNotice>
          )}

          <p className="max-w-2xl text-base leading-relaxed sm:text-lg">{event.description}</p>

          {goodToKnow.length > 0 && (
            <Panel title="Good to know">
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

        {/* Buy bar, below lg only. Sticky to the bottom of the viewport while the
            poster and description are read; it settles in its own place, directly
            above When/Where and the tickets, so it can never cover them or the
            footer. The page wrapper's padding is what -mx bleeds it across. */}
        {price && (
          <div
            data-buy-bar
            className="sticky bottom-0 z-20 -mx-5 flex min-h-18 items-center justify-between gap-4 bg-foreground px-5 pt-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] text-background sm:-mx-8 sm:px-8 lg:hidden"
          >
            <div className="min-w-0">
              <p className="text-base leading-5 font-semibold tabular-nums">{price.amount}</p>
              <p className="text-xs leading-4 text-background/70">{price.note}</p>
            </div>
            <a
              href="#tickets"
              className="btn btn-lg shrink-0 border-background bg-background px-5 text-foreground focus-visible:outline-background sm:px-7"
            >
              {demo ? "See tickets" : "Get tickets"}
            </a>
          </div>
        )}

        <aside className="flex flex-col gap-6 sm:gap-8 lg:col-span-5 lg:sticky lg:top-24 lg:self-start">
          <dl className="flex flex-col gap-5 border-t border-foreground pt-5 text-sm">
            <div>
              <dt className="eyebrow text-muted">When</dt>
              <dd className="mt-1 text-base">{formatEventDateTimeRange(event.startsAt, event.endsAt)}</dd>
            </div>
            <div>
              <dt className="eyebrow text-muted">Where</dt>
              <dd className="mt-1 text-base">
                {event.venueName}, {event.venueAddress}
              </dd>
            </div>
            <div>
              <dt className="eyebrow text-muted">Organiser</dt>
              <dd className="mt-1 text-base">Organised by {event.organiserName}</dd>
            </div>
          </dl>

          {/* The buy bar's target: focusable, so jumping here moves keyboard and
              screen-reader focus to the tickets too. */}
          <div id="tickets" tabIndex={-1} className="focus:outline-none">
            <Panel title="Tickets">
              <p className="mb-5 text-sm text-muted">
                Booking fee: 4% of ticket face value + A$0.50 per paid ticket. Free tickets never
                carry a fee.
              </p>
              <TicketSelector event={event} />
            </Panel>
          </div>
        </aside>
      </div>
    </div>
  );
}
