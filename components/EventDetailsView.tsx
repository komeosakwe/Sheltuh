import Link from "next/link";
import DemoNotice from "@/components/DemoNotice";
import EventArt from "@/components/EventArt";
import TicketSelector from "@/components/TicketSelector";
import { formatEventDateTimeRange } from "@/lib/format";
import { EVENT_CATEGORIES, type SheltuhEvent } from "@/lib/types";

export default function EventDetailsView({ event, demo }: { event: SheltuhEvent; demo: boolean }) {
  const categoryLabel =
    EVENT_CATEGORIES.find((category) => category.value === event.category)?.label ?? event.category;

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6 px-4 py-8 sm:px-6">
      <Link href="/" className="text-sm text-accent underline underline-offset-2">
        &larr; Back to all events
      </Link>

      <div className="grid grid-cols-1 gap-8 lg:grid-cols-[1fr_380px] lg:items-start">
        <div className="flex flex-col gap-6">
          <EventArt poster={event.poster} title={event.title} className="h-40 rounded-lg sm:h-64">
            <span className="rounded bg-black/50 px-2 py-1 text-xs font-medium uppercase tracking-wide text-white">
              {categoryLabel}
            </span>
          </EventArt>

          <div className="flex flex-col gap-2">
            <h1 className="font-heading text-4xl text-foreground sm:text-5xl">{event.title}</h1>
            <p className="text-muted">{formatEventDateTimeRange(event.startsAt, event.endsAt)}</p>
            <p className="text-muted">
              {event.venueName}, {event.venueAddress}
            </p>
            <p className="text-muted">Organised by {event.organiserName}</p>
          </div>

          {demo && (
            <DemoNotice>This listing is fictional sample data for this local prototype.</DemoNotice>
          )}

          <p className="leading-relaxed text-foreground">{event.description}</p>

          {(event.audience || event.whatToExpect || event.ageRestriction || event.accessibility) && (
            <div className="flex flex-col gap-3 rounded-lg border border-surface-border bg-surface p-4">
              <h2 className="font-heading text-xl text-foreground">Good to know</h2>
              <dl className="flex flex-col gap-2.5 text-sm">
                {event.audience && (
                  <div>
                    <dt className="font-medium text-foreground">Who it&rsquo;s for</dt>
                    <dd className="text-muted">{event.audience}</dd>
                  </div>
                )}
                {event.whatToExpect && (
                  <div>
                    <dt className="font-medium text-foreground">What to expect</dt>
                    <dd className="text-muted">{event.whatToExpect}</dd>
                  </div>
                )}
                {event.ageRestriction && (
                  <div>
                    <dt className="font-medium text-foreground">Age restriction</dt>
                    <dd className="text-muted">{event.ageRestriction}</dd>
                  </div>
                )}
                {event.accessibility && (
                  <div>
                    <dt className="font-medium text-foreground">Accessibility</dt>
                    <dd className="text-muted">{event.accessibility}</dd>
                  </div>
                )}
              </dl>
              <p className="text-xs text-muted">As provided by the organiser.</p>
            </div>
          )}
        </div>

        <div className="flex flex-col gap-4 lg:sticky lg:top-24 lg:self-start">
          <div>
            <h2 className="font-heading text-2xl text-foreground">Tickets</h2>
            <p className="mt-1 text-sm text-muted">
              Booking fee: 4% of ticket face value + A$0.50 per paid ticket. Free tickets never
              carry a fee.
            </p>
          </div>
          <TicketSelector event={event} />
        </div>
      </div>
    </div>
  );
}
