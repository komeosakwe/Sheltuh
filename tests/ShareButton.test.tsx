// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import AddToCalendar from "@/components/AddToCalendar";
import ShareButton from "@/components/ShareButton";
import { sampleEvents } from "@/lib/sample-events";

type Nav = { share?: unknown; canShare?: unknown; clipboard?: unknown };
const nav = navigator as unknown as Nav;

function setNavigator(values: Nav) {
  for (const key of ["share", "canShare", "clipboard"] as const) {
    Object.defineProperty(navigator, key, { value: values[key], configurable: true, writable: true });
  }
}

const ORIGIN = window.location.origin;
const SHARED = `${ORIGIN}/events/neon-static`;

beforeEach(() => {
  // Arrived through a tracking link: the address bar has ?ref= and a hash.
  window.history.replaceState(null, "", "/events/neon-static?ref=abcd2345&utm_source=ig#tickets");
});
afterEach(() => {
  cleanup();
  setNavigator({});
  vi.useRealTimers();
  window.history.replaceState(null, "", "/");
});

function renderShare() {
  render(<ShareButton slug="neon-static" title="Neon Static" text="Neon Static · Fri 25 Sep, 8:00 pm · Warehouse 9" />);
  return screen.getByRole("button", { name: "Share Neon Static" });
}

describe("ShareButton", () => {
  it("uses the share sheet with the bare event URL (no ?ref= or other tracking)", async () => {
    const share = vi.fn().mockResolvedValue(undefined);
    const writeText = vi.fn();
    setNavigator({ share, canShare: () => true, clipboard: { writeText } });
    const button = renderShare();
    expect(button).toHaveTextContent("Share");
    await act(async () => fireEvent.click(button));
    expect(share).toHaveBeenCalledWith({
      title: "Neon Static",
      text: "Neon Static · Fri 25 Sep, 8:00 pm · Warehouse 9",
      url: SHARED,
    });
    expect(writeText).not.toHaveBeenCalled();
    expect(screen.getByRole("status")).toHaveTextContent("");
  });

  it("says nothing when the person cancels the share sheet", async () => {
    const share = vi.fn().mockRejectedValue(new DOMException("cancelled", "AbortError"));
    const writeText = vi.fn();
    setNavigator({ share, clipboard: { writeText } });
    const button = renderShare();
    await act(async () => fireEvent.click(button));
    expect(writeText).not.toHaveBeenCalled();
    expect(screen.getByRole("status")).toHaveTextContent("");
    expect(screen.queryByRole("textbox")).toBeNull();
  });

  it("copies the link without a share sheet, and politely says so for 4 seconds", async () => {
    vi.useFakeTimers();
    const writeText = vi.fn().mockResolvedValue(undefined);
    setNavigator({ clipboard: { writeText } });
    const button = renderShare();
    await act(async () => fireEvent.click(button));
    expect(writeText).toHaveBeenCalledWith(SHARED);
    const status = screen.getByRole("status");
    expect(status).toHaveTextContent("Link copied");
    act(() => vi.advanceTimersByTime(4000));
    expect(status).toHaveTextContent("");
  });

  it("falls back to copying when the share sheet can't take a URL", async () => {
    const share = vi.fn();
    const writeText = vi.fn().mockResolvedValue(undefined);
    setNavigator({ share, canShare: () => false, clipboard: { writeText } });
    const button = renderShare();
    await act(async () => fireEvent.click(button));
    expect(share).not.toHaveBeenCalled();
    expect(writeText).toHaveBeenCalledWith(SHARED);
  });

  it("shows the link selected to copy by hand when the clipboard refuses; Escape closes it and returns focus", async () => {
    const writeText = vi.fn().mockRejectedValue(new Error("denied"));
    setNavigator({ clipboard: { writeText } });
    const button = renderShare();
    await act(async () => fireEvent.click(button));
    const field = screen.getByRole("textbox", { name: "Link to this event" });
    expect(field).toHaveValue(SHARED);
    expect(field).toHaveAttribute("readonly");
    expect(field).toHaveFocus();
    expect(button).toHaveAttribute("aria-expanded", "true");
    // Copy still can't: the reason is announced and the link stays selected.
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Copy" })));
    expect(screen.getByText(/Couldn’t copy it automatically/)).toBeInTheDocument();
    fireEvent.keyDown(field, { key: "Escape" });
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(button).toHaveFocus();
  });

  it("with no clipboard at all, opens the manual copy popover", async () => {
    setNavigator({});
    const button = renderShare();
    await act(async () => fireEvent.click(button));
    expect(screen.getByRole("textbox", { name: "Link to this event" })).toHaveValue(SHARED);
  });
});

describe("AddToCalendar", () => {
  const event = sampleEvents.find((e) => e.slug === "thornbury-dub-session");
  if (!event) throw new Error("fixture missing");

  it("is a disclosure with an .ics download and a Google Calendar link; Escape closes it", () => {
    render(<AddToCalendar event={event} />);
    const trigger = screen.getByRole("button", { name: "Add to calendar" });
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("link")).toBeNull();
    fireEvent.click(trigger);
    expect(trigger).toHaveAttribute("aria-expanded", "true");

    const ics = screen.getByRole("link", { name: "Apple / Outlook (.ics)" });
    expect(ics).toHaveAttribute("download", "thornbury-dub-session.ics");
    const href = ics.getAttribute("href") ?? "";
    expect(href.startsWith("data:text/calendar;charset=utf-8,")).toBe(true);
    const file = decodeURIComponent(href.slice(href.indexOf(",") + 1));
    expect(file).toContain("UID:evt-thornbury-dub-session@sheltuh.com.au\r\n");
    expect(file).toContain("DTSTART:20261107T083000Z\r\n");
    expect(file).toContain(`URL:${ORIGIN}/events/thornbury-dub-session\r\n`);
    expect(file).not.toContain("ref=");

    const google = screen.getByRole("link", { name: "Google Calendar (opens in a new tab)" });
    expect(google).toHaveAttribute("target", "_blank");
    expect(google).toHaveAttribute("rel", "noopener noreferrer");
    expect(google.getAttribute("href")).toMatch(/^https:\/\/calendar\.google\.com\/calendar\/render\?action=TEMPLATE&/);

    fireEvent.keyDown(google, { key: "Escape" });
    expect(screen.queryByRole("link")).toBeNull();
    expect(trigger).toHaveFocus();
    expect(nav.share).toBeUndefined();
  });
});
