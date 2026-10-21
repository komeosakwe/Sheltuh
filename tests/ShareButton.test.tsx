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

/** jsdom has no matchMedia: a viewport that is (or isn't) a phone, below sm. */
function setPhone(phone: boolean) {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    writable: true,
    value: (query: string) => ({
      matches: phone && query.includes("max-width"),
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    }),
  });
}

beforeEach(() => {
  // Arrived through a tracking link: the address bar has ?ref= and a hash.
  window.history.replaceState(null, "", "/events/neon-static?ref=abcd2345&utm_source=ig#tickets");
  setPhone(false);
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

  it("on a phone, spans the viewport inside its gutters just under the button; from sm, hangs from its right edge", async () => {
    setPhone(true);
    setNavigator({});
    const button = renderShare();
    button.getBoundingClientRect = () => ({ bottom: 300 }) as DOMRect;
    await act(async () => fireEvent.click(button));
    const popover = screen.getByRole("group", { name: "Copy the link" });
    expect(popover).toHaveClass("fixed", "inset-x-5", "sm:absolute", "sm:right-0", "sm:top-full", "sm:w-72");
    expect(popover.style.top).toBe("308px");
    // It follows the button as the page scrolls.
    button.getBoundingClientRect = () => ({ bottom: 120 }) as DOMRect;
    act(() => {
      window.dispatchEvent(new Event("scroll"));
    });
    expect(popover.style.top).toBe("128px");
    // Wider than a phone: the classes place it.
    setPhone(false);
    act(() => {
      window.dispatchEvent(new Event("resize"));
    });
    expect(popover.style.top).toBe("");
  });

  it("on a phone, scrolls the page to bring a popover that opens past the bottom of the screen into view", async () => {
    setPhone(true);
    setNavigator({});
    const scrollBy = vi.spyOn(window, "scrollBy").mockImplementation(() => {});
    // The popover (a div) would end 142px below the screen.
    const rect = vi
      .spyOn(HTMLDivElement.prototype, "getBoundingClientRect")
      .mockReturnValue({ bottom: window.innerHeight + 142 } as DOMRect);
    const button = renderShare();
    button.getBoundingClientRect = () => ({ bottom: window.innerHeight - 20 }) as DOMRect;
    await act(async () => fireEvent.click(button));
    expect(scrollBy).toHaveBeenCalledWith(0, 150);
    rect.mockRestore();
    scrollBy.mockRestore();
  });

  it("closes when focus leaves it, leaving focus where it went", async () => {
    setNavigator({});
    render(
      <>
        <ShareButton slug="neon-static" title="Neon Static" />
        <button type="button">Next thing</button>
      </>,
    );
    const button = screen.getByRole("button", { name: "Share Neon Static" });
    await act(async () => fireEvent.click(button));
    const field = screen.getByRole("textbox", { name: "Link to this event" });
    // Moving within the popover keeps it open.
    const copy = screen.getByRole("button", { name: "Copy" });
    fireEvent.blur(field, { relatedTarget: copy });
    expect(screen.getByRole("group", { name: "Copy the link" })).toBeInTheDocument();
    const next = screen.getByRole("button", { name: "Next thing" });
    fireEvent.blur(copy, { relatedTarget: next });
    expect(screen.queryByRole("group", { name: "Copy the link" })).toBeNull();
    expect(button).not.toHaveAttribute("aria-expanded");
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

  const created: Blob[] = [];
  const revoked: string[] = [];
  beforeEach(() => {
    created.length = 0;
    revoked.length = 0;
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      writable: true,
      value: (blob: Blob) => {
        created.push(blob);
        return `blob:${ORIGIN}/file-${created.length}`;
      },
    });
    Object.defineProperty(URL, "revokeObjectURL", {
      configurable: true,
      writable: true,
      value: (url: string) => revoked.push(url),
    });
  });

  it("is a disclosure with an .ics download and a Google Calendar link; Escape closes it", async () => {
    render(<AddToCalendar event={event} />);
    const trigger = screen.getByRole("button", { name: "Add to calendar" });
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("link")).toBeNull();
    fireEvent.click(trigger);
    expect(trigger).toHaveAttribute("aria-expanded", "true");

    const ics = screen.getByRole("link", { name: "Apple / Outlook (.ics)" });
    expect(ics).toHaveAttribute("download", "thornbury-dub-session.ics");
    // A Blob object URL, not a data: URI (in-app browsers handle it better).
    expect(ics).toHaveAttribute("href", `blob:${ORIGIN}/file-1`);
    expect(created).toHaveLength(1);
    expect(created[0].type).toBe("text/calendar;charset=utf-8");
    const file = await created[0].text();
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
    // The file is released once the menu closes.
    expect(revoked).toEqual([`blob:${ORIGIN}/file-1`]);
  });

  it("releases the file when the page goes with the menu open", () => {
    const { unmount } = render(<AddToCalendar event={event} />);
    fireEvent.click(screen.getByRole("button", { name: "Add to calendar" }));
    unmount();
    expect(revoked).toEqual([`blob:${ORIGIN}/file-1`]);
  });

  it("says so, instead of doing nothing, when the event's date can't be read", () => {
    render(<AddToCalendar event={{ ...event, startsAt: "soon" }} />);
    const trigger = screen.getByRole("button", { name: "Add to calendar" });
    expect(screen.getByRole("status")).toHaveTextContent("");
    fireEvent.click(trigger);
    expect(screen.getByRole("status")).toHaveTextContent("This event’s date can’t be added to a calendar.");
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("link")).toBeNull();
    expect(created).toHaveLength(0);
  });
});
