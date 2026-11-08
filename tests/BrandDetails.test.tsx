// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import SceneMapFilterBar from "@/components/SceneMapFilterBar";
import InitialsAvatar from "@/components/ui/InitialsAvatar";
import { ProgressLoader } from "@/components/ui/ProgressLoader";
import { EVENT_CATEGORIES } from "@/lib/types";

/* Visual-QA corrections (21 Oct 2026) that are about markup, not layout. */

afterEach(cleanup);

describe("InitialsAvatar", () => {
  it("is a rounded square; yours is orange with black initials, the rest take turns", () => {
    const { container } = render(
      <>
        <InitialsAvatar name="Mia T." you />
        <InitialsAvatar name="Aisha L." index={0} />
        <InitialsAvatar name="Leo V." index={1} />
        <InitialsAvatar name="Quinn C." index={2} />
      </>,
    );
    const [you, a, b, c] = Array.from(container.querySelectorAll("span[aria-hidden='true']"));
    for (const avatar of [you, a, b, c]) expect(avatar).toHaveClass("rounded-dot", "text-xs");
    expect(you).toHaveClass("bg-signal", "text-signal-foreground");
    expect(a).toHaveClass("bg-foreground");
    expect(b).toHaveClass("bg-card", "border-foreground");
    expect(c).toHaveClass("bg-surface");
  });
});

describe("ProgressLoader", () => {
  it("says 'Loading' without a number until there's at least 1%", () => {
    const { container, rerender } = render(<ProgressLoader percent={0} />);
    expect(container).toHaveTextContent(/^Loading$/);
    rerender(<ProgressLoader percent={12} />);
    expect(container).toHaveTextContent("Loading 12%");
    rerender(<ProgressLoader percent={100} done />);
    expect(container).toHaveTextContent("Loaded 100%");
  });
});

describe("the map's filter chips", () => {
  const props = {
    search: "",
    onSearchChange: vi.fn(),
    categories: EVENT_CATEGORIES,
    category: "all" as const,
    onCategoryChange: vi.fn(),
    time: "all" as const,
    onTimeChange: vi.fn(),
    specificDate: "",
    onSpecificDateChange: vi.fn(),
    suburbGroups: [],
    suburb: "all",
    onSuburbChange: vi.fn(),
    pricing: "all" as const,
    onPricingChange: vi.fn(),
  };

  // The owner's mockup (8 Nov 2026): a chosen chip is peach with an orange icon and bold words.
  it("a set date or select is peach and bold, with an orange icon, and shows what's chosen", () => {
    render(<SceneMapFilterBar {...props} category="art" time="date" specificDate="2026-11-01" pricing="free" />);
    const date = screen.getByLabelText("Choose a date").closest("[data-date-chip]");
    expect(date).toHaveClass("bg-peach", "font-bold");
    expect(date?.querySelector("svg")).toHaveClass("text-signal");
    // The chip shows the day itself (iOS Safari draws no padding or placeholder in a date field).
    expect(date).toHaveTextContent("1 Nov");
    const category = screen.getByLabelText("Category").closest("[data-select-chip]");
    expect(category).toHaveClass("bg-peach", "font-bold");
    expect(category).toHaveTextContent("Art");
    const price = screen.getByLabelText("Price").closest("[data-select-chip]");
    expect(price).toHaveClass("bg-peach");
    expect(price).toHaveTextContent("Free");
    expect(screen.getByRole("button", { name: "Tonight" })).toHaveAttribute("aria-pressed", "false");
  });

  it("unset, they're ivory pills with a hairline, black icons and their default words", () => {
    render(<SceneMapFilterBar {...props} category="all" />);
    const date = screen.getByLabelText("Choose a date").closest("[data-date-chip]");
    expect(date).toHaveClass("bg-panel", "border-soft-line", "rounded-full", "h-8");
    expect(date).not.toHaveClass("bg-peach");
    expect(date).toHaveTextContent("Date");
    const category = screen.getByLabelText("Category").closest("[data-select-chip]");
    expect(category).toHaveClass("bg-panel");
    expect(category).toHaveTextContent("All scenes");
    expect(screen.getByLabelText("Price").closest("[data-select-chip]")).toHaveTextContent("Any price");
    expect(category?.querySelector("svg")).toHaveClass("text-foreground");
  });

  it("Tonight and This weekend are toggle buttons: pressed, peach", () => {
    render(<SceneMapFilterBar {...props} time="tonight" />);
    const tonight = screen.getByRole("button", { name: "Tonight" });
    expect(tonight).toHaveAttribute("aria-pressed", "true");
    expect(tonight).toHaveClass("bg-peach", "font-bold");
    const weekend = screen.getByRole("button", { name: "This weekend" });
    expect(weekend).toHaveAttribute("aria-pressed", "false");
    expect(weekend).toHaveClass("bg-panel", "font-medium");
  });

  it("the search field: labelled, the mockup's placeholder, 16px typed text on phones", () => {
    render(<SceneMapFilterBar {...props} />);
    const search = screen.getByRole("searchbox", { name: "Search events, venues or suburbs" });
    expect(search).toHaveAttribute("placeholder", "Search events, venues or suburbs");
    expect(search).toHaveClass("text-base", "rounded-2xl", "placeholder:text-field");
  });

  it("the location field shows the chosen suburb over its native select", () => {
    const suburbGroups = [{ state: "VIC" as const, label: "Victoria", suburbs: [{ value: "Fitzroy", label: "Fitzroy, VIC" }] }];
    const { rerender } = render(<SceneMapFilterBar {...props} suburbGroups={suburbGroups} />);
    const field = screen.getByRole("combobox", { name: "Location" }).closest("[data-location-field]");
    expect(field).toHaveTextContent("All of Australia");
    rerender(<SceneMapFilterBar {...props} suburbGroups={suburbGroups} suburb="Fitzroy" />);
    expect(field).toHaveTextContent("Fitzroy, VIC");
  });

  it("is one sideways-scrolling row on phones, wrapping from 640px", () => {
    render(<SceneMapFilterBar {...props} category="all" />);
    expect(screen.getByRole("form", { name: "Filter events" })).toHaveClass(
      "flex-nowrap",
      "overflow-x-auto",
      "sm:flex-wrap",
      "sm:overflow-visible",
    );
  });
});
