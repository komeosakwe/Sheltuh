// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { DashButton } from "@/components/dashboard/ui/DashButton";
import DashDialog from "@/components/dashboard/ui/DashDialog";
import DashDrawer from "@/components/dashboard/ui/DashDrawer";
import { tabStops } from "@/components/ui/useModalDialog";

/**
 * The dashboard's dialog (Edit ticket type, Message attendees) and drawers (Tickets; the
 * organiser nav): native modal dialogs, named by their titles, closed by the ✕, Escape or the
 * scrim, and mounted only while open. The browser's own modal focus and Escape are checked in
 * e2e/organiser-shell.spec.ts (the nav drawer; nothing renders this dialog or the right drawer in a
 * page yet); jsdom has no modal dialogs or layout, so they're given what a browser does.
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

describe("DashDialog while its action runs (dismissible={false})", () => {
  function Busy({ onClose = () => {} }: { onClose?: () => void }) {
    return (
      <DashDialog open onClose={onClose} title="Message attendees" dismissible={false}>
        <p>Sending…</p>
      </DashDialog>
    );
  }

  it("the ✕ says it's unavailable and does nothing; Escape and the scrim do nothing", () => {
    const onClose = vi.fn();
    render(<Busy onClose={onClose} />);
    const dialog = screen.getByRole("dialog", { name: "Message attendees" });
    const x = screen.getByRole("button", { name: "Close" });
    expect(x).toHaveAttribute("aria-disabled", "true");
    fireEvent.click(x);
    const escape = fireEvent.keyDown(dialog, { key: "Escape" });
    // false: the default (closing) was prevented.
    expect(escape).toBe(false);
    expect(fireEvent(dialog, new Event("cancel", { cancelable: true }))).toBe(false);
    fireEvent.pointerDown(dialog);
    fireEvent.pointerUp(dialog);
    fireEvent.click(dialog);
    expect(onClose).not.toHaveBeenCalled();
    expect(dialog).toHaveAttribute("open");
  });
});

describe("Tab goes round inside (the browser would let it out into its toolbar)", () => {
  // jsdom lays nothing out: count every element as shown.
  beforeEach(() => {
    vi.spyOn(Element.prototype, "getClientRects").mockReturnValue([new DOMRect(0, 0, 10, 10)] as unknown as DOMRectList);
  });
  afterEach(() => vi.restoreAllMocks());

  it("from the last control to the first and back, skipping what Tab can't reach", () => {
    render(
      <DashDialog open onClose={() => {}} title="Edit ticket type" action={<DashButton block>Save changes</DashButton>}>
        <input aria-label="Name" />
        <button type="button" tabIndex={-1}>
          Not a tab stop
        </button>
        <div inert>
          <button type="button">Inert</button>
        </div>
        <input type="radio" name="fee" aria-label="Buyers pay" />
        <input type="radio" name="fee" aria-label="You pay" defaultChecked />
      </DashDialog>,
    );
    const dialog = screen.getByRole("dialog");
    const close = screen.getByRole("button", { name: "Close" });
    const save = screen.getByRole("button", { name: "Save changes" });
    save.focus();
    fireEvent.keyDown(dialog, { key: "Tab" });
    expect(close).toHaveFocus();
    fireEvent.keyDown(dialog, { key: "Tab", shiftKey: true });
    expect(save).toHaveFocus();
    // In the middle, Tab is the browser's own.
    screen.getByRole("textbox", { name: "Name" }).focus();
    expect(fireEvent.keyDown(dialog, { key: "Tab" })).toBe(true);
    expect(tabStops(dialog).map((element) => element.getAttribute("aria-label") ?? element.textContent)).toEqual([
      "Close",
      "Name",
      "You pay",
      "Save changes",
    ]);
  });

  it("in the right drawer too", () => {
    render(
      <DashDrawer open onClose={() => {}} title="Tickets" footer={<DashButton>Done</DashButton>}>
        <p>Rows</p>
      </DashDrawer>,
    );
    const drawer = screen.getByRole("dialog", { name: "Tickets" });
    screen.getByRole("button", { name: "Done" }).focus();
    fireEvent.keyDown(drawer, { key: "Tab" });
    expect(screen.getByRole("button", { name: "Close" })).toHaveFocus();
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
