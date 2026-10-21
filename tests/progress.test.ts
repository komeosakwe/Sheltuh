import { describe, expect, it } from "vitest";
import { estimatedProgress, PROGRESS_CEILING, PROGRESS_HALF_LIFE_MS } from "@/lib/progress";

describe("estimatedProgress (honest loading percentage)", () => {
  it("starts at 0", () => {
    expect(estimatedProgress(0, false)).toBe(0);
  });

  it("eases: rises quickly at first, then slows, and never goes backwards", () => {
    const samples = [0, 100, 200, 400, 800, 1600, 3200, 6400].map((ms) => estimatedProgress(ms, false));
    for (let i = 1; i < samples.length; i += 1) expect(samples[i]).toBeGreaterThanOrEqual(samples[i - 1]);
    // Half the way to the ceiling after one half-life, three quarters after two.
    expect(estimatedProgress(PROGRESS_HALF_LIFE_MS, false)).toBe(Math.floor(PROGRESS_CEILING / 2));
    expect(estimatedProgress(2 * PROGRESS_HALF_LIFE_MS, false)).toBe(Math.floor(PROGRESS_CEILING * 0.75));
    // Early steps are bigger than late ones.
    const early = estimatedProgress(400, false) - estimatedProgress(0, false);
    const late = estimatedProgress(4400, false) - estimatedProgress(4000, false);
    expect(early).toBeGreaterThan(late);
  });

  it("caps below 100 (at the ~90% ceiling) however long it takes, until the data is in", () => {
    for (const ms of [10_000, 60_000, 3_600_000, Number.MAX_SAFE_INTEGER]) {
      const value = estimatedProgress(ms, false);
      expect(value).toBeLessThan(100);
      expect(value).toBeLessThanOrEqual(PROGRESS_CEILING);
    }
    expect(estimatedProgress(60_000, false)).toBeGreaterThanOrEqual(PROGRESS_CEILING - 1);
    // A ceiling of 100 or more is clamped: it can never claim to be done.
    expect(estimatedProgress(1e12, false, { ceiling: 150 })).toBeLessThan(100);
  });

  it("completes to 100 only when done, from any point", () => {
    expect(estimatedProgress(0, true)).toBe(100);
    expect(estimatedProgress(250, true)).toBe(100);
    expect(estimatedProgress(60_000, true)).toBe(100);
  });

  it("is always a whole number, and moves in steps when asked (reduced motion)", () => {
    for (const ms of [33, 517, 1234, 2999]) {
      expect(Number.isInteger(estimatedProgress(ms, false))).toBe(true);
      expect(estimatedProgress(ms, false, { step: 10 }) % 10).toBe(0);
    }
    expect(estimatedProgress(PROGRESS_HALF_LIFE_MS, false, { step: 10 })).toBe(40);
  });

  it("treats nonsense input as no time elapsed", () => {
    expect(estimatedProgress(-500, false)).toBe(0);
    expect(estimatedProgress(Number.NaN, false)).toBe(0);
  });
});
