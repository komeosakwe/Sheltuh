// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import EventBrowser from "@/components/EventBrowser";
import EventFilterBar from "@/components/EventFilterBar";
import { sampleEvents } from "@/lib/sample-events";
import { EVENT_CATEGORIES } from "@/lib/types";

afterEach(cleanup);

function renderBar(overrides: Partial<Parameters<typeof EventFilterBar>[0]> = {}) {
  const props = {
    categories: EVENT_CATEGORIES,
    category: "all" as const,
    onCategoryChange: vi.fn(),
    pricing: "all" as const,
    onPricingChange: vi.fn(),
    onOrAfter: "",
    onOnOrAfterChange: vi.fn(),
    hasActiveFilters: false,
    onReset: vi.fn(),
    ...overrides,
  };
  render(<EventFilterBar {...props} />);
  return props;
}

describe("EventFilterBar — phone disclosure", () => {
  it("starts closed and toggles aria-expanded on the panel it controls", () => {
    renderBar();
    const toggle = screen.getByRole("button", { name: "Filters" });
    const panel = document.getElementById("event-filters");
    expect(toggle).toHaveAttribute("aria-controls", "event-filters");
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(panel).toHaveClass("hidden", "sm:grid");

    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(panel).toHaveClass("grid");
    expect(panel).not.toHaveClass("hidden");

    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(panel).toHaveClass("hidden");
  });

  it("keeps the labelled controls in the form (the desktop layout and e2e rely on them)", () => {
    renderBar();
    const form = screen.getByRole("form", { name: "Filter events" });
    expect(form).toContainElement(screen.getByLabelText("Category"));
    expect(form).toContainElement(screen.getByLabelText("On or after"));
    expect(screen.getByRole("radio", { name: "Free" })).toBeInTheDocument();
  });

  it("counts the active filters in the toggle label", () => {
    renderBar({ category: "art", onOrAfter: "2026-10-01", hasActiveFilters: true });
    const toggle = screen.getByRole("button", { name: "Filters, 2 active" });
    expect(toggle).toHaveTextContent("Filters · 2");
  });
});

describe("EventFilterBar inside the demo feed", () => {
  it("updates the count as filters change and resets them all", () => {
    render(<EventBrowser events={sampleEvents} categories={EVENT_CATEGORIES} />);
    expect(screen.getByRole("button", { name: "Filters" })).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Category"), { target: { value: "art" } });
    fireEvent.click(screen.getByRole("radio", { name: "Free" }));
    const toggle = screen.getByRole("button", { name: "Filters, 2 active" });
    expect(screen.getByText(/^Showing \d+ of \d+ events$/)).toBeInTheDocument();

    fireEvent.click(toggle);
    fireEvent.click(screen.getAllByRole("button", { name: "Reset filters" })[0]);
    expect(screen.getByRole("button", { name: "Filters" })).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByLabelText("Category")).toHaveValue("all");
    expect(screen.getByRole("radio", { name: "All" })).toBeChecked();
    expect(screen.getByText(`Showing ${sampleEvents.length} of ${sampleEvents.length} events`)).toBeInTheDocument();
  });
});
