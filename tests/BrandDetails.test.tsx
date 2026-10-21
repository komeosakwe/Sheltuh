// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import GoingStack from "@/components/home/GoingStack";
import SceneMapFilterBar from "@/components/SceneMapFilterBar";
import InitialsAvatar from "@/components/ui/InitialsAvatar";
import { ProgressLoader } from "@/components/ui/ProgressLoader";
import { EVENT_CATEGORIES } from "@/lib/types";

/* Visual-QA corrections (21 Oct 2026) that are about markup, not layout. */

afterEach(cleanup);

describe("GoingStack", () => {
  it("with no initials (live), shows the two dots and 'N going', never blank tiles", () => {
    const { container } = render(<GoingStack count={6} />);
    expect(screen.getByText("6 going")).toBeInTheDocument();
    expect(container.querySelectorAll(".size-6")).toHaveLength(0);
    expect(container.querySelector("svg")).not.toBeNull();
  });

  it("with initials (demo), shows one tile per initial, up to three", () => {
    const { container } = render(<GoingStack count={9} initials={["AL", "LV", "MN", "SH"]} />);
    const tiles = container.querySelectorAll(".size-6");
    expect(tiles).toHaveLength(3);
    expect(Array.from(tiles).map((t) => t.textContent)).toEqual(["A", "L", "M"]);
  });

  it("the big stack only shows with initials", () => {
    const { container } = render(<GoingStack size="lg" />);
    expect(container).toBeEmptyDOMElement();
  });
});

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
    onCategoryChange: vi.fn(),
    time: "all" as const,
    onTimeChange: vi.fn(),
    specificDate: "",
    onSpecificDateChange: vi.fn(),
    suburbs: [],
    suburb: "all",
    onSuburbChange: vi.fn(),
    pricing: "all" as const,
    onPricingChange: vi.fn(),
  };

  it("a set date or select is black with the two dots, like a pressed chip; the date's own icon goes light", () => {
    const { container } = render(
      <SceneMapFilterBar {...props} category="art" time="date" specificDate="2026-11-01" pricing="free" />,
    );
    const date = screen.getByLabelText("Choose a date");
    expect(date).toHaveClass("bg-foreground", "scheme-dark");
    expect(screen.getByLabelText("Category")).toHaveClass("bg-foreground");
    expect(screen.getByLabelText("Price")).toHaveClass("bg-foreground");
    expect(container.querySelectorAll("[data-selected-dots]")).toHaveLength(3);
  });

  it("unset, they're white with no dots", () => {
    const { container } = render(<SceneMapFilterBar {...props} category="all" />);
    expect(screen.getByLabelText("Category")).toHaveClass("bg-card");
    expect(screen.getByLabelText("Choose a date")).not.toHaveClass("scheme-dark");
    expect(container.querySelectorAll("[data-selected-dots]")).toHaveLength(0);
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
