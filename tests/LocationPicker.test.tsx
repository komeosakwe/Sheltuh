// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import SearchBar from "@/components/SearchBar";
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
  return render(<SearchBar label="Search events" size="lg" tone="signal" placeholder="Search events" near={near} />);
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
    fireEvent.click(within(panel).getByRole("button", { name: "Use my current location", hidden: true }));
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
    expect(screen.getByRole("button", { name: "Location: Your suburb" })).toHaveAttribute("popovertarget", panel.id);
    const use = within(panel).getByRole("button", { name: "Use my current location", hidden: true });
    expect(use).toHaveAttribute("type", "button");
    expect(use).toHaveAccessibleDescription(/Your browser will ask first\. We only use it to find your suburb, on this device\./);
    expect(within(panel).getByRole("link", { name: "Privacy", hidden: true })).toHaveAttribute("href", "/privacy#location");
    // Focus moves into the panel when it opens.
    expect(document.activeElement).toBe(use);
  });

  it("on success: shows and remembers the nearest suburb's name only, closes and returns focus, and doesn't submit", async () => {
    const submit = vi.fn((event: Event) => event.preventDefault());
    renderBar();
    screen.getByRole("search").addEventListener("submit", submit);
    const panel = openPanel();
    const northcote = findLocality("Northcote");
    if (!northcote) throw new Error("fixture");
    getCurrentPosition.mockImplementation((success) => success(position(northcote.lat + 0.001, northcote.lng)));
    fireEvent.click(within(panel).getByRole("button", { name: "Use my current location", hidden: true }));

    const button = await screen.findByRole("button", { name: "Location: Northcote" });
    expect(document.activeElement).toBe(button);
    expect(within(panel).getByLabelText("Your suburb")).toHaveValue("Northcote");
    expect(screen.getAllByRole("status").some((s) => s.textContent === "Location set: Northcote")).toBe(true);
    const stored = localStorage.getItem(NEAR_STORAGE_KEY) ?? "";
    expect(JSON.parse(stored)).toEqual({ suburb: "Northcote" });
    expect(stored).not.toMatch(/lat|lng|-37|144/);
    // Nothing submits by itself (WCAG 3.2.2).
    expect(submit).not.toHaveBeenCalled();
    // No coordinates anywhere in the page either.
    expect(document.body.innerHTML).not.toContain(String(northcote.lat + 0.001));
  });

  it.each([
    [1, "Location is off for this site. Type your suburb instead."],
    [2, "Couldn’t find your location. Type your suburb instead."],
    [3, "Couldn’t find your location. Type your suburb instead."],
  ] as const)("error code %i: says so in the panel, stores nothing", (code, message) => {
    renderBar();
    const panel = openPanel();
    getCurrentPosition.mockImplementation((_success, failure) => failure(positionError(code)));
    fireEvent.click(within(panel).getByRole("button", { name: "Use my current location", hidden: true }));
    expect(within(panel).getByRole("status", { hidden: true })).toHaveTextContent(message);
    expect(localStorage.getItem(NEAR_STORAGE_KEY)).toBeNull();
    expect(screen.getByRole("button", { name: "Location: Your suburb" })).toBeInTheDocument();
  });

  it("outside Melbourne: says so and stores nothing", async () => {
    renderBar();
    const panel = openPanel();
    getCurrentPosition.mockImplementation((success) => success(position(-33.8688, 151.2093)));
    fireEvent.click(within(panel).getByRole("button", { name: "Use my current location", hidden: true }));
    await waitFor(() =>
      expect(within(panel).getByRole("status", { hidden: true })).toHaveTextContent("You seem to be outside Melbourne. Type a Melbourne suburb instead."),
    );
    expect(localStorage.getItem(NEAR_STORAGE_KEY)).toBeNull();
  });

  it("in Melbourne but far from any suburb we know: asks for the suburb rather than guessing", async () => {
    renderBar();
    const panel = openPanel();
    getCurrentPosition.mockImplementation((success) => success(position(-38.1446, 145.1236)));
    fireEvent.click(within(panel).getByRole("button", { name: "Use my current location", hidden: true }));
    await waitFor(() =>
      expect(within(panel).getByRole("status", { hidden: true })).toHaveTextContent("We couldn’t match your location to a suburb yet."),
    );
    expect(localStorage.getItem(NEAR_STORAGE_KEY)).toBeNull();
  });

  it("without the Geolocation API: no button, just the typed suburb", () => {
    removeGeolocation();
    renderBar();
    const panel = openPanel();
    expect(within(panel).queryByRole("button", { name: "Use my current location", hidden: true })).toBeNull();
    expect(within(panel).getByLabelText("Your suburb")).toHaveAttribute("name", "near");
  });
});

describe("LocationPicker — the typed suburb and the remembered one", () => {
  it("offers the known suburbs as suggestions once opened; a 16px field of at most 60 characters", async () => {
    renderBar();
    const panel = openPanel();
    const input = within(panel).getByLabelText("Your suburb");
    expect(input).toHaveClass("text-base");
    expect(input).toHaveAttribute("maxlength", "60");
    const list = document.getElementById(input.getAttribute("list") ?? "");
    await waitFor(() => expect(list?.querySelectorAll("option").length).toBeGreaterThan(0));
    expect(list?.querySelector("option[value='Fitzroy']")).not.toBeNull();
  });

  it("shows what's typed on the segment", () => {
    renderBar();
    const panel = openPanel();
    fireEvent.change(within(panel).getByLabelText("Your suburb"), { target: { value: "Carlton" } });
    expect(screen.getByRole("button", { name: "Location: Carlton" })).toBeInTheDocument();
  });

  it("prefills the remembered suburb after mount (hero, header)", () => {
    localStorage.setItem(NEAR_STORAGE_KEY, JSON.stringify({ suburb: "Brunswick" }));
    renderBar();
    expect(screen.getByRole("button", { name: "Location: Brunswick" })).toBeInTheDocument();
    expect(screen.getByLabelText("Your suburb")).toHaveValue("Brunswick");
  });

  it("on /search mirrors the address, not the remembered suburb", () => {
    localStorage.setItem(NEAR_STORAGE_KEY, JSON.stringify({ suburb: "Brunswick" }));
    renderBar("");
    expect(screen.getByRole("button", { name: "Location: Your suburb" })).toBeInTheDocument();
    cleanup();
    renderBar("Carlton");
    expect(screen.getByRole("button", { name: "Location: Carlton" })).toBeInTheDocument();
  });

  it("Anywhere in Melbourne clears the field and the remembered suburb, and returns focus", () => {
    localStorage.setItem(NEAR_STORAGE_KEY, JSON.stringify({ suburb: "Brunswick" }));
    renderBar();
    const panel = openPanel();
    fireEvent.click(within(panel).getByRole("button", { name: "Anywhere in Melbourne", hidden: true }));
    expect(localStorage.getItem(NEAR_STORAGE_KEY)).toBeNull();
    expect(within(panel).getByLabelText("Your suburb")).toHaveValue("");
    const button = screen.getByRole("button", { name: "Location: Your suburb" });
    expect(document.activeElement).toBe(button);
  });

  it("on submit: leaves an empty `near` out, and keeps a typed one", () => {
    renderBar();
    const form = screen.getByRole<HTMLFormElement>("search");
    expect([...submittedData(form).keys()]).toEqual(["q"]);
    const panel = openPanel();
    fireEvent.change(within(panel).getByLabelText("Your suburb"), { target: { value: "  Carlton " } });
    expect(submittedData(form).get("near")).toBe("Carlton");
  });

  it("remembers a typed suburb the table knows, by its own name, when the search is submitted", async () => {
    renderBar();
    const form = screen.getByRole<HTMLFormElement>("search");
    const panel = openPanel();
    const input = within(panel).getByLabelText("Your suburb");
    // The suburb table has loaded once the suggestions are there.
    await waitFor(() => expect(document.getElementById(input.getAttribute("list") ?? "")?.querySelector("option")).not.toBeNull());
    fireEvent.change(input, { target: { value: "st kilda" } });
    submittedData(form);
    expect(JSON.parse(localStorage.getItem(NEAR_STORAGE_KEY) ?? "null")).toEqual({ suburb: "St Kilda" });
  });
});
