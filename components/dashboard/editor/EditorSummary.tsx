import EventArt from "@/components/EventArt";
import StatusBadge, { type StatusTone } from "@/components/ui/StatusBadge";
import type { EventPoster } from "@/lib/types";

/**
 * The event summary (docs/design/event-editor.md §5.2): the top of the rail on lg and up (a card with a
 * 3:2 thumbnail), a compact row below it (48px thumbnail). The thumbnail is decorative (the title names
 * the event). Everything comes from the live form, so it follows typing.
 */
export default function EditorSummary({
  title,
  when,
  status,
  lastSaved,
  poster,
  imageUrl,
  price,
  organiser,
}: {
  title: string;
  /** "Sat 8 Nov, 7:00 pm", or empty while the start isn't set. */
  when: string;
  status: { label: string; tone: StatusTone; notSaved: boolean };
  /** "2:14 pm" (the viewer's local time), none for a new event. */
  lastSaved?: string;
  poster: EventPoster;
  imageUrl?: string;
  /** "From A$13.30" (or "Free"): the all-inclusive price the event page shows. */
  price?: { amount: string; note?: string } | null;
  /** Admin: whose event it is. */
  organiser?: string;
}) {
  const name = title.trim();
  return (
    <section
      aria-label="Event summary"
      className="flex items-start gap-3 lg:flex-col lg:gap-3 lg:rounded-card lg:border lg:border-foreground lg:bg-card lg:p-4"
    >
      <EventArt
        poster={poster}
        imageUrl={imageUrl}
        title={name || "Untitled event"}
        fit="auto"
        className="aspect-square size-12 shrink-0 overflow-hidden rounded-control lg:aspect-[3/2] lg:size-auto lg:w-full"
      />
      <div className="flex min-w-0 flex-1 flex-col gap-1 lg:gap-2">
        <p
          className={`line-clamp-2 text-base leading-6 font-semibold break-words lg:line-clamp-3 ${name ? "" : "text-muted"}`}
          data-summary-title=""
        >
          {name || "Untitled event"}
        </p>
        <p className="text-sm leading-5 text-muted">{when || "Date to be added"}</p>
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge tone={status.tone}>{status.label}</StatusBadge>
          {status.notSaved && <span className="meta text-muted">Not saved yet</span>}
        </div>
        {organiser && <p className="text-sm text-muted">Organiser: {organiser}</p>}
        {lastSaved && <p className="meta text-muted">Last saved {lastSaved}</p>}
        {price && (
          <p className="hidden text-sm tabular-nums lg:block">
            {price.amount}
            {price.note && <span className="block text-xs text-muted">{price.note}</span>}
          </p>
        )}
      </div>
    </section>
  );
}
