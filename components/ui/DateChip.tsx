import { cardDateChip, type EventStartFields } from "@/lib/event-card";

/**
 * The date chip on an event card's image (the rules' Cards board): the
 * weekday, the day and the month of the start, in the event's own zone, on
 * white with black text in both themes (it sits on a photo), the day at 24px.
 * The weekday is black too, never orange: small orange type fails on white. Decorative (`aria-hidden`): the
 * card's mono line says the same date in words.
 */
export default function DateChip({ event, className = "" }: { event: EventStartFields; className?: string }) {
  const { weekday, day, month } = cardDateChip(event);
  return (
    <span
      aria-hidden="true"
      data-date-chip=""
      className={`flex w-10 flex-col items-center rounded-badge bg-paper py-2 text-ink ${className}`.trim()}
    >
      <span className="mono-s uppercase">{weekday}</span>
      <span className="text-2xl leading-6 font-semibold tabular-nums">{day}</span>
      <span className="mono-s uppercase">{month}</span>
    </span>
  );
}
