/**
 * Australian states and time zones, for client and server alike.
 *
 * Keep this module small: it must never import the suburb table
 * (lib/localities.ts, via lib/location.ts), which is far too large to load
 * eagerly in client code. Suburb names are matched here as plain strings.
 *
 * Every time that isn't an event's own (messages, reports, logs) stays in
 * PLATFORM_TIME_ZONE. An event's local times convert to and from UTC
 * instants in its own zone with localToUtcIso / wallClockParts.
 */

/** The zone for everything that isn't an event's own time. */
export const PLATFORM_TIME_ZONE = "Australia/Melbourne";

/** The ABS's states and territories, OT being the other territories (Christmas, Cocos, Norfolk, Jervis Bay). */
export const STATE_CODES = ["NSW", "VIC", "QLD", "SA", "WA", "TAS", "NT", "ACT", "OT"] as const;

export type StateCode = (typeof STATE_CODES)[number];

/**
 * The zones an event in each state may use, the state's default first. A
 * later migration's check constraint mirrors this table: change both together.
 */
export const ZONES_BY_STATE = {
  NSW: ["Australia/Sydney", "Australia/Broken_Hill", "Australia/Lord_Howe"],
  VIC: ["Australia/Melbourne"],
  QLD: ["Australia/Brisbane"],
  SA: ["Australia/Adelaide"],
  WA: ["Australia/Perth", "Australia/Eucla"],
  TAS: ["Australia/Hobart"],
  NT: ["Australia/Darwin"],
  ACT: ["Australia/Sydney"],
  // Every OT locality is matched by name in defaultTimeZone, so the first
  // entry is only a fallback for a name the ABS doesn't use.
  OT: ["Indian/Christmas", "Indian/Cocos", "Pacific/Norfolk", "Australia/Sydney"],
} as const satisfies Readonly<Record<StateCode, readonly string[]>>;

/** Every zone an Australian event may use. */
export type AustralianTimeZone = (typeof ZONES_BY_STATE)[StateCode][number];

/** The zones an event in state `S` may use. */
type ZoneIn<S extends StateCode> = (typeof ZONES_BY_STATE)[S][number];

/**
 * Places whose zone isn't their state's default, by state and ABS locality
 * name (lib/localities.ts), lower case.
 *  - Yancowinna County (Broken Hill, Silverton) keeps South Australia's time.
 *  - Lord Howe Island is +10:30, and +11 in daylight saving.
 *  - The Eucla area's roadhouse towns keep the unofficial +8:45 the IANA
 *    database records for them (Australia/Eucla).
 *  - The other territories: Christmas Island, the Cocos (Keeling) Islands
 *    (Home Island, West Island), Norfolk Island, and Jervis Bay on Sydney time.
 */
const ZONE_EXCEPTIONS: { readonly [S in StateCode]?: ReadonlyMap<string, ZoneIn<S>> } = {
  NSW: new Map<string, ZoneIn<"NSW">>([
    ["broken hill", "Australia/Broken_Hill"],
    ["silverton", "Australia/Broken_Hill"],
    ["lord howe island", "Australia/Lord_Howe"],
  ]),
  WA: new Map<string, ZoneIn<"WA">>([
    ["eucla", "Australia/Eucla"],
    ["mundrabilla", "Australia/Eucla"],
    ["madura", "Australia/Eucla"],
    ["cocklebiddy", "Australia/Eucla"],
    ["caiguna", "Australia/Eucla"],
  ]),
  OT: new Map<string, ZoneIn<"OT">>([
    ["christmas island", "Indian/Christmas"],
    ["home island", "Indian/Cocos"],
    ["west island", "Indian/Cocos"],
    ["norfolk island", "Pacific/Norfolk"],
    ["jervis bay", "Australia/Sydney"],
  ]),
};

/**
 * The zone an event at `suburb` in `state` most likely uses: the state's
 * default, or the zone of a place listed in ZONE_EXCEPTIONS. `suburb` is an
 * ABS locality name, optionally followed by its state as lib/location.ts
 * writes it ("Silverton NSW"); case and spacing don't matter.
 */
export function defaultTimeZone(state: StateCode, suburb?: string | null): AustralianTimeZone {
  const fallback = ZONES_BY_STATE[state][0];
  const exceptions = ZONE_EXCEPTIONS[state];
  if (!exceptions || !suburb) return fallback;
  const key = suburb.trim().toLowerCase().replace(/\s+/g, " ");
  const suffix = ` ${state.toLowerCase()}`;
  const name = key.endsWith(suffix) ? key.slice(0, -suffix.length) : key;
  return exceptions.get(name) ?? fallback;
}

/** A local date ("YYYY-MM-DD") and time ("HH:mm"), as <input type="date"> / <input type="time"> use them. */
export interface WallClockParts {
  date: string;
  time: string;
}

const formatterCache = new Map<string, Intl.DateTimeFormat>();

/**
 * One shared Intl.DateTimeFormat per locale, options and zone: building one
 * is slow, and formatters are used over and over (every card on a page).
 * Throws RangeError for a zone the runtime doesn't know.
 */
export function cachedDateTimeFormat(
  locale: string,
  options: Intl.DateTimeFormatOptions & { timeZone: string },
): Intl.DateTimeFormat {
  const key = `${locale}|${JSON.stringify(options)}`;
  let formatter = formatterCache.get(key);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat(locale, options);
    formatterCache.set(key, formatter);
  }
  return formatter;
}

interface LocalDateTime {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
}

function localPartsAt(epochMs: number, timeZone: string): LocalDateTime {
  const formatter = cachedDateTimeFormat("en-US", {
    timeZone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const parts = Object.fromEntries(formatter.formatToParts(new Date(epochMs)).map((p) => [p.type, p.value]));
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    // Intl renders midnight as "24" with hour12: false; normalise to 0.
    hour: Number(parts.hour) % 24,
    minute: Number(parts.minute),
  };
}

/** The zone's UTC offset, in minutes, at the given instant (daylight saving included). */
function offsetMinutesAt(epochMs: number, timeZone: string): number {
  const parts = localPartsAt(epochMs, timeZone);
  const asUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, 0);
  return Math.round((asUtc - epochMs) / 60_000);
}

function partsEqual(a: LocalDateTime, b: LocalDateTime): boolean {
  return a.year === b.year && a.month === b.month && a.day === b.day && a.hour === b.hour && a.minute === b.minute;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME_PATTERN = /^(\d{2}):(\d{2})$/;

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

/**
 * Converts a local date + time in `timeZone` into a UTC instant (ISO 8601),
 * honouring daylight saving, including Lord Howe's half-hour shift.
 *
 * A local time maps to UTC in one of three ways near a transition:
 *  - Normal: exactly one UTC instant shows the requested local time.
 *  - Spring-forward gap (e.g. Melbourne's 2:00am -> 3:00am, Lord Howe's
 *    2:00am -> 2:30am): the local time never happens — rejected.
 *  - Fall-back overlap (e.g. 3:00am -> 2:00am): the local time happens
 *    twice — resolved to the first (earlier, daylight-saving) occurrence.
 *
 * `dateStr` is "YYYY-MM-DD", `timeStr` is "HH:mm". Throws RangeError for a
 * malformed or calendar-invalid date, an out-of-range time, a local time in
 * a spring-forward gap, or a zone the runtime doesn't know. Callers taking
 * user input turn the RangeError into a 400.
 */
export function localToUtcIso(dateStr: string, timeStr: string, timeZone: string): string {
  const local = parseLocalDateTime(dateStr, timeStr);
  const naiveUtcMs = Date.UTC(local.year, local.month - 1, local.day, local.hour, local.minute, 0);

  // No Australian zone changes offset more than once in any two days, so
  // probing a day either side of the naive guess surfaces both candidate
  // offsets near a transition (and one, repeated, everywhere else) without
  // hardcoding any zone's offsets.
  const candidateOffsets = new Set([
    offsetMinutesAt(naiveUtcMs - DAY_MS, timeZone),
    offsetMinutesAt(naiveUtcMs, timeZone),
    offsetMinutesAt(naiveUtcMs + DAY_MS, timeZone),
  ]);

  const matches: number[] = [];
  for (const offsetMinutes of candidateOffsets) {
    const candidateMs = naiveUtcMs - offsetMinutes * 60_000;
    if (partsEqual(localPartsAt(candidateMs, timeZone), local)) {
      matches.push(candidateMs);
    }
  }

  if (matches.length === 0) {
    throw new RangeError(
      `${dateStr} ${timeStr} is not a valid ${timeZone} local time — it falls in the ` +
        "daylight-saving spring-forward gap, when the clocks jump forward.",
    );
  }

  // Ambiguous (the local time happened twice when clocks fell back): resolve
  // to its first, daylight-saving occurrence — the earlier matching instant.
  return new Date(Math.min(...matches)).toISOString();
}

/**
 * The local date and time an instant shows in `timeZone`, never the
 * runtime's own zone: the inverse of localToUtcIso, for date/time inputs.
 * Throws RangeError for an invalid instant or zone.
 */
export function wallClockParts(isoLike: string | Date, timeZone: string): WallClockParts {
  const epochMs = new Date(isoLike).getTime();
  if (Number.isNaN(epochMs)) throw new RangeError("Invalid time value");
  const parts = localPartsAt(epochMs, timeZone);
  const two = (n: number) => String(n).padStart(2, "0");
  return {
    date: `${String(parts.year).padStart(4, "0")}-${two(parts.month)}-${two(parts.day)}`,
    time: `${two(parts.hour)}:${two(parts.minute)}`,
  };
}

/** What a zone's label calls it: "{City} time". */
const ZONE_CITIES: ReadonlyMap<string, string> = new Map([
  ["Australia/Melbourne", "Melbourne"],
  ["Australia/Sydney", "Sydney"],
  ["Australia/Brisbane", "Brisbane"],
  ["Australia/Adelaide", "Adelaide"],
  ["Australia/Perth", "Perth"],
  ["Australia/Hobart", "Hobart"],
  ["Australia/Darwin", "Darwin"],
  ["Australia/Broken_Hill", "Broken Hill"],
  ["Australia/Lord_Howe", "Lord Howe Island"],
  ["Australia/Eucla", "Eucla"],
  ["Pacific/Norfolk", "Norfolk Island"],
  ["Indian/Christmas", "Christmas Island"],
  ["Indian/Cocos", "Cocos (Keeling) Islands"],
]);

/**
 * The abbreviations people know. Others (ICU's ACWST for Eucla, LHST/LHDT
 * for Lord Howe, "GMT+12" for Norfolk) are shown as a UTC offset instead.
 */
const KNOWN_ABBREVIATIONS: ReadonlySet<string> = new Set(["AEST", "AEDT", "ACST", "ACDT", "AWST"]);

function cityFor(timeZone: string, state?: StateCode | null): string {
  if (state === "ACT" && timeZone === "Australia/Sydney") return "Canberra";
  return ZONE_CITIES.get(timeZone) ?? (timeZone.split("/").pop() ?? timeZone).replace(/_/g, " ");
}

/** "UTC+10:30", "UTC+07:00", "UTC-03:00". */
function utcOffsetLabel(offsetMinutes: number): string {
  const sign = offsetMinutes < 0 ? "-" : "+";
  const abs = Math.abs(offsetMinutes);
  return `UTC${sign}${String(Math.floor(abs / 60)).padStart(2, "0")}:${String(abs % 60).padStart(2, "0")}`;
}

/**
 * The zone as people read it at `instant`: "{City} time (ABBR)", e.g.
 * "Perth time (AWST)" or "Melbourne time (AEDT)", or with a UTC offset when
 * the abbreviation isn't one of AEST, AEDT, ACST, ACDT and AWST:
 * "Lord Howe Island time (UTC+11:00)". The ACT's zone is Sydney's, so pass
 * the state to have it read "Canberra time". Throws RangeError for an
 * invalid instant or zone.
 */
export function zoneLabel(timeZone: string, instant: string | Date, state?: StateCode | null): string {
  const epochMs = new Date(instant).getTime();
  if (Number.isNaN(epochMs)) throw new RangeError("Invalid time value");
  const formatter = cachedDateTimeFormat("en-AU", { timeZone, timeZoneName: "short" });
  const abbreviation = formatter.formatToParts(new Date(epochMs)).find((part) => part.type === "timeZoneName")?.value;
  const suffix =
    abbreviation !== undefined && KNOWN_ABBREVIATIONS.has(abbreviation)
      ? abbreviation
      : utcOffsetLabel(offsetMinutesAt(epochMs, timeZone));
  return `${cityFor(timeZone, state)} time (${suffix})`;
}
