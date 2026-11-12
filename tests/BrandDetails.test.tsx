// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import SceneMapFilterBar from "@/components/SceneMapFilterBar";
import InitialsAvatar from "@/components/ui/InitialsAvatar";
import { ProgressLoader } from "@/components/ui/ProgressLoader";
import { EVENT_CATEGORIES } from "@/lib/types";

/* Visual-QA corrections (21 Oct 2026) that are about markup, not layout. */

afterEach(cleanup);

describe("InitialsAvatar", () => {
  // The rules' Shape board: avatars stay round.
  it("is a circle; yours is orange with black initials, the rest take turns", () => {
    const { container } = render(
      <>
        <InitialsAvatar name="Mia T." you />
        <InitialsAvatar name="Aisha L." index={0} />
        <InitialsAvatar name="Leo V." index={1} />
        <InitialsAvatar name="Quinn C." index={2} />
      </>,
    );
    const [you, a, b, c] = Array.from(container.querySelectorAll("span[aria-hidden='true']"));
    for (const avatar of [you, a, b, c]) {
      expect(avatar).toHaveClass("rounded-full", "text-xs");
      expect(avatar).not.toHaveClass("rounded-dot");
    }
    expect(you).toHaveClass("bg-signal", "text-signal-foreground");
    expect(a).toHaveClass("bg-foreground");
    expect(b).toHaveClass("bg-card", "border-foreground");
    expect(c).toHaveClass("bg-surface");
  });

  // Review L6: an organiser's initials stand in for its logo in the logo's own shape.
  it("shape='logo': the logo's rounded square, not a circle", () => {
    const { container } = render(<InitialsAvatar name="Northside Noise" shape="logo" />);
    const avatar = container.querySelector("span[aria-hidden='true']");
    expect(avatar).toHaveClass("rounded-dot");
    expect(avatar).not.toHaveClass("rounded-full");
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

describe("Nearby's filters (the rules' Tags & chips board)", () => {
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
    pricing: "all" as const,
    onPricingChange: vi.fn(),
    radius: 25 as const,
    onRadiusChange: vi.fn(),
  };

  it("a set date or dropdown is black (the foreground), with what's chosen showing", () => {
    render(<SceneMapFilterBar {...props} category="art" time="date" specificDate="2026-11-01" pricing="free" />);
    const date = screen.getByLabelText("Choose a date").closest("[data-date-chip]");
    expect(date).toHaveClass("bg-foreground", "text-background", "h-12", "rounded-control", "border-control");
    // The chip shows the day itself (iOS Safari draws no padding or placeholder in a date field).
    expect(date).toHaveTextContent("1 Nov");
    const category = screen.getByRole("combobox", { name: "Category" });
    expect(category).toHaveValue("art");
    expect(category).toHaveClass("bg-foreground", "text-background");
    expect(screen.getByRole("combobox", { name: "Price" })).toHaveValue("free");
    expect(screen.getByRole("button", { name: "Tonight" })).toHaveAttribute("aria-pressed", "false");
  });

  it("unset, they're the page colour with the 1.5px stroke, 48px and radius 8, saying their defaults", () => {
    render(<SceneMapFilterBar {...props} category="all" />);
    const date = screen.getByLabelText("Choose a date").closest("[data-date-chip]");
    expect(date).toHaveClass("bg-background", "border-foreground", "border-control", "rounded-control", "h-12");
    expect(date).not.toHaveClass("bg-foreground");
    expect(date).toHaveTextContent("Date");
    const category = screen.getByRole("combobox", { name: "Category" });
    expect(category).toHaveClass("bg-background");
    expect(category.querySelector("option:checked")).toHaveTextContent("All scenes");
    expect(screen.getByRole("combobox", { name: "Price" }).querySelector("option:checked")).toHaveTextContent("Any price");
    // Prices are in Australian dollars (A$), as everywhere on the site.
    expect(within(screen.getByRole("combobox", { name: "Price" })).getByRole("option", { name: "Under A$25" })).toBeInTheDocument();
  });

  it("Tonight and This weekend are toggle buttons: pressed, black", () => {
    render(<SceneMapFilterBar {...props} time="tonight" />);
    const tonight = screen.getByRole("button", { name: "Tonight" });
    expect(tonight).toHaveAttribute("aria-pressed", "true");
    expect(tonight).toHaveClass("bg-foreground", "text-background");
    const weekend = screen.getByRole("button", { name: "This weekend" });
    expect(weekend).toHaveAttribute("aria-pressed", "false");
    expect(weekend).toHaveClass("bg-background");
  });

  it("the search field: labelled, the proposal's placeholder, 16px typed text, 48px with the stroke", () => {
    render(<SceneMapFilterBar {...props} />);
    const search = screen.getByRole("searchbox", { name: "Search events, venues or suburbs" });
    expect(search).toHaveAttribute("placeholder", "Search events, venues or suburbs");
    expect(search).toHaveClass("text-base", "h-12", "rounded-control", "border-control");
  });

  it("has one location control, Where, and no suburb select of its own", () => {
    render(<SceneMapFilterBar {...props} near="Sydney" />);
    expect(screen.queryByRole("combobox", { name: "Location" })).toBeNull();
    const where = within(document.querySelector("[data-location-field]") as HTMLElement).getByRole("button", {
      name: "Where: Sydney",
    });
    // A field of its own at every width (not the search bar's segment).
    expect(where.className).not.toMatch(/md:border-transparent/);
  });

  it("Distance: Within 5, 10, 25 or 50 km, or All of Australia; black while a radius applies", () => {
    const { rerender } = render(<SceneMapFilterBar {...props} />);
    const distance = screen.getByRole("combobox", { name: "Distance" });
    expect(within(distance).getAllByRole("option").map((option) => option.textContent)).toEqual([
      "Within 5 km",
      "Within 10 km",
      "Within 25 km",
      "Within 50 km",
      "All of Australia",
    ]);
    expect(distance).toHaveValue("25");
    expect(distance).toHaveClass("bg-foreground", "text-background");
    fireEvent.change(distance, { target: { value: "10" } });
    expect(props.onRadiusChange).toHaveBeenLastCalledWith(10);
    rerender(<SceneMapFilterBar {...props} radius="all" />);
    expect(screen.getByRole("combobox", { name: "Distance" })).not.toHaveClass("bg-foreground");
    // No place to measure from yet: no Distance.
    rerender(<SceneMapFilterBar {...props} radius={null} />);
    expect(screen.queryByRole("combobox", { name: "Distance" })).toBeNull();
  });

  it("below lg the filters sit behind a Filters button that says how many are set; one row from lg", () => {
    render(<SceneMapFilterBar {...props} category="art" pricing="free" radius={10} viewToggle={<span>switch</span>} />);
    const button = screen.getByRole("button", { name: "Filters, 3 active" });
    const panel = screen.getByRole("form", { name: "Filter events" });
    expect(button).toHaveAttribute("aria-expanded", "false");
    expect(button).toHaveAttribute("aria-controls", panel.id);
    expect(panel).toHaveClass("hidden", "lg:flex");
    // The List | Map switch is on the Filters button's row.
    expect(button.parentElement).toHaveTextContent("switch");
    fireEvent.click(button);
    expect(button).toHaveAttribute("aria-expanded", "true");
    expect(panel).toHaveClass("flex", "flex-wrap");
    expect(panel).not.toHaveClass("hidden");
  });
});
