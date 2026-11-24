import { describe, expect, it } from "vitest";
import { buyerNameError, BUYER_NAME_MAX } from "@/lib/buyer-details";
import { holderLineText, orderHolderLines, orderPaidText, orderPlacedText, orderStatusText, orderTicketsText } from "@/lib/event-orders-format";

describe("orderStatusText", () => {
  it.each([
    [{ status: "paid", paidCents: 3230, refundedCents: 0 }, "Paid"],
    [{ status: "refunded", paidCents: 3230, refundedCents: 3230 }, "Refunded"],
    [{ status: "refunded", paidCents: 0, refundedCents: 0 }, "Refunded"],
    [{ status: "refunded", paidCents: 6000, refundedCents: 1500 }, "Part refunded A$15"],
    [{ status: "paid", paidCents: 6000, refundedCents: 1550 }, "Part refunded A$15.50"],
  ] as const)("%j is %s", (order, text) => {
    expect(orderStatusText(order)).toBe(text);
  });
});

describe("order cells", () => {
  it("lists tickets with their counts", () => {
    expect(orderTicketsText({ tickets: [{ ticketTypeName: "General", quantity: 2 }, { ticketTypeName: "VIP", quantity: 1 }] })).toBe(
      "2 × General, 1 × VIP",
    );
  });

  it("says Free for nothing paid", () => {
    expect(orderPaidText({ paidCents: 0 })).toBe("Free");
    expect(orderPaidText({ paidCents: 3230 })).toBe("A$32.30");
  });

  it("shows the time in the event's zone, naming it when it isn't Melbourne's", () => {
    const now = new Date("2026-11-05T00:00:00Z");
    expect(orderPlacedText("2026-11-04T09:05:00Z", "Australia/Melbourne", now)).toBe("Wed 4 Nov, 8:05 pm");
    expect(orderPlacedText("2026-11-04T09:05:00Z", "Australia/Perth", now)).toMatch(/^Wed 4 Nov, 5:05 pm Perth time$/);
    expect(orderPlacedText("2025-11-04T09:05:00Z", "Australia/Melbourne", now)).toBe("Tue 4 Nov 2025, 8:05 pm");
  });
});

describe("buyerNameError", () => {
  it("needs a name", () => {
    expect(buyerNameError("")).toBe("Enter your name.");
    expect(buyerNameError("   ")).toBe("Enter your name.");
    expect(buyerNameError(" Alex ")).toBeNull();
  });

  it(`allows ${BUYER_NAME_MAX} characters, counting an emoji as one`, () => {
    expect(buyerNameError("a".repeat(BUYER_NAME_MAX))).toBeNull();
    expect(buyerNameError("😀".repeat(BUYER_NAME_MAX))).toBeNull();
    expect(buyerNameError("a".repeat(BUYER_NAME_MAX + 1))).toBe("Use 80 characters or fewer.");
  });
});

describe("orderHolderLines", () => {
  const now = new Date("2026-11-05T00:00:00Z");
  const holder = (holderName: string | null, holderEmail: string | null, transferredAt: string, ticketNumber = 1) => ({
    ticketNumber,
    ticketTypeName: "General",
    holderName,
    holderEmail,
    transferredAt,
  });

  it("nothing for an order with no tickets sent on (or an older answer without holders)", () => {
    expect(orderHolderLines({ holders: [] }, "Australia/Melbourne", now)).toEqual([]);
    expect(orderHolderLines({}, "Australia/Melbourne", now)).toEqual([]);
  });

  it("one line per holder, their tickets together and dated by the latest, in the event's zone", () => {
    const lines = orderHolderLines(
      {
        holders: [
          holder("Sam Lee", "sam@example.com", "2026-11-03T13:30:00Z", 1),
          holder("Kim Ng", "kim@example.com", "2026-11-02T01:00:00Z", 2),
          holder("Sam Lee", "sam@example.com", "2026-11-01T01:00:00Z", 3),
        ],
      },
      "Australia/Melbourne",
      now,
    );
    // 13:30 UTC on the 3rd is the 4th in Melbourne.
    expect(lines).toEqual([
      ["2 tickets sent to Sam Lee", "sam@example.com", "Sent Wed 4 Nov"],
      ["1 ticket sent to Kim Ng", "kim@example.com", "Sent Mon 2 Nov"],
    ]);
    expect(lines.map(holderLineText)).toEqual(["2 tickets sent to Sam Lee · sam@example.com · Sent Wed 4 Nov", "1 ticket sent to Kim Ng · kim@example.com · Sent Mon 2 Nov"]);
    expect(orderHolderLines({ holders: [holder("Sam Lee", "sam@example.com", "2026-11-03T13:30:00Z")] }, "Australia/Perth", now)).toEqual([
      ["1 ticket sent to Sam Lee", "sam@example.com", "Sent Tue 3 Nov"],
    ]);
  });

  it("hidden holders share one line that says the details aren't shared, never a name; the date says it's when it was sent", () => {
    expect(
      orderHolderLines(
        { holders: [holder(null, null, "2026-11-02T01:00:00Z"), holder(null, null, "2025-11-02T01:00:00Z")] },
        "Australia/Melbourne",
        now,
      ),
    ).toEqual([["2 tickets sent to other people (details not shared)", "Sent Mon 2 Nov"]]);
    expect(orderHolderLines({ holders: [holder(null, null, "2026-11-07T01:00:00Z")] }, "Australia/Melbourne", now)).toEqual([
      ["1 ticket sent to someone else (details not shared)", "Sent Sat 7 Nov"],
    ]);
  });
});
