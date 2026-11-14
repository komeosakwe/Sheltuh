import { describe, expect, it } from "vitest";
import type { Deps } from "@/lib/server/deps";
import {
  capReached,
  DEFAULT_RETRY_AFTER_SECONDS,
  HttpError,
  retryAfterHeader,
  secondsUntilUtcMidnight,
  tooManyRequests,
  windowSeconds,
  type RateWindow,
} from "@/lib/server/http";
import { runHandler, type Handler } from "@/lib/server/route";
import { CHECKOUT_LIMITS } from "@/lib/server/checkout-attempts";
import { CHECK_IN_LIMIT } from "@/lib/server/handlers/check-ins";
import { RESEND_MIN_INTERVAL, RESEND_RATE_LIMIT } from "@/lib/server/handlers/email-outbox";
import { EVENT_ORDERS_LIMITS } from "@/lib/server/handlers/event-orders";
import { INVITE_LIMITS } from "@/lib/server/handlers/invites";
import { MESSAGE_RATE_LIMIT, REQUEST_RATE_LIMIT } from "@/lib/server/handlers/messages";
import { CHECKOUT_RATE_LIMITS, SEAT_HOLD_LIMITS } from "@/lib/server/handlers/orders";
import { PLACES_RATE_LIMITS } from "@/lib/server/handlers/places";
import { EVENT_RELEASE_LIMIT, RELEASE_LIMIT } from "@/lib/server/handlers/ticket-release";
import { WALLET_RATE_LIMITS } from "@/lib/server/handlers/wallet";

/** The handler throws `err`; the route wrapper answers. No handler here touches deps. */
async function answer(err: HttpError): Promise<Response> {
  const handler: Handler = async () => {
    throw err;
  };
  return runHandler(handler, new Request("https://sheltuh.test/api/x"), {}, {} as Deps);
}

describe("windowSeconds", () => {
  it("reads the intervals the rate-limit functions are given", () => {
    expect(windowSeconds("60 seconds")).toBe(60);
    expect(windowSeconds("1 minute")).toBe(60);
    expect(windowSeconds("5 minutes")).toBe(300);
    expect(windowSeconds("10 minutes")).toBe(600);
    expect(windowSeconds("1 hour")).toBe(3_600);
    expect(windowSeconds("24 hours")).toBe(86_400);
    expect(windowSeconds("1 day")).toBe(86_400);
  });

  it("refuses anything else rather than guess", () => {
    for (const odd of ["1.5 hours", "-1 hour", "1 hours ago", "1 week", "hour", ""]) {
      expect(() => windowSeconds(odd as RateWindow), odd).toThrow(/Unsupported rate-limit window/);
    }
  });

  it("each limiter's Retry-After is its real window (fixed windows from the first hit: the longest a reset can be)", () => {
    expect(windowSeconds(CHECKOUT_RATE_LIMITS.paidCheckout.window)).toBe(60);
    expect(windowSeconds(CHECKOUT_RATE_LIMITS.paymentPerClient.window)).toBe(60);
    expect(windowSeconds(CHECKOUT_RATE_LIMITS.paymentPerOrder.window)).toBe(60);
    expect(windowSeconds(WALLET_RATE_LIMITS.perClient.window)).toBe(60);
    expect(windowSeconds(WALLET_RATE_LIMITS.perOrder.window)).toBe(60);
    expect(windowSeconds(INVITE_LIMITS.resendCooldown)).toBe(60);
    expect(windowSeconds(CHECK_IN_LIMIT.window)).toBe(300);
    expect(windowSeconds(RESEND_MIN_INTERVAL)).toBe(300);
    expect(windowSeconds(CHECKOUT_LIMITS.window)).toBe(600);
    expect(windowSeconds(SEAT_HOLD_LIMITS.perClient.window)).toBe(600);
    expect(windowSeconds(SEAT_HOLD_LIMITS.attempts.window)).toBe(600);
    expect(windowSeconds(SEAT_HOLD_LIMITS.hold)).toBe(35 * 60);
    expect(windowSeconds(EVENT_ORDERS_LIMITS.reads.window)).toBe(600);
    expect(windowSeconds(EVENT_ORDERS_LIMITS.exports.window)).toBe(3_600);
    expect(windowSeconds(RESEND_RATE_LIMIT.window)).toBe(3_600);
    expect(windowSeconds(MESSAGE_RATE_LIMIT.window)).toBe(3_600);
    expect(windowSeconds(REQUEST_RATE_LIMIT.window)).toBe(86_400);
    expect(PLACES_RATE_LIMITS.details.map((l) => windowSeconds(l.window))).toEqual([3_600, 86_400]);
    // One answer for two limits: the longer one.
    expect(Math.max(windowSeconds(RELEASE_LIMIT.window), windowSeconds(EVENT_RELEASE_LIMIT.window))).toBe(86_400);
  });
});

describe("secondsUntilUtcMidnight", () => {
  it("counts to the next UTC midnight, whatever the Melbourne date", () => {
    expect(secondsUntilUtcMidnight(new Date("2026-11-13T23:00:00Z"))).toBe(3_600);
    expect(secondsUntilUtcMidnight(new Date("2026-11-13T00:00:00Z"))).toBe(86_400);
    expect(secondsUntilUtcMidnight(new Date("2026-11-13T12:34:56Z"))).toBe(11 * 3_600 + 25 * 60 + 4);
    // Part seconds round up, and it's never 0.
    expect(secondsUntilUtcMidnight(new Date("2026-11-13T23:59:59.500Z"))).toBe(1);
    // Month and year ends.
    expect(secondsUntilUtcMidnight(new Date("2026-12-31T22:00:00Z"))).toBe(7_200);
  });
});

describe("retryAfterHeader", () => {
  it("whole seconds, rounded up, at least 1", () => {
    expect(retryAfterHeader(60)).toEqual({ "retry-after": "60" });
    expect(retryAfterHeader(1.2)).toEqual({ "retry-after": "2" });
    expect(retryAfterHeader(0)).toEqual({ "retry-after": "1" });
    expect(retryAfterHeader(-5)).toEqual({ "retry-after": "1" });
  });
});

describe("runHandler: every 429 says when to try again", () => {
  it("a 429 whose limit gave no Retry-After gets the default; the body and cache-control are unchanged", async () => {
    const res = await answer(new HttpError(429, "Too many requests.", undefined, { code: "rate_limited" }));
    expect(res.status).toBe(429);
    expect(DEFAULT_RETRY_AFTER_SECONDS).toBe(60);
    expect(res.headers.get("retry-after")).toBe("60");
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    expect(await res.json()).toStrictEqual({ code: "rate_limited", error: "Too many requests." });
  });

  it("a limit's own value is sent as given, beside any other headers", async () => {
    const res = await answer(tooManyRequests("Slow down.", 3_600, { field: "Slow down." }, { code: "x" }));
    expect(res.headers.get("retry-after")).toBe("3600");
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    expect(await res.json()).toStrictEqual({ code: "x", error: "Slow down.", fieldErrors: { field: "Slow down." } });

    const own = await answer(new HttpError(429, "Wait.", undefined, undefined, { "Retry-After": "5", "x-extra": "1" }));
    // One Retry-After (the handler's, whatever its case), not the default as well.
    expect(own.headers.get("retry-after")).toBe("5");
    expect(own.headers.get("x-extra")).toBe("1");
  });

  it("a cap no wait lifts goes without Retry-After", async () => {
    const res = await answer(capReached("All used.", undefined, { code: "event_total_cap" }));
    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).toBeNull();
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    expect(await res.json()).toStrictEqual({ code: "event_total_cap", error: "All used." });
  });

  it("other statuses are left as they were", async () => {
    expect((await answer(new HttpError(409, "Conflict."))).headers.get("retry-after")).toBeNull();
    expect((await answer(new HttpError(503, "Busy.", undefined, undefined, { "retry-after": "2" }))).headers.get("retry-after")).toBe("2");
  });
});
