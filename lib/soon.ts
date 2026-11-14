import { eventZone } from "./format";
import { wallClockParts } from "./time-zones";
import type { SheltuhEvent } from "./types";

/**
 * The "soon" tag (owner request, 13 Nov 2026: "Fire emoji when it's close and also a tag"): how close an
 * event is, from its times alone, in its own zone's wall clock. Never scarcity or popularity ("selling
 * fast"): only when it's on (Australian Consumer Law: nothing invented). Pure.
 *
 *  - "On now": it has started and hasn't ended.
 *  - "Tonight": it starts later today there, at 5:00 pm or after.
 *  - "Today": it starts later today there, before 5:00 pm.
 *  - "Tomorrow": it starts tomorrow there.
 *  - null otherwise: further off, ended, or a time that can't be read. No "this week": it's about urgency.
 *
 * "Today" is the event's own: a Perth event at 10:00 pm Perth time is "Tonight" in Perth even when it's
 * already tomorrow in Melbourne. An event with no end time ends when it starts (lib/event-card.ts hasEnded).
 */
export type SoonLabel = "On now" | "Tonight" | "Today" | "Tomorrow";

/** What the label needs from an event: plain, serialisable fields, so a server component can hand them to the client tag. */
export type SoonFields = Pick<SheltuhEvent, "startsAt" | "endsAt" | "timeZone">;

/** Just the fields soonLabel reads, so a client component's props carry nothing else of the event. */
export function soonFields(event: SoonFields): SoonFields {
  return { startsAt: event.startsAt, endsAt: event.endsAt, timeZone: event.timeZone };
}

/** From this local time on, a start later today is "Tonight". */
export const TONIGHT_FROM = "17:00";

/** The calendar date `days` after a yyyy-mm-dd (calendar arithmetic, no clock involved, so daylight saving can't shift it). */
function addDays(dateKey: string, days: number): string {
  const [year, month, day] = dateKey.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

/** The soon label for `event` at `now`, or null for none (see above). */
export function soonLabel(event: SoonFields, now: Date): SoonLabel | null {
  const start = Date.parse(event.startsAt);
  const end = event.endsAt ? Date.parse(event.endsAt) : start;
  const nowMs = now.getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end) || !Number.isFinite(nowMs)) return null;
  if (end <= nowMs) return null;
  if (start <= nowMs) return "On now";

  const zone = eventZone(event.timeZone);
  const today = wallClockParts(now, zone).date;
  const starts = wallClockParts(event.startsAt, zone);
  if (starts.date === today) return starts.time >= TONIGHT_FROM ? "Tonight" : "Today";
  if (starts.date === addDays(today, 1)) return "Tomorrow";
  return null;
}
