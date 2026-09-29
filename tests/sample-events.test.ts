import { describe, expect, it } from "vitest";
import { generatedSampleEvents } from "@/lib/sample-events-more";
import { sampleEvents } from "@/lib/sample-events";

describe("demo sample events", () => {
  it("have unique ids, slugs and ticket ids, so lists and links never collide", () => {
    const ids = sampleEvents.map((e) => e.id);
    const slugs = sampleEvents.map((e) => e.slug);
    const ticketIds = sampleEvents.flatMap((e) => e.ticketTypes.map((t) => t.id));
    expect(new Set(ids).size).toBe(ids.length);
    expect(new Set(slugs).size).toBe(slugs.length);
    expect(new Set(ticketIds).size).toBe(ticketIds.length);
  });

  it("include the generated ones, in addition to the hand-written showcase events", () => {
    expect(generatedSampleEvents.length).toBeGreaterThan(0);
    expect(sampleEvents.length).toBeGreaterThan(generatedSampleEvents.length);
    for (const generated of generatedSampleEvents) expect(sampleEvents).toContain(generated);
  });

  it("each end after they start, with a real price and quantity on every ticket type", () => {
    for (const event of sampleEvents) {
      expect(Date.parse(event.endsAt ?? "")).toBeGreaterThan(Date.parse(event.startsAt));
      expect(event.ticketTypes.length).toBeGreaterThan(0);
      for (const ticket of event.ticketTypes) {
        expect(Number.isInteger(ticket.priceCents)).toBe(true);
        expect(ticket.priceCents).toBeGreaterThanOrEqual(0);
        expect(ticket.quantityAvailable).toBeGreaterThan(0);
      }
    }
  });

  it("place every generated event inside Melbourne", () => {
    for (const event of generatedSampleEvents) {
      expect(event.coordinates?.lat).toBeGreaterThan(-38.5);
      expect(event.coordinates?.lat).toBeLessThan(-37.5);
      expect(event.coordinates?.lng).toBeGreaterThan(144.5);
      expect(event.coordinates?.lng).toBeLessThan(145.5);
    }
  });

  it("only use dates inside daylight-saving time, because the generator hard-codes the +11 offset", () => {
    // AEDT 2026-27 runs from 2am on 4 Oct 2026 to 3am on 4 Apr 2027 (Melbourne time).
    const from = Date.parse("2026-10-03T16:00:00Z");
    const to = Date.parse("2027-04-03T16:00:00Z");
    for (const event of generatedSampleEvents) {
      const start = Date.parse(event.startsAt);
      expect(start).toBeGreaterThanOrEqual(from);
      expect(start).toBeLessThan(to);
      // ...and they land at sensible evening/daytime hours in Melbourne local time.
      const hour = Number(
        new Intl.DateTimeFormat("en-AU", { hour: "numeric", hour12: false, timeZone: "Australia/Melbourne" }).format(
          new Date(event.startsAt),
        ),
      );
      expect(hour).toBeGreaterThanOrEqual(9);
      expect(hour).toBeLessThanOrEqual(21);
    }
  });
});
