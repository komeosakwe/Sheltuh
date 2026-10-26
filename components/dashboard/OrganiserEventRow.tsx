import Link from "next/link";
import { buttonClass, secondaryActionClass } from "@/components/ui/Button";
import StatusBadge from "@/components/ui/StatusBadge";
import type { EventRecord } from "@/lib/api/types";
import { formatDayTime } from "@/lib/format";
import { organiserEventActions, organiserEventStatus } from "@/lib/organiser-events";
import { sellsPaidTicketsOnSheltuh } from "@/lib/ticketing";

/** The event's start, when it has a real one ("Sat 12 Dec, 7:00 pm"); null otherwise. */
function startText(startsAt: string): string | null {
  if (!startsAt || Number.isNaN(Date.parse(startsAt))) return null;
  return formatDayTime(startsAt);
}

/**
 * One of the organiser's events on the dashboard: its title (an h2), when and
 * where, its status as a word in a badge (never colour alone) with a line on
 * what to do next, then only the actions that apply to it
 * (lib/organiser-events.ts). Edit or View is the outlined button; the rest
 * are quiet secondary actions. Each is named with the event ("Edit Night
 * Market") and is 44px tall; they wrap, so nothing scrolls sideways at 320px.
 */
export default function OrganiserEventRow({ event, payoutsEnabled }: { event: EventRecord; payoutsEnabled: boolean }) {
  const title = event.title || "Untitled event";
  const status = organiserEventStatus(event);
  const actions = organiserEventActions(event);
  const when = startText(event.startsAt);
  const meta = [when, event.suburb].filter(Boolean).join(" · ");
  // A draft (or rejected event) with paid tickets can't be submitted until payouts are set up.
  const needsPayouts =
    !payoutsEnabled && (event.status === "draft" || event.status === "rejected") && sellsPaidTicketsOnSheltuh(event);

  return (
    <li data-event-row={event.eventId} data-status={status.state} className="flex flex-col gap-3 border-t border-foreground py-4">
      <div className="flex flex-col gap-1">
        {/* The status right under the title on phones, beside it from sm. */}
        <div className="flex flex-col items-start gap-x-4 gap-y-1 sm:flex-row sm:justify-between">
          <h2 className="min-w-0 font-semibold break-words text-foreground">{title}</h2>
          <StatusBadge tone={status.tone}>{status.label}</StatusBadge>
        </div>
        {meta && <p className="text-sm text-muted">{meta}</p>}
        <p className="text-sm text-muted">{status.hint}</p>
        {needsPayouts && <p className="text-sm text-foreground">Set up payouts to submit (it has paid tickets)</p>}
      </div>
      <ul aria-label={`Actions for ${title}`} className="flex flex-wrap gap-2">
        {actions.map((action, index) => (
          <li key={action.kind}>
            <Link
              href={action.href}
              aria-label={action.name}
              className={index === 0 ? buttonClass("outline", "sm", "min-h-11") : secondaryActionClass}
            >
              {action.label}
            </Link>
          </li>
        ))}
      </ul>
    </li>
  );
}
