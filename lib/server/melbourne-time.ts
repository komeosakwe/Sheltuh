import { localToUtcIso, PLATFORM_TIME_ZONE } from "../time-zones";

/**
 * Converts an organiser-submitted Australia/Melbourne local date + time into
 * a correct UTC instant, honouring AEST (+10) / AEDT (+11) daylight saving:
 * localToUtcIso (lib/time-zones.ts) in the platform's zone.
 *
 *  - Spring-forward gap (clocks jump 2:00am -> 3:00am): some local times
 *    (e.g. 2:30am on transition day) never occur at all — rejected.
 *  - Autumn fall-back overlap (clocks step back 3:00am -> 2:00am): some
 *    local times occur twice — resolved deterministically to the first
 *    (earlier, DST) occurrence.
 *
 * `dateStr` is "YYYY-MM-DD", `timeStr` is "HH:mm". Throws RangeError for a
 * malformed or calendar-invalid date, an out-of-range time, or a local time
 * that falls in the spring-forward gap.
 */
export function melbourneLocalToUtcIso(dateStr: string, timeStr: string): string {
  return localToUtcIso(dateStr, timeStr, PLATFORM_TIME_ZONE);
}
