import { describe, expect, it } from "vitest";
import { getUpcomingEvents, isFreeEvent, isPaidEvent, isUpcomingEvent } from "@/lib/data";
import { sampleEvents } from "@/lib/sample-events";
import type { SheltuhEvent, TicketType } from "@/lib/types";

const base = sampleEvents[0];
const ticket = (priceCents: number): TicketType => ({
  id: `t${priceCents}`,
  name: "Entry",
  priceCents,
  feePolicy: "buyer-pays",
  quantityAvailable: 5,
});
const withTickets = (ticketTypes: TicketType[]): SheltuhEvent => ({ ...base, ticketTypes });

describe("isFreeEvent / isPaidEvent", () => {
  it("all free is free, any paid is paid", () => {
    expect(isFreeEvent(withTickets([ticket(0)]))).toBe(true);
    expect(isPaidEvent(withTickets([ticket(0)]))).toBe(false);
    expect(isFreeEvent(withTickets([ticket(0), ticket(2000)]))).toBe(false);
    expect(isPaidEvent(withTickets([ticket(0), ticket(2000)]))).toBe(true);
  });

  it("an event with no ticket types yet is neither (as the API's pricing filter)", () => {
    expect(isFreeEvent(withTickets([]))).toBe(false);
    expect(isPaidEvent(withTickets([]))).toBe(false);
  });

  it("an external event is free only when marked free, and never paid (its price isn't known)", () => {
    const external = (externalFree: boolean): SheltuhEvent => ({
      ...withTickets([]),
      ticketingMode: "external",
      externalTicketUrl: "https://events.humanitix.com/x",
      externalFree,
    });
    expect(isFreeEvent(external(true))).toBe(true);
    expect(isPaidEvent(external(true))).toBe(false);
    expect(isFreeEvent(external(false))).toBe(false);
    expect(isPaidEvent(external(false))).toBe(false);
  });
});

describe("isUpcomingEvent (the API's upcoming=1 rule)", () => {
  const now = new Date("2026-10-21T10:00:00.000Z");
  const at = (startsAt: string, endsAt?: string): SheltuhEvent => ({ ...base, startsAt, endsAt });

  it("keeps events that haven't ended, in progress included", () => {
    expect(isUpcomingEvent(at("2026-10-22T08:00:00.000Z", "2026-10-22T11:00:00.000Z"), now)).toBe(true);
    expect(isUpcomingEvent(at("2026-10-21T09:00:00.000Z", "2026-10-21T12:00:00.000Z"), now)).toBe(true);
  });

  it("drops events that have ended, including at the exact end time", () => {
    expect(isUpcomingEvent(at("2026-10-20T08:00:00.000Z", "2026-10-20T11:00:00.000Z"), now)).toBe(false);
    expect(isUpcomingEvent(at("2026-10-21T07:00:00.000Z", "2026-10-21T10:00:00.000Z"), now)).toBe(false);
  });

  it("without an end time, counts as ended once it starts", () => {
    expect(isUpcomingEvent(at("2026-10-21T10:00:01.000Z"), now)).toBe(true);
    expect(isUpcomingEvent(at("2026-10-21T09:59:59.000Z"), now)).toBe(false);
  });

  it("getUpcomingEvents applies it to the demo data", async () => {
    const upcoming = await getUpcomingEvents(now);
    expect(upcoming.length).toBeGreaterThan(0);
    expect(upcoming.length).toBeLessThan(sampleEvents.length);
    expect(upcoming.every((event) => isUpcomingEvent(event, now))).toBe(true);
    expect(upcoming).toEqual(sampleEvents.filter((event) => isUpcomingEvent(event, now)));
  });
});
