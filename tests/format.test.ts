import { afterEach, describe, expect, it } from "vitest";
import {
  formatDayWithYear,
  formatDayTime,
  formatMessageTime,
  formatDateBadge,
  formatEventDateKey,
  formatEventDateShort,
  formatEventDateTimeRange,
  formatEventTime,
  formatEventWhen,
  formatTimeZoneLabel,
  eventZone,
  zoneSuffix,
  toDateTimeInputParts,
  toMelbourneDateTimeInputParts,
} from "../lib/format";

describe("Melbourne date/time formatting (real UTC instants, AEST/AEDT-aware)", () => {
  it("formats an AEST (winter) instant as Melbourne local time", () => {
    // 2026-09-25T10:00:00Z is AEST (+10) -> 8:00pm local on the same UTC date.
    expect(formatEventDateShort("2026-09-25T10:00:00.000Z")).toBe("Fri 25 Sept");
    expect(formatEventTime("2026-09-25T10:00:00.000Z")).toBe("8:00 pm");
  });

  it("formats an AEDT (daylight saving) instant as Melbourne local time", () => {
    // 2026-10-08T08:00:00Z is AEDT (+11) -> 7:00pm local.
    expect(formatEventDateShort("2026-10-08T08:00:00.000Z")).toBe("Thu 8 Oct");
    expect(formatEventTime("2026-10-08T08:00:00.000Z")).toBe("7:00 pm");
  });

  it("renders a same-day range without repeating the date", () => {
    // Paper Moon Ceramics Lab: 10:00am - 1:00pm AEST, same Melbourne day.
    expect(formatEventDateTimeRange("2026-10-03T00:00:00.000Z", "2026-10-03T03:00:00.000Z")).toBe(
      "Sat 3 Oct, 10:00 am – 1:00 pm",
    );
  });

  it("spells out the end date when the Melbourne-local day changes", () => {
    // Neon Static: 8:00pm Fri 25 Sep AEST through to 12:00am Sat 26 Sep.
    expect(formatEventDateTimeRange("2026-09-25T10:00:00.000Z", "2026-09-25T14:00:00.000Z")).toBe(
      "Fri 25 Sept, 8:00 pm – Sat 26 Sept, 12:00 am",
    );
  });

  it("computes the Melbourne calendar day, which can differ from the UTC one", () => {
    // Analog Print Weekend start: 2026-11-20T23:00:00Z is 10:00am AEDT on Nov 21.
    expect(formatEventDateKey("2026-11-20T23:00:00.000Z")).toBe("2026-11-21");
  });
});

describe("toMelbourneDateTimeInputParts — ignores the runtime's own timezone", () => {
  const originalTz = process.env.TZ;

  afterEach(() => {
    process.env.TZ = originalTz;
  });

  it("splits an AEST instant into Melbourne-local date/time input values", () => {
    // 2026-09-25T10:00:00Z is 8:00pm AEST (+10) on the same UTC calendar date.
    expect(toMelbourneDateTimeInputParts("2026-09-25T10:00:00.000Z")).toEqual({
      date: "2026-09-25",
      time: "20:00",
    });
  });

  it("splits an AEDT instant into Melbourne-local date/time input values", () => {
    // 2026-10-08T08:00:00Z is 7:00pm AEDT (+11).
    expect(toMelbourneDateTimeInputParts("2026-10-08T08:00:00.000Z")).toEqual({
      date: "2026-10-08",
      time: "19:00",
    });
  });

  it("rolls over to the next Melbourne calendar day near a UTC/local date boundary", () => {
    // 2026-11-20T23:00:00Z is 10:00am AEDT on Nov 21 — a different date than the UTC instant's.
    expect(toMelbourneDateTimeInputParts("2026-11-20T23:00:00.000Z")).toEqual({
      date: "2026-11-21",
      time: "10:00",
    });
  });

  it("produces the same result regardless of the browser/runtime's own timezone", () => {
    // The stored instant is a fixed point in time; only the *display* timezone
    // (always Australia/Melbourne here) may determine the date/time parts —
    // never process.env.TZ / the host's local zone. This is the exact bug:
    // the old isoToDateTimeParts used `new Date().getHours()` etc., which
    // read back in the browser's own zone instead of Melbourne's.
    const instant = "2026-09-25T10:00:00.000Z";
    const expected = { date: "2026-09-25", time: "20:00" };

    for (const tz of ["UTC", "America/New_York", "Pacific/Auckland", "Asia/Kolkata"]) {
      process.env.TZ = tz;
      expect(toMelbourneDateTimeInputParts(instant)).toEqual(expected);
    }
  });

  it("round-trips DST-adjacent dates (AEDT start, 2026-10-04 02:00 -> 03:00 local)", () => {
    // 2026-10-04T02:30:00Z is 1:30pm AEDT on Oct 4 (already past the 2am->3am
    // spring-forward, which happened at 2026-10-04T02:00:00Z in UTC-anchored
    // terms — see lib/server/melbourne-time.ts for the inverse).
    expect(toMelbourneDateTimeInputParts("2026-10-04T02:30:00.000Z")).toEqual({
      date: "2026-10-04",
      time: "13:30",
    });
  });

  it("round-trips DST-adjacent dates (AEDT end, just after the fall-back)", () => {
    // 2026-04-04T16:00:00Z is 2:00am AEST on Apr 5, just after clocks fall
    // back from AEDT — still unambiguous as a UTC instant.
    expect(toMelbourneDateTimeInputParts("2026-04-04T16:00:00.000Z")).toEqual({
      date: "2026-04-05",
      time: "02:00",
    });
  });
});

describe("formatDateBadge (phone home date badge, Melbourne time)", () => {
  it("shows a single day as its date and month", () => {
    // 2026-10-03T00:00Z is 11:00 am on Sat 3 Oct in Melbourne (AEDT).
    expect(formatDateBadge("2026-10-03T00:00:00.000Z")).toEqual({ range: "3", month: "OCT" });
  });

  it("counts an end on the same Melbourne date as one day", () => {
    expect(formatDateBadge("2026-10-03T00:00:00.000Z", "2026-10-03T03:00:00.000Z")).toEqual({ range: "3", month: "OCT" });
  });

  it("uses the Melbourne date, not the UTC one", () => {
    // 2026-10-02T14:00Z is 1:00 am on Sat 3 Oct in Melbourne, still 2 Oct in UTC.
    expect(formatDateBadge("2026-10-02T14:00:00.000Z")).toEqual({ range: "3", month: "OCT" });
  });

  it("shows a span within a month as a day range", () => {
    expect(formatDateBadge("2026-10-19T00:00:00.000Z", "2026-10-25T08:00:00.000Z")).toEqual({
      range: "19–25",
      month: "OCT",
    });
  });

  it("names the start month when a span crosses into the next month", () => {
    expect(formatDateBadge("2026-10-30T00:00:00.000Z", "2026-11-02T08:00:00.000Z")).toEqual({
      range: "30 OCT–2",
      month: "NOV",
    });
  });
});

describe("formatMessageTime (Melbourne time)", () => {
  it("shows just the time on the same Melbourne day, and the date too otherwise", () => {
    // 9:05 am AEST on Sat 26 Sep; "now" later that Melbourne day (but a different UTC date).
    const sent = "2026-09-25T23:05:00.000Z";
    expect(formatMessageTime(sent, new Date("2026-09-26T10:00:00.000Z"))).toBe("9:05 am");
    expect(formatMessageTime(sent, new Date("2026-09-26T15:00:00.000Z"))).toBe(`${formatEventDateShort(sent)}, 9:05 am`);
    expect(formatEventDateShort(sent)).toMatch(/^Sat 26 Sept?$/);
  });

  it("adds the year only when it isn't the current Melbourne year", () => {
    const lastYear = "2025-12-31T12:30:00.000Z"; // 11:30 pm AEDT on Wed 31 Dec 2025
    const now = new Date("2026-01-01T02:00:00.000Z"); // 1 pm AEDT on 1 Jan 2026
    expect(formatMessageTime(lastYear, now)).toBe(`${formatEventDateShort(lastYear)} 2025, 11:30 pm`);
    expect(formatDayWithYear(lastYear, now)).toMatch(/^Wed 31 Dec 2025$/);
    // Same instant seen from later that Melbourne year: no year.
    expect(formatDayWithYear(lastYear, new Date("2025-12-31T05:00:00.000Z"))).toMatch(/^Wed 31 Dec$/);
  });
});

describe("formatDayTime (Melbourne time, always with the day)", () => {
  it("keeps the day even on the same day, and adds the year when it's not this year", () => {
    const now = new Date("2026-09-26T10:00:00.000Z");
    // The month's abbreviation depends on the ICU data ("Sep" / "Sept").
    const sameDay = "2026-09-25T23:05:00.000Z";
    expect(formatDayTime(sameDay, now)).toBe(`${formatEventDateShort(sameDay)}, 9:05 am`);
    expect(formatDayTime(sameDay, now)).toMatch(/^Sat 26 Sept?, 9:05 am$/);
    const lastYear = "2025-09-25T13:30:00.000Z";
    expect(formatDayTime(lastYear, now)).toBe(`${formatEventDateShort(lastYear)} 2025, 11:30 pm`);
  });
});

describe("formatTimeZoneLabel (the event page's zone, at the event's start)", () => {
  it("AEST before daylight saving starts (4 Oct 2026), AEDT after", () => {
    expect(formatTimeZoneLabel("2026-09-25T10:00:00.000Z")).toBe("Melbourne time (AEST)");
    expect(formatTimeZoneLabel("2026-10-24T08:00:00.000Z")).toBe("Melbourne time (AEDT)");
  });

  it("AEST again once daylight saving ends (5 Apr 2026)", () => {
    expect(formatTimeZoneLabel("2026-04-10T08:00:00.000Z")).toBe("Melbourne time (AEST)");
  });
});

describe("formatters in another event zone (Perth: AWST, no daylight saving; Adelaide: ACST/ACDT)", () => {
  // 2026-01-15T11:30:00Z is 7:30 pm AWST (+8) in Perth, 10:00 pm ACDT (+10:30)
  // in Adelaide and 10:30 pm AEDT (+11) in Melbourne, all on Thu 15 Jan.
  const summer = "2026-01-15T11:30:00.000Z";
  // 2026-08-12T15:00:00Z is 11:00 pm AWST on Wed 12 Aug in Perth, but
  // 12:30 am ACST and 1:00 am AEST on Thu 13 Aug in Adelaide and Melbourne.
  const winterLate = "2026-08-12T15:00:00.000Z";

  it("formats the day and time in the given zone", () => {
    expect(formatEventTime(summer, "Australia/Perth")).toBe("7:30 pm");
    expect(formatEventTime(summer, "Australia/Adelaide")).toBe("10:00 pm");
    expect(formatEventTime(summer)).toBe("10:30 pm");
    expect(formatEventDateShort(winterLate, "Australia/Perth")).toBe("Wed 12 Aug");
    expect(formatEventDateShort(winterLate, "Australia/Adelaide")).toBe("Thu 13 Aug");
    expect(formatEventTime(winterLate, "Australia/Adelaide")).toBe("12:30 am");
    expect(formatEventDateKey(winterLate, "Australia/Perth")).toBe("2026-08-12");
    expect(formatEventDateKey(winterLate, "Australia/Adelaide")).toBe("2026-08-13");
  });

  it("decides 'same day' in the given zone", () => {
    // 9:00 pm to 11:00 pm in Perth; in Melbourne that ends after midnight.
    const start = "2026-08-12T13:00:00.000Z";
    expect(formatEventDateTimeRange(start, winterLate, "Australia/Perth")).toBe("Wed 12 Aug, 9:00 pm – 11:00 pm");
    expect(formatEventDateTimeRange(start, winterLate, "Australia/Adelaide")).toBe(
      "Wed 12 Aug, 10:30 pm – Thu 13 Aug, 12:30 am",
    );
    expect(formatDateBadge(start, winterLate, "Australia/Perth")).toEqual({ range: "12", month: "AUG" });
    expect(formatDateBadge(start, winterLate, "Australia/Adelaide")).toEqual({ range: "12–13", month: "AUG" });
    const now = new Date("2026-08-12T14:00:00.000Z"); // 10:00 pm in Perth, 12:00 am (13 Aug) in Melbourne
    expect(formatMessageTime(start, now, "Australia/Perth")).toBe("9:00 pm");
    expect(formatMessageTime(start, now)).toBe("Wed 12 Aug, 11:00 pm");
    expect(formatDayTime(start, now, "Australia/Perth")).toBe("Wed 12 Aug, 9:00 pm");
    expect(formatDayWithYear("2025-12-31T17:00:00.000Z", now, "Australia/Perth")).toBe("Thu 1 Jan");
    expect(formatDayWithYear("2025-12-31T15:00:00.000Z", now, "Australia/Perth")).toBe("Wed 31 Dec 2025");
  });

  it("splits an instant into the zone's date/time input values", () => {
    expect(toDateTimeInputParts(summer, "Australia/Perth")).toEqual({ date: "2026-01-15", time: "19:30" });
    expect(toDateTimeInputParts(summer, "Australia/Adelaide")).toEqual({ date: "2026-01-15", time: "22:00" });
    expect(toDateTimeInputParts(winterLate, "Australia/Adelaide")).toEqual({ date: "2026-08-13", time: "00:30" });
    expect(toDateTimeInputParts(summer, "Australia/Melbourne")).toEqual(toMelbourneDateTimeInputParts(summer));
  });

  it("labels the zone with its city and abbreviation", () => {
    expect(formatTimeZoneLabel(summer, "Australia/Perth")).toBe("Perth time (AWST)");
    expect(formatTimeZoneLabel(winterLate, "Australia/Perth")).toBe("Perth time (AWST)");
    expect(formatTimeZoneLabel(summer, "Australia/Adelaide")).toBe("Adelaide time (ACDT)");
    expect(formatTimeZoneLabel(winterLate, "Australia/Adelaide")).toBe("Adelaide time (ACST)");
    expect(formatTimeZoneLabel(summer, "Australia/Sydney", "ACT")).toBe("Canberra time (AEDT)");
  });

  it("leaves Melbourne output unchanged: no zone is the same as Australia/Melbourne", () => {
    const now = new Date("2026-09-26T10:00:00.000Z");
    for (const iso of [summer, winterLate, "2026-10-03T16:00:00.000Z", "2026-04-04T15:30:00.000Z", "2025-12-31T12:30:00.000Z"]) {
      const tz = "Australia/Melbourne";
      expect(formatEventDateKey(iso)).toBe(formatEventDateKey(iso, tz));
      expect(formatEventDateShort(iso)).toBe(formatEventDateShort(iso, tz));
      expect(formatEventTime(iso)).toBe(formatEventTime(iso, tz));
      expect(formatDayWithYear(iso, now)).toBe(formatDayWithYear(iso, now, tz));
      expect(formatMessageTime(iso, now)).toBe(formatMessageTime(iso, now, tz));
      expect(formatDayTime(iso, now)).toBe(formatDayTime(iso, now, tz));
      expect(formatEventDateTimeRange(iso, winterLate)).toBe(formatEventDateTimeRange(iso, winterLate, tz));
      expect(formatDateBadge(iso, winterLate)).toEqual(formatDateBadge(iso, winterLate, tz));
      expect(formatTimeZoneLabel(iso)).toBe(formatTimeZoneLabel(iso, tz));
    }
    expect(formatEventTime(winterLate)).toBe("1:00 am");
    expect(formatEventDateShort(winterLate)).toBe("Thu 13 Aug");
    expect(formatTimeZoneLabel(summer)).toBe("Melbourne time (AEDT)");
  });
});

describe("an event's compact line names a zone other than Melbourne's (zoneSuffix, formatEventWhen)", () => {
  // Fri 15 Jan 2026: 7:30 pm AWST in Perth, 10:00 pm ACDT in Adelaide, 10:30 pm AEDT in Melbourne.
  const summer = "2026-01-15T11:30:00.000Z";
  const summerEnd = "2026-01-15T12:30:00.000Z";

  it("defaults the zone to Melbourne", () => {
    expect(eventZone(undefined)).toBe("Australia/Melbourne");
    expect(eventZone(null)).toBe("Australia/Melbourne");
    expect(eventZone("Australia/Perth")).toBe("Australia/Perth");
  });

  it("Perth: the city's name after the time", () => {
    expect(zoneSuffix("Australia/Perth")).toBe(" Perth time");
    expect(formatEventWhen(summer, summerEnd, "Australia/Perth", "WA")).toBe("Thu 15 Jan, 7:30 pm – 8:30 pm Perth time");
  });

  it("Adelaide: in its own daylight-saving time", () => {
    expect(zoneSuffix("Australia/Adelaide", "SA")).toBe(" Adelaide time");
    expect(formatEventWhen(summer, undefined, "Australia/Adelaide", "SA")).toBe("Thu 15 Jan, 10:00 pm Adelaide time");
  });

  it("the ACT says Canberra; any zone but Melbourne's is named, Sydney's included", () => {
    expect(zoneSuffix("Australia/Sydney", "ACT")).toBe(" Canberra time");
    expect(zoneSuffix("Australia/Sydney", "NSW")).toBe(" Sydney time");
  });

  it("Melbourne (or no zone): nothing added, the line exactly as before", () => {
    expect(zoneSuffix(undefined)).toBe("");
    expect(zoneSuffix("Australia/Melbourne", "VIC")).toBe("");
    expect(formatEventWhen(summer, summerEnd)).toBe(formatEventDateTimeRange(summer, summerEnd));
    expect(formatEventWhen(summer, summerEnd, "Australia/Melbourne", "VIC")).toBe("Thu 15 Jan, 10:30 pm – 11:30 pm");
  });
});
