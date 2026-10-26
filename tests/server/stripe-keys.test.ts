import { afterEach, describe, expect, it, vi } from "vitest";
import { checkPublishableKey, matchingPublishableKey } from "@/lib/server/stripe-keys";

// The publishable key must be the secret key's mode (test or live), or card
// checkouts are refused (lib/server/deps.ts stripePublishableKey).

afterEach(() => {
  vi.restoreAllMocks();
});

const PK_TEST = "pk_test_" + "51ExampleOnlyNotARealKey";
const PK_LIVE = "pk_live_" + "51ExampleOnlyNotARealKey";
const SK_TEST = "sk_test_" + "51ExampleOnlyNotARealKey";
const SK_LIVE = "sk_live_" + "51ExampleOnlyNotARealKey";
const RK_LIVE = "rk_live_" + "51ExampleOnlyNotARealKey";

describe("checkPublishableKey", () => {
  it("accepts a key of the secret key's mode (restricted secret keys too)", () => {
    expect(checkPublishableKey(PK_TEST, SK_TEST)).toEqual({ ok: true, key: PK_TEST });
    expect(checkPublishableKey(PK_LIVE, SK_LIVE)).toEqual({ ok: true, key: PK_LIVE });
    expect(checkPublishableKey(PK_LIVE, RK_LIVE)).toEqual({ ok: true, key: PK_LIVE });
  });

  it("refuses a missing, malformed or mismatched key, saying why without either key", () => {
    const cases: [string | undefined, string | undefined, RegExp][] = [
      [undefined, SK_TEST, /NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY isn't set/],
      ["", SK_TEST, /isn't set/],
      [SK_TEST, SK_TEST, /isn't a publishable key/],
      ["pk_nope_123", SK_TEST, /isn't a publishable key/],
      [PK_TEST, undefined, /STRIPE_SECRET_KEY isn't set/],
      [PK_TEST, "whsec_123", /STRIPE_SECRET_KEY/],
      [PK_TEST, SK_LIVE, /is a test key but STRIPE_SECRET_KEY is a live key/],
      [PK_LIVE, SK_TEST, /is a live key but STRIPE_SECRET_KEY is a test key/],
    ];
    for (const [publishable, secret, reason] of cases) {
      const check = checkPublishableKey(publishable, secret);
      expect(check.ok).toBe(false);
      if (check.ok) continue;
      expect(check.reason).toMatch(reason);
      expect(check.reason).not.toContain("51Example");
    }
  });
});

describe("matchingPublishableKey", () => {
  it("logs the reason once, never a key", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(matchingPublishableKey(PK_LIVE, SK_TEST)).toBeUndefined();
    expect(error).toHaveBeenCalledTimes(1);
    const logged = JSON.stringify(error.mock.calls);
    expect(logged).toMatch(/Card payments are off/);
    expect(logged).not.toContain("51Example");
    expect(matchingPublishableKey(PK_TEST, SK_TEST)).toBe(PK_TEST);
    expect(error).toHaveBeenCalledTimes(1);
  });
});
