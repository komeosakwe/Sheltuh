import { describe, expect, it } from "vitest";
import { soonFields, soonLabel, type SoonFields } from "@/lib/soon";

/**
 * The "soon" tag's label (lib/soon.ts): time only, in the event's own zone's wall clock. Melbourne is
 * AEDT (UTC+11) in November, Perth AWST (UTC+8) and Brisbane AEST (UTC+10) all year.
 */
const at = (iso: string) => new Date(iso);
const melbourne = (startsAt: string, endsAt?: string): SoonFields => ({ startsAt, endsAt, timeZone: "Australia/Melbourne" });

describe("soonLabel", () => {
  it("On now: started and not yet ended, a multi-day event too", () => {
    // Sat 14 Nov, 5:00–9:00 pm Melbourne; now 7:00 pm.
    expect(soonLabel(melbourne("2026-11-14T06:00:00.000Z", "2026-11-14T10:00:00.000Z"), at("2026-11-14T08:00:00.000Z"))).toBe("On now");
    // From Thu 12 Nov to Sun 22 Nov; now Fri 13 Nov.
    expect(soonLabel(melbourne("2026-11-11T23:00:00.000Z", "2026-11-22T07:00:00.000Z"), at("2026-11-13T02:00:00.000Z"))).toBe("On now");
  });

  it("nothing once it has ended, or the moment it ends; an event with no end ends when it starts", () => {
    const event = melbourne("2026-11-14T06:00:00.000Z", "2026-11-14T10:00:00.000Z");
    expect(soonLabel(event, at("2026-11-14T10:00:00.000Z"))).toBeNull();
    expect(soonLabel(event, at("2026-11-15T01:00:00.000Z"))).toBeNull();
    expect(soonLabel(melbourne("2026-11-14T06:00:00.000Z"), at("2026-11-14T06:00:00.000Z"))).toBeNull();
    expect(soonLabel(melbourne("2026-11-14T06:00:00.000Z"), at("2026-11-14T05:59:00.000Z"))).toBe("Tonight");
  });

  it("Tonight from 5:00 pm, Today before it: the boundary is 17:00 in the event's zone", () => {
    const now = at("2026-11-13T22:00:00.000Z"); // Sat 14 Nov, 9:00 am Melbourne
    expect(soonLabel(melbourne("2026-11-14T05:59:00.000Z"), now)).toBe("Today"); // 4:59 pm
    expect(soonLabel(melbourne("2026-11-14T06:00:00.000Z"), now)).toBe("Tonight"); // 5:00 pm
    expect(soonLabel(melbourne("2026-11-14T12:59:00.000Z"), now)).toBe("Tonight"); // 11:59 pm
    expect(soonLabel(melbourne("2026-11-13T23:00:00.000Z"), now)).toBe("Today"); // 10:00 am
  });

  it("Tomorrow across midnight, and nothing further off (no 'this week')", () => {
    const now = at("2026-11-13T12:30:00.000Z"); // Fri 13 Nov, 11:30 pm Melbourne
    expect(soonLabel(melbourne("2026-11-13T12:45:00.000Z"), now)).toBe("Tonight"); // 11:45 pm: still tonight
    expect(soonLabel(melbourne("2026-11-13T13:00:00.000Z"), now)).toBe("Tomorrow"); // Sat 12:00 am
    expect(soonLabel(melbourne("2026-11-14T06:00:00.000Z"), now)).toBe("Tomorrow"); // Sat 5:00 pm
    expect(soonLabel(melbourne("2026-11-14T12:59:00.000Z"), now)).toBe("Tomorrow"); // Sat 11:59 pm
    expect(soonLabel(melbourne("2026-11-14T13:00:00.000Z"), now)).toBeNull(); // Sun 12:00 am
    expect(soonLabel(melbourne("2026-11-17T08:00:00.000Z"), now)).toBeNull(); // Tue
    // Just after midnight, yesterday's "Tomorrow" is today's.
    expect(soonLabel(melbourne("2026-11-14T06:00:00.000Z"), at("2026-11-13T13:00:00.000Z"))).toBe("Tonight");
  });

  it("is the event's own day: a Perth or Brisbane event, whatever Melbourne's date", () => {
    // Fri 13 Nov, 11:00 pm in Melbourne = 8:00 pm in Perth.
    const now = at("2026-11-13T12:00:00.000Z");
    // 10:00 pm Fri in Perth (Sat 1:00 am in Melbourne): tonight there.
    expect(soonLabel({ startsAt: "2026-11-13T14:00:00.000Z", timeZone: "Australia/Perth" }, now)).toBe("Tonight");
    // The same instant for a Melbourne event is tomorrow.
    expect(soonLabel(melbourne("2026-11-13T14:00:00.000Z"), now)).toBe("Tomorrow");
    // Brisbane (no daylight saving) is 10:00 pm Fri: an 11:45 pm Brisbane start is tonight there.
    expect(soonLabel({ startsAt: "2026-11-13T13:45:00.000Z", timeZone: "Australia/Brisbane" }, now)).toBe("Tonight");
    // Sat 11:30 pm in Perth is Sun in Melbourne, still tomorrow in Perth.
    expect(soonLabel({ startsAt: "2026-11-14T15:30:00.000Z", timeZone: "Australia/Perth" }, now)).toBe("Tomorrow");
  });

  it("an event with no zone is Melbourne's", () => {
    const now = at("2026-11-13T12:00:00.000Z"); // Fri 11:00 pm Melbourne
    expect(soonLabel({ startsAt: "2026-11-13T14:00:00.000Z" }, now)).toBe("Tomorrow");
  });

  it("rolls over a month and a year", () => {
    // Mon 30 Nov, 8:00 pm Melbourne -> Tue 1 Dec.
    expect(soonLabel(melbourne("2026-12-01T08:00:00.000Z"), at("2026-11-30T09:00:00.000Z"))).toBe("Tomorrow");
    // Thu 31 Dec 2026, 8:00 pm Melbourne -> Fri 1 Jan 2027, 7:00 pm.
    const nye = at("2026-12-31T09:00:00.000Z");
    expect(soonLabel(melbourne("2027-01-01T08:00:00.000Z"), nye)).toBe("Tomorrow");
    expect(soonLabel(melbourne("2027-01-02T08:00:00.000Z"), nye)).toBeNull();
    // A year's last evening, in the year's last hour.
    expect(soonLabel(melbourne("2026-12-31T12:30:00.000Z"), nye)).toBe("Tonight");
  });

  it("holds across daylight saving (Melbourne springs forward at 2:00 am Sun 4 Oct 2026)", () => {
    // Sat 3 Oct, 10:00 pm AEST (UTC+10); Sun 4 Oct, 6:00 pm AEDT (UTC+11): tomorrow, 19 hours on.
    expect(soonLabel(melbourne("2026-10-04T07:00:00.000Z"), at("2026-10-03T12:00:00.000Z"))).toBe("Tomorrow");
    // Sun 4 Oct, 1:30 am AEST, before the change: 6:00 pm AEDT is tonight, 12:30 am Mon isn't.
    const early = at("2026-10-03T15:30:00.000Z");
    expect(soonLabel(melbourne("2026-10-04T07:00:00.000Z"), early)).toBe("Tonight");
    expect(soonLabel(melbourne("2026-10-04T13:30:00.000Z"), early)).toBe("Tomorrow");
    // Brisbane keeps AEST: the same instant is 1:30 am Sun there too, and its Sun 4:59 pm is Today.
    expect(soonLabel({ startsAt: "2026-10-04T06:59:00.000Z", timeZone: "Australia/Brisbane" }, early)).toBe("Today");
    // Back to standard time (3:00 am AEDT Sun 5 Apr 2026 -> 2:00 am AEST): Sun 11:00 pm AEST is still that Sunday.
    expect(soonLabel(melbourne("2026-04-05T13:00:00.000Z"), at("2026-04-04T14:00:00.000Z"))).toBe("Tonight");
  });

  it("nothing for a time it can't read", () => {
    expect(soonLabel(melbourne("not a date"), at("2026-11-13T12:00:00.000Z"))).toBeNull();
  });

  it("soonFields keeps only the times", () => {
    const fields = soonFields({ startsAt: "a", endsAt: "b", timeZone: "Australia/Perth", ...{ title: "x" } } as SoonFields);
    expect(fields).toEqual({ startsAt: "a", endsAt: "b", timeZone: "Australia/Perth" });
  });
});
