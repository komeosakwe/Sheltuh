import { cardDateChip, type EventStartFields } from "@/lib/event-card";

/**
 * The date chip on an event card's image (the rules' Cards board): the
 * weekday, the day and the month of the start, in the event's own zone, on
 * white with black text in both themes (it sits on a photo), the day at 24px.
 * The weekday is black too, never orange: small orange type fails on white. Decorative (`aria-hidden`): the
 * card's mono line says the same date in words.
 */
export default function DateChip({
  event,
  size = "card",
  className = "",
}: {
  event: EventStartFields;
  /** `page`: the event page's photo (the owner's event mock), a step larger from 1024px. */
  size?: "card" | "page";
  className?: string;
}) {
  const { weekday, day, month } = cardDateChip(event);
  const page = size === "page";
  return (
    <span
      aria-hidden="true"
      data-date-chip=""
      className={`flex flex-col items-center rounded-badge bg-paper text-ink ${page ? "w-10 py-2 lg:w-16 lg:py-3" : "w-10 py-2"} ${className}`.trim()}
    >
      <span className={`uppercase ${page ? "mono-s lg:mono-m" : "mono-s"}`}>{weekday}</span>
      <span className={`font-semibold tabular-nums ${page ? "text-2xl leading-6 lg:text-3xl lg:leading-10" : "text-2xl leading-6"}`}>{day}</span>
      <span className={`uppercase ${page ? "mono-s lg:mono-m" : "mono-s"}`}>{month}</span>
    </span>
  );
}
