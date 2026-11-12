// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import SearchBar from "@/components/SearchBar";
import LocationPicker from "@/components/search/LocationPicker";
import { findLocality } from "@/lib/location";
import { NEAR_STORAGE_KEY } from "@/lib/near-storage";

type Success = (position: GeolocationPosition) => void;
type Failure = (error: GeolocationPositionError) => void;

const getCurrentPosition = vi.fn<(success: Success, failure: Failure, options?: PositionOptions) => void>();

function installGeolocation() {
  Object.defineProperty(navigator, "geolocation", {
    configurable: true,
    value: { getCurrentPosition, watchPosition: vi.fn(), clearWatch: vi.fn() },
  });
}

function removeGeolocation() {
  // jsdom has none of its own; this undoes installGeolocation.
  Reflect.deleteProperty(navigator, "geolocation");
}

function position(lat: number, lng: number): GeolocationPosition {
  return { coords: { latitude: lat, longitude: lng, accuracy: 1000 }, timestamp: Date.now() } as GeolocationPosition;
}

function positionError(code: 1 | 2 | 3): GeolocationPositionError {
  return { code, message: "", PERMISSION_DENIED: 1, POSITION_UNAVAILABLE: 2, TIMEOUT: 3 } as GeolocationPositionError;
}

/**
 * jsdom has no Popover API (the closed panel is display: none, so it's queried with `hidden: true`)
 * and no `formdata` event: fire the events a browser would (as tests/Nav.test.tsx does).
 */
function openPanel() {
  const panel = document.querySelector<HTMLElement>("[data-location-panel]");
  if (!panel) throw new Error("location panel not rendered");
  act(() => {
    panel.dispatchEvent(Object.assign(new Event("beforetoggle"), { newState: "open", oldState: "closed" }));
    panel.dispatchEvent(Object.assign(new Event("toggle"), { newState: "open", oldState: "closed" }));
  });
  return panel;
}

/** What the form would submit: a browser fires `formdata` on the form while building it. */
function submittedData(form: HTMLFormElement): FormData {
  const formData = new FormData(form);
  form.dispatchEvent(Object.assign(new Event("formdata"), { formData }));
  return formData;
}

function renderBar(near?: string) {
  return render(<SearchBar near={near} />);
}

beforeEach(() => {
  getCurrentPosition.mockReset();
  installGeolocation();
});
afterEach(() => {
  cleanup();
  removeGeolocation();
  localStorage.clear();
});

describe("LocationPicker — asking for the browser's position", () => {
  it("never asks on load; asks once per click, coarse, with a timeout", () => {
    renderBar();
    expect(getCurrentPosition).not.toHaveBeenCalled();
    const panel = openPanel();
    expect(getCurrentPosition).not.toHaveBeenCalled();
    fireEvent.click(within(panel).getByRole("button", { name: "Use my location", hidden: true }));
    expect(getCurrentPosition).toHaveBeenCalledTimes(1);
    expect(getCurrentPosition.mock.calls[0][2]).toEqual({ enableHighAccuracy: false, timeout: 10_000, maximumAge: 600_000 });
    expect(within(panel).getByRole("status", { hidden: true })).toHaveTextContent("Finding your location…");
  });

  it("is a labelled dialog that says what it does, with a link to the privacy policy", () => {
    renderBar();
    const panel = openPanel();
    expect(panel).toHaveAttribute("popover", "auto");
    expect(panel).toHaveAttribute("role", "dialog");
    expect(panel).toHaveAttribute("aria-labelledby");
    expect(document.getElementById(panel.getAttribute("aria-labelledby") ?? "")).toHaveTextContent("Find events near you");
    expect(screen.getByRole("button", { name: "Where: Your suburb" })).toHaveAttribute("popovertarget", panel.id);
    const use = within(panel).getByRole("button", { name: "Use my location", hidden: true });
    expect(use).toHaveAttribute("type", "button");
    expect(within(panel).queryByText(/Your browser will ask first/)).toBeNull();
    expect(within(panel).getByRole("link", { name: "How we use your location", hidden: true })).toHaveAttribute("href", "/privacy#location");
    // "Suburb", not a personal-data prompt, and not the button's "Your suburb" again; still no autofill.
    expect(within(panel).getByLabelText("Suburb")).toHaveAttribute("autocomplete", "off");
    expect(within(panel).queryByLabelText("Your suburb")).toBeNull();
    // Focus moves into the panel when it opens.
    expect(document.activeElement).toBe(use);
  });

  it("on success: shows and remembers the nearest suburb's name and state only, closes and returns focus, and doesn't submit", async () => {
    const submit = vi.fn((event: Event) => event.preventDefault());
    renderBar();
    screen.getByRole("search").addEventListener("submit", submit);
    const panel = openPanel();
    const northcote = findLocality("Northcote");
    if (!northcote) throw new Error("fixture");
    getCurrentPosition.mockImplementation((success) => success(position(northcote.lat + 0.001, northcote.lng)));
    fireEvent.click(within(panel).getByRole("button", { name: "Use my location", hidden: true }));

    const button = await screen.findByRole("button", { name: "Where: Northcote" });
    expect(document.activeElement).toBe(button);
    expect(within(panel).getByLabelText("Suburb")).toHaveValue("Northcote");
    expect(screen.getAllByRole("status").some((s) => s.textContent === "Location set: Northcote, VIC")).toBe(true);
    const stored = localStorage.getItem(NEAR_STORAGE_KEY) ?? "";
    expect(JSON.parse(stored)).toEqual({ suburb: "Northcote", state: "VIC" });
    expect(stored).not.toMatch(/lat|lng|-37|144/);
    // Nothing submits by itself (WCAG 3.2.2).
    expect(submit).not.toHaveBeenCalled();
    // No coordinates anywhere in the page either.
    expect(document.body.innerHTML).not.toContain(String(northcote.lat + 0.001));
  });

  /** The status line sits right under the row with "Use my location"; after a failure, focus is on the suburb field, described by it. */
  function expectFailure(panel: HTMLElement, message: string) {
    const use = within(panel).getByRole("button", { name: "Use my location", hidden: true });
    const status = within(panel).getByRole("status", { hidden: true });
    expect(use.parentElement?.nextElementSibling).toBe(status);
    expect(status).toHaveTextContent(message);
    const field = within(panel).getByLabelText("Suburb");
    expect(document.activeElement).toBe(field);
    expect(field).toHaveAccessibleDescription(message);
  }

  it.each([
    [1, "Location is off for this site. Type your suburb instead."],
    [2, "Couldn’t find your location. Type your suburb instead."],
    [3, "Couldn’t find your location. Type your suburb instead."],
  ] as const)("error code %i: says so under the button, moves to the suburb field, stores nothing", (code, message) => {
    renderBar();
    const panel = openPanel();
    getCurrentPosition.mockImplementation((_success, failure) => failure(positionError(code)));
    fireEvent.click(within(panel).getByRole("button", { name: "Use my location", hidden: true }));
    expectFailure(panel, message);
    expect(localStorage.getItem(NEAR_STORAGE_KEY)).toBeNull();
    expect(screen.getByRole("button", { name: "Where: Your suburb" })).toBeInTheDocument();
  });

  describe("inside an in-app browser", () => {
    const INSTAGRAM_IOS =
      "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 340.0.0.26.108 (iPhone15,2; iOS 18_1; en_AU)";
    const INSTAGRAM_ANDROID =
      "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/126.0.0.0 Mobile Safari/537.36 Instagram 340.0.0.30.109 Android";
    const SAFARI_IOS =
      "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1";

    function pretend(userAgent: string, url = "https://app.sheltuh.com.au/search?q=jazz#token=secret") {
      vi.stubGlobal("navigator", Object.create(navigator, { userAgent: { value: userAgent } }));
      vi.stubGlobal("location", new URL(url));
    }
    afterEach(() => vi.unstubAllGlobals());

    it.each([1, 2, 3] as const)("error code %i on iOS: names the app, says to type a suburb or use the ••• menu, no link", (code) => {
      pretend(INSTAGRAM_IOS);
      renderBar();
      const panel = openPanel();
      getCurrentPosition.mockImplementation((_success, failure) => failure(positionError(code)));
      fireEvent.click(within(panel).getByRole("button", { name: "Use my location", hidden: true }));
      const message = "Instagram’s browser can’t share your location. Type your suburb, or open Sheltüh in your browser from the ••• menu.";
      const status = within(panel).getByRole("status", { hidden: true });
      expect(status).toHaveTextContent(message);
      expect(within(status).queryByRole("link", { hidden: true })).toBeNull();
      expect(document.activeElement).toBe(within(panel).getByLabelText("Suburb"));
      expect(localStorage.getItem(NEAR_STORAGE_KEY)).toBeNull();
    });

    it("on Android it links to Chrome", () => {
      pretend(INSTAGRAM_ANDROID);
      renderBar();
      const panel = openPanel();
      getCurrentPosition.mockImplementation((_success, failure) => failure(positionError(1)));
      fireEvent.click(within(panel).getByRole("button", { name: "Use my location", hidden: true }));
      const status = within(panel).getByRole("status", { hidden: true });
      expect(status).toHaveTextContent("open Sheltüh in Chrome.");
      expect(within(status).getByRole("link", { name: "Open in Chrome", hidden: true })).toHaveAttribute(
        "href",
        "intent://app.sheltuh.com.au/search?q=jazz#Intent;scheme=https;package=com.android.chrome;end",
      );
    });

    it("with no https address to hand over (even on Android), points to the ••• menu and has no link", () => {
      pretend(INSTAGRAM_ANDROID, "http://localhost:3000/");
      renderBar();
      const panel = openPanel();
      getCurrentPosition.mockImplementation((_success, failure) => failure(positionError(2)));
      fireEvent.click(within(panel).getByRole("button", { name: "Use my location", hidden: true }));
      const status = within(panel).getByRole("status", { hidden: true });
      expect(status).toHaveTextContent(
        /^Instagram’s browser can’t share your location\. Type your suburb, or open Sheltüh in your browser from the ••• menu\.$/,
      );
      expect(within(status).queryByRole("link", { hidden: true })).toBeNull();
    });

    it("an ordinary browser keeps the usual message and has no link", () => {
      pretend(SAFARI_IOS);
      renderBar();
      const panel = openPanel();
      getCurrentPosition.mockImplementation((_success, failure) => failure(positionError(2)));
      fireEvent.click(within(panel).getByRole("button", { name: "Use my location", hidden: true }));
      expectFailure(panel, "Couldn’t find your location. Type your suburb instead.");
      expect(within(panel).queryByRole("link", { name: /Open in/, hidden: true })).toBeNull();
    });

    it("a position outside Australia keeps its own message", async () => {
      pretend(INSTAGRAM_IOS);
      renderBar();
      const panel = openPanel();
      getCurrentPosition.mockImplementation((success) => success(position(-36.8485, 174.7633)));
      fireEvent.click(within(panel).getByRole("button", { name: "Use my location", hidden: true }));
      await waitFor(() =>
        expectFailure(panel, "We couldn’t match your location to an Australian suburb. Type your suburb instead."),
      );
    });
  });

  it("outside Australia (Auckland): says so, moves to the suburb field, and stores nothing", async () => {
    renderBar();
    const panel = openPanel();
    getCurrentPosition.mockImplementation((success) => success(position(-36.8485, 174.7633)));
    fireEvent.click(within(panel).getByRole("button", { name: "Use my location", hidden: true }));
    await waitFor(() =>
      expectFailure(panel, "We couldn’t match your location to an Australian suburb. Type your suburb instead."),
    );
    expect(localStorage.getItem(NEAR_STORAGE_KEY)).toBeNull();
  });

  it.each([
    ["Frankston, outside the old inner-Melbourne table", -38.1425, 145.1257, "Frankston", "VIC"],
    ["Geelong", -38.1446, 144.3612, "Geelong", "VIC"],
    ["central Sydney", -33.8688, 151.2093, "Sydney", "NSW"],
    ["central Perth", -31.9523, 115.8613, "Perth", "WA"],
  ])("anywhere in Australia (%s): names the suburb", async (_where, lat, lng, suburb, state) => {
    renderBar();
    const panel = openPanel();
    getCurrentPosition.mockImplementation((success) => success(position(lat, lng)));
    fireEvent.click(within(panel).getByRole("button", { name: "Use my location", hidden: true }));
    await screen.findByRole("button", { name: `Where: ${suburb}` });
    expect(JSON.parse(localStorage.getItem(NEAR_STORAGE_KEY) ?? "null")).toEqual({ suburb, state });
  });

  it("names a suburb with its state when the name alone is Melbourne's (Richmond NSW)", async () => {
    renderBar();
    const panel = openPanel();
    const richmond = findLocality("Richmond NSW");
    if (!richmond) throw new Error("fixture");
    getCurrentPosition.mockImplementation((success) => success(position(richmond.lat + 0.001, richmond.lng - 0.001)));
    fireEvent.click(within(panel).getByRole("button", { name: "Use my location", hidden: true }));
    await screen.findByRole("button", { name: "Where: Richmond NSW" });
    expect(within(panel).getByLabelText("Suburb")).toHaveValue("Richmond NSW");
    expect(screen.getAllByRole("status").some((s) => s.textContent === "Location set: Richmond, NSW")).toBe(true);
    expect(JSON.parse(localStorage.getItem(NEAR_STORAGE_KEY) ?? "null")).toEqual({ suburb: "Richmond NSW", state: "NSW" });
  });

  it("clears a stale message when the panel opens again, and when the suburb is typed", () => {
    renderBar();
    const panel = openPanel();
    getCurrentPosition.mockImplementation((_success, failure) => failure(positionError(1)));
    const use = within(panel).getByRole("button", { name: "Use my location", hidden: true });
    const status = within(panel).getByRole("status", { hidden: true });
    fireEvent.click(use);
    expect(status).not.toBeEmptyDOMElement();
    fireEvent.change(within(panel).getByLabelText("Suburb"), { target: { value: "C" } });
    expect(status).toBeEmptyDOMElement();
    expect(within(panel).getByLabelText("Suburb")).not.toHaveAttribute("aria-describedby");
    fireEvent.click(use);
    expect(status).not.toBeEmptyDOMElement();
    openPanel();
    expect(status).toBeEmptyDOMElement();
  });

  it("keeps “Finding your location…” when the panel reopens mid-request", () => {
    renderBar();
    const panel = openPanel();
    fireEvent.click(within(panel).getByRole("button", { name: "Use my location", hidden: true }));
    openPanel();
    expect(within(panel).getByRole("status", { hidden: true })).toHaveTextContent("Finding your location…");
  });

  it("without the Geolocation API: no button, just the typed suburb, and still the privacy link", () => {
    removeGeolocation();
    renderBar();
    const panel = openPanel();
    expect(within(panel).queryByRole("button", { name: "Use my location", hidden: true })).toBeNull();
    expect(within(panel).getByLabelText("Suburb")).toHaveAttribute("name", "near");
    expect(within(panel).getByRole("link", { name: "How we use your location", hidden: true })).toHaveAttribute("href", "/privacy#location");
  });
});

describe("LocationPicker — the typed suburb and the remembered one", () => {
  it("suggests suburbs starting with what's typed, from two letters, a few at a time; a 16px field of at most 60 characters", async () => {
    renderBar();
    const panel = openPanel();
    const input = within(panel).getByLabelText("Suburb");
    expect(input).toHaveClass("text-base");
    expect(input).toHaveAttribute("maxlength", "60");
    const list = document.getElementById(input.getAttribute("list") ?? "");
    const options = () => [...(list?.querySelectorAll("option") ?? [])].map((option) => option.value);
    fireEvent.change(input, { target: { value: "Fitz" } });
    // "Suburb, STATE", as everywhere a place is shown (owner decision D4).
    await waitFor(() => expect(options().slice(0, 2)).toEqual(["Fitzroy, VIC", "Fitzroy North, VIC"]));
    expect(options().length).toBeLessThanOrEqual(8);
    // A state narrows them, by the names that find them again.
    fireEvent.change(input, { target: { value: "Richmond n" } });
    expect(options()).toEqual(["Richmond, NSW"]);
    // Not a list of all 15,000 places before anything's typed.
    fireEvent.change(input, { target: { value: "F" } });
    expect(options()).toEqual([]);
  });

  it("shows what's typed on the segment", () => {
    renderBar();
    const panel = openPanel();
    fireEvent.change(within(panel).getByLabelText("Suburb"), { target: { value: "Carlton" } });
    expect(screen.getByRole("button", { name: "Where: Carlton" })).toBeInTheDocument();
  });

  it("prefills the remembered suburb after mount (hero, header)", () => {
    localStorage.setItem(NEAR_STORAGE_KEY, JSON.stringify({ suburb: "Brunswick" }));
    renderBar();
    expect(screen.getByRole("button", { name: "Where: Brunswick" })).toBeInTheDocument();
    expect(screen.getByLabelText("Suburb")).toHaveValue("Brunswick");
  });

  it("on /search mirrors the address, not the remembered suburb", () => {
    localStorage.setItem(NEAR_STORAGE_KEY, JSON.stringify({ suburb: "Brunswick" }));
    renderBar("");
    expect(screen.getByRole("button", { name: "Where: Your suburb" })).toBeInTheDocument();
    cleanup();
    renderBar("Carlton");
    expect(screen.getByRole("button", { name: "Where: Carlton" })).toBeInTheDocument();
  });

  it("All of Australia clears the field and the remembered suburb, says so on the segment, and returns focus", () => {
    localStorage.setItem(NEAR_STORAGE_KEY, JSON.stringify({ suburb: "Brunswick" }));
    renderBar();
    const panel = openPanel();
    fireEvent.click(within(panel).getByRole("button", { name: "All of Australia", hidden: true }));
    expect(localStorage.getItem(NEAR_STORAGE_KEY)).toBeNull();
    expect(within(panel).getByLabelText("Suburb")).toHaveValue("");
    // The explicit choice shows on the button (for this page view), not the "Your suburb" prompt.
    const button = screen.getByRole("button", { name: "Where: All of Australia" });
    expect(button).toHaveTextContent("All of Australia");
    expect(document.activeElement).toBe(button);
    // Typing replaces it; emptying the field again is the prompt, not "All of Australia".
    fireEvent.change(within(panel).getByLabelText("Suburb"), { target: { value: "Carlton" } });
    expect(screen.getByRole("button", { name: "Where: Carlton" })).toBeInTheDocument();
    fireEvent.change(within(panel).getByLabelText("Suburb"), { target: { value: "" } });
    expect(screen.getByRole("button", { name: "Where: Your suburb" })).toBeInTheDocument();
  });

  it("“All of Australia” lasts only for this page view: a new bar shows the prompt", () => {
    renderBar();
    const panel = openPanel();
    fireEvent.click(within(panel).getByRole("button", { name: "All of Australia", hidden: true }));
    expect(screen.getByRole("button", { name: "Where: All of Australia" })).toBeInTheDocument();
    cleanup();
    renderBar();
    expect(screen.getByRole("button", { name: "Where: Your suburb" })).toBeInTheDocument();
  });

  it("on submit: leaves an empty `near` out, and keeps a typed one", () => {
    renderBar();
    const form = screen.getByRole<HTMLFormElement>("search");
    expect([...submittedData(form).keys()]).toEqual(["q"]);
    const panel = openPanel();
    fireEvent.change(within(panel).getByLabelText("Suburb"), { target: { value: "  Carlton " } });
    expect(submittedData(form).get("near")).toBe("Carlton");
  });

  it("searching with the location emptied forgets the remembered suburb, so /search won't bring it back", () => {
    localStorage.setItem(NEAR_STORAGE_KEY, JSON.stringify({ suburb: "Brunswick" }));
    renderBar();
    const form = screen.getByRole<HTMLFormElement>("search");
    const panel = openPanel();
    fireEvent.change(within(panel).getByLabelText("Suburb"), { target: { value: "  " } });
    expect([...submittedData(form).keys()]).toEqual(["q"]);
    expect(localStorage.getItem(NEAR_STORAGE_KEY)).toBeNull();
  });

  it("remembers a typed suburb the table knows, by its own name, when the search is submitted", async () => {
    renderBar();
    const form = screen.getByRole<HTMLFormElement>("search");
    const panel = openPanel();
    const input = within(panel).getByLabelText("Suburb");
    fireEvent.change(input, { target: { value: "st kilda" } });
    // The suburb table has loaded once the suggestions are there.
    await waitFor(() => expect(document.getElementById(input.getAttribute("list") ?? "")?.querySelector("option")).not.toBeNull());
    submittedData(form);
    expect(JSON.parse(localStorage.getItem(NEAR_STORAGE_KEY) ?? "null")).toEqual({ suburb: "St Kilda", state: "VIC" });
    // A state picks the place, which is remembered by the name that finds it again.
    fireEvent.change(input, { target: { value: "richmond, nsw" } });
    expect(submittedData(form).get("near")).toBe("richmond, nsw");
    expect(JSON.parse(localStorage.getItem(NEAR_STORAGE_KEY) ?? "null")).toEqual({ suburb: "Richmond NSW", state: "NSW" });
  });
});

describe("LocationPicker — closing", () => {
  function focusOut(from: HTMLElement, to: EventTarget | null) {
    fireEvent.focusOut(from, { relatedTarget: to });
  }

  it("closes when focus leaves for somewhere outside the panel and the location button", () => {
    renderBar();
    const panel = openPanel();
    const hidePopover = vi.fn();
    Object.assign(panel, { hidePopover });
    const field = within(panel).getByLabelText("Suburb");
    // Within the panel, back to the location button, or to nothing (a click on the panel's text): stays open.
    focusOut(field, within(panel).getByRole("button", { name: "All of Australia", hidden: true }));
    focusOut(field, screen.getByRole("button", { name: /^Where: / }));
    focusOut(field, null);
    expect(hidePopover).not.toHaveBeenCalled();
    // Tabbed on to Search: closes.
    focusOut(field, screen.getByRole("button", { name: "Search" }));
    expect(hidePopover).toHaveBeenCalledTimes(1);
  });

  /** The bar inside the layout's <main tabIndex={-1}> (app/layout.tsx), the panel's nearest focusable ancestor. */
  function renderInMain() {
    return render(
      <main id="main" tabIndex={-1}>
        <SearchBar />
      </main>,
    );
  }

  /**
   * A press as Safari and every iOS browser (WebKit) does it: the pressed button isn't focused,
   * focus goes to <main> around the panel, then the click lands. (Chromium focuses the button.)
   */
  function pressLikeWebKit(target: HTMLElement) {
    const main = document.getElementById("main");
    if (!main) throw new Error("no <main>");
    fireEvent.pointerDown(target);
    fireEvent.mouseDown(target);
    const from = document.activeElement instanceof HTMLElement ? document.activeElement : document.body;
    fireEvent.focusOut(from, { relatedTarget: main });
    act(() => main.focus());
    fireEvent.pointerUp(target);
    fireEvent.mouseUp(target);
    fireEvent.click(target);
  }

  it("stays open when a press moves focus to <main> around it (the panel's text; in WebKit, its buttons)", () => {
    renderInMain();
    const panel = openPanel();
    const hidePopover = vi.fn();
    Object.assign(panel, { hidePopover });
    focusOut(within(panel).getByRole("button", { name: "Use my location", hidden: true }), document.getElementById("main"));
    expect(hidePopover).not.toHaveBeenCalled();
  });

  it("a WebKit tap on Use my location asks for the position and sets the suburb (it used to close first)", async () => {
    renderInMain();
    const panel = openPanel();
    const hidePopover = vi.fn();
    Object.assign(panel, { hidePopover });
    const fitzroy = findLocality("Fitzroy");
    if (!fitzroy) throw new Error("fixture");
    getCurrentPosition.mockImplementation((success) => success(position(fitzroy.lat, fitzroy.lng)));
    pressLikeWebKit(within(panel).getByRole("button", { name: "Use my location", hidden: true }));
    // Closed by the success, once, not by the press.
    await screen.findByRole("button", { name: "Where: Fitzroy" });
    expect(getCurrentPosition).toHaveBeenCalledTimes(1);
    expect(hidePopover).toHaveBeenCalledTimes(1);
    expect(JSON.parse(localStorage.getItem(NEAR_STORAGE_KEY) ?? "null")).toEqual({ suburb: "Fitzroy", state: "VIC" });
  });

  it("a WebKit tap on All of Australia clears the suburb", () => {
    localStorage.setItem(NEAR_STORAGE_KEY, JSON.stringify({ suburb: "Fitzroy", state: "VIC" }));
    renderInMain();
    const panel = openPanel();
    pressLikeWebKit(within(panel).getByRole("button", { name: "All of Australia", hidden: true }));
    expect(screen.getByRole("button", { name: "Where: All of Australia" })).toBeInTheDocument();
    expect(localStorage.getItem(NEAR_STORAGE_KEY)).toBeNull();
  });

  it("the page losing focus or being hidden while locating (a phone's permission prompt) neither closes it nor loses the answer", async () => {
    renderInMain();
    const panel = openPanel();
    const hidePopover = vi.fn();
    Object.assign(panel, { hidePopover });
    let answer: ((error: GeolocationPositionError) => void) | undefined;
    getCurrentPosition.mockImplementation((_success, failure) => {
      answer = failure;
    });
    const use = within(panel).getByRole("button", { name: "Use my location", hidden: true });
    act(() => use.focus());
    fireEvent.click(use);
    // The prompt takes focus from the page (focus goes nowhere), and may hide it.
    fireEvent.focusOut(use, { relatedTarget: null });
    fireEvent.blur(window);
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" });
    fireEvent(document, new Event("visibilitychange"));
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
    fireEvent(document, new Event("visibilitychange"));
    fireEvent.focus(window);
    expect(hidePopover).not.toHaveBeenCalled();
    act(() => answer?.(positionError(3)));
    expect(within(panel).getByRole("status", { hidden: true })).toHaveTextContent("Couldn’t find your location. Type your suburb instead.");
    expect(hidePopover).not.toHaveBeenCalled();
    Reflect.deleteProperty(document, "visibilityState");
  });
});

describe("LocationPicker — the rules' location menu (redesign PR 2)", () => {
  /** The rows under a menu section's label ("Recent", "Suggested"). */
  function section(panel: HTMLElement, name: string) {
    return within(within(panel).getByRole("group", { name, hidden: true }));
  }

  it("the segment shows WHERE over the place, and is named by both (WCAG 2.5.3)", () => {
    localStorage.setItem(NEAR_STORAGE_KEY, JSON.stringify({ suburb: "Caulfield East", state: "VIC" }));
    renderBar();
    const button = screen.getByRole("button", { name: "Where: Caulfield East" });
    expect(button).toHaveTextContent(/^Where\s*Caulfield East$/);
    expect(button).toHaveClass("min-h-12", "rounded-control", "hover:bg-hover", "data-open:bg-hover", "data-open:border-foreground");
    // The open state is drawn from the menu's own toggle, not guessed.
    expect(button).not.toHaveAttribute("data-open");
    openPanel();
    expect(button).toHaveAttribute("data-open");
  });

  it("opens with Use my location and All of Australia, then the suburb field, Recent and Suggested, in that order", () => {
    localStorage.setItem(NEAR_STORAGE_KEY, JSON.stringify({ suburb: "Caulfield East", state: "VIC" }));
    renderBar();
    const panel = openPanel();
    const order = [
      within(panel).getByRole("button", { name: "Use my location", hidden: true }),
      within(panel).getByRole("button", { name: "All of Australia", hidden: true }),
      within(panel).getByLabelText("Suburb"),
      within(panel).getByRole("group", { name: "Recent", hidden: true }),
      within(panel).getByRole("group", { name: "Suggested", hidden: true }),
      within(panel).getByRole("link", { name: "How we use your location", hidden: true }),
    ];
    for (let i = 1; i < order.length; i++) {
      expect(order[i - 1].compareDocumentPosition(order[i]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    }
    // Black words, never orange (orange text only on black); 48px rows; radius 8, the stroke, no shadow.
    expect(order[0]).not.toHaveClass("text-signal");
    expect(order[0]).toHaveClass("min-h-12");
    expect(panel).toHaveClass("rounded-control", "border-control", "border-foreground");
    expect(panel.className).not.toMatch(/shadow/);
  });

  it("Recent is the remembered suburb, marked current with its state; Suggested is Melbourne, Sydney, Brisbane and Perth", () => {
    localStorage.setItem(NEAR_STORAGE_KEY, JSON.stringify({ suburb: "Caulfield East", state: "VIC" }));
    renderBar();
    const panel = openPanel();
    const recent = section(panel, "Recent").getAllByRole("button", { hidden: true });
    expect(recent).toHaveLength(1);
    expect(recent[0]).toHaveTextContent("Caulfield East");
    expect(recent[0]).toHaveTextContent("VIC · current");
    expect(recent[0]).toHaveAttribute("aria-current", "true");
    expect(
      section(panel, "Suggested")
        .getAllByRole("button", { hidden: true })
        .map((row) => row.textContent),
    ).toEqual(["MelbourneVIC, Australia", "SydneyNSW, Australia", "BrisbaneQLD, Australia", "PerthWA, Australia"]);
  });

  it("with nothing remembered there's no Recent; a remembered suggested city isn't listed twice", () => {
    renderBar();
    expect(within(openPanel()).queryByRole("group", { name: "Recent", hidden: true })).toBeNull();
    cleanup();
    localStorage.setItem(NEAR_STORAGE_KEY, JSON.stringify({ suburb: "Sydney", state: "NSW" }));
    renderBar();
    const panel = openPanel();
    expect(section(panel, "Recent").getByRole("button", { hidden: true })).toHaveTextContent("Sydney");
    expect(section(panel, "Suggested").queryByRole("button", { name: /^Sydney/, hidden: true })).toBeNull();
  });

  it("choosing a suggested place sets it on the segment and remembers it at once, by the table's own name; nothing submits", async () => {
    const submit = vi.fn((event: Event) => event.preventDefault());
    renderBar();
    screen.getByRole("search").addEventListener("submit", submit);
    const panel = openPanel();
    // Straight away, before anything's typed: the table is loaded first if it hasn't yet, so the
    // stored name is always the table's own ("Brisbane" is Brisbane City).
    fireEvent.click(section(panel, "Suggested").getByRole("button", { name: /^Brisbane/, hidden: true }));
    const button = await screen.findByRole("button", { name: "Where: Brisbane City" });
    expect(document.activeElement).toBe(button);
    expect(JSON.parse(localStorage.getItem(NEAR_STORAGE_KEY) ?? "null")).toEqual({ suburb: "Brisbane City", state: "QLD" });
    expect(screen.getAllByRole("status").some((s) => s.textContent === "Location set: Brisbane City, QLD")).toBe(true);
    expect(submit).not.toHaveBeenCalled();
  });

  it("one location everywhere: a place chosen in one bar shows in another on the page", async () => {
    render(
      <>
        <SearchBar />
        <SearchBar />
      </>,
    );
    const [first] = document.querySelectorAll<HTMLElement>("[data-location-panel]");
    act(() => {
      first.dispatchEvent(Object.assign(new Event("toggle"), { newState: "open", oldState: "closed" }));
    });
    fireEvent.click(within(first).getByRole("button", { name: /^Perth/, hidden: true }));
    const b = screen.getAllByRole("search")[1];
    expect(await within(b).findByRole("button", { name: "Where: Perth" })).toBeInTheDocument();
    expect(JSON.parse(localStorage.getItem(NEAR_STORAGE_KEY) ?? "null")).toEqual({ suburb: "Perth", state: "WA" });
  });
});

describe("LocationPicker — Escape", () => {
  it("closes the list only and returns focus to Where (in the phone's sheet the browser would close both)", () => {
    renderBar();
    const panel = openPanel();
    const hidePopover = vi.fn();
    Object.assign(panel, { hidePopover });
    const use = within(panel).getByRole("button", { name: "Use my location", hidden: true });
    const outer = vi.fn();
    document.addEventListener("keydown", outer);
    const event = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
    act(() => {
      use.dispatchEvent(event);
    });
    expect(event.defaultPrevented).toBe(true);
    expect(outer).not.toHaveBeenCalled();
    expect(hidePopover).toHaveBeenCalledTimes(1);
    expect(document.activeElement).toBe(screen.getByRole("button", { name: /^Where: / }));
    document.removeEventListener("keydown", outer);
  });
});

/** The browser's `toggle` as the menu closes (light dismiss, Escape, Close, or a choice). */
function closePanel(panel: HTMLElement) {
  act(() => {
    panel.dispatchEvent(Object.assign(new Event("toggle"), { newState: "closed", oldState: "open" }));
  });
}

// CodeRabbit (PR 43): on Nearby nothing sends the typed words later, so they mustn't outlive the menu.
describe("LocationPicker — standalone (Nearby): closing without applying", () => {
  it("drops a typed suburb and shows the place in use again; the search bar keeps it for Search", () => {
    localStorage.setItem(NEAR_STORAGE_KEY, JSON.stringify({ suburb: "Fitzroy", state: "VIC" }));
    render(<LocationPicker standalone />);
    const panel = openPanel();
    const field = within(panel).getByLabelText("Suburb");
    fireEvent.change(field, { target: { value: "Bruns" } });
    expect(screen.getByRole("button", { name: "Where: Bruns" })).toBeInTheDocument();
    closePanel(panel);
    expect(screen.getByRole("button", { name: "Where: Fitzroy" })).toBeInTheDocument();
    expect(field).toHaveValue("Fitzroy");
    expect(JSON.parse(localStorage.getItem(NEAR_STORAGE_KEY) ?? "null")).toEqual({ suburb: "Fitzroy", state: "VIC" });
    cleanup();

    // In the search bar a typed suburb is sent with Search, so it stays.
    renderBar();
    const barPanel = openPanel();
    fireEvent.change(within(barPanel).getByLabelText("Suburb"), { target: { value: "Bruns" } });
    closePanel(barPanel);
    expect(screen.getByRole("button", { name: "Where: Bruns" })).toBeInTheDocument();
  });

  it("shows the page's visit place again, not the remembered suburb", () => {
    localStorage.setItem(NEAR_STORAGE_KEY, JSON.stringify({ suburb: "Fitzroy", state: "VIC" }));
    render(<LocationPicker near="Sydney" standalone />);
    const panel = openPanel();
    fireEvent.change(within(panel).getByLabelText("Suburb"), { target: { value: "Perth" } });
    closePanel(panel);
    expect(screen.getByRole("button", { name: "Where: Sydney" })).toBeInTheDocument();
  });

  it("after All of Australia, typing then closing shows All of Australia again", () => {
    localStorage.setItem(NEAR_STORAGE_KEY, JSON.stringify({ suburb: "Fitzroy", state: "VIC" }));
    render(<LocationPicker standalone />);
    let panel = openPanel();
    fireEvent.click(within(panel).getByRole("button", { name: "All of Australia", hidden: true }));
    closePanel(panel);
    expect(screen.getByRole("button", { name: "Where: All of Australia" })).toBeInTheDocument();
    panel = openPanel();
    fireEvent.change(within(panel).getByLabelText("Suburb"), { target: { value: "Carl" } });
    expect(screen.getByRole("button", { name: "Where: Carl" })).toBeInTheDocument();
    closePanel(panel);
    expect(screen.getByRole("button", { name: "Where: All of Australia" })).toBeInTheDocument();
    expect(localStorage.getItem(NEAR_STORAGE_KEY)).toBeNull();
  });

  it("Enter still applies what's typed: remembered by the table's name, and kept after the menu closes", async () => {
    render(<LocationPicker standalone />);
    const panel = openPanel();
    const hidePopover = vi.fn(() => closePanel(panel));
    Object.assign(panel, { hidePopover });
    const field = within(panel).getByLabelText("Suburb");
    fireEvent.change(field, { target: { value: "brunswick" } });
    fireEvent.keyDown(field, { key: "Enter" });
    await waitFor(() => expect(hidePopover).toHaveBeenCalled());
    const place = findLocality("brunswick");
    expect(place).not.toBeNull();
    expect(JSON.parse(localStorage.getItem(NEAR_STORAGE_KEY) ?? "null")).toEqual({ suburb: place?.name, state: place?.state });
    expect(screen.getByRole("button", { name: `Where: ${place?.name}` })).toBeInTheDocument();
    expect(field).toHaveValue(place?.name);
  });

  it("an unknown suburb on Enter keeps the menu open with the message; closing then restores the place", async () => {
    localStorage.setItem(NEAR_STORAGE_KEY, JSON.stringify({ suburb: "Fitzroy", state: "VIC" }));
    render(<LocationPicker standalone />);
    const panel = openPanel();
    const hidePopover = vi.fn();
    Object.assign(panel, { hidePopover });
    const field = within(panel).getByLabelText("Suburb");
    fireEvent.change(field, { target: { value: "Nowhereville" } });
    fireEvent.keyDown(field, { key: "Enter" });
    await waitFor(() => expect(within(panel).getByRole("status", { hidden: true })).toHaveTextContent(/couldn’t find that suburb/));
    expect(hidePopover).not.toHaveBeenCalled();
    closePanel(panel);
    expect(screen.getByRole("button", { name: "Where: Fitzroy" })).toBeInTheDocument();
  });
});
