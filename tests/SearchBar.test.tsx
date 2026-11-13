// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import SearchBar from "@/components/SearchBar";
import type { SheltuhEvent } from "@/lib/types";

afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.unstubAllGlobals();
});

/** jsdom has no Popover API: fire the `toggle` event a browser would. */
function toggle(el: HTMLElement, newState: "open" | "closed") {
  act(() => {
    el.dispatchEvent(Object.assign(new Event("toggle"), { newState, oldState: newState === "open" ? "closed" : "open" }));
  });
}

function sheet() {
  const el = document.querySelector<HTMLElement>("[data-search-sheet]");
  if (!el) throw new Error("search sheet not rendered");
  return el;
}

describe("SearchBar", () => {
  it("is a search landmark named by the words it shows, that submits a plain GET to /search?q=", () => {
    render(<SearchBar />);
    const form = screen.getByRole("search", { name: "Search events" });
    expect(form).toHaveAttribute("action", "/search");
    expect(form).toHaveAttribute("method", "get");
    const input = within(form).getByRole("combobox", { name: "Search events" });
    expect(input).toHaveAttribute("name", "q");
    expect(input).toHaveAttribute("maxlength", "100");
    expect(input).toHaveAttribute("placeholder", "Search events");
  });

  it("shows the current query, in the field and on the phone's one field", () => {
    render(<SearchBar defaultValue="neon" />);
    expect(screen.getByRole("combobox", { name: "Search events" })).toHaveValue("neon");
    const trigger = document.querySelector("[data-search-trigger]");
    expect(trigger).toHaveTextContent("neon");
    expect(trigger).toHaveAccessibleName("Search events: neon");
  });

  it("gives two bars on one page their own input and sheet ids", () => {
    render(
      <>
        <SearchBar />
        <SearchBar />
      </>,
    );
    const [a, b] = screen.getAllByRole("combobox", { name: "Search events" });
    expect(a.id).not.toBe(b.id);
    const [sa, sb] = document.querySelectorAll("[data-search-sheet]");
    expect(sa.id).not.toBe(sb.id);
  });

  // The rules' Search board (desktop): "Search events" + Where (+ When, deferred) + an orange Search.
  it("from md, one bar with radius 8 and the stroke, 8px inside: the words, Where, then the orange Search", () => {
    render(<SearchBar />);
    const form = screen.getByRole("search", { name: "Search events" });
    const bar = form.querySelector("[data-search-bar]");
    expect(bar).toHaveClass("md:flex-row", "md:rounded-control", "md:border-control", "md:border-foreground", "md:bg-card", "md:p-2", "md:gap-2");
    expect(bar?.className).not.toMatch(/\bp-1\b|\bgap-1\b|rounded-full/);
    // The same element is the phone's sheet and, from md, just the bar's wrapper.
    expect(sheet()).toHaveClass("md:contents");
    const location = within(form).getByRole("button", { name: "Where: Your suburb" });
    const submit = within(form).getByRole("button", { name: "Search" });
    // Keyboard order: words → Where → Search.
    expect(screen.getByRole("combobox", { name: "Search events" }).compareDocumentPosition(location) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(location.compareDocumentPosition(submit) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(submit).toHaveAttribute("type", "submit");
    expect(submit).toHaveClass("btn", "btn-signal", "md:min-h-12");
    // No When field yet: /search reads only q and near.
    expect(within(form).queryByText(/^when$/i)).toBeNull();
    // 48px targets; 16px text so iOS doesn't zoom; a long query ends in "…".
    expect(screen.getByRole("combobox", { name: "Search events" })).toHaveClass("h-12", "text-base", "text-ellipsis");
    expect(location).toHaveClass("min-h-12");
    // From md, focus rings inside the bar are drawn inset, so they don't cross its stroke.
    for (const control of [screen.getByRole("combobox", { name: "Search events" }), location, submit]) expect(control).toHaveClass("md:focus-visible:-outline-offset-2!");
  });

  // The rules' Layout board: below md the search bar is one field that opens a full-screen sheet.
  it("below md, one field opens the full-screen sheet: a native popover, a dialog only while open, focusing the words", () => {
    render(<SearchBar />);
    const trigger = document.querySelector<HTMLElement>("[data-search-trigger]");
    if (!trigger) throw new Error("no trigger");
    expect(trigger).toHaveClass("md:hidden", "min-h-12");
    expect(trigger).toHaveAttribute("type", "button");
    expect(trigger).toHaveAccessibleName("Search events");
    expect(trigger).toHaveAttribute("popovertarget", sheet().id);
    expect(sheet()).toHaveAttribute("popover", "auto");
    expect(sheet()).not.toHaveAttribute("role");
    toggle(sheet(), "open");
    expect(sheet()).toHaveAttribute("role", "dialog");
    expect(sheet()).toHaveAccessibleName("Search events");
    expect(document.activeElement).toBe(screen.getByRole("combobox", { name: "Search events" }));
    // A Close button for touch (Escape and the field's own toggle also close it).
    const close = within(sheet()).getByRole("button", { name: "Close" });
    expect(close).toHaveAttribute("popovertargetaction", "hide");
    expect(close).toHaveClass("size-12");
    expect(close.parentElement).toHaveClass("md:hidden");
    toggle(sheet(), "closed");
    expect(sheet()).not.toHaveAttribute("role");
  });

  it("closes the sheet when focus leaves it for the page, or for the field under it; not when it moves inside or to an ancestor", () => {
    render(<SearchBar />);
    const el = sheet();
    const hidePopover = vi.fn();
    Object.assign(el, { hidePopover, matches: (q: string) => q === ":popover-open" || Element.prototype.matches.call(el, q) });
    toggle(el, "open");
    const input = screen.getByRole("combobox", { name: "Search events" });
    fireEvent.focusOut(input, { relatedTarget: screen.getByRole("button", { name: /^Where: / }) });
    // A press on the sheet's text focuses the nearest focusable ancestor: stays open.
    fireEvent.focusOut(input, { relatedTarget: screen.getByRole("search") });
    expect(hidePopover).not.toHaveBeenCalled();
    // CodeRabbit (PR 43): Shift+Tab from the sheet's first control reaches the field that opened it,
    // which is under the full-screen sheet: closes, so the next Shift+Tab can't reach the page behind it.
    const close = within(el).getByRole("button", { name: "Close" });
    fireEvent.focusOut(close, { relatedTarget: document.querySelector("[data-search-trigger]") });
    expect(hidePopover).toHaveBeenCalledTimes(1);
    const outside = document.createElement("button");
    document.body.append(outside);
    fireEvent.focusOut(input, { relatedTarget: outside });
    expect(hidePopover).toHaveBeenCalledTimes(2);
    outside.remove();
  });

  it("shows no “Press Search” hint outside /search (no appliedNear)", () => {
    render(<SearchBar near="Fitzroy" />);
    expect(document.querySelector("[data-near-hint]")).toBeNull();
  });

  it("submits the suburb as `near` from inside the same form", () => {
    render(<SearchBar near="Fitzroy" />);
    const form = screen.getByRole("search", { name: "Search events" });
    const near = within(form).getByLabelText("Suburb");
    expect(near).toHaveAttribute("name", "near");
    expect(near).toHaveValue("Fitzroy");
    const location = within(form).getByRole("button", { name: "Where: Fitzroy" });
    expect(location.querySelector("[data-location-label]")).toHaveTextContent("Fitzroy");
  });
});

function sampleEvent(id: string, title: string): SheltuhEvent {
  return {
    id,
    slug: `slug-${id}`,
    title,
    description: "d",
    category: "live-music",
    suburb: "Fitzroy",
    state: "VIC",
    timeZone: "Australia/Melbourne",
    venueName: "The Hall",
    venueAddress: "1 St",
    startsAt: "2026-11-20T09:00:00Z",
    endsAt: "2026-11-20T12:00:00Z",
    organiserId: "org-1",
    organiserName: "Org",
    poster: { pattern: "rings", background: "#000000", primary: "#ffffff", secondary: "#ff4800" },
    ticketTypes: [{ id: `${id}-t`, name: "GA", priceCents: 0, feePolicy: "buyer-pays", quantityAvailable: 10 }],
  };
}

/** Records where a pick goes (jsdom can't navigate). */
function stubNavigation() {
  const assign = vi.fn();
  vi.stubGlobal("location", { ...window.location, assign });
  return assign;
}

// The owner's "suggest events to search up" (Nov 2026): a combobox (WAI-ARIA APG) whose list opens
// under the empty field.
describe("SearchBar suggestions", () => {
  const field = () => screen.getByRole("combobox", { name: "Search events" });
  const list = () => screen.getByRole("listbox", { name: "Search suggestions", hidden: true });

  it("is a combobox controlling a hidden list until the empty field has focus", () => {
    render(<SearchBar />);
    expect(field()).toHaveAttribute("aria-expanded", "false");
    expect(field()).toHaveAttribute("aria-controls", list().id);
    expect(field()).not.toHaveAttribute("aria-activedescendant");
    expect(list().closest("[data-search-suggestions]")).not.toBeVisible();
    fireEvent.focus(field());
    expect(field()).toHaveAttribute("aria-expanded", "true");
    expect(list().closest("[data-search-suggestions]")).toBeVisible();
    // Categories only, without events from the page.
    const groups = within(list()).getAllByRole("group");
    expect(groups.map((group) => group.getAttribute("aria-labelledby") && document.getElementById(group.getAttribute("aria-labelledby") ?? "")?.textContent)).toEqual([
      "Categories",
    ]);
    expect(within(list()).getAllByRole("option").map((option) => option.textContent)).toEqual(["Live music", "Art", "Workshops", "Pop-ups", "Theatre"]);
  });

  it("suggests the events the page passes under “Coming up”", () => {
    const events = [sampleEvent("a", "Neon Static"), sampleEvent("b", "Paper Moon")];
    render(<SearchBar suggestedEvents={{ events, now: new Date("2026-11-13T00:00:00Z") }} />);
    fireEvent.focus(field());
    const coming = within(list()).getByRole("group", { name: "Coming up" });
    expect(within(coming).getAllByRole("option").map((option) => option.textContent)).toEqual([
      "Neon StaticFri 20 Nov · 8pm · Fitzroy, VIC",
      "Paper MoonFri 20 Nov · 8pm · Fitzroy, VIC",
    ]);
  });

  it("doesn't open over a query, and closes as soon as one is typed (opening again once it's cleared)", () => {
    const { unmount } = render(<SearchBar defaultValue="neon" />);
    fireEvent.focus(field());
    expect(field()).toHaveAttribute("aria-expanded", "false");
    unmount();
    render(<SearchBar />);
    fireEvent.focus(field());
    fireEvent.change(field(), { target: { value: "j" } });
    expect(field()).toHaveAttribute("aria-expanded", "false");
    fireEvent.change(field(), { target: { value: "" } });
    expect(field()).toHaveAttribute("aria-expanded", "true");
  });

  it("moves through the options with Down and Up (wrapping), focus staying in the field", () => {
    render(<SearchBar />);
    fireEvent.focus(field());
    fireEvent.keyDown(field(), { key: "ArrowDown" });
    const options = within(list()).getAllByRole("option");
    expect(field()).toHaveAttribute("aria-activedescendant", options[0].id);
    expect(options[0]).toHaveAttribute("aria-selected", "true");
    expect(options[1]).toHaveAttribute("aria-selected", "false");
    fireEvent.keyDown(field(), { key: "ArrowDown" });
    expect(field()).toHaveAttribute("aria-activedescendant", options[1].id);
    fireEvent.keyDown(field(), { key: "ArrowUp" });
    fireEvent.keyDown(field(), { key: "ArrowUp" });
    expect(field()).toHaveAttribute("aria-activedescendant", options[options.length - 1].id);
  });

  it("Enter opens the chosen suggestion instead of searching; with none chosen it searches as before", () => {
    const assign = stubNavigation();
    render(<SearchBar />);
    fireEvent.focus(field());
    // Nothing chosen: the form's own submit goes ahead.
    expect(fireEvent.keyDown(field(), { key: "Enter" })).toBe(true);
    expect(assign).not.toHaveBeenCalled();
    fireEvent.keyDown(field(), { key: "ArrowDown" });
    fireEvent.keyDown(field(), { key: "ArrowDown" });
    expect(fireEvent.keyDown(field(), { key: "Enter" })).toBe(false);
    expect(assign).toHaveBeenCalledWith("/events?category=art");
  });

  it("a click opens the suggestion (an event opens its page), and the press doesn't take focus from the field", () => {
    const assign = stubNavigation();
    render(<SearchBar suggestedEvents={{ events: [sampleEvent("a", "Neon Static")], now: new Date("2026-11-13T00:00:00Z") }} />);
    fireEvent.focus(field());
    const option = within(list()).getByRole("option", { name: /Neon Static/ });
    expect(fireEvent.mouseDown(option)).toBe(false);
    fireEvent.mouseMove(option);
    expect(field()).toHaveAttribute("aria-activedescendant", option.id);
    fireEvent.click(option);
    expect(assign).toHaveBeenCalledWith("/events/slug-a");
  });

  it("Escape closes the list (and only the list: a second one is left to the sheet), and leaving the field closes it", () => {
    render(<SearchBar />);
    fireEvent.focus(field());
    fireEvent.keyDown(field(), { key: "ArrowDown" });
    expect(fireEvent.keyDown(field(), { key: "Escape" })).toBe(false);
    expect(field()).toHaveAttribute("aria-expanded", "false");
    expect(field()).not.toHaveAttribute("aria-activedescendant");
    expect(fireEvent.keyDown(field(), { key: "Escape" })).toBe(true);
    // Down opens it again.
    fireEvent.keyDown(field(), { key: "ArrowDown" });
    expect(field()).toHaveAttribute("aria-expanded", "true");
    fireEvent.blur(field());
    expect(field()).toHaveAttribute("aria-expanded", "false");
  });

  it("lies over the page from md (nothing moves) and sits under Search in the phone's sheet", () => {
    render(<SearchBar />);
    const panel = list().closest("[data-search-suggestions]");
    expect(panel).toHaveClass("md:absolute", "md:top-full", "rounded-card", "shadow-soft", "bg-card");
    // Last in the bar: in the sheet it follows Search, so opening it moves nothing above it.
    expect(panel?.parentElement?.lastElementChild).toBe(panel);
  });
});

