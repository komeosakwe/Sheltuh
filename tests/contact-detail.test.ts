import { describe, expect, it } from "vitest";
import { containsEmailAddress, containsWebAddress } from "@/lib/contact-detail";
import { validateHolderField } from "@/lib/holder-message-rules";
import { HOLDER_MESSAGE_LIMITS } from "@/lib/server/handlers/holder-messages";

// lib/contact-detail.ts: the one definition of "a link or an address" that the
// holder-message API and the compose form share.

describe("web addresses the old 24-TLD list let through", () => {
  it.each([
    ["x.ru", "Tickets at x.ru tonight for everyone"],
    ["x.top", "Tickets at x.top tonight for everyone"],
    ["x.ai", "Tickets at x.ai tonight for everyone"],
    ["x.cc", "Tickets at x.cc tonight for everyone"],
    ["x.click", "Tickets at x.click tonight for everyone"],
    ["x.uk", "Tickets at x.uk tonight for everyone"],
    ["x.nz", "Tickets at x.nz tonight for everyone"],
    ["is.gd", "Tickets at is.gd/abc tonight for everyone"],
    ["goo.gl", "Tickets at goo.gl/abc tonight for everyone"],
    ["rb.gy", "Tickets at rb.gy/abc tonight for everyone"],
    ["lnkd.in", "Tickets at lnkd.in/abc tonight for everyone"],
    ["a bare IPv4", "Log in at 203.0.113.5/login tonight please"],
    ["a bare IPv4 alone", "203.0.113.5"],
    ["an obfuscated IPv4", "Log in at 203[.]0[.]113[.]5 tonight please"],
    ["a subdomain", "Tickets at tickets.shop.example.co.nz tonight"],
    ["a punycode TLD", "Tickets at x.xn--p1ai tonight for everyone"],
    ["a non-Latin TLD", "Tickets at х.рф tonight for everyone"],
    ["a bracketed dot with an unlisted TLD", "Tickets at x[dot]ru tonight for everyone"],
    ["a parenthesised dot", "Tickets at x (dot) top tonight for everyone"],
    ["a spaced dot before an unlisted TLD", "Tickets at x .ru tonight for everyone"],
    ["a spoken dot", "Tickets at x dot ru tonight for everyone"],
    ["fullwidth forms", "Tickets at ｘ．ｒｕ tonight for everyone"],
    ["an ideographic full stop", "Tickets at x。ru tonight for everyone"],
    ["zero-width characters", "Tickets at x​.r‍u tonight for everyone"],
    ["a scheme", "Tickets at https://x tonight for everyone"],
    ["www", "Tickets at www.x tonight for everyone"],
    ["an obfuscated address", "a [at] b [dot] ru"],
    ["an address in brackets", "Write to a(at)b(dot)ru please"],
  ])("%s", (_name, text) => {
    expect(containsWebAddress(text) || containsEmailAddress(text)).toBe(true);
  });

  it("finds a link in an obfuscated address, and the address too", () => {
    expect(containsWebAddress("a [at] b [dot] ru")).toBe(true);
    expect(containsEmailAddress("a [at] b [dot] ru")).toBe(true);
    expect(containsEmailAddress("a(at)b")).toBe(true);
    expect(containsEmailAddress("a{at}b")).toBe(true);
    expect(containsEmailAddress("a＠b")).toBe(true);
  });
});

describe("ordinary text it must leave alone", () => {
  it.each([
    "Doors 7.30pm",
    "Doors 7.30pm, music from 8.00",
    "St. Kilda",
    "Meet at St. Kilda Pier, Mr. Lee will be there",
    "e.g. bring ID",
    "i.e. photo ID is needed",
    "Level 2.5",
    "Tickets cost A$12.50 each",
    "A$12.50",
    "Starts 8.00",
    "Doors at 7 a.m. or 7 p.m. sharp",
    "A polka dot dress is welcome",
    "Wait... there is more",
    "Follow @sheltuh for updates",
    "Ask (@name) at the bar",
    "Bring ID. Doors open at eight. See you there.",
    "Version 1.2.3 is out",
  ])("%s", (text) => {
    expect(containsWebAddress(text)).toBe(false);
    expect(containsEmailAddress(text)).toBe(false);
  });
});

describe("the compose form uses the same detector", () => {
  const check = (text: string) => validateHolderField("body", text, HOLDER_MESSAGE_LIMITS);

  it("refuses what the API refuses", () => {
    expect(check("Tickets at x.ru tonight, bring friends")).toBe("The message can't include links or web addresses.");
    expect(check("Log in at 203.0.113.5/login tonight please")).toBe("The message can't include links or web addresses.");
    expect(check("Write to somebody at the venue tonight pls: a [at] b")).toBe("The message can't include email addresses.");
  });

  it("accepts a plain message with times and prices", () => {
    expect(check("Doors 7.30pm at St. Kilda, e.g. bring ID. Level 2.5, A$12.50, from 8.00.")).toBeNull();
  });
});
