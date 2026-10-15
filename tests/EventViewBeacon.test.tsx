// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import EventViewBeacon, { VIEWED_KEY } from "@/components/analytics/EventViewBeacon";
import { getTrackingRef } from "@/lib/tracking-ref";

const recordEventView = vi.fn();
vi.mock("@/lib/api/analytics", () => ({
  recordEventView: (...args: unknown[]) => recordEventView(...args),
}));

let configured = true;
vi.mock("@/lib/api/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api/client")>()),
  get isApiConfigured() {
    return configured;
  },
}));

function setUrl(path: string, referrer = "") {
  window.history.replaceState(null, "", path);
  Object.defineProperty(document, "referrer", { value: referrer, configurable: true });
}

beforeEach(() => {
  configured = true;
  recordEventView.mockReset();
  sessionStorage.clear();
  setUrl("/events/night-market");
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  Object.defineProperty(document, "prerendering", { value: false, configurable: true });
});

describe("EventViewBeacon", () => {
  it("sends one view with the bucketed source and nothing else", () => {
    setUrl("/events/night-market", "https://l.instagram.com/?u=https%3A%2F%2Fsheltuh.com.au%2Fsecret");
    render(<EventViewBeacon eventId="evt-1" />);
    expect(recordEventView).toHaveBeenCalledTimes(1);
    expect(recordEventView).toHaveBeenCalledWith("evt-1", { source: "instagram" });
  });

  it("sends a direct view with no referrer", () => {
    render(<EventViewBeacon eventId="evt-1" />);
    expect(recordEventView).toHaveBeenCalledWith("evt-1", { source: "direct" });
  });

  it("counts once per event per session, however often the page is opened", () => {
    const first = render(<EventViewBeacon eventId="evt-1" />);
    first.unmount();
    render(<EventViewBeacon eventId="evt-1" />);
    render(<EventViewBeacon eventId="evt-2" />);
    expect(recordEventView.mock.calls.map((c) => c[0])).toEqual(["evt-1", "evt-2"]);
    expect(JSON.parse(sessionStorage.getItem(VIEWED_KEY) ?? "[]")).toEqual(["evt-1", "evt-2"]);
  });

  it("passes a well-formed ?ref= code and keeps it for checkout", () => {
    setUrl("/events/night-market?ref=AB3DEF7H", "https://www.google.com/");
    render(<EventViewBeacon eventId="evt-1" />);
    expect(recordEventView).toHaveBeenCalledWith("evt-1", { source: "search", code: "ab3def7h" });
    expect(getTrackingRef("evt-1")).toBe("ab3def7h");
  });

  it("ignores a malformed ?ref= code", () => {
    setUrl("/events/night-market?ref=../../etc");
    render(<EventViewBeacon eventId="evt-1" />);
    expect(recordEventView).toHaveBeenCalledWith("evt-1", { source: "direct" });
    expect(getTrackingRef("evt-1")).toBeUndefined();
  });

  it("still keeps a ref code when the view was already counted this session", () => {
    render(<EventViewBeacon eventId="evt-1" />);
    cleanup();
    setUrl("/events/night-market?ref=ab3def7h");
    render(<EventViewBeacon eventId="evt-1" />);
    expect(recordEventView).toHaveBeenCalledTimes(1);
    expect(getTrackingRef("evt-1")).toBe("ab3def7h");
  });

  it("demo mode sends nothing", () => {
    configured = false;
    render(<EventViewBeacon eventId="evt-1" />);
    expect(recordEventView).not.toHaveBeenCalled();
  });

  it("waits while the browser prerenders the page, then counts when it's shown", () => {
    Object.defineProperty(document, "prerendering", { value: true, configurable: true });
    render(<EventViewBeacon eventId="evt-1" />);
    expect(recordEventView).not.toHaveBeenCalled();
    document.dispatchEvent(new Event("prerenderingchange"));
    expect(recordEventView).toHaveBeenCalledTimes(1);
  });

  it("never uses sendBeacon (the API only counts same-origin application/json fetches)", () => {
    const sendBeacon = vi.fn();
    Object.defineProperty(navigator, "sendBeacon", { value: sendBeacon, configurable: true });
    render(<EventViewBeacon eventId="evt-1" />);
    expect(sendBeacon).not.toHaveBeenCalled();
  });

  it("falls back to once per page load when sessionStorage is blocked, and never throws", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("SecurityError");
    });
    expect(() => render(<EventViewBeacon eventId="evt-blocked" />)).not.toThrow();
    render(<EventViewBeacon eventId="evt-blocked" />);
    expect(recordEventView).toHaveBeenCalledTimes(1);
  });
});
