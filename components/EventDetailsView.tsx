import Link from "next/link";
import DemoNotice from "@/components/DemoNotice";
import EventArt from "@/components/EventArt";
import TicketSelector from "@/components/TicketSelector";
import { Panel } from "@/components/ui/Section";
import { formatEventDateTimeRange } from "@/lib/format";
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

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-10 px-5 py-8 sm:px-8 sm:py-14">
      <Link href="/" className="eyebrow w-fit underline underline-offset-4">
        &larr; Back to all events
      </Link>

      <div className="grid grid-cols-1 gap-10 lg:grid-cols-12 lg:gap-14">
        <div className="flex flex-col gap-10 lg:col-span-7">
          <div className="flex flex-col gap-5">
            <p className="eyebrow text-muted">{categoryLabel}</p>
            <h1 className="display-lg">{event.title}</h1>
          </div>

          <EventArt poster={event.poster}
          imageUrl={event.imageUrl} title={event.title} className="aspect-[4/3] w-full" />

          {demo && (
            <DemoNotice>This listing is fictional sample data for this local prototype.</DemoNotice>
          )}

          <p className="max-w-2xl text-lg leading-relaxed">{event.description}</p>

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

        <aside className="flex flex-col gap-8 lg:col-span-5 lg:sticky lg:top-24 lg:self-start">
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

          <Panel title="Tickets">
            <p className="mb-5 text-sm text-muted">
              Booking fee: 4% of ticket face value + A$0.50 per paid ticket. Free tickets never
              carry a fee.
            </p>
            <TicketSelector event={event} />
          </Panel>
        </aside>
      </div>
    </div>
  );
}
