import { describe, expect, it } from "vitest";
import { isSoldOut } from "@/lib/pricing";
import { SAMPLE_SEAT_MAPS } from "@/lib/sample-seat-maps";
import { sampleEvents } from "@/lib/sample-events";
import { flattenSeats } from "@/lib/seating/template";

describe("the demo seated event (lib/sample-events.ts and lib/sample-seat-maps.ts agree)", () => {
  const event = sampleEvents.find((e) => e.id === "evt-off-kilter");
  const sample = SAMPLE_SEAT_MAPS["evt-off-kilter"];

  it("is seated, on sale, and its tiers are the map's", () => {
    expect(event?.seating).toEqual({ version: sample.version });
    expect(event && isSoldOut(event)).toBe(false);
    expect(event?.ticketTypes.every((t) => t.seated === true)).toBe(true);
    const seats = flattenSeats(sample.template);
    for (const tier of event?.ticketTypes ?? []) {
      expect(tier.quantityAvailable).toBe(seats.filter((s) => s.ticketTypeId === tier.id && !s.blocked).length);
    }
  });

  it("says what's left as the API would: `remaining` only at 10 or fewer, from the map's free seats", () => {
    const seats = flattenSeats(sample.template);
    const taken = new Set(sample.unavailable);
    for (const tier of event?.ticketTypes ?? []) {
      const left = seats.filter((s) => s.ticketTypeId === tier.id && !s.blocked && !taken.has(s.position)).length;
      expect(left).toBeGreaterThan(0);
      expect(tier.remaining).toBe(left <= 10 ? left : undefined);
    }
  });

  it("has a few seats sold, and its wheelchair space and companion seat free", () => {
    expect(sample.unavailable.length).toBeGreaterThan(0);
    expect(sample.unavailable.length).toBeLessThan(sample.seatCount / 2);
    const seats = flattenSeats(sample.template);
    const access = seats.filter((s) => s.kind !== "standard");
    expect(access.map((s) => s.kind).sort()).toEqual(["companion", "wheelchair"]);
    expect(access.some((s) => sample.unavailable.includes(s.position))).toBe(false);
  });

  it("isn't the demo's sold-out (waitlist) event, which is a different one", () => {
    const soldOut = sampleEvents.filter(isSoldOut);
    expect(soldOut.map((e) => e.slug)).toEqual(["dead-letter-office"]);
    expect(soldOut[0].seating).toBeUndefined();
  });
});
