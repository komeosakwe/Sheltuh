// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  forgetOfferToken,
  keepOfferToken,
  keptOfferToken,
  rememberReturnOrder,
  sendParam,
  takeReturnOrder,
} from "@/lib/ticket-transfer-return";

const ORD = "ord_0123456789abcdef0123456789abcdef";
const TOKEN = "T".repeat(40) + "k_-";

afterEach(() => {
  sessionStorage.clear();
  localStorage.clear();
  vi.restoreAllMocks();
});

describe("lib/ticket-transfer-return", () => {
  it("keeps the ticket page's order id in this tab only, and gives it back once", () => {
    rememberReturnOrder(ORD);
    expect(localStorage.length).toBe(0);
    expect(takeReturnOrder()).toBe(ORD);
    expect(takeReturnOrder()).toBeNull();
  });

  it("never keeps or returns something that isn't an order id", () => {
    rememberReturnOrder("https://evil.example");
    expect(takeReturnOrder()).toBeNull();
    sessionStorage.setItem("sheltuh:return-order", "../admin");
    expect(takeReturnOrder()).toBeNull();
  });

  it("keeps a well-formed accept token until it's forgotten", () => {
    keepOfferToken("short");
    expect(keptOfferToken()).toBeNull();
    keepOfferToken(TOKEN);
    expect(keptOfferToken()).toBe(TOKEN);
    expect(localStorage.length).toBe(0);
    forgetOfferToken();
    expect(keptOfferToken()).toBeNull();
  });

  it("storage that throws is ignored", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("full", "QuotaExceededError");
    });
    expect(() => keepOfferToken(TOKEN)).not.toThrow();
    expect(keptOfferToken()).toBeNull();
  });

  it("?send= is a ticket number from 1 to 9999, else nothing", () => {
    expect(sendParam("2")).toBe(2);
    expect(sendParam("9999")).toBe(9999);
    for (const raw of [null, "", "0", "01", "10000", "1.5", "-1", "x"]) expect(sendParam(raw), String(raw)).toBeNull();
  });
});
