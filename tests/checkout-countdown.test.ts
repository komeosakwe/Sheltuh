import { describe, expect, it } from "vitest";
import {
  COUNTDOWN_TIME_UP_ANNOUNCEMENT,
  clockOffsetMs,
  countdownAnnouncement,
  formatCountdown,
  isCountdownUrgent,
  localDeadline,
  msUntilNextSecond,
} from "@/lib/checkout-countdown";

const MIN = 60_000;

describe("formatCountdown", () => {
  it("is mm:ss, whole seconds rounded up", () => {
    expect(formatCountdown(14 * MIN + 32_000)).toBe("14:32");
    expect(formatCountdown(14 * MIN + 31_001)).toBe("14:32");
    expect(formatCountdown(5 * MIN)).toBe("05:00");
    expect(formatCountdown(59_999)).toBe("01:00");
    expect(formatCountdown(9_000)).toBe("00:09");
    expect(formatCountdown(1)).toBe("00:01");
  });

  it("never below 00:00, never above the 15-minute pay window, and 00:00 for nonsense", () => {
    expect(formatCountdown(0)).toBe("00:00");
    expect(formatCountdown(-5_000)).toBe("00:00");
    expect(formatCountdown(15 * MIN)).toBe("15:00");
    expect(formatCountdown(3 * 24 * 60 * MIN)).toBe("15:00");
    expect(formatCountdown(Number.NaN)).toBe("00:00");
  });
});

describe("clock skew", () => {
  const received = Date.parse("2026-11-09T10:00:00.000Z");

  it("the offset is the server's clock less this device's when the answer arrived", () => {
    expect(clockOffsetMs("2026-11-09T10:07:00.000Z", received)).toBe(7 * MIN);
    expect(clockOffsetMs("2026-11-09T09:58:30.000Z", received)).toBe(-90_000);
  });

  it("no offset without a usable serverTime (an older response)", () => {
    expect(clockOffsetMs(undefined, received)).toBe(0);
    expect(clockOffsetMs("not a time", received)).toBe(0);
  });

  it("the deadline on this device's clock leaves the server's time left, whatever this clock says", () => {
    // The phone is 7 minutes behind: the server says 10:07:00, the deadline is 10:21:32 (14:32 left).
    const offset = clockOffsetMs("2026-11-09T10:07:00.000Z", received);
    const deadline = localDeadline("2026-11-09T10:21:32.000Z", offset);
    expect(formatCountdown(deadline - received)).toBe("14:32");
    // And 7 minutes ahead.
    const ahead = clockOffsetMs("2026-11-09T09:53:00.000Z", received);
    expect(formatCountdown(localDeadline("2026-11-09T10:07:32.000Z", ahead) - received)).toBe("14:32");
    expect(localDeadline("garbage", 0)).toBeNaN();
  });
});

describe("the last two minutes", () => {
  it("is urgent from 2:00 left", () => {
    expect(isCountdownUrgent(2 * MIN + 1)).toBe(false);
    expect(isCountdownUrgent(2 * MIN)).toBe(true);
    expect(isCountdownUrgent(0)).toBe(true);
  });
});

describe("countdownAnnouncement", () => {
  it("says 5:00, 1:00 and time's up as they're passed, and nothing else", () => {
    expect(countdownAnnouncement(5 * MIN + 1_000, 5 * MIN)).toBe("5 minutes left to complete your order.");
    expect(countdownAnnouncement(5 * MIN, 5 * MIN - 1_000)).toBeNull();
    expect(countdownAnnouncement(MIN + 1_000, MIN)).toBe("1 minute left to complete your order.");
    expect(countdownAnnouncement(1_000, 0)).toBe(COUNTDOWN_TIME_UP_ANNOUNCEMENT);
    expect(COUNTDOWN_TIME_UP_ANNOUNCEMENT).toBe("Time’s up. You haven’t been charged.");
    expect(countdownAnnouncement(10 * MIN, 10 * MIN - 1_000)).toBeNull();
    expect(countdownAnnouncement(3 * MIN, 2 * MIN)).toBeNull();
  });

  it("after a jump (a device that slept), only the latest moment passed", () => {
    expect(countdownAnnouncement(6 * MIN, 30_000)).toBe("1 minute left to complete your order.");
    expect(countdownAnnouncement(6 * MIN, -10_000)).toBe(COUNTDOWN_TIME_UP_ANNOUNCEMENT);
  });

  it("nothing for time standing still, going back, or already past", () => {
    expect(countdownAnnouncement(5 * MIN, 5 * MIN)).toBeNull();
    expect(countdownAnnouncement(4 * MIN, 6 * MIN)).toBeNull();
    expect(countdownAnnouncement(-1_000, -2_000)).toBeNull();
  });
});

describe("msUntilNextSecond", () => {
  it("is how long until the shown second changes", () => {
    expect(msUntilNextSecond(60_000)).toBe(1_000);
    expect(msUntilNextSecond(59_500)).toBe(500);
    expect(msUntilNextSecond(1)).toBe(1);
    expect(msUntilNextSecond(0)).toBe(0);
    expect(msUntilNextSecond(Number.NaN)).toBe(0);
  });
});
