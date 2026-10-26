import { existsSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { generatedSampleEvents } from "@/lib/sample-events-more";
import { sampleEvents } from "@/lib/sample-events";
import { checkExternalTicketUrl, ticketProviderName } from "@/lib/ticketing";
import { distanceKm } from "@/lib/geo";
import { findLocality } from "@/lib/location";
import { placeQuery } from "@/lib/place";

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
    const slugs = new Set(sampleEvents.map((e) => e.slug));
    for (const generated of generatedSampleEvents) expect(slugs.has(generated.slug)).toBe(true);
  });

  it("each end after they start, with a real price and quantity on every ticket type", () => {
    for (const event of sampleEvents) {
      expect(Date.parse(event.endsAt ?? "")).toBeGreaterThan(Date.parse(event.startsAt));
      // External events sell elsewhere and have none (checked below).
      if (event.ticketingMode === "external") continue;
      expect(event.ticketTypes.length).toBeGreaterThan(0);
      for (const ticket of event.ticketTypes) {
        expect(Number.isInteger(ticket.priceCents)).toBe(true);
        expect(ticket.priceCents).toBeGreaterThanOrEqual(0);
        expect(ticket.quantityAvailable).toBeGreaterThan(0);
      }
    }
  });

  it("include external-ticketing events that follow the API's rules (a valid link, no ticket types, provider by host)", () => {
    const external = sampleEvents.filter((event) => event.ticketingMode === "external");
    expect(external.length).toBeGreaterThanOrEqual(2);
    expect(external.some((event) => event.externalFree)).toBe(true);
    expect(external.some((event) => !event.externalFree)).toBe(true);
    for (const event of external) {
      expect(event.ticketTypes).toEqual([]);
      const checked = checkExternalTicketUrl(event.externalTicketUrl ?? "");
      expect(checked).toEqual({ ok: true, url: event.externalTicketUrl });
      expect(event.externalProvider).toBe(ticketProviderName(event.externalTicketUrl ?? ""));
    }
    // One known site and one that isn't ("the organiser's site").
    expect(external.map((event) => event.externalProvider)).toEqual(expect.arrayContaining(["Humanitix", null]));
  });

  it("place every generated Victorian event inside Melbourne, and each interstate one in its own state", () => {
    for (const event of generatedSampleEvents.filter((e) => (e.state ?? "VIC") === "VIC")) {
      expect(event.coordinates?.lat).toBeGreaterThan(-38.5);
      expect(event.coordinates?.lat).toBeLessThan(-37.5);
      expect(event.coordinates?.lng).toBeGreaterThan(144.5);
      expect(event.coordinates?.lng).toBeLessThan(145.5);
    }
    // Owner decision D11: three interstate samples, each found in its state (lib/place.ts placeQuery).
    const interstate = generatedSampleEvents.filter((e) => e.state && e.state !== "VIC");
    expect(interstate.map((e) => [e.suburb, e.state, e.timeZone])).toEqual([
      ["Newtown", "NSW", "Australia/Sydney"],
      ["Fortitude Valley", "QLD", "Australia/Brisbane"],
      ["Northbridge", "WA", "Australia/Perth"],
    ]);
    for (const event of interstate) {
      const locality = findLocality(placeQuery(event));
      expect(locality?.state).toBe(event.state);
      // The venue's coordinates are within a few km of the suburb's centre.
      expect(distanceKm(locality ?? { lat: 0, lng: 0 }, event.coordinates ?? { lat: 0, lng: 0 })).toBeLessThan(3);
    }
  });

  it("start at sensible hours in their own zone, inside daylight-saving time for Victorian ones (the generator's +11)", () => {
    // AEDT 2026-27 runs from 2am on 4 Oct 2026 to 3am on 4 Apr 2027 (Melbourne time).
    const from = Date.parse("2026-10-03T16:00:00Z");
    const to = Date.parse("2027-04-03T16:00:00Z");
    for (const event of generatedSampleEvents) {
      const start = Date.parse(event.startsAt);
      expect(start).toBeGreaterThanOrEqual(from);
      expect(start).toBeLessThan(to);
      // ...and they land at sensible evening/daytime hours, local to the event.
      const hour = Number(
        new Intl.DateTimeFormat("en-AU", {
          hour: "numeric",
          hour12: false,
          timeZone: event.timeZone ?? "Australia/Melbourne",
        }).format(new Date(event.startsAt)),
      );
      expect(hour).toBeGreaterThanOrEqual(9);
      expect(hour).toBeLessThanOrEqual(21);
    }
  });

  it("convert an interstate start in its own zone: 6:30 pm in Perth, 11 am in Brisbane, 8 pm in Sydney", () => {
    const at = (slug: string) => generatedSampleEvents.find((e) => e.slug === slug)?.startsAt;
    expect(at("northbridge-late-sketch")).toBe("2026-11-21T10:30:00.000Z"); // AWST, UTC+8
    expect(at("valley-risograph-fair")).toBe("2026-11-14T01:00:00.000Z"); // AEST, UTC+10 (no daylight saving)
    expect(at("king-street-fuzz-night")).toBe("2026-11-28T09:00:00.000Z"); // AEDT, UTC+11
  });

  it("never point at a photo file that doesn't exist (that would be a wasted 404 on every page load)", () => {
    for (const event of sampleEvents) {
      if (event.imageUrl) expect(existsSync(path.join(process.cwd(), "public", event.imageUrl))).toBe(true);
    }
  });
});
