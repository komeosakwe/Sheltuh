// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DashButton, DashButtonLink, dashButtonClass } from "@/components/dashboard/ui/DashButton";
import { DashChip, DashChipLink } from "@/components/dashboard/ui/DashChip";
import { DashField, DashTextareaField } from "@/components/dashboard/ui/DashField";
import DashSelect from "@/components/dashboard/ui/DashSelect";
import ProgressBar from "@/components/dashboard/ui/ProgressBar";
import SettingRow from "@/components/dashboard/ui/SettingRow";
import StatCard from "@/components/dashboard/ui/StatCard";
import StatusPill from "@/components/dashboard/ui/StatusPill";
import Toggle from "@/components/dashboard/ui/Toggle";

/**
 * The organiser dashboard's shared controls (Latte's dashboard frames, Components 465:7337):
 * their roles, names and states, which carry the meaning (never the colour alone).
 */

afterEach(cleanup);

describe("DashButton", () => {
  it("is the site's .btn at the dashboard's 40px Label/Tag size, in its three looks", () => {
    expect(dashButtonClass("primary")).toContain("btn-signal");
    expect(dashButtonClass("dark")).toContain("btn-solid");
    expect(dashButtonClass("outline")).toContain("btn-outline");
    for (const variant of ["primary", "dark", "outline"] as const) {
      expect(dashButtonClass(variant)).toEqual(expect.stringContaining("min-h-10"));
      expect(dashButtonClass(variant)).toEqual(expect.stringContaining("label-tag"));
    }
    // The dialogs' call to action: full width, 48px, Label/Button (no Label/Tag).
    expect(dashButtonClass("dark", "", true)).toContain("w-full");
    expect(dashButtonClass("dark", "", true)).not.toContain("label-tag");
  });

  it("acts as a button, keeps focus and ignores clicks while busy", () => {
    const onClick = vi.fn();
    const { rerender } = render(<DashButton onClick={onClick}>Create event</DashButton>);
    const button = screen.getByRole("button", { name: "Create event" });
    expect(button).toHaveAttribute("type", "button");
    fireEvent.click(button);
    expect(onClick).toHaveBeenCalledTimes(1);
    rerender(
      <DashButton onClick={onClick} busy>
        Create event
      </DashButton>,
    );
    expect(button).toHaveAttribute("aria-disabled", "true");
    expect(button).not.toBeDisabled();
    fireEvent.click(button);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("is a link when it goes somewhere", () => {
    render(<DashButtonLink href="/dashboard/new">Create event</DashButtonLink>);
    expect(screen.getByRole("link", { name: "Create event" })).toHaveAttribute("href", "/dashboard/new");
  });
});

describe("DashChip", () => {
  it("says whether a filter is on with aria-pressed, filled when on", () => {
    const onClick = vi.fn();
    render(
      <>
        <DashChip pressed onClick={onClick}>
          All · 6
        </DashChip>
        <DashChip pressed={false}>Live · 3</DashChip>
      </>,
    );
    const all = screen.getByRole("button", { name: "All · 6" });
    const live = screen.getByRole("button", { name: "Live · 3" });
    expect(all).toHaveAttribute("aria-pressed", "true");
    expect(all).toHaveClass("bg-foreground", "text-background", "min-h-8");
    expect(live).toHaveAttribute("aria-pressed", "false");
    expect(live).toHaveClass("bg-background", "border-foreground");
    fireEvent.click(all);
    expect(onClick).toHaveBeenCalled();
  });

  it("marks the tab you're on with aria-current when the chips are links", () => {
    render(
      <>
        <DashChipLink href="/dashboard/e1" current>
          Edit
        </DashChipLink>
        <DashChipLink href="/dashboard/e1/insights" current={false}>
          Insights
        </DashChipLink>
      </>,
    );
    expect(screen.getByRole("link", { name: "Edit" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "Insights" })).not.toHaveAttribute("aria-current");
  });
});

describe("StatusPill", () => {
  it.each([
    ["green", "pop-up"],
    ["red", "theatre"],
    ["lilac", "live-music"],
    ["yellow", "fashion"],
    ["grey", "neutral"],
  ] as const)("the %s tone is the %s tag tint", (tone, tag) => {
    render(<StatusPill tone={tone}>Live</StatusPill>);
    expect(screen.getByText("Live")).toHaveAttribute("data-tag", tag);
  });

  it("white and black have no tint of their own", () => {
    render(
      <>
        <StatusPill tone="white">↑ 13%</StatusPill>
        <StatusPill tone="black">Owner</StatusPill>
      </>,
    );
    expect(screen.getByText("Owner")).toHaveClass("bg-foreground", "text-background");
    expect(screen.getByText("Owner")).not.toHaveAttribute("data-tag");
    expect(screen.getByText("↑ 13%")).toHaveClass("bg-card");
  });

  it("reads its words in place of a symbol", () => {
    const { container } = render(
      <StatusPill tone="green" srText="Up 15% on the week before">
        ↑ 15%
      </StatusPill>,
    );
    expect(container.textContent).toContain("Up 15% on the week before");
    expect(screen.getByText("↑ 15%")).toHaveAttribute("aria-hidden", "true");
  });
});

describe("StatCard", () => {
  it("plain: the number over its label, centred, with a subtle edge", () => {
    const { container } = render(<StatCard value="+86" label="Tickets this week" />);
    const card = container.querySelector("[data-stat-card]");
    expect(card).toHaveAttribute("data-stat-card", "plain");
    expect(card).toHaveClass("border-surface-border", "rounded-card", "items-center");
    expect(card?.textContent).toBe("+86Tickets this week");
    expect(screen.getByText("Tickets this week")).toHaveClass("text-muted");
  });

  it("a tone fills it (orange is the signal fill with black words); Insights' stats are radius 8", () => {
    const { container } = render(
      <>
        <StatCard tone="signal" value="86" label="Tickets" />
        <StatCard tone="lilac" value="3" label="Transfers" />
        <StatCard value="595" label="Page views" radius="control" />
      </>,
    );
    const [orange, lilac, insight] = Array.from(container.querySelectorAll("[data-stat-card]"));
    expect(orange).toHaveClass("bg-signal", "text-signal-foreground");
    expect(lilac).toHaveAttribute("data-tag", "live-music");
    expect(screen.getByText("Transfers")).not.toHaveClass("text-muted");
    expect(insight).toHaveClass("rounded-control");
  });
});

describe("ProgressBar", () => {
  it("is a named progressbar with a label, clamped to its range", () => {
    render(<ProgressBar value={86} max={120} label="Tickets sold" />);
    const bar = screen.getByRole("progressbar", { name: "Tickets sold" });
    expect(bar).toHaveAttribute("aria-valuenow", "86");
    expect(bar).toHaveAttribute("aria-valuemax", "120");
    expect(bar.querySelector<HTMLElement>("[data-progress-fill]")?.style.width).toMatch(/^71\.66/);
    cleanup();
    render(<ProgressBar value={150} max={120} label="Tickets sold" />);
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "120");
  });

  it("is hidden decoration without a label, and empty when nothing is on sale", () => {
    const { container } = render(<ProgressBar value={0} max={0} />);
    expect(screen.queryByRole("progressbar")).toBeNull();
    const bar = container.querySelector("[data-progress-bar]");
    expect(bar).toHaveAttribute("aria-hidden", "true");
    expect(container.querySelector<HTMLElement>("[data-progress-fill]")?.style.width).toBe("0%");
  });
});

describe("Toggle and SettingRow", () => {
  function Controlled({ initial = false }: { initial?: boolean }) {
    const [on, setOn] = useState(initial);
    return <SettingRow title="Daily summary" description="One email each morning" checked={on} onCheckedChange={setOn} />;
  }

  it("is a switch named by its row's title and described by its line, toggled by a press", () => {
    render(<Controlled />);
    const toggle = screen.getByRole("switch", { name: "Daily summary" });
    expect(toggle).toHaveAccessibleDescription("One email each morning");
    expect(toggle).toHaveAttribute("aria-checked", "false");
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-checked", "true");
    expect(toggle).toHaveAttribute("data-toggle", "on");
    expect(toggle).toHaveClass("bg-signal");
  });

  it("the off track has an edge you can see (the frame's grey alone is 1.1:1)", () => {
    render(<Toggle checked={false} onCheckedChange={() => {}} aria-label="New orders" />);
    expect(screen.getByRole("switch", { name: "New orders" })).toHaveClass("ring-1", "ring-muted");
  });

  it("does nothing when disabled", () => {
    const change = vi.fn();
    render(<Toggle checked onCheckedChange={change} disabled aria-label="New orders" />);
    fireEvent.click(screen.getByRole("switch"));
    expect(change).not.toHaveBeenCalled();
  });
});

describe("DashField", () => {
  it("labels its input, and reads its hint and error with it", () => {
    render(<DashField label="Name" hint="Shown on your events." error="Enter a name." defaultValue="" />);
    const input = screen.getByRole("textbox", { name: "Name" });
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(input).toHaveAccessibleDescription("Enter a name. Shown on your events.");
    expect(input).toHaveClass("min-h-12", "border-control", "border-foreground", "rounded-control");
  });

  it("keeps a description the caller adds", () => {
    render(
      <>
        <p id="extra">Extra</p>
        <DashField label="Name" aria-describedby="extra" hint="Hint" />
      </>,
    );
    expect(screen.getByRole("textbox", { name: "Name" })).toHaveAccessibleDescription("Extra Hint");
  });

  it("a dialog's field has the Body/S Strong label, 4px over its input", () => {
    const { container } = render(<DashField labelStyle="dialog" label="Price" defaultValue="A$25.94" />);
    expect(screen.getByText("Price")).toHaveClass("body-s", "font-semibold");
    expect(screen.getByText("Price")).not.toHaveClass("text-muted");
    expect(container.querySelector("[data-dash-field]")).toHaveClass("gap-1");
    expect(screen.getByRole("textbox", { name: "Price" })).toHaveValue("A$25.94");
  });

  it("has a multi-line version for longer text", () => {
    render(<DashTextareaField label="About" defaultValue="Warehouse nights." />);
    const about = screen.getByRole("textbox", { name: "About" });
    expect(about.tagName).toBe("TEXTAREA");
    expect(about).not.toHaveAttribute("aria-invalid");
  });
});

describe("DashSelect", () => {
  it("is a native select named by its label (shown or not)", () => {
    const change = vi.fn();
    render(
      <DashSelect
        label="Period"
        hideLabel
        value="month"
        onChange={(event) => change(event.target.value)}
        options={[
          { value: "week", label: "This week" },
          { value: "month", label: "This month" },
        ]}
      />,
    );
    const select = screen.getByRole("combobox", { name: "Period" });
    expect(select).toHaveValue("month");
    expect(screen.getByText("Period")).toHaveClass("sr-only");
    fireEvent.change(select, { target: { value: "week" } });
    expect(change).toHaveBeenCalledWith("week");
  });
});
