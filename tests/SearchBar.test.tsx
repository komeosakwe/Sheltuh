// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import SearchBar from "@/components/SearchBar";

afterEach(() => {
  cleanup();
  localStorage.clear();
});

describe("SearchBar", () => {
  it("is a named search landmark that submits a plain GET to /search?q=", () => {
    render(<SearchBar label="Search the site" />);
    const form = screen.getByRole("search", { name: "Search the site" });
    expect(form).toHaveAttribute("action", "/search");
    expect(form).toHaveAttribute("method", "get");
    const input = screen.getByRole("searchbox", { name: "Search events" });
    expect(input).toHaveAttribute("name", "q");
    expect(input).toHaveAttribute("maxlength", "100");
  });

  it("names the field by the words it shows: “Search events”, by default, also its landmark's name (WCAG 2.5.3)", () => {
    render(<SearchBar />);
    const form = screen.getByRole("search", { name: "Search events" });
    const input = within(form).getByRole("searchbox", { name: "Search events" });
    expect(input).toHaveAttribute("placeholder", "Search events");
  });

  it("shows the current query", () => {
    render(<SearchBar defaultValue="neon" />);
    expect(screen.getByRole("searchbox")).toHaveValue("neon");
  });

  it("gives two search bars on one page distinct landmark names and their own input ids", () => {
    render(
      <>
        <SearchBar label="A" />
        <SearchBar label="B" />
      </>,
    );
    expect(screen.getByRole("search", { name: "A" })).toBeInTheDocument();
    expect(screen.getByRole("search", { name: "B" })).toBeInTheDocument();
    const [a, b] = screen.getAllByRole("searchbox", { name: "Search events" });
    expect(a.id).not.toBe(b.id);
  });

  // The rules' Search board: "Search events" + Where (+ When, deferred) + an orange Search; radius 8, the 1.5px stroke.
  it("is one bar, radius 8 with the stroke: the words, Where, then the orange Search, all inside the form", () => {
    render(<SearchBar />);
    const form = screen.getByRole("search", { name: "Search events" });
    const bar = form.querySelector("[data-search-bar]");
    expect(bar).toHaveClass("rounded-control", "border-control", "border-foreground", "bg-card");
    expect(bar).not.toHaveClass("rounded-full");
    const location = within(form).getByRole("button", { name: "Where: Your suburb" });
    const submit = within(form).getByRole("button", { name: "Search" });
    // Keyboard order: words → Where → Search.
    expect(screen.getByRole("searchbox").compareDocumentPosition(location) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(location.compareDocumentPosition(submit) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(submit).toHaveAttribute("type", "submit");
    // The one orange action, with a black label and icon (btn-signal); "Search" shows from 640px.
    expect(submit).toHaveClass("btn", "btn-signal", "min-h-12", "min-w-12");
    expect(within(submit).getByText("Search")).toHaveClass("sr-only", "sm:not-sr-only");
    // No When field yet: /search reads only q and near.
    expect(within(form).queryByText(/when/i)).toBeNull();
    // 48px targets; 16px text so iOS doesn't zoom; a long query ends in "…".
    expect(screen.getByRole("searchbox")).toHaveClass("h-12", "text-base", "text-ellipsis");
    expect(location).toHaveClass("min-h-12");
    // Focus rings inside the bar are drawn inset, so they don't cross its stroke.
    for (const control of [screen.getByRole("searchbox"), location, submit]) expect(control).toHaveClass("focus-visible:-outline-offset-2!");
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
