import { describe, expect, it } from "vitest";
import {
  DEFAULT_REFUND_POLICY,
  isValidRefundDays,
  MAX_REFUND_DAYS,
  MIN_REFUND_DAYS,
  REFUND_ACL_STATEMENT,
  REFUND_POLICIES,
  refundPolicySummary,
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
