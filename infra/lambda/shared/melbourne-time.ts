/**
 * Converts an organiser-submitted Australia/Melbourne local date + time into
 * a correct UTC instant, honouring AEST (+10) / AEDT (+11) daylight saving —
 * never a fixed offset. `dateStr` is "YYYY-MM-DD", `timeStr` is "HH:mm".
 */
export function melbourneLocalToUtcIso(dateStr: string, timeStr: string): string {
  const naiveUtcMs = Date.parse(`${dateStr}T${timeStr}:00Z`);
  if (Number.isNaN(naiveUtcMs)) {
    throw new RangeError(`Invalid date/time: ${dateStr} ${timeStr}`);
  }
  const offsetMinutes = melbourneOffsetMinutesAt(naiveUtcMs);
  return new Date(naiveUtcMs - offsetMinutes * 60_000).toISOString();
}

const offsetFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: "Australia/Melbourne",
  hour12: false,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});

/** Melbourne's UTC offset, in minutes, at the given instant (handles DST). */
function melbourneOffsetMinutesAt(epochMs: number): number {
  const parts = Object.fromEntries(
    offsetFormatter.formatToParts(new Date(epochMs)).map((p) => [p.type, p.value]),
  );
  const asUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour) % 24,
    Number(parts.minute),
    Number(parts.second),
  );
  return Math.round((asUtc - epochMs) / 60_000);
}
