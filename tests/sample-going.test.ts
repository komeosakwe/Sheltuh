import { describe, expect, it } from "vitest";
import { getSampleGoing, SAMPLE_GOING_MAX, SAMPLE_GOING_MIN } from "@/lib/sample-going";
import { sampleEvents } from "@/lib/sample-events";

describe("getSampleGoing", () => {
  it("is deterministic: the same event always gets the same names (server and browser agree)", () => {
    for (const event of sampleEvents) {
      expect(getSampleGoing(event.id)).toEqual(getSampleGoing(event.id));
    }
  });

  it("gives different events different lists", () => {
    const lists = sampleEvents.map((e) => getSampleGoing(e.id).attendees.map((a) => a.displayName).join());
    expect(new Set(lists).size).toBe(sampleEvents.length);
  });

  it("always shows a count (at least three) that matches the names, with unique ids and first names", () => {
    for (const event of sampleEvents) {
      const { count, attendees } = getSampleGoing(event.id);
      expect(count).toBeGreaterThanOrEqual(Math.max(3, SAMPLE_GOING_MIN));
      expect(count).toBeLessThanOrEqual(SAMPLE_GOING_MAX);
      expect(attendees).toHaveLength(count);
      expect(new Set(attendees.map((a) => a.attendeeId)).size).toBe(count);
      expect(new Set(attendees.map((a) => a.displayName.split(" ")[0])).size).toBe(count);
      for (const a of attendees) {
        expect(a.isYou).toBe(false);
        expect(a.displayName).toMatch(/^\p{L}+ [A-Z]\.$/u);
      }
    }
  });

  it("pins one event's list, so an accidental change to the generator is caught", () => {
    const { count, attendees } = getSampleGoing("evt-neon-static");
    expect({ count, first: attendees.slice(0, 3).map((a) => a.displayName) }).toMatchInlineSnapshot(`
      {
        "count": 15,
        "first": [
          "Aisha L.",
          "Leo V.",
          "Mia N.",
        ],
      }
    `);
  });
});
