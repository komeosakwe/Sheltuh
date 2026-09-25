/**
 * Converts an organiser-submitted Australia/Melbourne local date + time into
 * a correct UTC instant, honouring AEST (+10) / AEDT (+11) daylight saving.
 *
 * Melbourne local time maps to UTC in three distinct ways depending on how
 * close it is to a DST transition:
 *  - Normal: exactly one UTC instant reproduces the requested local time.
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
  const local = parseLocalDateTime(dateStr, timeStr);
  const naiveUtcMs = Date.UTC(local.year, local.month - 1, local.day, local.hour, local.minute, 0);

  // Melbourne changes offset at most once per +/-1 day window, so probing a
  // day either side of the naive guess reliably surfaces both candidate
  // offsets near a transition (and one, repeated, everywhere else) without
  // hardcoding the +10/+11 values.
  const candidateOffsets = new Set([
    melbourneOffsetMinutesAt(naiveUtcMs - DAY_MS),
    melbourneOffsetMinutesAt(naiveUtcMs),
    melbourneOffsetMinutesAt(naiveUtcMs + DAY_MS),
  ]);

  const matches: number[] = [];
  for (const offsetMinutes of candidateOffsets) {
    const candidateMs = naiveUtcMs - offsetMinutes * 60_000;
    if (partsEqual(melbourneWallClockParts(candidateMs), local)) {
      matches.push(candidateMs);
    }
  }

  if (matches.length === 0) {
    throw new RangeError(
      `${dateStr} ${timeStr} is not a valid Australia/Melbourne local time — it falls in the ` +
        "daylight-saving spring-forward gap, when clocks jump from 2:00am to 3:00am.",
    );
  }

  // Ambiguous (the local time occurred twice when clocks fell back): resolve
  // to its first, DST-side occurrence — the earlier of the matching instants.
  return new Date(Math.min(...matches)).toISOString();
}

const DAY_MS = 24 * 60 * 60 * 1000;

const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME_PATTERN = /^(\d{2}):(\d{2})$/;

interface LocalDateTime {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
}

function parseLocalDateTime(dateStr: string, timeStr: string): LocalDateTime {
  const dateMatch = DATE_PATTERN.exec(dateStr);
  const timeMatch = TIME_PATTERN.exec(timeStr);
  if (!dateMatch || !timeMatch) {
    throw new RangeError(`Invalid date/time format: ${dateStr} ${timeStr}`);
  }

  const year = Number(dateMatch[1]);
  const month = Number(dateMatch[2]);
  const day = Number(dateMatch[3]);
  const hour = Number(timeMatch[1]);
  const minute = Number(timeMatch[2]);

  if (hour > 23 || minute > 59) {
    throw new RangeError(`Invalid time: ${timeStr}`);
  }

  // JS Date arithmetic silently normalises overflowing components (e.g.
  // 2026-02-30 rolls into March) instead of rejecting them — reject any
  // date whose components don't survive a round trip through Date.UTC.
  const roundTrip = new Date(Date.UTC(year, month - 1, day));
  if (
    roundTrip.getUTCFullYear() !== year ||
    roundTrip.getUTCMonth() !== month - 1 ||
    roundTrip.getUTCDate() !== day
  ) {
    throw new RangeError(`Invalid calendar date: ${dateStr}`);
  }

  return { year, month, day, hour, minute };
}

const wallClockFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: "Australia/Melbourne",
  hour12: false,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});

function melbourneWallClockParts(epochMs: number): LocalDateTime {
  const parts = Object.fromEntries(
    wallClockFormatter.formatToParts(new Date(epochMs)).map((p) => [p.type, p.value]),
  );
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    // Intl renders midnight as "24" with hour12: false; normalise to 0.
    hour: Number(parts.hour) % 24,
    minute: Number(parts.minute),
  };
}

function partsEqual(a: LocalDateTime, b: LocalDateTime): boolean {
  return a.year === b.year && a.month === b.month && a.day === b.day && a.hour === b.hour && a.minute === b.minute;
}

/** Melbourne's UTC offset, in minutes, at the given instant (handles DST). */
function melbourneOffsetMinutesAt(epochMs: number): number {
  const parts = melbourneWallClockParts(epochMs);
  const asUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, 0);
  return Math.round((asUtc - epochMs) / 60_000);
}
