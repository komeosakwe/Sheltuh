import { describe, expect, it } from "vitest";
import {
  cardCta,
  cardDateLabel,
  cardGoing,
  categoryLabel,
  demoGoing,
  hasEnded,
  placeLabel,
  signalLabel,
} from "@/lib/event-card";
import { getSampleGoing } from "@/lib/sample-going";
import type { SheltuhEvent, TicketType } from "@/lib/types";

/* The pure card helpers (docs/design/mobile-redesign.md §2.3, §6.2). */

const ticket = (priceCents: number, extra: Partial<TicketType> = {}): TicketType => ({
  id: `t${priceCents}`,
  name: "GA",
  priceCents,
  feePolicy: "buyer-pays",
  quantityAvailable: 10,
  ...extra,
});

const event = (overrides: Partial<SheltuhEvent> = {}): SheltuhEvent => ({
  id: "e",
  slug: "e",
  title: "E",
  description: "d",
  category: "theatre",
  suburb: "Coburg",
  venueName: "The Depot Theatre",
  venueAddress: "a",
  // Sat 24 Oct 2026, 7:30 pm to 10:30 pm AEDT.
  startsAt: "2026-10-24T08:30:00.000Z",
  endsAt: "2026-10-24T11:30:00.000Z",
  organiserName: "o",
  poster: { pattern: "rings", background: "#000000", primary: "#ffffff", secondary: "#ff4800" },
  ticketTypes: [ticket(3000)],
  ...overrides,
});
const external = (externalFree: boolean) =>
  event({ ticketTypes: [], ticketingMode: "external", externalTicketUrl: "https://dice.fm/x", externalFree, externalProvider: "DICE" });

const BEFORE = new Date("2026-10-20T00:00:00.000Z");

describe("categoryLabel and placeLabel", () => {
  it("labels the category, falling back to its raw value", () => {
    expect(categoryLabel(event())).toBe("Theatre");
    expect(categoryLabel(event({ category: "mystery" as SheltuhEvent["category"] }))).toBe("mystery");
  });

  it("joins venue and suburb, never leaving a dangling separator", () => {
    expect(placeLabel(event())).toBe("The Depot Theatre · Coburg");
    expect(placeLabel(event({ venueName: "" }))).toBe("Coburg");
    expect(placeLabel(event({ venueName: "", suburb: "" }))).toBe("");
  });
});

describe("cardDateLabel (Melbourne time)", () => {
  it("is the start's date and time before it starts, and after it ends", () => {
    expect(cardDateLabel(event(), BEFORE)).toEqual({ date: "Sat 24 Oct", time: "7:30 pm" });
    expect(cardDateLabel(event(), new Date("2026-10-25T00:00:00.000Z"))).toEqual({ date: "Sat 24 Oct", time: "7:30 pm" });
  });

  it("says a multi-day event under way is on now, until its end date", () => {
    const run = event({ startsAt: "2026-10-15T00:00:00.000Z", endsAt: "2026-11-01T08:00:00.000Z" });
    expect(cardDateLabel(run, BEFORE)).toEqual({ running: "Now on · until Sun 1 Nov" });
  });

  it("says an event ending later today is on until its end time", () => {
    expect(cardDateLabel(event(), new Date("2026-10-24T09:00:00.000Z"))).toEqual({ running: "Now on · until 10:30 pm" });
  });

  it("an event with no end time is never 'now on'", () => {
    expect(cardDateLabel(event({ endsAt: undefined }), new Date("2026-10-24T09:00:00.000Z"))).toEqual({
      date: "Sat 24 Oct",
      time: "7:30 pm",
    });
  });
});

describe("hasEnded", () => {
  it("at its end time, or at its start when it has none", () => {
    expect(hasEnded(event(), new Date("2026-10-24T11:29:59.000Z"))).toBe(false);
    expect(hasEnded(event(), new Date("2026-10-24T11:30:00.000Z"))).toBe(true);
    expect(hasEnded(event({ endsAt: undefined }), new Date("2026-10-24T08:30:00.000Z"))).toBe(true);
  });
});

describe("cardCta (§6.2.3: the first matching row wins)", () => {
  const soldOut = (extra: Partial<SheltuhEvent> = {}) =>
    event({ soldOut: true, ticketTypes: [ticket(3000, { soldOut: true, remaining: 0 })], ...extra });
  const seated = (extra: Partial<SheltuhEvent> = {}) =>
    event({ seating: { version: 2 }, ticketTypes: [ticket(3000, { seated: true })], ...extra });

  it.each<[string, SheltuhEvent, ReturnType<typeof cardCta>]>([
    ["1 ended", event({ endsAt: "2026-10-19T00:00:00.000Z", startsAt: "2026-10-18T00:00:00.000Z" }), null],
    ["1 ended, sold out", soldOut({ endsAt: "2026-10-19T00:00:00.000Z", startsAt: "2026-10-18T00:00:00.000Z" }), null],
    ["2 external, free", external(true), { label: "Get free tickets", href: "/events/e#tickets", tone: "signal" }],
    ["3 external, paid", external(false), { label: "Buy tickets", href: "/events/e#tickets", tone: "signal" }],
    ["4 no tiers yet", event({ ticketTypes: [] }), null],
    ["5 sold out", soldOut(), { label: "Join waitlist", href: "/events/e#tickets", tone: "outline" }],
    ["5 sold out, seated", seated({ soldOut: true, ticketTypes: [ticket(3000, { seated: true, soldOut: true })] }), { label: "Join waitlist", href: "/events/e#tickets", tone: "outline" }],
    ["6 seated, on sale", seated(), { label: "Choose seats", href: "/events/e/seats", tone: "signal" }],
    ["7 every on-sale tier free", event({ ticketTypes: [ticket(0), ticket(1500, { soldOut: true })] }), { label: "Get free tickets", href: "/events/e#tickets", tone: "signal" }],
    ["8 paid", event({ ticketTypes: [ticket(0), ticket(1500)] }), { label: "Buy tickets", href: "/events/e#tickets", tone: "signal" }],
  ])("%s", (_label, e, expected) => {
    expect(cardCta(e, BEFORE)).toEqual(expected);
  });

  it("never links a card out to another site", () => {
    for (const e of [external(true), external(false)]) expect(cardCta(e, BEFORE)?.href).toMatch(/^\/events\//);
  });
});

describe("cardGoing (§6.2.5): real or absent", () => {
  it("demo: the fictional sample's count and first three initials", () => {
    const sample = getSampleGoing("e");
    expect(cardGoing(event(), "demo")).toEqual(demoGoing("e"));
    expect(demoGoing("e").count).toBe(sample.count);
    expect(demoGoing("e").initials).toHaveLength(Math.min(3, sample.attendees.length));
  });

  it("live: only the server's thresholded trending count, with no names", () => {
    expect(cardGoing(event(), "live")).toBeNull();
    expect(cardGoing(event(), "live", { kind: "popular" })).toBeNull();
    expect(cardGoing(event(), "live", { kind: "going", count: 12 })).toEqual({ count: 12 });
  });

  it("external: never, demo included", () => {
    expect(cardGoing(external(false), "demo")).toBeNull();
    expect(cardGoing(external(false), "live", { kind: "going", count: 12 })).toBeNull();
  });
});

describe("signalLabel", () => {
  it("labels the signal; a going count shows in the going row instead, except on an external event", () => {
    expect(signalLabel({ kind: "going", count: 9 }, false)).toBeNull();
    expect(signalLabel({ kind: "going", count: 9 }, true)).toBe("Popular this week");
    expect(signalLabel({ kind: "just-announced" }, false)).toBe("Just announced");
    expect(signalLabel({ kind: "popular" }, false)).toBe("Popular this week");
  });
});
