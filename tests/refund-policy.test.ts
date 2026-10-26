import { describe, expect, it } from "vitest";
import {
  DEFAULT_REFUND_POLICY,
  isValidRefundDays,
  MAX_REFUND_DAYS,
  MIN_REFUND_DAYS,
  REFUND_ACL_STATEMENT,
  REFUND_POLICIES,
  REFUND_WINDOW_CLOSED,
  refundDeadline,
  refundPolicySummary,
  refundTermsLine,
  refundTermsSummary,
  tightensRefundPolicy,
} from "@/lib/refund-policy";

describe("refundPolicySummary", () => {
  it("no_change_of_mind, whatever days are passed", () => {
    expect(refundPolicySummary("no_change_of_mind")).toBe("No refunds for change of mind.");
    expect(refundPolicySummary("no_change_of_mind", null)).toBe("No refunds for change of mind.");
    expect(refundPolicySummary("no_change_of_mind", 7)).toBe("No refunds for change of mind.");
  });

  it("days_before, with day or days", () => {
    expect(refundPolicySummary("days_before", 1)).toBe("Refunds available up to 1 day before the event.");
    expect(refundPolicySummary("days_before", 7)).toBe("Refunds available up to 7 days before the event.");
    expect(refundPolicySummary("days_before", 30)).toBe("Refunds available up to 30 days before the event.");
  });

  it("throws for days_before without valid days, rather than saying something untrue", () => {
    for (const days of [undefined, null, 0, 31, 2.5, Number.NaN]) {
      expect(() => refundPolicySummary("days_before", days), String(days)).toThrow(RangeError);
    }
  });

  it("refundTermsSummary: the same sentence, or null (never a throw) when there's nothing true to say", () => {
    expect(refundTermsSummary("no_change_of_mind")).toBe("No refunds for change of mind.");
    expect(refundTermsSummary("days_before", 7)).toBe("Refunds available up to 7 days before the event.");
    for (const days of [undefined, null, 0, 31, 2.5]) expect(refundTermsSummary("days_before", days), String(days)).toBeNull();
    expect(refundTermsSummary(undefined)).toBeNull();
    expect(refundTermsSummary(null, 7)).toBeNull();
  });

  it("the Australian Consumer Law line", () => {
    expect(REFUND_ACL_STATEMENT).toBe(
      "You're always entitled to a refund if the event is cancelled or significantly changed, as the Australian Consumer Law requires.",
    );
  });
});

describe("the policy's values", () => {
  it("match the database's check constraints", () => {
    expect(REFUND_POLICIES).toEqual(["no_change_of_mind", "days_before"]);
    expect(DEFAULT_REFUND_POLICY).toBe("no_change_of_mind");
    expect([MIN_REFUND_DAYS, MAX_REFUND_DAYS]).toEqual([1, 30]);
  });

  it("isValidRefundDays: whole numbers from 1 to 30 only", () => {
    expect([1, 15, 30].every(isValidRefundDays)).toBe(true);
    expect([0, 31, -1, 1.5, "7", null, undefined, Number.POSITIVE_INFINITY].some(isValidRefundDays)).toBe(false);
  });
});

describe("tightensRefundPolicy", () => {
  const none = { refundPolicy: "no_change_of_mind" } as const;
  const days = (refundDays: number) => ({ refundPolicy: "days_before", refundDays }) as const;

  it("days_before → no_change_of_mind tightens; the reverse loosens", () => {
    expect(tightensRefundPolicy(days(30), none)).toBe(true);
    expect(tightensRefundPolicy(none, days(30))).toBe(false);
  });

  it("more days' notice tightens (the window closes earlier); fewer loosens", () => {
    expect(tightensRefundPolicy(days(7), days(14))).toBe(true);
    expect(tightensRefundPolicy(days(14), days(7))).toBe(false);
  });

  it("the same policy doesn't", () => {
    expect(tightensRefundPolicy(none, none)).toBe(false);
    expect(tightensRefundPolicy(days(7), days(7))).toBe(false);
    // Days stored with no_change_of_mind (never, by the constraint) are ignored.
    expect(tightensRefundPolicy(none, { refundPolicy: "no_change_of_mind", refundDays: 3 })).toBe(false);
  });
});

describe("refundTermsLine: the policy against the event's start", () => {
  // Sat 28 Nov 2026, 7:00 pm in Melbourne (AEDT, UTC+11).
  const START = "2026-11-28T08:00:00.000Z";
  const at = (iso: string) => ({ now: new Date(iso) });

  it("before the deadline: the date and time refunds close, in the event's zone, and the days", () => {
    expect(refundTermsLine("days_before", 7, START, at("2026-11-01T00:00:00.000Z"))).toBe(
      "Refunds available until Sat 21 Nov, 7:00 pm (7 days before the event).",
    );
    expect(refundTermsLine("days_before", 1, START, at("2026-11-01T00:00:00.000Z"))).toBe(
      "Refunds available until Fri 27 Nov, 7:00 pm (1 day before the event).",
    );
  });

  it("from the deadline on: the window has closed, and no change-of-mind refunds", () => {
    expect(REFUND_WINDOW_CLOSED).toBe("The refund window for this event has closed. No refunds for change of mind.");
    // 3 days to go with a 7-day policy: never "up to 7 days before".
    expect(refundTermsLine("days_before", 7, START, at("2026-11-25T08:00:00.000Z"))).toBe(REFUND_WINDOW_CLOSED);
    // Exactly at the deadline it's closed; a minute before, it's open.
    expect(refundTermsLine("days_before", 7, START, at("2026-11-21T08:00:00.000Z"))).toBe(REFUND_WINDOW_CLOSED);
    expect(refundTermsLine("days_before", 7, START, at("2026-11-21T07:59:00.000Z"))).toMatch(/^Refunds available until/);
  });

  it("no_change_of_mind is the same sentence as always, whenever it's asked", () => {
    for (const now of ["2026-01-01T00:00:00.000Z", "2026-11-27T00:00:00.000Z", "2027-01-01T00:00:00.000Z"]) {
      expect(refundTermsLine("no_change_of_mind", null, START, at(now))).toBe("No refunds for change of mind.");
    }
  });

  it("the deadline is days × 24 hours before the start: across a daylight-saving change, an hour off the start's clock time", () => {
    // Sun 4 Apr 2027, 7:00 pm AEST (UTC+10): Melbourne's clocks went back that morning.
    const afterDst = "2027-04-04T09:00:00.000Z";
    expect(refundDeadline(afterDst, 7)?.toISOString()).toBe("2027-03-28T09:00:00.000Z");
    expect(refundTermsLine("days_before", 7, afterDst, at("2026-11-01T00:00:00.000Z"))).toBe(
      "Refunds available until Sun 28 Mar 2027, 8:00 pm (7 days before the event).",
    );
    // Sun 10 Oct 2027, 7:00 pm AEDT (UTC+11): the clocks went forward early on Sun 3 Oct, so 8 days
    // before is still standard time (UTC+10).
    const intoDst = "2027-10-10T08:00:00.000Z";
    expect(refundTermsLine("days_before", 8, intoDst, at("2027-01-01T00:00:00.000Z"))).toBe(
      "Refunds available until Sat 2 Oct, 6:00 pm (8 days before the event).",
    );
  });

  it("formats the deadline in the event's zone (Melbourne by default)", () => {
    const now = at("2026-11-01T00:00:00.000Z").now;
    expect(refundTermsLine("days_before", 7, START, { now, timeZone: "Australia/Perth" })).toBe(
      "Refunds available until Sat 21 Nov, 4:00 pm (7 days before the event).",
    );
    expect(refundTermsLine("days_before", 7, START, { now, timeZone: "Australia/Brisbane" })).toBe(
      "Refunds available until Sat 21 Nov, 6:00 pm (7 days before the event).",
    );
    expect(refundTermsLine("days_before", 7, START, { now })).toBe(
      refundTermsLine("days_before", 7, START, { now, timeZone: "Australia/Melbourne" }),
    );
  });

  it("the year, when the deadline isn't in this year", () => {
    expect(refundTermsLine("days_before", 7, "2027-01-20T08:00:00.000Z", at("2026-11-01T00:00:00.000Z"))).toBe(
      "Refunds available until Wed 13 Jan 2027, 7:00 pm (7 days before the event).",
    );
  });

  it("nothing true to say: null, as refundTermsSummary; no usable start: the plain summary", () => {
    expect(refundTermsLine(undefined, 7, START)).toBeNull();
    expect(refundTermsLine("days_before", null, START)).toBeNull();
    expect(refundTermsLine("days_before", 31, START)).toBeNull();
    expect(refundTermsLine("days_before", 7, undefined)).toBe("Refunds available up to 7 days before the event.");
    expect(refundTermsLine("days_before", 7, "not a date")).toBe("Refunds available up to 7 days before the event.");
    expect(refundDeadline("not a date", 7)).toBeNull();
    expect(refundDeadline(START, 0)).toBeNull();
  });
});
