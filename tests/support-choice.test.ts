import { describe, expect, it } from "vitest";
import {
  isEmptyOther,
  NO_SUPPORT,
  parseSupportAmount,
  supportAddedHint,
  supportCentsOf,
  supportErrorOf,
  totalIncludesWords,
} from "@/lib/support-choice";
import { isValidSupportCents } from "@/lib/support";

describe("parseSupportAmount (Support Sheltüh's Other amount)", () => {
  it.each([
    ["7", 700],
    ["7.5", 750],
    ["7.50", 750],
    ["7.", 700],
    [" 12.05 ", 1205],
    ["$3", 300],
    ["A$3", 300],
    ["a$ 3", 300],
    ["1", 100],
    ["500", 50_000],
    ["500.00", 50_000],
    ["7.500", 750],
    ["4.35", 435],
    ["1.10", 110],
  ])("reads %j as %i cents, in whole cents with no floating point", (text, cents) => {
    expect(parseSupportAmount(text)).toEqual({ ok: true, cents });
    expect(isValidSupportCents(cents)).toBe(true);
  });

  it("treats nothing typed as nothing added, without an error", () => {
    expect(parseSupportAmount("")).toEqual({ ok: true, cents: 0 });
    expect(parseSupportAmount("   ")).toEqual({ ok: true, cents: 0 });
  });

  it("refuses amounts below A$1 and above A$500, saying which limit", () => {
    for (const text of ["0", "0.00", "0.99", ".99", "0.5"]) {
      expect(parseSupportAmount(text), text).toEqual({ ok: false, error: "The smallest amount is A$1." });
    }
    for (const text of ["500.01", "501", "100000", "99999999999999999999"]) {
      expect(parseSupportAmount(text), text).toEqual({ ok: false, error: "The most you can add is A$500." });
    }
  });

  it("refuses part cents and anything that isn't an amount in dollars", () => {
    expect(parseSupportAmount("7.505")).toEqual({ ok: false, error: "Use whole cents, like 7.50." });
    for (const text of ["abc", "-5", "1,000", "5 dollars", ".", "1e2", "5.5.5"]) {
      expect(parseSupportAmount(text)).toEqual({ ok: false, error: "Enter an amount in dollars, like 7 or 7.50." });
    }
  });
});

describe("supportCentsOf / supportErrorOf", () => {
  it("adds nothing for none, an empty Other, or an Other that isn't valid yet", () => {
    expect(supportCentsOf(NO_SUPPORT)).toBe(0);
    expect(supportCentsOf({ option: "other", text: "" })).toBe(0);
    expect(supportCentsOf({ option: "other", text: "0.5" })).toBe(0);
    expect(supportErrorOf({ option: "other", text: "0.5" })).toBe("The smallest amount is A$1.");
  });

  it("adds a preset, or a valid Other, as it is", () => {
    expect(supportCentsOf({ option: "preset", cents: 500 })).toBe(500);
    expect(supportCentsOf({ option: "other", text: "12.34" })).toBe(1234);
    expect(supportErrorOf({ option: "preset", cents: 500 })).toBeNull();
    expect(supportErrorOf({ option: "other", text: "" })).toBeNull();
  });

  it("isEmptyOther: Other with nothing (or only spaces) typed, which Checkout treats as none", () => {
    expect(isEmptyOther({ option: "other", text: "" })).toBe(true);
    expect(isEmptyOther({ option: "other", text: "  " })).toBe(true);
    expect(isEmptyOther({ option: "other", text: "0.5" })).toBe(false);
    expect(isEmptyOther({ option: "preset", cents: 500 })).toBe(false);
    expect(isEmptyOther(NO_SUPPORT)).toBe(false);
  });

  it("supportAddedHint: how to take it off, only when an amount was added", () => {
    expect(supportAddedHint({ option: "preset", cents: 500 })).toBe(" Choose it again or press Remove to take it off.");
    expect(supportAddedHint({ option: "other", text: "" })).toBe("");
    expect(supportAddedHint(NO_SUPPORT)).toBe("");
  });

  it("says what a total includes", () => {
    expect(totalIncludesWords(0)).toBe("booking fees");
    expect(totalIncludesWords(500)).toBe("booking fees and Support Sheltüh");
  });
});
