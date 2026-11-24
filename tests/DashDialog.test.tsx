// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { DashButton } from "@/components/dashboard/ui/DashButton";
import DashDialog from "@/components/dashboard/ui/DashDialog";
import DashDrawer from "@/components/dashboard/ui/DashDrawer";

/**
 * The dashboard's dialog (Edit ticket type, Message attendees) and drawers (Tickets; the
 * organiser nav): native modal dialogs, named by their titles, closed by the ✕, Escape or the
 * scrim, and mounted only while open. The browser's focus trap and Escape are checked in
 * e2e/organiser-shell.spec.ts; jsdom has no modal dialogs, so they're given what a browser does.
 */

beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement) {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close = function close(this: HTMLDialogElement) {
    this.removeAttribute("open");
    this.dispatchEvent(new Event("close"));
  };
});

afterEach(cleanup);

function DialogHarness({ onClose = () => {} }: { onClose?: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Edit
      </button>
      <DashDialog
        open={open}
        onClose={() => {
          setOpen(false);
          onClose();
        }}
        title="Edit ticket type"
        subtitle="Changes apply to new orders."
        action={<DashButton variant="dark" block>Save</DashButton>}
      >
        <label>
          Name
          <input defaultValue="Second release" />
        </label>
      </DashDialog>
    </>
  );
}

describe("DashDialog", () => {
  it("shows nothing until opened, then a dialog named by its title and described by its line", () => {
    render(<DialogHarness />);
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    const dialog = screen.getByRole("dialog", { name: "Edit ticket type" });
    expect(dialog).toHaveAccessibleDescription("Changes apply to new orders.");
    expect(dialog).toHaveClass("w-120", "rounded-card", "backdrop:bg-ink/60");
    expect(screen.getByRole("textbox", { name: "Name" })).toHaveValue("Second release");
    expect(screen.getByRole("button", { name: "Save" })).toHaveClass("w-full");
  });

  it("the ✕ closes it and tells its owner, and the page can scroll again", () => {
    const onClose = vi.fn();
    render(<DialogHarness onClose={onClose} />);
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    expect(document.documentElement.style.overflow).toBe("hidden");
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.documentElement.style.overflow).toBe("");
  });

  it("a press that starts and ends on the scrim closes it; a drag from inside doesn't", () => {
    const onClose = vi.fn();
    render(<DialogHarness onClose={onClose} />);
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    const dialog = screen.getByRole("dialog");
    const field = screen.getByRole("textbox");
    fireEvent.pointerDown(field);
    fireEvent.pointerUp(dialog);
    fireEvent.click(dialog);
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.pointerDown(dialog);
    fireEvent.pointerUp(dialog);
    fireEvent.click(dialog);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe("DashDrawer", () => {
  it("right: the Tickets drawer, titled, with its ✕ and its footer", () => {
    const onClose = vi.fn();
    render(
      <DashDrawer
        open
        onClose={onClose}
        title="Tickets"
        subtitle="Set up who can buy, how much and when."
        footer={<DashButton variant="primary">Done</DashButton>}
      >
        <p>Second release</p>
      </DashDrawer>,
    );
    const drawer = screen.getByRole("dialog", { name: "Tickets" });
    expect(drawer).toHaveAttribute("data-dash-drawer", "right");
    expect(drawer).toHaveClass("w-130", "ml-auto", "h-dvh");
    expect(drawer).toHaveAccessibleDescription("Set up who can buy, how much and when.");
    expect(screen.getByRole("heading", { level: 2, name: "Tickets" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Done" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(onClose).toHaveBeenCalled();
  });

  it("left: a bare black panel named by its label, its content the caller's", () => {
    render(
      <DashDrawer open side="left" label="Organiser menu" name="organiser-drawer" onClose={() => {}}>
        <nav aria-label="Organiser">x</nav>
      </DashDrawer>,
    );
    const drawer = screen.getByRole("dialog", { name: "Organiser menu" });
    expect(drawer).toHaveAttribute("data-surface", "ink");
    expect(drawer).toHaveAttribute("data-organiser-drawer");
    expect(drawer).toHaveClass("w-66", "backdrop:bg-ink/50");
    expect(screen.queryByRole("button", { name: "Close" })).toBeNull();
    expect(screen.getByRole("navigation", { name: "Organiser" })).toBeInTheDocument();
  });

  it("mounts its content only while open", () => {
    const { rerender } = render(
      <DashDrawer open={false} side="left" label="Organiser menu" onClose={() => {}}>
        <p>Inside</p>
      </DashDrawer>,
    );
    expect(screen.queryByText("Inside")).toBeNull();
    rerender(
      <DashDrawer open side="left" label="Organiser menu" onClose={() => {}}>
        <p>Inside</p>
      </DashDrawer>,
    );
    expect(screen.getByText("Inside")).toBeInTheDocument();
  });
});
