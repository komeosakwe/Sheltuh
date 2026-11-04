import { describe, expect, it } from "vitest";
import type { TicketTypeInput } from "@/lib/api/types";
import {
  admitsPatch,
  cleanTicketType,
  draftErrors,
  errorFieldLabel,
  GROUP_NEEDS_WHOLE_GROUPS,
  groupSizeOptions,
  formKeyedFieldErrors,
  groupDisabledReason,
  groupTicketPreset,
  GROUP_REASON_FREE,
  GROUP_REASON_OFF,
  GROUP_REASON_SEATED,
  GROUP_REASON_SOLD,
} from "@/components/dashboard/editor/draft";
import { draftToPreviewEvent, type PreviewDraft } from "@/components/dashboard/editor/preview-event";
import { formatFeedPriceParts } from "@/lib/pricing";

const single: TicketTypeInput = { id: "a", name: "General", priceCents: 3500, feePolicy: "buyer-pays", quantityAvailable: 50 };
const group: TicketTypeInput = { ...single, id: "g", name: "Group of 4", priceCents: 12000, quantityAvailable: 20, admits: 4 };
const ON = { enabled: true, reservedSeating: false, sold: 0 };

describe("cleanTicketType: admits", () => {
  it("always sends it: 1 for a single ticket (absent would keep the stored size), the size for a group", () => {
    expect(cleanTicketType(single, 0).admits).toBe(1);
    expect(cleanTicketType(group, 1).admits).toBe(4);
    expect(cleanTicketType({ ...single, seated: true }, 0).admits).toBe(1);
  });
});

describe("admitsPatch", () => {
  it("keeps the people, as whole groups of the new size (at least one)", () => {
    expect(admitsPatch(single, 4)).toMatchObject({ admits: 4, quantityAvailable: 48 });
    expect(admitsPatch({ ...single, quantityAvailable: 3 }, 4)).toMatchObject({ admits: 4, quantityAvailable: 4 });
    expect(admitsPatch(group, 1)).toMatchObject({ admits: 1, quantityAvailable: 20 });
    expect(admitsPatch(group, 5)).toMatchObject({ admits: 5, quantityAvailable: 20 });
  });

  it("leaves a quantity that isn't a number of people at 0, for the form to refuse", () => {
    expect(admitsPatch({ ...single, quantityAvailable: 0 }, 4).quantityAvailable).toBe(0);
    expect(admitsPatch({ ...single, quantityAvailable: Number.NaN }, 4).quantityAvailable).toBe(0);
  });

  it("names a blank or generated 'Group of N' ticket after its size, never one the organiser named", () => {
    expect(admitsPatch({ ...single, name: "" }, 4).name).toBe("Group of 4");
    expect(admitsPatch(group, 6).name).toBe("Group of 6");
    expect(admitsPatch(group, 1).name).toBe("");
    expect(admitsPatch({ ...group, name: "Table for 4" }, 6).name).toBeUndefined();
    expect(admitsPatch(single, 4).name).toBeUndefined();
  });

  it("stays within 1 to 10", () => {
    expect(admitsPatch(single, 40).admits).toBe(10);
    expect(admitsPatch(single, 0).admits).toBe(1);
  });
});

describe("groupTicketPreset", () => {
  it("is a Group of 4, 5 groups, fee absorbed, unpriced", () => {
    expect(groupTicketPreset("x")).toEqual({
      id: "x",
      name: "Group of 4",
      priceCents: 0,
      feePolicy: "organiser-absorbs",
      quantityAvailable: 20,
      admits: 4,
    });
  });
});

describe("groupDisabledReason", () => {
  it("is null for a paid single ticket while it's on", () => {
    expect(groupDisabledReason(single, ON)).toBeNull();
    expect(groupDisabledReason(group, ON)).toBeNull();
  });

  it("says why, in order: seating, sales, off, free", () => {
    expect(groupDisabledReason(single, { ...ON, reservedSeating: true })).toBe(GROUP_REASON_SEATED);
    expect(groupDisabledReason({ ...single, seated: true }, ON)).toBe(GROUP_REASON_SEATED);
    expect(groupDisabledReason(single, { ...ON, sold: 1, enabled: false })).toBe(GROUP_REASON_SOLD);
    expect(groupDisabledReason(single, { ...ON, enabled: false })).toBe(GROUP_REASON_OFF);
    expect(groupDisabledReason({ ...single, priceCents: 0 }, ON)).toBe(GROUP_REASON_FREE);
  });

  it("lets a free ticket that's already a group go back to one person", () => {
    expect(groupDisabledReason({ ...group, priceCents: 0 }, ON)).toBeNull();
  });

  it("while off, lets an unsold group ticket go back to 1 (only), and nothing else change", () => {
    const off = { ...ON, enabled: false };
    expect(groupDisabledReason(group, off)).toBeNull();
    expect(groupDisabledReason(single, off)).toBe(GROUP_REASON_OFF);
    expect(groupDisabledReason(group, { ...off, sold: 4 })).toBe(GROUP_REASON_SOLD);
    expect(groupSizeOptions(group, false)).toEqual([1, 4]);
    expect(groupSizeOptions(single, false)).toEqual([1]);
    expect(groupSizeOptions(single, true)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  });
});

describe("draftErrors: whole groups", () => {
  const draft = (ticket: TicketTypeInput) =>
    draftErrors({
      title: "t",
      description: "d",
      venueName: "v",
      venueAddress: "a",
      place: { kind: "empty" },
      start: { date: "", time: "" },
      end: { date: "", time: "" },
      organiserMissing: false,
      isAdmin: false,
      platformManaged: false,
      ticketingMode: "sheltuh",
      externalTicketUrl: "",
      ticketTypes: [ticket],
      refundPolicy: "no_change_of_mind",
      refundDays: Number.NaN,
    });

  it("refuses a quantity that isn't a multiple of the people per ticket", () => {
    expect(draft({ ...group, quantityAvailable: 10 })["ticket-0-qty"]).toBe(GROUP_NEEDS_WHOLE_GROUPS);
    expect(draft({ ...group, quantityAvailable: 20 })["ticket-0-qty"]).toBeUndefined();
    expect(draft({ ...single, quantityAvailable: 7 })["ticket-0-qty"]).toBeUndefined();
  });
});

describe("the API's admits error, as the form keys it", () => {
  it("maps ticketTypes[i].admits to the field's own key, and labels it", () => {
    expect(formKeyedFieldErrors({ "ticketTypes[2].admits": "x", "ticketTypes[0].opensAfterPrevious": "y", title: "z" })).toEqual({
      "ticket-2-admits": "x",
      "ticket-0-lock": "y",
      title: "z",
    });
    expect(errorFieldLabel("ticket-2-admits")).toBe("Ticket 3 people per ticket");
    expect(formKeyedFieldErrors({ "ticketTypes[1].quantityAvailable": "q" })).toEqual({ "ticket-1-qty": "q" });
  });
});

describe("the preview of a group ticket", () => {
  const draft = (tickets: TicketTypeInput[]): PreviewDraft => ({
    title: "t",
    description: "d",
    category: "live-music",
    suburb: "Fitzroy",
    timeZone: "Australia/Melbourne",
    venueName: "v",
    venueAddress: "a",
    pin: null,
    start: { date: "2027-01-01", time: "20:00" },
    end: { date: "2027-01-01", time: "23:00" },
    organiserName: "o",
    ticketTypes: tickets,
    ticketingMode: "sheltuh",
    externalFree: false,
    refundPolicy: "no_change_of_mind",
    refundDays: Number.NaN,
  });

  it("carries admits above 1 only, so the event page prices and counts it as it will", () => {
    const { event } = draftToPreviewEvent(draft([{ ...single, admits: 1 }, group]));
    expect(event.ticketTypes[0].admits).toBeUndefined();
    expect(event.ticketTypes[1].admits).toBe(4);
    // The price is the single's: the group's price is never "from" a price per person (lib/pricing.ts).
    expect(formatFeedPriceParts(event)).toEqual({ amount: "A$37.60", note: "incl. booking fee" });
  });
});
