// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import DashMenu, { type DashMenuItem } from "@/components/dashboard/ui/DashMenu";

/**
 * The dashboard's menu button (Latte's More ··· menu 499:21194 and "Who can find this event?"
 * 499:20969): the ARIA menu-button pattern, keyboard first.
 */

afterEach(cleanup);

function actions(onSelect = vi.fn()): DashMenuItem[] {
  return [
    { key: "message", label: "Message attendees", onSelect: () => onSelect("message") },
    { key: "checkin", label: "Check in guests", href: "/dashboard/e1/check-in" },
    { key: "duplicate", label: "Duplicate event", onSelect: () => onSelect("duplicate") },
    { key: "pause", label: "Pause ticket sales", disabled: true },
    { key: "cancel", label: "Cancel event", description: "Refunds everyone", tone: "danger", onSelect: () => onSelect("cancel") },
  ];
}

function renderMore(onSelect = vi.fn()) {
  render(<DashMenu label="More ···" triggerLabel="More actions" items={actions(onSelect)} />);
  return screen.getByRole("button", { name: "More actions" });
}

describe("DashMenu", () => {
  it("is closed until pressed; the button says it opens a menu", () => {
    const trigger = renderMore();
    expect(trigger).toHaveAttribute("aria-haspopup", "menu");
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("menu")).toBeNull();
    fireEvent.click(trigger);
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    const menu = screen.getByRole("menu", { name: "More actions" });
    expect(trigger).toHaveAttribute("aria-controls", menu.id);
    expect(screen.getAllByRole("menuitem").map((item) => item.textContent)).toEqual([
      "Message attendees",
      "Check in guests",
      "Duplicate event",
      "Pause ticket sales",
      "Cancel eventRefunds everyone",
    ]);
  });

  it("opens on ↓ at the first row and on ↑ at the last; arrows wrap and skip disabled rows", () => {
    const trigger = renderMore();
    fireEvent.keyDown(trigger, { key: "ArrowDown" });
    expect(screen.getByRole("menuitem", { name: "Message attendees" })).toHaveFocus();
    const menu = screen.getByRole("menu");
    fireEvent.keyDown(menu, { key: "ArrowUp" });
    expect(screen.getByRole("menuitem", { name: /Cancel event/ })).toHaveFocus();
    fireEvent.keyDown(menu, { key: "ArrowUp" });
    // Pause is disabled: skipped.
    expect(screen.getByRole("menuitem", { name: "Duplicate event" })).toHaveFocus();
    fireEvent.keyDown(menu, { key: "Home" });
    expect(screen.getByRole("menuitem", { name: "Message attendees" })).toHaveFocus();
    fireEvent.keyDown(menu, { key: "End" });
    expect(screen.getByRole("menuitem", { name: /Cancel event/ })).toHaveFocus();
    fireEvent.keyDown(menu, { key: "ArrowDown" });
    expect(screen.getByRole("menuitem", { name: "Message attendees" })).toHaveFocus();
    // A letter: the next row starting with it.
    fireEvent.keyDown(menu, { key: "d" });
    expect(screen.getByRole("menuitem", { name: "Duplicate event" })).toHaveFocus();
    cleanup();

    const again = renderMore();
    fireEvent.keyDown(again, { key: "ArrowUp" });
    expect(screen.getByRole("menuitem", { name: /Cancel event/ })).toHaveFocus();
  });

  it("Escape closes it and puts focus back on the button", () => {
    const trigger = renderMore();
    fireEvent.keyDown(trigger, { key: "Enter" });
    fireEvent.keyDown(screen.getByRole("menu"), { key: "Escape" });
    expect(screen.queryByRole("menu")).toBeNull();
    expect(trigger).toHaveFocus();
    expect(trigger).toHaveAttribute("aria-expanded", "false");
  });

  it("picking a row closes it, back on the button, then acts", () => {
    const onSelect = vi.fn();
    const trigger = renderMore(onSelect);
    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole("menuitem", { name: "Duplicate event" }));
    expect(onSelect).toHaveBeenCalledWith("duplicate");
    expect(screen.queryByRole("menu")).toBeNull();
    expect(trigger).toHaveFocus();
  });

  it("a disabled row says so and does nothing; a row that goes somewhere is a link", () => {
    const onSelect = vi.fn();
    const trigger = renderMore(onSelect);
    fireEvent.click(trigger);
    const pause = screen.getByRole("menuitem", { name: "Pause ticket sales" });
    expect(pause).toHaveAttribute("aria-disabled", "true");
    fireEvent.click(pause);
    expect(onSelect).not.toHaveBeenCalled();
    expect(screen.getByRole("menu")).toBeInTheDocument();
    const checkIn = screen.getByRole("menuitem", { name: "Check in guests" });
    expect(checkIn.tagName).toBe("A");
    expect(checkIn).toHaveAttribute("href", "/dashboard/e1/check-in");
    // The destructive row is in the danger colour, its line under it.
    expect(screen.getByText("Cancel event")).toHaveClass("text-danger");
    expect(screen.getByText("Refunds everyone")).toHaveClass("text-muted");
  });

  it("a press outside closes it", () => {
    const trigger = renderMore();
    fireEvent.click(trigger);
    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("a radio menu checks the chosen option and opens on it", () => {
    const choose = vi.fn();
    render(
      <DashMenu
        radio
        label="Public"
        menuLabel="Who can find this event?"
        width="lg"
        items={[
          { key: "public", label: "Public", description: "Shown in Sheltüh discovery, search and categories", checked: true },
          { key: "unlisted", label: "Unlisted", description: "Only people with the link can see and buy", onSelect: () => choose("unlisted") },
        ]}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Public" }));
    const menu = screen.getByRole("menu", { name: "Who can find this event?" });
    expect(menu).toHaveClass("w-84");
    const options = screen.getAllByRole("menuitemradio");
    expect(options.map((option) => option.getAttribute("aria-checked"))).toEqual(["true", "false"]);
    expect(options[0]).toHaveFocus();
    expect(options[0]).toHaveClass("bg-hover");
    fireEvent.click(options[1]);
    expect(choose).toHaveBeenCalledWith("unlisted");
  });
});
