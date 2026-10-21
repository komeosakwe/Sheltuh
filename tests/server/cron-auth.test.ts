import { afterEach, describe, expect, it, vi } from "vitest";

// Wraps the real timingSafeEqual so the test can see the comparison is made in
// constant time, on fixed-length digests, while behaving exactly as in production.
const timingSafeEqual = vi.hoisted(() => vi.fn());
vi.mock("node:crypto", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:crypto")>();
  timingSafeEqual.mockImplementation(actual.timingSafeEqual);
  return { ...actual, timingSafeEqual };
});

const { requireCronSecret } = await import("@/lib/server/cron-auth");
const { HttpError } = await import("@/lib/server/http");

const SECRET = "cron-unit-secret";

function request(authorization?: string): Request {
  const headers = new Headers();
  if (authorization !== undefined) headers.set("authorization", authorization);
  return new Request("https://sheltuh.test/api/cron/email-outbox", { headers });
}

/** The status requireCronSecret refuses with, or "ok" if it lets the request in. */
function outcome(authorization: string | undefined, ...secretArg: [secret?: string | undefined]): number | "ok" {
  // A rest argument rather than a default, so passing undefined explicitly means "CRON_SECRET unset".
  const secret = secretArg.length > 0 ? secretArg[0] : SECRET;
  try {
    requireCronSecret(request(authorization), secret);
    return "ok";
  } catch (err) {
    if (err instanceof HttpError) return err.statusCode;
    throw err;
  }
}

afterEach(() => {
  vi.restoreAllMocks();
  timingSafeEqual.mockClear();
});

describe("requireCronSecret", () => {
  it("lets in exactly `Bearer <CRON_SECRET>`", () => {
    expect(outcome(`Bearer ${SECRET}`)).toBe("ok");
  });

  it("refuses a missing header, another scheme, a bare secret and a wrong secret with 401", () => {
    for (const auth of [undefined, "", "Bearer", "Bearer ", SECRET, `Basic ${SECRET}`, `bearer ${SECRET}`, "Bearer wrong"]) {
      expect(outcome(auth)).toBe(401);
    }
  });

  it("refuses a wrong secret of any length with 401, never a length error (digests are compared)", () => {
    for (const wrong of ["x", `${SECRET}x`, SECRET.slice(0, -1), "y".repeat(10_000)]) {
      expect(outcome(`Bearer ${wrong}`)).toBe(401);
    }
  });

  it("compares in constant time, as two 32-byte SHA-256 digests", () => {
    expect(outcome(`Bearer ${SECRET}`)).toBe("ok");
    expect(outcome("Bearer a-much-longer-wrong-secret-than-the-real-one")).toBe(401);
    expect(timingSafeEqual).toHaveBeenCalledTimes(2);
    for (const [a, b] of timingSafeEqual.mock.calls as [Buffer, Buffer][]) {
      expect(a).toHaveLength(32);
      expect(b).toHaveLength(32);
    }
  });

  it("refuses everything, the matching guess included, when CRON_SECRET isn't set", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    for (const secret of [undefined, ""]) {
      expect(outcome("Bearer undefined", secret)).toBe(401);
      expect(outcome("Bearer ", secret)).toBe(401);
      expect(outcome(undefined, secret)).toBe(401);
    }
    expect(error).toHaveBeenCalled();
    // The log line names the missing setting, never a header value.
    expect(error.mock.calls.flat().join(" ")).not.toMatch(/Bearer/);
    expect(timingSafeEqual).not.toHaveBeenCalled();
  });
});
