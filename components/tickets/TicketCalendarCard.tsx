"use client";

import { useMemo, useState, useSyncExternalStore } from "react";
import { AddToCalendarSheet, type CalendarLinks } from "@/components/tickets/TicketSheets";
import { buttonClass } from "@/components/ui/Button";
import { googleCalendarUrl, icsFilename, outlookCalendarUrl, type CalendarEvent } from "@/lib/calendar";
import { eventCalendarPath, publicEventUrl } from "@/lib/event-url";

/** The page's own origin, for the calendar entries' link back to the event: only known in the browser. */
const noStore = () => () => {};
const useOrigin = () => useSyncExternalStore<string | null>(noStore, () => window.location.origin, () => null);

/** What a ticket's calendar entry is made of: the event as the ticket (or its public page, when loaded) has it. */
export interface TicketCalendarInput {
  slug?: string;
  /** The event's id when its public page was loaded; the slug otherwise. */
  id?: string;
  title: string;
  description?: string;
  venueName?: string;
  venueAddress?: string;
  startsAt?: string;
  endsAt?: string;
}

/** Google's and Outlook's prefilled pages and the event's .ics, once there's a slug, a start and (in the browser) an origin. */
export function useTicketCalendar({ slug, id, title, description, venueName, venueAddress, startsAt, endsAt }: TicketCalendarInput): CalendarLinks | null {
  const origin = useOrigin();
  return useMemo(() => {
    if (!slug || !startsAt || origin === null) return null;
    const entry: CalendarEvent = {
      id: id ?? slug,
      slug,
      title,
      description: description ?? "",
      venueName: venueName ?? "",
      venueAddress: venueAddress ?? "",
      startsAt,
      endsAt,
    };
    const url = publicEventUrl(slug, origin);
    const google = googleCalendarUrl(entry, url);
    const outlook = outlookCalendarUrl(entry, url);
    if (google === null || outlook === null) return null;
    return { google, outlook, ics: eventCalendarPath(slug), icsName: icsFilename(entry) };
  }, [slug, id, title, description, venueName, venueAddress, startsAt, endsAt, origin]);
}

export const ticketCardClass = "flex flex-col gap-4 rounded-control border border-surface-border bg-card p-6";
export const ticketCardTitleClass = "text-xl leading-7 font-semibold text-foreground";
const calendarButtonClass = buttonClass("outline", "sm", "min-w-0 flex-1 px-2");

/**
 * The ticket pages' "Add to calendar" card (Latte's 1120 My ticket frames): three equal buttons, Google,
 * Apple and Outlook, each straight to its calendar. Narrower than 360 they don't fit: one button opens the
 * list (the Add to calendar sheet).
 */
export default function TicketCalendarCard({ links, subtitle }: { links: CalendarLinks; /** The sheet's line: "Here & Now · Sat 14 Nov, 5–9 pm". */ subtitle: string }) {
  const [open, setOpen] = useState(false);
  return (
    <section aria-labelledby="ticket-calendar" className={`${ticketCardClass} print:hidden`}>
      <h2 id="ticket-calendar" className={ticketCardTitleClass}>
        Add to calendar
      </h2>
      <div className="flex gap-2 max-[359px]:hidden">
        <a href={links.google} target="_blank" rel="noopener noreferrer" className={calendarButtonClass}>
          Google<span className="sr-only"> Calendar (opens in a new tab)</span>
        </a>
        <a href={links.ics} className={calendarButtonClass}>
          Apple<span className="sr-only"> Calendar</span>
        </a>
        <a href={links.outlook} target="_blank" rel="noopener noreferrer" className={calendarButtonClass}>
          Outlook<span className="sr-only"> (opens in a new tab)</span>
        </a>
      </div>
      <button type="button" onClick={() => setOpen(true)} className={buttonClass("outline", "sm", "w-full min-[360px]:hidden")}>
        Choose a calendar
      </button>
      <AddToCalendarSheet open={open} onClose={() => setOpen(false)} subtitle={subtitle} links={links} />
    </section>
  );
}
