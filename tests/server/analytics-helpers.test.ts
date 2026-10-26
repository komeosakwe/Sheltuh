import { describe, expect, it } from "vitest";
import { calculateBookingFeeCents } from "@/lib/fees";
import {
  addDays,
  eachDay,
  MAX_RANGE_DAYS,
  melbourneDateOf,
  parseAnalyticsQuery,
  previousPeriod,
} from "@/lib/server/analytics-range";
import { allocate, ticketTypeSales } from "@/lib/server/analytics-report";
import { centsToDecimal, csvCell, toCsv } from "@/lib/server/csv";
import { isLikelyBot } from "@/lib/server/handlers/event-views";
import { parseLinkLabel } from "@/lib/server/handlers/tracking-links";
import { HttpError } from "@/lib/server/http";
import { generateTrackingCode, parseTrackingCode, TRACKING_CODE_PATTERN } from "@/lib/server/tracking-codes";

describe("csvCell", () => {
  it("quotes every cell and doubles quotes", () => {
    expect(csvCell("plain")).toBe('"plain"');
    expect(csvCell('a "b", c')).toBe('"a ""b"", c"');
    expect(csvCell("line\nbreak")).toBe('"line\nbreak"');
    expect(csvCell(null)).toBe('""');
    expect(csvCell(undefined)).toBe('""');
    expect(csvCell(42)).toBe('"42"');
    expect(csvCell(Number.NaN)).toBe('""');
  });

  it("neutralises anything a spreadsheet would run as a formula", () => {
    for (const formula of ["=1+1", "+1", "-1", "@SUM(A1)", "\t=1", "\r=1", " =1", "　=1", '=cmd|"/c calc"!A1']) {
      expect(csvCell(formula).startsWith(`"'`), JSON.stringify(formula)).toBe(true);
    }
    expect(csvCell("a=b")).toBe('"a=b"');
    expect(csvCell("Night market")).toBe('"Night market"');
  });

  it("writes money as decimal dollars, untouched by the formula guard", () => {
    expect(csvCell({ cents: 120450 })).toBe('"1204.50"');
    expect(csvCell({ cents: 5 })).toBe('"0.05"');
    expect(csvCell({ cents: -1200 })).toBe('"-12.00"');
    expect(centsToDecimal(0)).toBe("0.00");
  });

  it("builds a file with a BOM and CRLF line ends", () => {
    expect(toCsv([["a", 1], ["b"]])).toBe('﻿"a","1"\r\n"b"\r\n');
  });
});

describe("date ranges", () => {
  const today = "2026-10-14";
  const parse = (q: Record<string, string>, from = "2026-09-15") =>
    parseAnalyticsQuery(new URLSearchParams(q), { from, today });
  const fieldErrors = (q: Record<string, string>) => {
    try {
      parse(q);
    } catch (err) {
      expect(err).toBeInstanceOf(HttpError);
      return (err as HttpError).fieldErrors;
    }
    throw new Error("expected a 400");
  };

  it("uses the defaults and reads compare", () => {
    expect(parse({})).toEqual({ range: { from: "2026-09-15", to: today }, compare: false });
    expect(parse({ compare: "prevPeriod" }).compare).toBe(true);
    expect(parse({ from: "2026-01-01", to: "2026-01-31" }).range).toEqual({ from: "2026-01-01", to: "2026-01-31" });
  });

  it("pulls a default start forward so it never breaks the cap or ends after `to`", () => {
    expect(parse({}, "2020-01-01").range.from).toBe(addDays(today, -(MAX_RANGE_DAYS - 1)));
    expect(parse({ to: "2026-09-01" }).range).toEqual({ from: "2026-09-01", to: "2026-09-01" });
  });

  it("rejects bad dates, reversed and over-long ranges, and unknown compare values", () => {
    expect(fieldErrors({ from: "2026-02-29" })).toHaveProperty("from");
    expect(fieldErrors({ from: "2026-1-01" })).toHaveProperty("from");
    expect(fieldErrors({ to: "2101-01-01" })).toHaveProperty("to");
    expect(fieldErrors({ from: "2026-10-02", to: "2026-10-01" })).toHaveProperty("to");
    expect(fieldErrors({ from: "2024-10-13", to: "2026-10-14" })).toHaveProperty("from");
    expect(parse({ from: "2024-10-14", to: "2026-10-14" }).range.from).toBe("2024-10-14");
    expect(fieldErrors({ compare: "1" })).toHaveProperty("compare");
  });

  it("works out the previous period and every day, across daylight saving and leap days", () => {
    expect(previousPeriod({ from: "2026-10-01", to: "2026-10-10" })).toEqual({ from: "2026-09-21", to: "2026-09-30" });
    expect(previousPeriod({ from: "2024-03-01", to: "2024-03-01" })).toEqual({ from: "2024-02-29", to: "2024-02-29" });
    expect(eachDay({ from: "2026-10-03", to: "2026-10-05" })).toEqual(["2026-10-03", "2026-10-04", "2026-10-05"]);
  });

  it("dates instants in Melbourne time", () => {
    // 13:59 UTC is 23:59 AEST; 14:00 UTC is midnight.
    expect(melbourneDateOf("2026-07-01T13:59:00Z")).toBe("2026-07-01");
    expect(melbourneDateOf("2026-07-01T14:00:00Z")).toBe("2026-07-02");
    // In daylight saving (AEDT, +11), 13:00 UTC is already midnight.
    expect(melbourneDateOf("2026-12-01T13:00:00Z")).toBe("2026-12-02");
  });
});

describe("money split by ticket type", () => {
  it("allocate always adds up exactly and returns the weights when they already match", () => {
    expect(allocate(880, [510, 370])).toEqual([510, 370]);
    expect(allocate(100, [1, 1, 1])).toEqual([34, 33, 33]);
    expect(allocate(7, [0, 0])).toEqual([7, 0]);
    expect(allocate(0, [5, 5])).toEqual([0, 0]);
    expect(allocate(5, [])).toEqual([]);
    const big = allocate(9_007_199_254, [3_000_000_001, 2, 7]);
    expect(big.reduce((a, b) => a + b, 0)).toBe(9_007_199_254);
  });

  const current = [
    { id: "ga", name: "GA", priceCents: 3000, feePolicy: "buyer-pays" as const, quantityAvailable: 10 },
    { id: "vip", name: "VIP", priceCents: 8000, feePolicy: "organiser-absorbs" as const, quantityAvailable: 5 },
  ];

  it("uses lib/fees.ts per line when the snapshots agree", () => {
    const groups = [
      { ticketTypeId: "ga", ticketTypeName: "GA", unitPriceCents: 3000, feePolicy: "buyer-pays" as const, quantity: 3 },
      { ticketTypeId: "vip", ticketTypeName: "VIP", unitPriceCents: 8000, feePolicy: "organiser-absorbs" as const, quantity: 1 },
    ];
    const fee = (p: number) => calculateBookingFeeCents(p);
    const rows = ticketTypeSales(current, groups, {
      orders: 2,
      ticketsSold: 4,
      grossCents: 9000 + 3 * fee(3000) + 8000,
      feesCents: 3 * fee(3000) + fee(8000),
    });
    expect(rows).toEqual([
      expect.objectContaining({ ticketTypeId: "ga", ticketsSold: 3, faceValueCents: 9000, grossCents: 9690, feesCents: 690, netCents: 9000 }),
      expect.objectContaining({ ticketTypeId: "vip", ticketsSold: 1, faceValueCents: 8000, grossCents: 8000, feesCents: 530, netCents: 7470 }),
    ]);
  });

  it("reconciles to the orders' snapshots when fees were different then, and keeps removed or repriced types", () => {
    const groups = [
      // Sold at an old price, and a type that no longer exists.
      { ticketTypeId: "ga", ticketTypeName: "GA", unitPriceCents: 2500, feePolicy: "buyer-pays" as const, quantity: 2 },
      { ticketTypeId: "ga", ticketTypeName: "GA", unitPriceCents: 3000, feePolicy: "buyer-pays" as const, quantity: 1 },
      { ticketTypeId: "old", ticketTypeName: "Early bird", unitPriceCents: 1000, feePolicy: "buyer-pays" as const, quantity: 1 },
    ];
    // Under an older 5% + 50c rule: fees 175×2 + 200 + 100 = 650.
    const snapshot = { orders: 3, ticketsSold: 4, grossCents: 5000 + 3000 + 1000 + 650, feesCents: 650 };
    const rows = ticketTypeSales(current, groups, snapshot);
    expect(rows.map((r) => r.ticketTypeId)).toEqual(["ga", "vip", "old"]);
    expect(rows.reduce((a, r) => a + r.grossCents, 0)).toBe(snapshot.grossCents);
    expect(rows.reduce((a, r) => a + r.feesCents, 0)).toBe(snapshot.feesCents);
    for (const r of rows) expect(r.netCents).toBe(r.grossCents - r.feesCents);
    expect(rows[0]).toMatchObject({ ticketsSold: 3, faceValueCents: 8000 });
    expect(rows[1]).toMatchObject({ ticketsSold: 0, grossCents: 0 });
    expect(rows[2]).toMatchObject({ name: "Early bird", ticketsSold: 1 });
    expect(rows[2].priceCents).toBeUndefined();
  });
});

describe("bot detection", () => {
  const req = (headers: Record<string, string>) => new Request("https://x.test", { headers });
  it("lets real browsers through and stops obvious automation", () => {
    expect(
      isLikelyBot(req({ "user-agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148" })),
    ).toBe(false);
    expect(isLikelyBot(req({}))).toBe(true);
    expect(isLikelyBot(req({ "user-agent": "Twitterbot/1.0" }))).toBe(true);
    expect(isLikelyBot(req({ "user-agent": "node-fetch/3" }))).toBe(true);
    expect(isLikelyBot(req({ "user-agent": "Mozilla/5.0 Chrome/120", "sec-purpose": "prefetch" }))).toBe(true);
  });
});

describe("tracking codes and labels", () => {
  it("generates codes from the safe alphabet", () => {
    const codes = new Set(Array.from({ length: 200 }, generateTrackingCode));
    expect(codes.size).toBe(200);
    for (const code of codes) expect(code).toMatch(/^[2-9a-hjkmnp-z]{8}$/);
  });

  it("accepts only well-formed codes from clients, never throwing", () => {
    expect(parseTrackingCode(" AbCdEfGh ")).toBe("abcdefgh");
    for (const bad of ["abc", "abcdefghjkm", "abcdefg0", "abcdefgl", "abcdefgi", "abcdefgo", 1, null, {}, ["abcdefgh"]]) {
      expect(parseTrackingCode(bad)).toBeNull();
    }
    expect(TRACKING_CODE_PATTERN.test("2222222")).toBe(true);
  });

  it("validates labels", () => {
    expect(parseLinkLabel("  Instagram bio ")).toBe("Instagram bio");
    expect(parseLinkLabel("é".repeat(20))).toBe("é".repeat(20));
    for (const bad of ["", " ", null, 3, "x".repeat(41), "a\tb", "a‮b", "a b"]) {
      expect(() => parseLinkLabel(bad)).toThrow(HttpError);
    }
  });
});
