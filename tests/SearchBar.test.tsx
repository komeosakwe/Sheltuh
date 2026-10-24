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
    // Owner round of 24 Oct 2026 (D5): location has its own field now, so "suburb" left the placeholder.
    const input = screen.getByRole("searchbox", { name: "Search by event or venue" });
    expect(input).toHaveAttribute("name", "q");
    expect(input).toHaveAttribute("maxlength", "100");
  });

  it("names the field by the words it shows, so a short placeholder is also its name (WCAG 2.5.3)", () => {
    render(<SearchBar label="Search events" size="lg" placeholder="Search events" />);
    const input = screen.getByRole("searchbox", { name: "Search events" });
    expect(input).toHaveAttribute("placeholder", "Search events");
  });

  it("shows the current query", () => {
    render(<SearchBar defaultValue="neon" size="lg" />);
    expect(screen.getByRole("searchbox")).toHaveValue("neon");
  });

  it("gives two search bars on one page distinct landmark names", () => {
    render(
      <>
        <SearchBar label="Search the site" />
        <SearchBar label="Search events" size="lg" />
      </>,
    );
    expect(screen.getByRole("search", { name: "Search the site" })).toBeInTheDocument();
    expect(screen.getByRole("search", { name: "Search events" })).toBeInTheDocument();
  });

  it("gives each bar its own input id, even two of the same size", () => {
    render(
      <>
        <SearchBar label="A" size="lg" />
        <SearchBar label="B" size="lg" />
      </>,
    );
    const [a, b] = screen.getAllByRole("searchbox", { name: "Search by event or venue" });
    expect(a.id).not.toBe(b.id);
  });

  // Owner round of 24 Oct 2026: the Eventbrite-style bar. The submit always shows (the `submit` prop is gone).
  it("is one pill: the words, the location segment, then a round named submit, all inside the form", () => {
    render(<SearchBar label="Search events" size="lg" tone="signal" />);
    const form = screen.getByRole("search", { name: "Search events" });
    const bar = form.querySelector("[data-search-bar]");
    expect(bar).toHaveClass("rounded-full", "border", "border-foreground", "bg-card", "h-13");
    const location = within(form).getByRole("button", { name: "Location: Your suburb" });
    const submit = within(form).getByRole("button", { name: "Search" });
    // Keyboard order: words → location → Search.
    expect(screen.getByRole("searchbox").compareDocumentPosition(location) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(location.compareDocumentPosition(submit) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(submit).toHaveAttribute("type", "submit");
    expect(submit).toHaveClass("rounded-full", "size-11");
    // 16px text so iOS doesn't zoom; a long query ends in "…" rather than being cut off; tighter on phones.
    expect(screen.getByRole("searchbox")).toHaveClass("text-base", "text-ellipsis", "pl-3", "sm:pl-4");
    // The submit's focus ring is drawn inside the pill, like the field's and the location's.
    expect(submit).toHaveClass("focus-visible:-outline-offset-2!");
    expect(location).toHaveClass("px-2", "sm:px-3", "gap-1", "focus-visible:-outline-offset-2!");
  });

  it("shows no “Press Search” hint outside /search (no appliedNear)", () => {
    render(<SearchBar label="Search events" size="lg" near="Fitzroy" />);
    expect(document.querySelector("[data-near-hint]")).toBeNull();
  });

  it("tone=signal: an orange submit with a black icon (hero, /search)", () => {
    render(<SearchBar label="Search events" size="lg" tone="signal" />);
    expect(screen.getByRole("button", { name: "Search" })).toHaveClass("btn", "btn-signal");
  });

  it("tone=plain (default): a black submit, orange on hover, never btn-signal (the header)", () => {
    render(<SearchBar label="Search the site" placeholder="Search events" />);
    const submit = screen.getByRole("button", { name: "Search" });
    expect(submit).not.toHaveClass("btn-signal");
    expect(submit).toHaveClass("bg-foreground", "text-background", "hover:bg-signal", "hover:text-signal-foreground", "size-9");
    expect(screen.getByRole("search").querySelector("[data-search-bar]")).toHaveClass("h-11");
    expect(screen.getByRole("searchbox")).toHaveClass("text-sm");
  });

  // Header fit (24 Oct 2026): signed in, the header's bar shrinks into the room the nav leaves. It's a
  // size container, and under 20rem its location segment is just the pin; the button keeps its name.
  it("the header size narrows its location segment to the pin in a narrow bar; the hero's never does", () => {
    render(
      <>
        <SearchBar label="Search the site" placeholder="Search events" near="Fitzroy" />
        <SearchBar label="Search events" size="lg" near="Fitzroy" />
      </>,
    );
    const header = screen.getByRole("search", { name: "Search the site" });
    expect(header.querySelector("[data-search-bar]")).toHaveClass("@container");
    const headerLocation = within(header).getByRole("button", { name: "Location: Fitzroy" });
    expect(headerLocation.querySelector("[data-location-label]")).toHaveClass("hidden", "@xs:block", "truncate");
    const hero = screen.getByRole("search", { name: "Search events" });
    expect(hero.querySelector("[data-search-bar]")).not.toHaveClass("@container");
    const heroLabel = within(hero).getByRole("button", { name: "Location: Fitzroy" }).querySelector("[data-location-label]");
    expect(heroLabel).not.toHaveClass("hidden");
    expect(heroLabel).toHaveTextContent("Fitzroy");
  });

  it("submits the suburb as `near` from inside the same form", () => {
    render(<SearchBar label="Search events" size="lg" near="Fitzroy" />);
    const form = screen.getByRole("search", { name: "Search events" });
    const near = within(form).getByLabelText("Suburb");
    expect(near).toHaveAttribute("name", "near");
    expect(near).toHaveValue("Fitzroy");
    expect(within(form).getByRole("button", { name: "Location: Fitzroy" })).toBeInTheDocument();
  });
});
