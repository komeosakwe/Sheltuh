import { describe, expect, it } from "vitest";
import { bucketSeries, chooseBucket, niceMax } from "@/lib/analytics-chart";
import { addDays } from "@/lib/analytics-format";
import { isViewsUnreliable, unreliableDays, viewsCoverage } from "@/lib/analytics-data";
import type { AnalyticsDay } from "@/lib/api/types";

const days = (from: string, n: number) => Array.from({ length: n }, (_, i) => addDays(from, i));

describe("chooseBucket", () => {
  it("daily up to 62 days, weekly up to 400, monthly beyond", () => {
    expect(chooseBucket(62, false)).toBe("day");
    expect(chooseBucket(63, false)).toBe("week");
    expect(chooseBucket(400, false)).toBe("week");
    expect(chooseBucket(401, false)).toBe("month");
  });

  it("phones go weekly past 31 days", () => {
    expect(chooseBucket(31, true)).toBe("day");
    expect(chooseBucket(32, true)).toBe("week");
  });
});

describe("bucketSeries", () => {
  it("days stay as they are, labelled by date", () => {
    const points = bucketSeries(["2026-10-03", "2026-10-04"], [5, 0], "day");
    expect(points.map((p) => [p.label, p.value])).toEqual([
      ["3 Oct", 5],
      ["4 Oct", 0],
    ]);
    expect(points[0].longLabel).toBe("3 October 2026");
  });

  it("weeks start on Monday and sum their days", () => {
    // Thu 1 Oct .. Wed 14 Oct 2026
    const dates = days("2026-10-01", 14);
    const points = bucketSeries(dates, dates.map(() => 1), "week");
    expect(points.map((p) => [p.label, p.value])).toEqual([
      ["Week of 28 Sept", 4], // Thu–Sun
      ["Week of 5 Oct", 7],
      ["Week of 12 Oct", 3],
    ]);
  });

  it("months sum their days", () => {
    const dates = days("2026-09-29", 4); // 29, 30 Sep; 1, 2 Oct
    expect(bucketSeries(dates, [1, 2, 3, 4], "month").map((p) => p.value)).toEqual([3, 7]);
  });

  it("a bucket with no counted days is null (no data), not 0", () => {
    const dates = days("2026-10-01", 3);
    const points = bucketSeries(dates, [null, null, 4], "day");
    expect(points.map((p) => p.value)).toEqual([null, null, 4]);
    expect(bucketSeries(dates, [null, null, 4], "month")[0].value).toBe(4);
    expect(bucketSeries(dates, [null, null, null], "month")[0].value).toBeNull();
  });

  it("lines the previous period up by position", () => {
    const points = bucketSeries(days("2026-10-01", 2), [1, 2], "day", [7, null]);
    expect(points.map((p) => p.previous)).toEqual([7, null]);
  });
});

describe("niceMax", () => {
  it("rounds up to 1, 2 or 5 × 10ⁿ, at least 1", () => {
    expect(niceMax(0)).toBe(1);
    expect(niceMax(0.3)).toBe(0.5);
    expect(niceMax(3)).toBe(5);
    expect(niceMax(142)).toBe(200);
    expect(niceMax(1000)).toBe(1000);
    expect(niceMax(1001)).toBe(2000);
  });
});

describe("analytics data readings", () => {
  it("views coverage: none before counting began, partial when it began mid-range", () => {
    const range = { from: "2026-10-01", to: "2026-10-30" };
    expect(viewsCoverage(range, null)).toBe("none");
    expect(viewsCoverage(range, "2026-11-01")).toBe("none");
    expect(viewsCoverage(range, "2026-10-10")).toBe("partial");
    expect(viewsCoverage(range, "2026-10-01")).toBe("all");
    expect(viewsCoverage(range, "2026-01-01")).toBe("all");
  });

  it("reads the optional viewsUnreliable flag, absent meaning reliable", () => {
    const day = (date: string, extra: object = {}): AnalyticsDay => ({
      date,
      views: 1,
      orders: 0,
      ticketsSold: 0,
      grossCents: 0,
      feesCents: 0,
      netCents: 0,
      ...extra,
    });
    expect(unreliableDays([day("2026-10-01"), day("2026-10-02", { viewsUnreliable: true }), day("2026-10-03", { viewsUnreliable: "yes" })])).toEqual([
      "2026-10-02",
    ]);
    expect(isViewsUnreliable({})).toBe(false);
    expect(isViewsUnreliable(null)).toBe(false);
    expect(isViewsUnreliable({ viewsUnreliable: true })).toBe(true);
  });
});
