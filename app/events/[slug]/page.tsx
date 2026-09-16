import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import DemoNotice from "@/components/DemoNotice";
import TicketSelector from "@/components/TicketSelector";
import { getEventBySlug } from "@/lib/data";
import { formatEventDate, formatEventTime } from "@/lib/format";
import { EVENT_CATEGORIES } from "@/lib/types";

interface EventDetailsPageProps {
  params: Promise<{ slug: string }>;
}

export async function generateMetadata({ params }: EventDetailsPageProps): Promise<Metadata> {
  const { slug } = await params;
  const event = await getEventBySlug(slug);
  return { title: event ? `${event.title} — Sheltüh` : "Event not found — Sheltüh" };
}

export default async function EventDetailsPage({ params }: EventDetailsPageProps) {
  const { slug } = await params;
  const event = await getEventBySlug(slug);

  if (!event) {
    notFound();
  }

  const categoryLabel =
    EVENT_CATEGORIES.find((category) => category.value === event.category)?.label ??
    event.category;

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6 px-4 py-8 sm:px-6">
      <Link href="/" className="text-sm text-accent underline underline-offset-2">
        &larr; Back to all events
      </Link>

      <div
        aria-hidden="true"
        className="flex h-48 items-end rounded-lg p-4 sm:h-64"
        style={{
          background: `linear-gradient(135deg, ${event.imageGradient[0]}, ${event.imageGradient[1]})`,
        }}
      >
        <span className="rounded bg-black/50 px-2 py-1 text-xs font-medium uppercase tracking-wide text-white">
          {categoryLabel}
        </span>
      </div>

      <div className="flex flex-col gap-2">
        <h1 className="font-heading text-4xl text-foreground sm:text-5xl">{event.title}</h1>
        <p className="text-muted">
          {formatEventDate(event.startsAt)} &middot; {formatEventTime(event.startsAt)}
          {event.endsAt ? ` – ${formatEventTime(event.endsAt)}` : ""}
        </p>
        <p className="text-muted">
          {event.venueName}, {event.venueAddress}
        </p>
        <p className="text-muted">Organised by {event.organiserName}</p>
      </div>

      <DemoNotice>This listing is fictional sample data for this local prototype.</DemoNotice>

      <p className="leading-relaxed text-foreground">{event.description}</p>

      <div>
        <h2 className="font-heading text-2xl text-foreground">Tickets</h2>
        <p className="mb-4 text-sm text-muted">
          Booking fee: 5% of ticket face value + A$0.50 per paid ticket. Free tickets never
          carry a fee.
        </p>
        <TicketSelector ticketTypes={event.ticketTypes} />
      </div>
    </div>
  );
}
