import { describe, expect, it } from "vitest";
import type { EventRecord, TicketTypeInput } from "@/lib/api/types";
import { SCAN_FOR_TICKETS, SCAN_TO_SEE, SIGN_PAGE_CSS, signCallToAction, signSummary, signText, signTitleSize } from "@/lib/qr-sign";

type SignEvent = Parameters<typeof signText>[0];

const ticket = (priceCents: number): TicketTypeInput => ({ id: `t${priceCents}`, name: "General", priceCents, feePolicy: "buyer-pays", quantityAvailable: 10 });

function event(extra: Partial<EventRecord> = {}): SignEvent {
  return {
    title: "Night Market",
    // 9:00 am UTC: 8:00 pm in Melbourne (AEDT, UTC+11) on Sat 5 Dec.
    startsAt: "2026-12-05T09:00:00.000Z",
    endsAt: "2026-12-05T12:00:00.000Z",
    timeZone: "Australia/Melbourne",
    state: "VIC",
    venueName: "The Tote",
    suburb: "Collingwood",
    ticketingMode: "sheltuh",
    ticketTypes: [ticket(2500)],
    ...extra,
  };
}

const URL = "https://sheltuh.com.au/events/night-market?ref=k7mq2hxd";

describe("signText", () => {
  it("says the event as its page does: the date range and the zone, the venue and suburb, the short address", () => {
    expect(signText(event(), URL)).toEqual({
      title: "Night Market",
      titleSize: "xl",
      when: "Sat 5 Dec, 8:00 pm – 11:00 pm",
      zone: "Melbourne time (AEDT)",
      place: "The Tote, Collingwood, VIC",
      action: SCAN_FOR_TICKETS,
      address: "sheltuh.com.au/events/night-market",
    });
  });

  it("uses the event's own time zone, never the platform's or the machine's", () => {
    const perth = signText(event({ timeZone: "Australia/Perth", state: "WA", suburb: "Northbridge" }), URL);
    // 9:00 am UTC is 5:00 pm in Perth (AWST, UTC+8), not Melbourne's 8:00 pm.
    expect(perth.when).toBe("Sat 5 Dec, 5:00 pm – 8:00 pm");
    expect(perth.zone).toBe("Perth time (AWST)");
    expect(perth.place).toBe("The Tote, Northbridge, WA");
    // An event that crosses midnight there names both days, and midnight in words.
    const late = signText(event({ startsAt: "2026-12-05T10:00:00.000Z", endsAt: "2026-12-05T13:00:00.000Z" }), URL);
    expect(late.when).toBe("Sat 5 Dec, 9:00 pm – Sun 6 Dec, midnight");
  });

  it("keeps the title and venue as typed, markup and all: it's text, never HTML", () => {
    const text = signText(event({ title: '  <img src=x onerror="alert(1)">\n Night   Market  ', venueName: "<b>Tote</b> & Co" }), URL);
    expect(text.title).toBe('<img src=x onerror="alert(1)"> Night Market');
    expect(text.place).toBe("<b>Tote</b> & Co, Collingwood, VIC");
  });

  it("leaves out a missing venue, and names an untitled event", () => {
    const text = signText(event({ title: "   ", venueName: "  " }), URL);
    expect(text.title).toBe("Untitled event");
    expect(text.place).toBe("Collingwood, VIC");
  });
});

describe("signCallToAction", () => {
  it("“Scan for tickets” for paid tickets on Sheltüh; “Scan to see the event” for free, none yet, or another site", () => {
    expect(signCallToAction(event({ ticketTypes: [ticket(0), ticket(1500)] }))).toBe(SCAN_FOR_TICKETS);
    expect(signCallToAction(event({ ticketTypes: [ticket(0)] }))).toBe(SCAN_TO_SEE);
    expect(signCallToAction(event({ ticketTypes: [] }))).toBe(SCAN_TO_SEE);
    expect(signCallToAction(event({ ticketingMode: "external", ticketTypes: [] }))).toBe(SCAN_TO_SEE);
  });
});

describe("signTitleSize", () => {
  it("steps down as the title gets longer (counted in characters, not UTF-16 units)", () => {
    expect(signTitleSize("Night Market")).toBe("xl");
    expect(signTitleSize("🎶".repeat(24))).toBe("xl");
    expect(signTitleSize("a".repeat(25))).toBe("lg");
    expect(signTitleSize("a".repeat(48))).toBe("lg");
    expect(signTitleSize("a".repeat(90))).toBe("md");
    expect(signTitleSize("a".repeat(150))).toBe("sm");
  });
});

describe("SIGN_PAGE_CSS", () => {
  it("is a portrait page of the paper's size with no margin", () => {
    expect(SIGN_PAGE_CSS).toEqual({
      a4: "@page { size: A4 portrait; margin: 0; }",
      a5: "@page { size: A5 portrait; margin: 0; }",
    });
  });
});

describe("signSummary", () => {
  it("is the date, the zone and the place, leaving out a missing place", () => {
    expect(signSummary({ when: "Sat 5 Dec, 8:00 pm", zone: "Melbourne time (AEDT)", place: "The Tote, Collingwood, VIC" })).toEqual([
      "Sat 5 Dec, 8:00 pm",
      "Melbourne time (AEDT)",
      "The Tote, Collingwood, VIC",
    ]);
    expect(signSummary({ when: "Sat 5 Dec, 8:00 pm", zone: "Melbourne time (AEDT)", place: "" })).toEqual(["Sat 5 Dec, 8:00 pm", "Melbourne time (AEDT)"]);
  });
});
