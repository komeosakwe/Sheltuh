import nodemailer from "nodemailer";
import Stripe from "stripe";
import { describe, expect, it, vi } from "vitest";
import { isPlainEmailAddress, MAX_EMAIL_LENGTH, redactForLog } from "@/lib/server/email-address";
import { mailOptions } from "@/lib/server/email";
import { errorMessageForLog, runHandler } from "@/lib/server/route";
import type { Deps } from "@/lib/server/deps";
import { requireEmail } from "@/lib/server/validation";

const HOSTILE = [
  "victim+,attacker.x@gmail.com",
  "n1<me@gmail.com>",
  "(n1)me@gmail.com",
  '"quoted"@example.com',
  '"a,b"@example.com',
  "a@example.com, b@example.com",
  "a@example.com; b@example.com",
  "group:a@example.com;",
  "x@[127.0.0.1]",
  "back\\slash@example.com",
  "sp ace@example.com",
];

describe("isPlainEmailAddress / requireEmail", () => {
  it.each([
    "a@b.co",
    "Mia.Smith+tickets@Example.com.au",
    "x_y%z-1@sub-1.example.io",
    "fan@xn--80ak6aa92e.com",
    "+promo@gmail.com",
  ])("accepts %s", (email) => {
    expect(isPlainEmailAddress(email)).toBe(true);
    const errors: Record<string, string> = {};
    expect(requireEmail(email, "email", errors)).toBe(email);
    expect(errors).toEqual({});
  });

  it.each([...HOSTILE, "a@b", "a@-b.com", "a@b-.com", "a@1.2", "@example.com", "a@@example.com", "a@.example.com"])(
    "rejects %s",
    (email) => {
      expect(isPlainEmailAddress(email)).toBe(false);
      const errors: Record<string, string> = {};
      requireEmail(email, "email", errors);
      expect(errors.email).toBe("Enter a valid email address.");
    },
  );

  it("at most 64 characters before the @ and 254 in all", () => {
    const domain = `${"d".repeat(63)}.${"e".repeat(63)}.${"f".repeat(63)}.com`; // 195 characters
    expect(isPlainEmailAddress(`${"l".repeat(64)}@example.com`)).toBe(true);
    expect(isPlainEmailAddress(`${"l".repeat(65)}@example.com`)).toBe(false);
    const longest = `${"l".repeat(MAX_EMAIL_LENGTH - domain.length - 1)}@${domain}`;
    expect(longest).toHaveLength(254);
    expect(isPlainEmailAddress(longest)).toBe(true);
    expect(isPlainEmailAddress(`l${longest}`)).toBe(false);
    const errors: Record<string, string> = {};
    requireEmail(`l${longest}`, "email", errors);
    expect(errors.email).toMatch(/254 characters/);
  });
});

describe("mailOptions", () => {
  const transport = nodemailer.createTransport({ jsonTransport: true });
  const message = { subject: "Your tickets", text: "hi", html: "<p>hi</p>" };

  it("sends to exactly the one address given", async () => {
    const info = await transport.sendMail(mailOptions("Sheltüh <tickets@sheltuh.com.au>", { ...message, to: "mia@example.com" }));
    expect(info.envelope).toEqual({ from: "tickets@sheltuh.com.au", to: ["mia@example.com"] });
  });

  it.each(HOSTILE)("a stored %s can never become another (or more than one) recipient", async (to) => {
    const info = await transport.sendMail(mailOptions("tickets@sheltuh.com.au", { ...message, to }));
    expect(info.envelope.to).toHaveLength(1);
    for (const other of ["attacker.x@gmail.com", "me@gmail.com", "a@example.com", "b@example.com"]) {
      expect(info.envelope.to).not.toContain(other);
    }
    expect(JSON.parse(String(info.message)).to).toHaveLength(1);
  });
});

describe("redactForLog", () => {
  it("redacts addresses, drops control characters and cuts to length", () => {
    expect(redactForLog("550 <fan@example.com>: no such user\r\n")).toBe("550 <[address]>: no such user");
    expect(redactForLog("x".repeat(500))).toHaveLength(200);
    expect(redactForLog("abc", 2)).toBe("ab");
  });

  it("bounds the work on huge input (the regex is quadratic on a long run without spaces)", () => {
    // Unbounded, this one string takes over a second.
    const huge = `${"a".repeat(30_000)} fan@example.com`;
    const started = performance.now();
    expect(redactForLog(huge)).toBe("a".repeat(200));
    expect(performance.now() - started).toBeLessThan(100);
  });

  it("still redacts an address the scan limit cuts off right after its @", () => {
    // The scan limit is 2,000 characters here: "secret@" ends exactly there.
    const text = `${"y".repeat(1992)} secret@example.com`;
    expect(text.indexOf("@")).toBe(1999);
    const out = redactForLog(text, 2000);
    expect(out).not.toContain("secret");
    expect(out.endsWith(" [address]".slice(0, out.length - 1992))).toBe(true);
  });
});

describe("order ids in logs", () => {
  const ORDER = `ord_${"0123456789abcdef".repeat(2)}`;

  it("redactForLog redacts order ids, whole or cut short", () => {
    expect(redactForLog(`Try a key other than 'checkout-session-${ORDER}'.`)).toBe(
      "Try a key other than 'checkout-session-ord_[redacted]'.",
    );
    expect(redactForLog(`ORD_${"AB".repeat(16)} and ${ORDER.slice(0, 12)}`)).toBe("ord_[redacted] and ord_[redacted]");
    // Cut by the scan limit (2,000 here) in the middle of the id: no partial id is left.
    const text = `${"z".repeat(1990)} ${ORDER}`;
    expect(redactForLog(text, 2000)).not.toMatch(/ord_[0-9a-f]/);
  });

  it("an unexpected error that quotes an order id (e.g. Stripe's idempotency error) is logged without it", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const stripeError = new Stripe.errors.StripeIdempotencyError({
      message: `Keys for idempotent requests can only be used with the same parameters they were first used with. Try using a key other than 'checkout-session-${ORDER}' if you meant to execute a different request.`,
      type: "idempotency_error",
    });
    const res = await runHandler(
      async () => {
        throw stripeError;
      },
      new Request("https://sheltuh.test/api/x"),
      {},
      {} as Deps,
    );
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "Something went wrong." });
    const logged = error.mock.calls.flat().map(String).join("\n");
    expect(logged).toContain("Unhandled API error:");
    expect(logged).toContain("checkout-session-ord_[redacted]");
    expect(logged).not.toContain(ORDER);
    expect(errorMessageForLog("not an error")).toBe("unknown error");
    error.mockRestore();
  });
});
