// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { useState } from "react";
import Sheet, { SheetRow, SheetRows } from "@/components/ui/Sheet";

// jsdom has no modal dialogs: give <dialog> what a browser would (open, close and its event).
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

function Harness({ onRow = () => {} }: { onRow?: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Open
      </button>
      <Sheet open={open} onClose={() => setOpen(false)} title="Add to calendar" subtitle="Here & Now · Sat 14 Nov" dismissLabel="Cancel">
        <SheetRows>
          <SheetRow title="Google Calendar" mark="›" href="https://calendar.google.com/x" newTab />
          <SheetRow title="Apple Calendar" sub="Downloads an .ics file" mark="›" href="/events/here-now/calendar.ics" download="here-now.ics" />
          <SheetRow title="Event page" mark="›" href="/events/here-now" />
          <SheetRow title="Copy address" onClick={onRow} />
        </SheetRows>
      </Sheet>
    </>
  );
}

describe("Sheet", () => {
  it("is closed until opened, then a modal dialog named by its title, with the subtitle", () => {
    render(<Harness />);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.queryByText("Google Calendar")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Open" }));
    const dialog = screen.getByRole("dialog", { name: "Add to calendar" });
    expect(dialog).toHaveAttribute("open");
    expect(within(dialog).getByRole("heading", { level: 2, name: "Add to calendar" })).toBeInTheDocument();
    expect(within(dialog).getByText("Here & Now · Sat 14 Nov")).toBeInTheDocument();
  });

  it("is a bottom sheet on phones (pinned to the bottom, handle, dismiss button) and a 480 dialog with a ✕ from 768", () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "Open" }));
    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveClass("mt-auto", "w-full", "rounded-t-sheet", "md:m-auto", "md:w-120", "md:rounded-sheet", "max-h-dvh", "overflow-y-auto");
    expect(within(dialog).getByRole("button", { name: "Cancel" })).toHaveClass("btn-outline", "w-full", "md:hidden");
    expect(within(dialog).getByRole("button", { name: "Close" })).toHaveClass("max-md:hidden", "size-11");
  });

  it("closes from the ✕, the dismiss button and a press on the scrim, and tells its owner", () => {
    render(<Harness />);
    const openIt = () => fireEvent.click(screen.getByRole("button", { name: "Open" }));
    openIt();
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    openIt();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    openIt();
    // A press inside the sheet doesn't close it; one on the dialog element itself (the scrim) does.
    fireEvent.click(screen.getByText("Here & Now · Sat 14 Nov"));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("dialog"));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("closes when the browser closes it (Escape fires the dialog's close event)", () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "Open" }));
    const dialog = screen.getByRole("dialog") as HTMLDialogElement;
    dialog.close();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("stops the page behind from scrolling while open, and restores it after", () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "Open" }));
    expect(document.documentElement.style.overflow).toBe("hidden");
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(document.documentElement.style.overflow).toBe("");
  });

  it("rows: links navigate (new tab said in words, downloads named), buttons act", () => {
    const onRow = vi.fn();
    render(<Harness onRow={onRow} />);
    fireEvent.click(screen.getByRole("button", { name: "Open" }));
    const google = screen.getByRole("link", { name: "Google Calendar (opens in a new tab)" });
    expect(google).toHaveAttribute("target", "_blank");
    expect(google).toHaveAttribute("rel", "noopener noreferrer");
    const apple = screen.getByRole("link", { name: /Apple Calendar/ });
    expect(apple).toHaveAttribute("download", "here-now.ics");
    expect(apple).toHaveTextContent("Downloads an .ics file");
    expect(apple).not.toHaveAttribute("target");
    expect(screen.getByRole("link", { name: "Event page" })).toHaveAttribute("href", "/events/here-now");
    fireEvent.click(screen.getByRole("button", { name: "Copy address" }));
    expect(onRow).toHaveBeenCalledTimes(1);
    // The marks are decoration: the names above don't include them.
    expect(screen.getAllByText("›")[0]).toHaveAttribute("aria-hidden", "true");
  });
});
