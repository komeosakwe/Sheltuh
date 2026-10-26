import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { allLocalities } from "@/lib/location";
import {
  defaultTimeZone,
  localToUtcIso,
  PLATFORM_TIME_ZONE,
  STATE_CODES,
  wallClockParts,
  ZONES_BY_STATE,
  zoneLabel,
} from "@/lib/time-zones";

// The 2026 transitions (tzdata): Australian daylight saving ends on Sun 5
// April and starts on Sun 4 October.

describe("localToUtcIso — zones without daylight saving", () => {
  it.each([
    ["Australia/Brisbane", "2026-01-15", "19:00", "2026-01-15T09:00:00.000Z"],
    ["Australia/Brisbane", "2026-10-04", "02:30", "2026-10-03T16:30:00.000Z"],
    ["Australia/Perth", "2026-01-15", "19:00", "2026-01-15T11:00:00.000Z"],
    ["Australia/Perth", "2026-07-15", "00:00", "2026-07-14T16:00:00.000Z"],
    ["Australia/Darwin", "2026-01-15", "19:00", "2026-01-15T09:30:00.000Z"],
    ["Australia/Darwin", "2026-04-05", "02:30", "2026-04-04T17:00:00.000Z"],
    ["Australia/Eucla", "2026-01-15", "19:00", "2026-01-15T10:15:00.000Z"],
    ["Indian/Christmas", "2026-01-15", "19:00", "2026-01-15T12:00:00.000Z"],
    ["Indian/Cocos", "2026-01-15", "19:00", "2026-01-15T12:30:00.000Z"],
  ])("%s %s %s is %s, all year round", (tz, date, time, iso) => {
    expect(localToUtcIso(date, time, tz)).toBe(iso);
  });
});

/**
 * Each zone's spring-forward gap (local times that never happen on 4 Oct
 * 2026) and fall-back repeat (local times that happen twice on 5 Apr 2026),
 * with offsets (minutes) before and after daylight saving.
 */
const DST_ZONES = [
  { tz: "Australia/Melbourne", std: 600, dst: 660, gap: ["02:00", "02:59"], gapEnd: "03:00", repeat: ["02:00", "02:59"] },
  { tz: "Australia/Sydney", std: 600, dst: 660, gap: ["02:00", "02:59"], gapEnd: "03:00", repeat: ["02:00", "02:59"] },
  { tz: "Australia/Hobart", std: 600, dst: 660, gap: ["02:00", "02:59"], gapEnd: "03:00", repeat: ["02:00", "02:59"] },
  { tz: "Australia/Adelaide", std: 570, dst: 630, gap: ["02:00", "02:59"], gapEnd: "03:00", repeat: ["02:00", "02:59"] },
  { tz: "Australia/Broken_Hill", std: 570, dst: 630, gap: ["02:00", "02:59"], gapEnd: "03:00", repeat: ["02:00", "02:59"] },
  // Lord Howe moves by half an hour: 2:00am -> 2:30am, and back 2:00am -> 1:30am.
  { tz: "Australia/Lord_Howe", std: 630, dst: 660, gap: ["02:00", "02:29"], gapEnd: "02:30", repeat: ["01:30", "01:59"] },
  { tz: "Pacific/Norfolk", std: 660, dst: 720, gap: ["02:00", "02:59"], gapEnd: "03:00", repeat: ["02:00", "02:59"] },
] as const;

/** The UTC instant of a local date + time at a fixed offset, by arithmetic alone. */
function atOffset(date: string, time: string, offsetMinutes: number): string {
  const [y, m, d] = date.split("-").map(Number);
  const [h, min] = time.split(":").map(Number);
  return new Date(Date.UTC(y, m - 1, d, h, min) - offsetMinutes * 60_000).toISOString();
}

function minusMinute(time: string): string {
  const [h, m] = time.split(":").map(Number);
  const total = h * 60 + m - 1;
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

describe.each(DST_ZONES)("localToUtcIso — $tz daylight saving", ({ tz, std, dst, gap, gapEnd, repeat }) => {
  it("uses standard time in winter and daylight time in summer", () => {
    expect(localToUtcIso("2026-07-15", "19:00", tz)).toBe(atOffset("2026-07-15", "19:00", std));
    expect(localToUtcIso("2026-01-15", "19:00", tz)).toBe(atOffset("2026-01-15", "19:00", dst));
  });

  it("rejects local times in the spring-forward gap", () => {
    for (const time of gap) {
      expect(() => localToUtcIso("2026-10-04", time, tz)).toThrow(RangeError);
    }
  });

  it("accepts the minute either side of the gap, with the right offset", () => {
    expect(localToUtcIso("2026-10-04", minusMinute(gap[0]), tz)).toBe(atOffset("2026-10-04", minusMinute(gap[0]), std));
    expect(localToUtcIso("2026-10-04", gapEnd, tz)).toBe(atOffset("2026-10-04", gapEnd, dst));
    // The same clock times a day either side are ordinary.
    expect(localToUtcIso("2026-10-03", gap[0], tz)).toBe(atOffset("2026-10-03", gap[0], std));
    expect(localToUtcIso("2026-10-05", gap[0], tz)).toBe(atOffset("2026-10-05", gap[0], dst));
  });

  it("resolves a repeated local time to its first (daylight-time) occurrence", () => {
    for (const time of repeat) {
      expect(localToUtcIso("2026-04-05", time, tz)).toBe(atOffset("2026-04-05", time, dst));
    }
    // Just before the repeat is still daylight time; a day later it's standard time.
    expect(localToUtcIso("2026-04-05", minusMinute(repeat[0]), tz)).toBe(
      atOffset("2026-04-05", minusMinute(repeat[0]), dst),
    );
    expect(localToUtcIso("2026-04-06", repeat[0], tz)).toBe(atOffset("2026-04-06", repeat[0], std));
    expect(localToUtcIso("2026-04-04", repeat[0], tz)).toBe(atOffset("2026-04-04", repeat[0], dst));
  });
});

describe("localToUtcIso — invalid input", () => {
  it("rejects malformed or impossible dates and times", () => {
    expect(() => localToUtcIso("2026-02-30", "10:00", "Australia/Perth")).toThrow(RangeError);
    expect(() => localToUtcIso("2026-01-01", "24:00", "Australia/Perth")).toThrow(RangeError);
    expect(() => localToUtcIso("2026-1-01", "10:00", "Australia/Perth")).toThrow(RangeError);
    expect(() => localToUtcIso("2026-01-01", "10:00:00", "Australia/Perth")).toThrow(RangeError);
  });

  it("rejects a zone the runtime doesn't know", () => {
    expect(() => localToUtcIso("2026-01-01", "10:00", "Australia/Atlantis")).toThrow(RangeError);
  });
});

describe("wallClockParts — the inverse of localToUtcIso", () => {
  it("reads an instant in the given zone, not the runtime's", () => {
    const instant = "2026-01-15T11:00:00.000Z";
    expect(wallClockParts(instant, "Australia/Perth")).toEqual({ date: "2026-01-15", time: "19:00" });
    expect(wallClockParts(instant, "Australia/Adelaide")).toEqual({ date: "2026-01-15", time: "21:30" });
    expect(wallClockParts(instant, "Australia/Melbourne")).toEqual({ date: "2026-01-15", time: "22:00" });
    expect(wallClockParts(instant, "Pacific/Norfolk")).toEqual({ date: "2026-01-15", time: "23:00" });
    expect(wallClockParts("2026-01-15T13:30:00.000Z", "Pacific/Norfolk")).toEqual({ date: "2026-01-16", time: "01:30" });
  });

  it("writes midnight as 00:00", () => {
    expect(wallClockParts("2026-07-14T16:00:00.000Z", "Australia/Perth")).toEqual({ date: "2026-07-15", time: "00:00" });
  });

  it("rejects an invalid instant", () => {
    expect(() => wallClockParts("not a date", "Australia/Perth")).toThrow(RangeError);
  });

  it("round-trips every quarter hour of the transition days in every zone", () => {
    const zones = [...new Set(Object.values(ZONES_BY_STATE).flat())];
    for (const tz of zones) {
      for (const date of ["2026-04-04", "2026-04-05", "2026-04-06", "2026-10-03", "2026-10-04", "2026-10-05"]) {
        for (let minutes = 0; minutes < 24 * 60; minutes += 15) {
          const time = `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
          let iso: string;
          try {
            iso = localToUtcIso(date, time, tz);
          } catch (error) {
            // Only a spring-forward gap may refuse a well-formed time.
            expect(error).toBeInstanceOf(RangeError);
            expect(date).toBe("2026-10-04");
            continue;
          }
          expect(wallClockParts(iso, tz), `${tz} ${date} ${time}`).toEqual({ date, time });
        }
      }
    }
  });
});

describe("ZONES_BY_STATE and defaultTimeZone", () => {
  it("covers every state, the platform's zone being Victoria's", () => {
    expect(Object.keys(ZONES_BY_STATE).sort()).toEqual([...STATE_CODES].sort());
    expect(ZONES_BY_STATE.VIC[0]).toBe(PLATFORM_TIME_ZONE);
    expect(ZONES_BY_STATE.ACT).toEqual(["Australia/Sydney"]);
  });

  it("lists only zones the runtime knows", () => {
    for (const zones of Object.values(ZONES_BY_STATE)) {
      for (const tz of zones) expect(() => new Intl.DateTimeFormat("en-AU", { timeZone: tz })).not.toThrow();
    }
  });

  it("defaults each state to its first zone", () => {
    for (const state of STATE_CODES) {
      expect(defaultTimeZone(state)).toBe(ZONES_BY_STATE[state][0]);
      expect(defaultTimeZone(state, null)).toBe(ZONES_BY_STATE[state][0]);
    }
    expect(defaultTimeZone("ACT", "City")).toBe("Australia/Sydney");
    expect(defaultTimeZone("VIC", "Fitzroy")).toBe("Australia/Melbourne");
  });

  it.each([
    ["NSW", "Broken Hill", "Australia/Broken_Hill"],
    ["NSW", "Silverton NSW", "Australia/Broken_Hill"],
    ["NSW", "Lord Howe Island", "Australia/Lord_Howe"],
    ["NSW", "  lord   howe ISLAND ", "Australia/Lord_Howe"],
    ["WA", "Eucla", "Australia/Eucla"],
    ["WA", "Madura", "Australia/Eucla"],
    ["OT", "Christmas Island", "Indian/Christmas"],
    ["OT", "Home Island", "Indian/Cocos"],
    ["OT", "West Island", "Indian/Cocos"],
    ["OT", "Norfolk Island", "Pacific/Norfolk"],
    ["OT", "Jervis Bay", "Australia/Sydney"],
    // A name only counts in its own state: Silverton SA is on Adelaide time anyway.
    ["SA", "Silverton", "Australia/Adelaide"],
    ["VIC", "Broken Hill", "Australia/Melbourne"],
    ["NSW", "Broken Hill West", "Australia/Sydney"],
  ] as const)("%s %s -> %s", (state, suburb, tz) => {
    expect(defaultTimeZone(state, suburb)).toBe(tz);
  });

  it("gives every ABS locality one of its state's zones, and uses every zone somewhere", () => {
    const used = new Set<string>();
    for (const place of allLocalities()) {
      const tz = defaultTimeZone(place.state, place.name);
      expect(ZONES_BY_STATE[place.state] as readonly string[], place.name).toContain(tz);
      used.add(`${place.state} ${tz}`);
    }
    for (const state of STATE_CODES) {
      for (const tz of ZONES_BY_STATE[state]) expect([...used]).toContain(`${state} ${tz}`);
    }
  });

  it("names exception places as the ABS does", () => {
    const names = allLocalities().map((place) => `${place.state} ${place.name.replace(/ (NSW|SA|WA)$/, "")}`);
    for (const name of [
      "NSW Broken Hill",
      "NSW Silverton",
      "NSW Lord Howe Island",
      "WA Eucla",
      "WA Mundrabilla",
      "WA Madura",
      "WA Cocklebiddy",
      "WA Caiguna",
      "OT Christmas Island",
      "OT Home Island",
      "OT West Island",
      "OT Norfolk Island",
      "OT Jervis Bay",
    ]) {
      expect(names).toContain(name);
    }
  });

  it("keeps the suburb table out of lib/time-zones.ts, which client code loads eagerly", () => {
    const source = readFileSync(path.join(__dirname, "../lib/time-zones.ts"), "utf8");
    expect(source).not.toMatch(/^\s*import\b/m);
  });
});

describe("zoneLabel — '{City} time (ABBR)', or a UTC offset", () => {
  const winter = "2026-07-15T03:00:00.000Z";
  const summer = "2026-01-15T03:00:00.000Z";

  it.each([
    ["Australia/Melbourne", "Melbourne time (AEST)", "Melbourne time (AEDT)"],
    ["Australia/Sydney", "Sydney time (AEST)", "Sydney time (AEDT)"],
    ["Australia/Hobart", "Hobart time (AEST)", "Hobart time (AEDT)"],
    ["Australia/Brisbane", "Brisbane time (AEST)", "Brisbane time (AEST)"],
    ["Australia/Adelaide", "Adelaide time (ACST)", "Adelaide time (ACDT)"],
    ["Australia/Broken_Hill", "Broken Hill time (ACST)", "Broken Hill time (ACDT)"],
    ["Australia/Darwin", "Darwin time (ACST)", "Darwin time (ACST)"],
    ["Australia/Perth", "Perth time (AWST)", "Perth time (AWST)"],
  ])("%s: familiar abbreviations", (tz, winterLabel, summerLabel) => {
    expect(zoneLabel(tz, winter)).toBe(winterLabel);
    expect(zoneLabel(tz, summer)).toBe(summerLabel);
  });

  // ICU names these ACWST, LHST/LHDT, GMT+7, GMT+6:30 and GMT+11/GMT+12:
  // assert the offsets, never ICU's own names.
  it.each([
    ["Australia/Eucla", "Eucla time (UTC+08:45)", "Eucla time (UTC+08:45)"],
    ["Australia/Lord_Howe", "Lord Howe Island time (UTC+10:30)", "Lord Howe Island time (UTC+11:00)"],
    ["Pacific/Norfolk", "Norfolk Island time (UTC+11:00)", "Norfolk Island time (UTC+12:00)"],
    ["Indian/Christmas", "Christmas Island time (UTC+07:00)", "Christmas Island time (UTC+07:00)"],
    ["Indian/Cocos", "Cocos (Keeling) Islands time (UTC+06:30)", "Cocos (Keeling) Islands time (UTC+06:30)"],
  ])("%s: an offset instead of ICU's name", (tz, winterLabel, summerLabel) => {
    expect(zoneLabel(tz, winter)).toBe(winterLabel);
    expect(zoneLabel(tz, summer)).toBe(summerLabel);
  });

  it("calls the ACT's zone Canberra time, and Jervis Bay's Sydney time", () => {
    expect(zoneLabel("Australia/Sydney", summer, "ACT")).toBe("Canberra time (AEDT)");
    expect(zoneLabel("Australia/Sydney", winter, "ACT")).toBe("Canberra time (AEST)");
    expect(zoneLabel("Australia/Sydney", summer, "OT")).toBe("Sydney time (AEDT)");
    expect(zoneLabel("Australia/Sydney", summer, "NSW")).toBe("Sydney time (AEDT)");
  });

  it("follows the offset in effect at the instant, across a transition", () => {
    // Lord Howe goes to +11 at 2026-10-03T15:30Z.
    expect(zoneLabel("Australia/Lord_Howe", "2026-10-03T15:29:00.000Z")).toBe("Lord Howe Island time (UTC+10:30)");
    expect(zoneLabel("Australia/Lord_Howe", "2026-10-03T15:30:00.000Z")).toBe("Lord Howe Island time (UTC+11:00)");
    expect(zoneLabel("Australia/Adelaide", new Date("2026-10-03T16:29:00.000Z"))).toBe("Adelaide time (ACST)");
    expect(zoneLabel("Australia/Adelaide", new Date("2026-10-03T16:30:00.000Z"))).toBe("Adelaide time (ACDT)");
  });

  it("uses the zone's own name, and a negative offset, for a zone outside the table", () => {
    expect(zoneLabel("America/Sao_Paulo", winter)).toBe("Sao Paulo time (UTC-03:00)");
  });

  it("rejects an invalid instant or zone", () => {
    expect(() => zoneLabel("Australia/Perth", "nope")).toThrow(RangeError);
    expect(() => zoneLabel("Australia/Atlantis", winter)).toThrow(RangeError);
  });
});
