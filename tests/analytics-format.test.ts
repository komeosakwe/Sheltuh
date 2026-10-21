import { describe, expect, it } from "vitest";
import {
  addDays,
  daysInRange,
  formatAudExact,
  formatChange,
  formatConversion,
  formatCount,
  formatDateRange,
  formatDateRangeLong,
  formatDay,
  isIsoDay,
  melbourneToday,
  weekStart,
} from "@/lib/analytics-format";

describe("formatCount", () => {
  it("groups thousands and never abbreviates", () => {
    expect(formatCount(0)).toBe("0");
    expect(formatCount(1204)).toBe("1,204");
    expect(formatCount(12480)).toBe("12,480");
    expect(formatCount(1_250_000)).toBe("1,250,000");
  });
});

describe("formatAudExact", () => {
  it("always shows cents, grouped, unlike formatAud", () => {
    expect(formatAudExact(0)).toBe("A$0.00");
    expect(formatAudExact(3200)).toBe("A$32.00");
    expect(formatAudExact(120450)).toBe("A$1,204.50");
    expect(formatAudExact(5)).toBe("A$0.05");
  });

  it("uses a real minus sign for negatives", () => {
    expect(formatAudExact(-1200)).toBe("−A$12.00");
  });
});

describe("formatConversion", () => {
  it("one decimal place", () => {
    expect(formatConversion(0.034)).toBe("3.4%");
    expect(formatConversion(0)).toBe("0.0%");
    expect(formatConversion(1.5)).toBe("150.0%");
  });

  it("<0.1% for a sliver above zero that would round to 0.0%", () => {
    expect(formatConversion(0.0004)).toBe("<0.1%");
    expect(formatConversion(0.0005)).toBe("0.1%");
  });

  it("null (no views, or not counted) is no data, never 0", () => {
    expect(formatConversion(null)).toBeNull();
    expect(formatConversion(undefined)).toBeNull();
    expect(formatConversion(Number.NaN)).toBeNull();
  });
});

describe("formatChange", () => {
  it("says the direction in words, rounded to whole percent", () => {
    expect(formatChange(112, 100, 30)).toBe("Up 12% vs previous 30 days");
    expect(formatChange(92, 100, 30)).toBe("Down 8% vs previous 30 days");
    expect(formatChange(0, 100, 7)).toBe("Down 100% vs previous 7 days");
  });

  it("no change under half a percent", () => {
    expect(formatChange(1004, 1000, 30)).toBe("No change vs previous 30 days");
    expect(formatChange(0, 0, 30)).toBe("No change vs previous 30 days");
  });

  it("new when the previous value was 0, and caps huge rises", () => {
    expect(formatChange(5, 0, 30)).toBe("New this period");
    expect(formatChange(20000, 10, 30)).toBe("Up more than 999% vs previous 30 days");
  });

  it("no earlier data when the previous value wasn't counted, nothing when not comparing", () => {
    expect(formatChange(10, null, 30)).toBe("No earlier data");
    expect(formatChange(10, undefined, 30)).toBeUndefined();
    expect(formatChange(null, 10, 30)).toBeUndefined();
  });

  it("singular day", () => {
    expect(formatChange(2, 1, 1)).toBe("Up 100% vs previous day");
  });
});

describe("calendar dates", () => {
  it("validates real YYYY-MM-DD dates", () => {
    expect(isIsoDay("2026-10-03")).toBe(true);
    expect(isIsoDay("2026-02-30")).toBe(false);
    expect(isIsoDay("2026-1-3")).toBe(false);
    expect(isIsoDay(undefined)).toBe(false);
  });

  it("adds days and counts inclusive ranges across months and years", () => {
    expect(addDays("2026-10-01", -1)).toBe("2026-09-30");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(daysInRange("2026-10-01", "2026-10-30")).toBe(30);
    expect(daysInRange("2026-10-03", "2026-10-03")).toBe(1);
  });

  it("finds the Monday a week starts on", () => {
    expect(weekStart("2026-10-08")).toBe("2026-10-05"); // Thursday → Monday
    expect(weekStart("2026-10-05")).toBe("2026-10-05");
    expect(weekStart("2026-10-11")).toBe("2026-10-05"); // Sunday
  });

  it("today is the Melbourne date, not UTC's", () => {
    // 15:30 UTC on 14 Oct is 2:30 am on 15 Oct in Melbourne (AEDT).
    expect(melbourneToday(new Date("2026-10-14T15:30:00Z"))).toBe("2026-10-15");
  });

  it("formats days and ranges without shifting the day", () => {
    expect(formatDay("2026-10-03")).toBe("3 Oct");
    expect(formatDateRange("2026-10-01", "2026-10-30")).toBe("1–30 Oct 2026");
    expect(formatDateRange("2026-11-15", "2026-12-14")).toBe("15 Nov – 14 Dec 2026");
    expect(formatDateRange("2025-12-15", "2026-01-14")).toBe("15 Dec 2025 – 14 Jan 2026");
    expect(formatDateRange("2026-10-03", "2026-10-03")).toBe("3 Oct 2026");
    expect(formatDateRangeLong("2026-10-01", "2026-10-30")).toBe("1 to 30 October 2026");
  });
});
