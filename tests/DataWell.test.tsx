// @vitest-environment jsdom
import { act, cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import DataWell, { type DataColumn } from "@/components/dashboard/ui/DataWell";
import StatusPill from "@/components/dashboard/ui/StatusPill";

/** "Org / Table" (Latte's Orders, Attendees and Payouts tables): a real, named table in a well. */

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/** A ResizeObserver that reports at once, and a well `scrollWidth` wider (or not) than it is. */
function stubOverflow(overflowing: boolean) {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      constructor(private readonly callback: () => void) {}
      observe() {
        this.callback();
      }
      disconnect() {}
    },
  );
  vi.spyOn(HTMLElement.prototype, "scrollWidth", "get").mockReturnValue(overflowing ? 900 : 300);
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(300);
}

interface Order {
  reference: string;
  event: string;
  buyer: string;
  tickets: number;
  amount: string;
  status: string;
}

const COLUMNS: DataColumn<Order>[] = [
  { key: "order", header: "Order", cell: (row) => `#${row.reference}`, type: "code", rowHeader: true },
  { key: "event", header: "Event", cell: (row) => row.event, hideBelow: "md" },
  { key: "buyer", header: "Buyer", cell: (row) => row.buyer },
  { key: "tickets", header: "Tickets", cell: (row) => row.tickets, align: "end" },
  { key: "amount", header: "Amount", cell: (row) => row.amount, align: "end" },
  { key: "status", header: "Status", cell: (row) => <StatusPill tone="green">{row.status}</StatusPill> },
];

const ROWS: Order[] = [
  { reference: "A90133C9", event: "Here & Now", buyer: "Alex Chen", tickets: 2, amount: "A$51.88", status: "Paid" },
  { reference: "B11F00D2", event: "Zine Fair", buyer: "Sam Lee", tickets: 1, amount: "A$0", status: "Free" },
];

describe("DataWell", () => {
  it("is a captioned table with column headers and a row header", () => {
    render(<DataWell caption="Orders" columns={COLUMNS} rows={ROWS} rowKey={(row) => row.reference} empty="No orders yet." />);
    const table = screen.getByRole("table", { name: "Orders" });
    expect(table.parentElement).toHaveClass("overflow-x-auto", "bg-surface", "rounded-card");
    expect(within(table).getAllByRole("columnheader").map((th) => th.textContent)).toEqual([
      "Order",
      "Event",
      "Buyer",
      "Tickets",
      "Amount",
      "Status",
    ]);
    const rowHeaders = within(table).getAllByRole("rowheader");
    expect(rowHeaders[0]).toHaveClass("font-mono");
    expect(rowHeaders[0].firstChild?.textContent).toBe("#A90133C9");
    // Right-aligned numbers; the Event column goes below 768px, as the phone frames drop it.
    expect(within(table).getAllByRole("cell", { name: "A$51.88" })[0]).toHaveClass("text-right");
    expect(within(table).getByRole("columnheader", { name: "Event" })).toHaveClass("max-md:hidden");
    expect(within(table).getByText("Paid")).toHaveAttribute("data-tag", "pop-up");
  });

  it("a dropped column's value is still in the row: a line under the row header, shown only where the column isn't", () => {
    render(<DataWell caption="Orders" columns={COLUMNS} rows={ROWS} rowKey={(row) => row.reference} empty="No orders yet." />);
    const [first] = screen.getAllByRole("rowheader");
    const line = first.querySelector("[data-dropped-column='event']");
    expect(line).toHaveTextContent("Event: Here & Now");
    expect(line).toHaveClass("md:hidden");
    expect(first).toHaveAccessibleName(/#A90133C9.*Event: Here & Now/);
  });

  it("is a focusable, named region only when it scrolls sideways", () => {
    stubOverflow(false);
    const { unmount } = render(<DataWell caption="Orders" columns={COLUMNS} rows={ROWS} rowKey={(row) => row.reference} empty="None." />);
    expect(screen.queryByRole("region")).toBeNull();
    expect(document.querySelector("[data-data-well]")).not.toHaveAttribute("tabindex");
    unmount();
    stubOverflow(true);
    act(() => {
      render(<DataWell caption="Orders" columns={COLUMNS} rows={ROWS} rowKey={(row) => row.reference} empty="None." />);
    });
    const region = screen.getByRole("region", { name: "Orders" });
    expect(region).toHaveAttribute("tabindex", "0");
  });

  it("says so when there are no rows", () => {
    render(<DataWell caption="Orders" columns={COLUMNS} rows={[]} rowKey={(row) => row.reference} empty="No orders yet." />);
    const cell = screen.getByRole("cell", { name: "No orders yet." });
    expect(cell).toHaveAttribute("colspan", "6");
  });

  it("can show its caption", () => {
    render(<DataWell caption="History" showCaption columns={COLUMNS} rows={ROWS} rowKey={(row) => row.reference} empty="None." />);
    expect(screen.getByText("History")).not.toHaveClass("sr-only");
  });
});
