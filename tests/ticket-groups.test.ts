import { describe, expect, it } from "vitest";
import {
  admitsOf,
  groupOfLabel,
  groupPositionLabel,
  groupSaving,
  groupSavingLabel,
  groupsIn,
  groupTicketsLabel,
  isGroupTicket,
  peopleFor,
  ticketNameWithGroup,
  withGroupPositions,
} from "../lib/ticket-groups";
import type { TicketType } from "../lib/types";

// Owner's example: a single A$35 (buyer pays: A$37.60) against a group of 4 for A$120 (buyer pays: A$127.70).
const single: TicketType = { id: "ga", name: "General admission", priceCents: 3500, feePolicy: "buyer-pays", quantityAvailable: 100 };
const group: TicketType = { id: "grp", name: "Group of 4", priceCents: 12000, feePolicy: "buyer-pays", quantityAvailable: 40, admits: 4 };

describe("admits", () => {
  it("is 1 unless the ticket is a group ticket", () => {
    expect(admitsOf(single)).toBe(1);
    expect(admitsOf({ admits: 1 })).toBe(1);
    expect(admitsOf(group)).toBe(4);
    expect(isGroupTicket(single)).toBe(false);
    expect(isGroupTicket(group)).toBe(true);
  });

  it("counts people from tickets and whole groups from people", () => {
    expect(peopleFor(group, 2)).toBe(8);
    expect(peopleFor(single, 2)).toBe(2);
    expect(groupsIn(group, 10)).toBe(2);
    expect(groupsIn(group, 3)).toBe(0);
    expect(groupsIn(single, 7)).toBe(7);
  });

  it("has the words the UI uses", () => {
    expect(groupOfLabel(4)).toBe("Group of 4");
    expect(groupTicketsLabel(4)).toBe("4 tickets");
    expect(groupPositionLabel({ position: 2, size: 4 })).toBe("2 of 4");
    expect(ticketNameWithGroup("Group of 4", { position: 2, size: 4 })).toBe("Group of 4 (2 of 4)");
    expect(ticketNameWithGroup("General admission")).toBe("General admission");
  });
});

describe("withGroupPositions", () => {
  it("numbers the people of each group, group by group, in order, per ticket type", () => {
    const tickets = [
      { ticketTypeId: "ga" },
      ...Array.from({ length: 8 }, () => ({ ticketTypeId: "grp", groupSize: 4 })),
      ...Array.from({ length: 2 }, () => ({ ticketTypeId: "pair", groupSize: 2 })),
    ];
    expect(withGroupPositions(tickets).map((t) => (t as { group?: unknown }).group)).toEqual([
      undefined,
      ...[1, 2, 3, 4, 1, 2, 3, 4].map((position) => ({ position, size: 4 })),
      { position: 1, size: 2 },
      { position: 2, size: 2 },
    ]);
  });

  it("leaves a single ticket (or a null size) alone, and doesn't change its input", () => {
    const input = [{ ticketTypeId: "ga", groupSize: null }, { ticketTypeId: "ga" }];
    const out = withGroupPositions(input);
    expect(out).toEqual(input);
    expect(out[0]).toBe(input[0]);
  });
});

describe("groupSaving", () => {
  it("is size x the cheapest single's buyer total less the group's: the owner's A$22.70", () => {
    const saving = groupSaving(group, [single, group]);
    expect(saving).toMatchObject({ savingCents: 4 * 3760 - 12770, single });
    expect(saving?.savingCents).toBe(2270);
    expect(groupSavingLabel(group, [single, group])).toBe("save A$22.70");
  });

  it("uses the cheapest single on sale", () => {
    const cheap = { ...single, id: "early", priceCents: 3000 };
    expect(groupSaving(group, [single, cheap, group])?.single.id).toBe("early");
    expect(groupSaving(group, [single, cheap, group])?.savingCents).toBe(4 * 3230 - 12770);
  });

  it("ignores a single that's sold out, waiting to open, seated, or has fewer than the group left", () => {
    const cheap = { ...single, id: "early", priceCents: 3000 };
    for (const unavailable of [
      { ...cheap, soldOut: true },
      { ...cheap, opensAfter: { ticketTypeId: "x", name: "x" } },
      { ...cheap, seated: true as const },
      { ...cheap, remaining: 3 },
    ]) {
      expect(groupSaving(group, [single, unavailable, group])?.single.id).toBe("ga");
    }
    // Exactly the group's size left is enough; 10 or fewer is sent only when true.
    expect(groupSaving(group, [{ ...single, remaining: 4 }, group])?.single.id).toBe("ga");
  });

  it("is null when it saves nothing, when there's no single, or for a single ticket", () => {
    expect(groupSaving({ ...group, priceCents: 15000 }, [single, group])).toBeNull();
    expect(groupSaving({ ...group, priceCents: 14150 }, [single, group])).toBeNull();
    expect(groupSaving(group, [group])).toBeNull();
    expect(groupSaving(group, [{ ...single, soldOut: true }, group])).toBeNull();
    expect(groupSaving(single, [single, group])).toBeNull();
    expect(groupSavingLabel(single, [single, group])).toBeNull();
  });

  it("a free single saves nothing", () => {
    expect(groupSaving(group, [{ ...single, priceCents: 0 }, group])).toBeNull();
  });

  it("an organiser-absorbed group is compared by what the buyer pays", () => {
    const absorbed = { ...group, priceCents: 14000, feePolicy: "organiser-absorbs" as const };
    // 4 x 3760 = 15040 against 14000.
    expect(groupSaving(absorbed, [single, absorbed])?.savingCents).toBe(1040);
  });
});
