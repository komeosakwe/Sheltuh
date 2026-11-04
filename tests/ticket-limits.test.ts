import { describe, expect, it } from "vitest";
import { isLow, MAX_PEOPLE_PER_TYPE, MAX_QUANTITY_PER_TYPE, ownLimit, ownLimitHint, remainingUnits } from "../lib/ticket-limits";
import type { TicketType } from "../lib/types";

const single: TicketType = { id: "ga", name: "General admission", priceCents: 3500, feePolicy: "buyer-pays", quantityAvailable: 100 };
const group: TicketType = { id: "grp", name: "Group of 4", priceCents: 12000, feePolicy: "buyer-pays", quantityAvailable: 40, admits: 4 };

describe("a single ticket's limits are unchanged", () => {
  it("caps at 8 per booking, and by what's left", () => {
    expect(ownLimit(single)).toBe(MAX_QUANTITY_PER_TYPE);
    expect(ownLimit({ ...single, quantityAvailable: 5 })).toBe(5);
    expect(ownLimit({ ...single, remaining: 3 })).toBe(3);
    expect(ownLimitHint({ ...single, remaining: 3 })).toBe("Only 3 left.");
    expect(ownLimitHint({ ...single, remaining: 9 })).toBe("Only 9 left. Up to 8 per booking.");
    expect(ownLimitHint(single)).toBe("Up to 8 per booking.");
    expect(isLow({ ...single, remaining: 3 })).toBe(true);
    expect(isLow(single)).toBe(false);
  });
});

describe("a group ticket's limits are in groups", () => {
  it("caps at 20 people: 5 groups of 4, 10 groups of 2 (but never over 8 tickets)", () => {
    expect(MAX_PEOPLE_PER_TYPE).toBe(20);
    expect(ownLimit(group)).toBe(5);
    expect(ownLimit({ ...group, admits: 2, quantityAvailable: 40 })).toBe(8);
    expect(ownLimit({ ...group, admits: 10, quantityAvailable: 40 })).toBe(2);
  });

  it("is also capped by the capacity and by what's left, in whole groups", () => {
    expect(ownLimit({ ...group, quantityAvailable: 8 })).toBe(2);
    expect(ownLimit({ ...group, remaining: 8 })).toBe(2);
    expect(ownLimit({ ...group, remaining: 4 })).toBe(1);
    expect(remainingUnits({ ...group, remaining: 8 })).toBe(2);
    expect(remainingUnits(group)).toBeUndefined();
  });

  it("says what's left in groups", () => {
    expect(ownLimitHint({ ...group, remaining: 8 })).toBe("Only 2 groups left.");
    expect(ownLimitHint({ ...group, remaining: 4 })).toBe("Only 1 group left.");
    expect(ownLimitHint(group)).toBe("Up to 5 per booking.");
    expect(isLow({ ...group, remaining: 8 })).toBe(true);
    expect(isLow({ ...group, remaining: 0 })).toBe(false);
  });
});
