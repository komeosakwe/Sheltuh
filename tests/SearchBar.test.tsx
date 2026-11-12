// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import SearchBar from "@/components/SearchBar";

afterEach(() => {
  cleanup();
  localStorage.clear();
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
    const input = within(form).getByRole("searchbox", { name: "Search events" });
    expect(input).toHaveAttribute("name", "q");
    expect(input).toHaveAttribute("maxlength", "100");
    expect(input).toHaveAttribute("placeholder", "Search events");
  });

  it("shows the current query, in the field and on the phone's one field", () => {
    render(<SearchBar defaultValue="neon" />);
    expect(screen.getByRole("searchbox")).toHaveValue("neon");
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
    const [a, b] = screen.getAllByRole("searchbox", { name: "Search events" });
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
    expect(screen.getByRole("searchbox").compareDocumentPosition(location) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(location.compareDocumentPosition(submit) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(submit).toHaveAttribute("type", "submit");
    expect(submit).toHaveClass("btn", "btn-signal", "md:min-h-12");
    // No When field yet: /search reads only q and near.
    expect(within(form).queryByText(/^when$/i)).toBeNull();
    // 48px targets; 16px text so iOS doesn't zoom; a long query ends in "…".
    expect(screen.getByRole("searchbox")).toHaveClass("h-12", "text-base", "text-ellipsis");
    expect(location).toHaveClass("min-h-12");
    // From md, focus rings inside the bar are drawn inset, so they don't cross its stroke.
    for (const control of [screen.getByRole("searchbox"), location, submit]) expect(control).toHaveClass("md:focus-visible:-outline-offset-2!");
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
    expect(document.activeElement).toBe(screen.getByRole("searchbox"));
    // A Close button for touch (Escape and the field's own toggle also close it).
    const close = within(sheet()).getByRole("button", { name: "Close" });
    expect(close).toHaveAttribute("popovertargetaction", "hide");
    expect(close).toHaveClass("size-12");
    expect(close.parentElement).toHaveClass("md:hidden");
    toggle(sheet(), "closed");
    expect(sheet()).not.toHaveAttribute("role");
  });

  it("closes the sheet when focus leaves it for the page, not when it moves inside or to the field", () => {
    render(<SearchBar />);
    const el = sheet();
    const hidePopover = vi.fn();
    Object.assign(el, { hidePopover, matches: (q: string) => q === ":popover-open" || Element.prototype.matches.call(el, q) });
    toggle(el, "open");
    const input = screen.getByRole("searchbox");
    fireEvent.focusOut(input, { relatedTarget: screen.getByRole("button", { name: /^Where: / }) });
    fireEvent.focusOut(input, { relatedTarget: document.querySelector("[data-search-trigger]") });
    expect(hidePopover).not.toHaveBeenCalled();
    const outside = document.createElement("button");
    document.body.append(outside);
    fireEvent.focusOut(input, { relatedTarget: outside });
    expect(hidePopover).toHaveBeenCalledTimes(1);
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
