// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import FilterDropdown from "@/components/ui/FilterDropdown";

/*
 * FilterDropdown (the rules' Tags & chips board, "Filters"): a native select
 * dressed as a filter, so the browser's own picker, keyboard and screen
 * reader behaviour are kept. Default: the page colour and the 1.5px stroke;
 * hover: cream; active: foreground-filled.
 */
afterEach(cleanup);

function Price({ value, onChange = () => {} }: { value: string; onChange?: (value: string) => void }) {
  return (
    <FilterDropdown label="Price" active={value !== "any"} value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="any">Any price</option>
      <option value="free">Free</option>
      <option value="paid">Paid</option>
    </FilterDropdown>
  );
}

describe("FilterDropdown", () => {
  it("is a native select, named by its label, showing the chosen option", () => {
    render(<Price value="any" />);
    const select = screen.getByRole("combobox", { name: "Price" });
    expect(select.tagName).toBe("SELECT");
    expect(select).toHaveDisplayValue("Any price");
    // The name stays "Price" whatever is picked; the label wraps the select (no id needed).
    expect(select.closest("label")).toHaveTextContent(/^Price/);
  });

  it("calls back with the chosen value", () => {
    const onChange = vi.fn();
    render(<Price value="any" onChange={onChange} />);
    fireEvent.change(screen.getByRole("combobox", { name: "Price" }), { target: { value: "free" } });
    expect(onChange).toHaveBeenCalledWith("free");
  });

  it("default: the page colour, the 1.5px foreground stroke, radius 8 and 48px tall; cream on hover", () => {
    render(<Price value="any" />);
    const select = screen.getByRole("combobox", { name: "Price" });
    expect(select).toHaveClass("h-12", "rounded-control", "border-control", "border-foreground", "bg-background", "text-foreground", "hover:bg-hover", "label-button");
    expect(select).not.toHaveAttribute("data-active");
    expect(select).not.toHaveClass("bg-foreground");
  });

  it("active: foreground-filled with the page colour's label (black in Light, white in Dark), chevron too", () => {
    const { container } = render(<Price value="free" />);
    const select = screen.getByRole("combobox", { name: "Price" });
    expect(select).toHaveAttribute("data-active");
    expect(select).toHaveClass("bg-foreground", "text-background");
    expect(select).not.toHaveClass("hover:bg-hover");
    const chevron = container.querySelector("svg");
    expect(chevron).toHaveAttribute("aria-hidden", "true");
    expect(chevron).toHaveClass("pointer-events-none", "text-background");
  });

  it("is as wide as its widest option, whichever is chosen: a hidden sizer holds every option's words", () => {
    const { container } = render(<Price value="free" />);
    const sizer = container.querySelector("[data-filter-sizer]");
    expect(sizer).toHaveAttribute("aria-hidden", "true");
    expect(sizer).toHaveClass("invisible", "h-0", "label-button", "pr-10", "pl-4", "border-control");
    expect([...(sizer?.children ?? [])].map((child) => child.textContent)).toEqual(["Any price", "Free", "Paid"]);
    // The sizer shares the select's grid cell, and isn't read: the name is still just "Price".
    expect(screen.getByRole("combobox", { name: "Price" })).toHaveClass("col-start-1", "row-start-1", "w-full");
  });

  it("sizes from mapped options and their words", () => {
    const options = [
      { value: "all", label: "All categories" },
      { value: "live-music", label: "Live music" },
    ];
    const { container } = render(
      <FilterDropdown label="Category" active={false} value="all" onChange={() => {}}>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </FilterDropdown>,
    );
    expect([...(container.querySelector("[data-filter-sizer]")?.children ?? [])].map((child) => child.textContent)).toEqual([
      "All categories",
      "Live music",
    ]);
  });

  it("keeps the browser's own focus ring (no outline override)", () => {
    render(<Price value="any" />);
    expect(screen.getByRole("combobox", { name: "Price" }).className).not.toMatch(/outline-none|focus.*outline-(?:signal|0)/);
  });
});
