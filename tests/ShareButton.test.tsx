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

/**
 * A press as Safari and every iOS browser (WebKit) does it: the pressed button or link isn't
 * focused; focus goes to the nearest focusable element around it, the layout's
 * <main tabIndex={-1}> (app/layout.tsx); then the click lands. (Chromium focuses what was pressed.)
 */
function pressLikeWebKit(target: HTMLElement) {
  const main = document.getElementById("main");
  if (!main) throw new Error("no <main>");
  fireEvent.pointerDown(target);
  fireEvent.mouseDown(target);
  const from = document.activeElement instanceof HTMLElement ? document.activeElement : document.body;
  fireEvent.blur(from, { relatedTarget: main });
  act(() => main.focus());
  fireEvent.pointerUp(target);
  fireEvent.mouseUp(target);
  fireEvent.click(target);
}

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

  it("a WebKit press on Copy (focus goes to <main> around it) keeps the popover open, so the click lands", async () => {
    const writeText = vi.fn().mockRejectedValue(new Error("denied"));
    setNavigator({ clipboard: { writeText } });
    render(
      <main id="main" tabIndex={-1}>
        <ShareButton slug="neon-static" title="Neon Static" />
      </main>,
    );
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Share Neon Static" })));
    expect(writeText).toHaveBeenCalledTimes(1);
    await act(async () => pressLikeWebKit(screen.getByRole("button", { name: "Copy" })));
    // Copy ran (a second try), and still can't: it says so in the open popover.
    expect(writeText).toHaveBeenCalledTimes(2);
    expect(screen.getByRole("group", { name: "Copy the link" })).toBeInTheDocument();
    expect(screen.getByText(/Couldn’t copy it automatically/)).toBeInTheDocument();
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
  const ICS_PATH = "/events/thornbury-dub-session/calendar.ics";

  function setUserAgent(value: string) {
    Object.defineProperty(navigator, "userAgent", { value, configurable: true });
  }
  const IPHONE =
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";
  const ANDROID =
    "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36";
  const jsdomUserAgent = navigator.userAgent;
  afterEach(() => setUserAgent(jsdomUserAgent));

  const menuLabels = () => screen.getAllByRole("link").map((link) => link.textContent);

  it("is a disclosure of plain links: Apple is the .ics URL (no download, no blob); Escape closes it", () => {
    setUserAgent(IPHONE);
    const createObjectURL = vi.fn();
    Object.defineProperty(URL, "createObjectURL", { configurable: true, writable: true, value: createObjectURL });
    render(<AddToCalendar event={event} />);
    const trigger = screen.getByRole("button", { name: "Add to calendar" });
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("link")).toBeNull();
    fireEvent.click(trigger);
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    expect(trigger).toHaveAttribute("aria-controls", screen.getByRole("list").id);

    expect(menuLabels()).toEqual(["Apple Calendar", "Google Calendar", "Outlook", "Download .ics (other apps)"]);
    const apple = screen.getByRole("link", { name: "Apple Calendar" });
    // A real URL on this site, opened (not saved): no download attribute, no target.
    expect(apple).toHaveAttribute("href", ICS_PATH);
    expect(apple).not.toHaveAttribute("download");
    expect(apple).not.toHaveAttribute("target");
    expect(createObjectURL).not.toHaveBeenCalled();

    const google = screen.getByRole("link", { name: "Google Calendar (opens in a new tab)" });
    expect(google).toHaveAttribute("target", "_blank");
    expect(google).toHaveAttribute("rel", "noopener noreferrer");
    expect(google.getAttribute("href")).toMatch(/^https:\/\/calendar\.google\.com\/calendar\/render\?action=TEMPLATE&/);

    const outlook = screen.getByRole("link", { name: "Outlook (opens in a new tab)" });
    expect(outlook).toHaveAttribute("target", "_blank");
    expect(outlook).toHaveAttribute("rel", "noopener noreferrer");
    const outlookUrl = new URL(outlook.getAttribute("href") ?? "");
    expect(outlookUrl.origin + outlookUrl.pathname).toBe("https://outlook.live.com/calendar/0/action/compose");
    expect(outlookUrl.searchParams.get("startdt")).toBe("2026-11-07T08:30:00Z");
    // The event's bare URL, from the page's origin: never the address bar's ?ref= or hash.
    expect(outlookUrl.searchParams.get("body")).toContain(`${ORIGIN}/events/thornbury-dub-session`);
    expect(outlook.getAttribute("href")).not.toContain("ref%3D");

    const download = screen.getByRole("link", { name: "Download .ics (other apps)" });
    expect(download).toHaveAttribute("href", ICS_PATH);
    expect(download).toHaveAttribute("download", "thornbury-dub-session.ics");

    fireEvent.keyDown(google, { key: "Escape" });
    expect(screen.queryByRole("link")).toBeNull();
    expect(trigger).toHaveFocus();
    expect(nav.share).toBeUndefined();
  });

  it("puts Google first on Android", () => {
    setUserAgent(ANDROID);
    render(<AddToCalendar event={event} />);
    fireEvent.click(screen.getByRole("button", { name: "Add to calendar" }));
    expect(menuLabels()).toEqual(["Google Calendar", "Apple Calendar", "Outlook", "Download .ics (other apps)"]);
  });

  it("puts Apple first on desktop", () => {
    render(<AddToCalendar event={event} />);
    fireEvent.click(screen.getByRole("button", { name: "Add to calendar" }));
    expect(menuLabels()[0]).toBe("Apple Calendar");
  });

  it("closes when the trigger is pressed again or on a click outside", () => {
    render(
      <>
        <AddToCalendar event={event} />
        <p>Elsewhere</p>
      </>,
    );
    const trigger = screen.getByRole("button", { name: "Add to calendar" });
    fireEvent.click(trigger);
    fireEvent.click(trigger);
    expect(screen.queryByRole("link")).toBeNull();
    fireEvent.click(trigger);
    fireEvent.pointerDown(screen.getByText("Elsewhere"));
    expect(screen.queryByRole("link")).toBeNull();
    expect(trigger).toHaveAttribute("aria-expanded", "false");
  });

  it("a WebKit press on a calendar link (focus goes to <main> around it) keeps the menu open, so the link's click lands", () => {
    render(
      <main id="main" tabIndex={-1}>
        <AddToCalendar event={event} />
      </main>,
    );
    // Opened from the keyboard (focus on the trigger), then a link tapped.
    const trigger = screen.getByRole("button", { name: "Add to calendar" });
    act(() => trigger.focus());
    fireEvent.click(trigger);
    const google = screen.getByRole("link", { name: "Google Calendar (opens in a new tab)" });
    const landed = vi.fn((e: Event) => e.preventDefault());
    google.addEventListener("click", landed);
    pressLikeWebKit(google);
    expect(google.isConnected).toBe(true);
    expect(landed).toHaveBeenCalledTimes(1);
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    // Tabbing on out of the menu still closes it.
    fireEvent.blur(google, { relatedTarget: document.body.appendChild(document.createElement("button")) });
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("says so, instead of doing nothing, when the event's date can't be read", () => {
    render(<AddToCalendar event={{ ...event, startsAt: "soon" }} />);
    const trigger = screen.getByRole("button", { name: "Add to calendar" });
    expect(screen.getByRole("status")).toHaveTextContent("");
    fireEvent.click(trigger);
    expect(screen.getByRole("status")).toHaveTextContent("This event’s date can’t be added to a calendar.");
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("link")).toBeNull();
  });
});
