import { describe, expect, it } from "vitest";
import { HttpError } from "../lambda/shared/http";
import {
  fail,
  optionalUrl,
  requireCategories,
  requireCategory,
  requireEmail,
  requireMelbourneDateTime,
  requireString,
  requireTicketTypes,
  slugify,
} from "../lambda/shared/validation";

describe("requireString", () => {
  it("trims and accepts a non-empty string", () => {
    const errors: Record<string, string> = {};
    expect(requireString("  hello  ", "field", errors)).toBe("hello");
    expect(errors.field).toBeUndefined();
  });

  it("rejects empty/whitespace-only input", () => {
    const errors: Record<string, string> = {};
    requireString("   ", "field", errors);
    expect(errors.field).toBeDefined();
  });

  it("rejects input over the max length", () => {
    const errors: Record<string, string> = {};
    requireString("x".repeat(10), "field", errors, 5);
    expect(errors.field).toMatch(/5 characters/);
  });
});

describe("requireEmail", () => {
  it("accepts a valid email", () => {
    const errors: Record<string, string> = {};
    expect(requireEmail("a@b.com", "email", errors)).toBe("a@b.com");
    expect(errors.email).toBeUndefined();
  });

  it("rejects a malformed email", () => {
    const errors: Record<string, string> = {};
    requireEmail("not-an-email", "email", errors);
    expect(errors.email).toBeDefined();
  });
});

describe("requireCategories / requireCategory", () => {
  it("accepts known categories and rejects unknown ones", () => {
    const errors: Record<string, string> = {};
    expect(requireCategories(["live-music", "art"], "categories", errors)).toEqual(["live-music", "art"]);
    expect(errors.categories).toBeUndefined();

    const errors2: Record<string, string> = {};
    requireCategories(["not-a-category"], "categories", errors2);
    expect(errors2.categories).toBeDefined();
  });

  it("requires at least one category", () => {
    const errors: Record<string, string> = {};
    requireCategories([], "categories", errors);
    expect(errors.categories).toBeDefined();
  });

  it("requireCategory rejects a non-string / unknown value", () => {
    const errors: Record<string, string> = {};
    requireCategory("nope", "category", errors);
    expect(errors.category).toBeDefined();
  });
});

describe("optionalUrl", () => {
  it("allows an empty value", () => {
    const errors: Record<string, string> = {};
    expect(optionalUrl(undefined, "url", errors)).toBeUndefined();
    expect(errors.url).toBeUndefined();
  });

  it("accepts a valid https URL", () => {
    const errors: Record<string, string> = {};
    expect(optionalUrl("https://example.com", "url", errors)).toBe("https://example.com");
  });

  it("rejects a non-http(s) or malformed URL", () => {
    const errors: Record<string, string> = {};
    optionalUrl("not a url", "url", errors);
    expect(errors.url).toBeDefined();

    const errors2: Record<string, string> = {};
    optionalUrl("ftp://example.com", "url", errors2);
    expect(errors2.url).toBeDefined();
  });
});

describe("requireMelbourneDateTime", () => {
  it("converts a valid date/time pair to a UTC ISO instant", () => {
    const errors: Record<string, string> = {};
    expect(requireMelbourneDateTime({ date: "2026-09-25", time: "20:00" }, "start", errors)).toBe(
      "2026-09-25T10:00:00.000Z",
    );
    expect(errors.start).toBeUndefined();
  });

  it("rejects a missing or malformed date/time", () => {
    const errors: Record<string, string> = {};
    requireMelbourneDateTime({ date: "25-09-2026", time: "20:00" }, "start", errors);
    expect(errors.start).toBeDefined();

    const errors2: Record<string, string> = {};
    requireMelbourneDateTime(undefined, "start", errors2);
    expect(errors2.start).toBeDefined();
  });
});

describe("requireTicketTypes", () => {
  it("accepts a valid ticket type list", () => {
    const errors: Record<string, string> = {};
    const result = requireTicketTypes(
      [{ name: "GA", priceCents: 3000, feePolicy: "buyer-pays", quantityAvailable: 100 }],
      "ticketTypes",
      errors,
    );
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("GA");
    expect(result[0].id).toBeTruthy();
    expect(errors.ticketTypes).toBeUndefined();
  });

  it("requires at least one ticket type", () => {
    const errors: Record<string, string> = {};
    requireTicketTypes([], "ticketTypes", errors);
    expect(errors.ticketTypes).toBeDefined();
  });

  it("rejects a ticket type with a negative price or non-integer quantity", () => {
    const errors: Record<string, string> = {};
    requireTicketTypes(
      [{ name: "GA", priceCents: -100, feePolicy: "buyer-pays", quantityAvailable: 1.5 }],
      "ticketTypes",
      errors,
    );
    expect(Object.keys(errors).some((k) => k.includes("priceCents"))).toBe(true);
    expect(Object.keys(errors).some((k) => k.includes("quantityAvailable"))).toBe(true);
  });

  it("rejects an invalid feePolicy", () => {
    const errors: Record<string, string> = {};
    requireTicketTypes(
      [{ name: "GA", priceCents: 100, feePolicy: "someone-else-pays", quantityAvailable: 1 }],
      "ticketTypes",
      errors,
    );
    expect(Object.keys(errors).some((k) => k.includes("feePolicy"))).toBe(true);
  });
});

describe("slugify", () => {
  it("lowercases, strips punctuation and hyphenates", () => {
    expect(slugify("Neon Static: After Dark!")).toBe("neon-static-after-dark");
  });

  it("truncates to 80 characters", () => {
    expect(slugify("x".repeat(200)).length).toBeLessThanOrEqual(80);
  });
});

describe("fail", () => {
  it("throws a 400 HttpError carrying the field errors", () => {
    try {
      fail({ title: "Enter a title." });
      throw new Error("fail() should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(HttpError);
      expect((err as HttpError).statusCode).toBe(400);
      expect((err as HttpError).fieldErrors).toEqual({ title: "Enter a title." });
    }
  });
});
