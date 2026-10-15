// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import DataTable from "@/components/analytics/DataTable";
import StatGrid from "@/components/analytics/StatGrid";
import TimeSeriesChart from "@/components/analytics/TimeSeriesChart";
import { addDays } from "@/lib/analytics-format";
import { stubMatchMedia } from "./test-utils/analyticsFixtures";

beforeEach(() => stubMatchMedia());
afterEach(() => {
  cleanup();
  Reflect.deleteProperty(window, "matchMedia");
});

const columns = [
  { key: "name", label: "Name" },
  { key: "views", label: "Views", numeric: true },
];

describe("DataTable", () => {
  it("is a captioned table from sm, with row headers and a totals row", () => {
    render(
      <DataTable
        caption="Things"
        columns={columns}
        rows={[{ key: "a", header: "Alpha", cells: ["1,204"] }]}
        totals={["1,204"]}
      />,
    );
    const table = screen.getByRole("table", { name: "Things" });
    expect(table.parentElement).toHaveClass("hidden", "sm:block");
    expect(within(table).getByRole("columnheader", { name: "Views" })).toHaveClass("text-right");
    expect(within(table).getByRole("rowheader", { name: "Alpha" })).toBeInTheDocument();
    expect(within(table).getByRole("rowheader", { name: "Total" })).toBeInTheDocument();
  });

  it("on phones is a list of small definition lists (the table is display:none there)", () => {
    render(<DataTable caption="Things" columns={columns} rows={[{ key: "a", header: "Alpha", cells: ["12"] }]} totals={["12"]} />);
    const list = screen.getByRole("list", { name: "Things" });
    expect(list).toHaveClass("sm:hidden");
    const items = within(list).getAllByRole("listitem");
    expect(items).toHaveLength(2);
    expect(within(items[0]).getByRole("term")).toHaveTextContent("Views");
    expect(within(items[0]).getByRole("definition")).toHaveTextContent("12");
    expect(items[1]).toHaveTextContent("Total");
  });

  it("groups rows under a row-group heading with subtotals", () => {
    render(
      <DataTable
        caption="Sources"
        columns={columns}
        rows={[
          { key: "ig", header: "Instagram", cells: ["5"], group: "social" },
          { key: "fb", header: "Facebook", cells: ["3"], group: "social" },
          { key: "dir", header: "Direct", cells: ["2"] },
        ]}
        groups={{ social: { header: "Social", cells: ["8"] } }}
      />,
    );
    const table = screen.getByRole("table");
    const groupHeader = within(table).getByRole("rowheader", { name: "Social" });
    expect(groupHeader).toHaveAttribute("scope", "rowgroup");
    expect(groupHeader.closest("tr")).toHaveTextContent("Social8");
    expect(groupHeader.closest("tbody")).toHaveTextContent("Instagram");
    expect(within(table).getByRole("rowheader", { name: "Direct" }).closest("tbody")).not.toBe(groupHeader.closest("tbody"));
  });
});

describe("StatGrid", () => {
  it("reads label, number, change, with '—' as No data and definitions one tap away", () => {
    render(
      <StatGrid
        stats={[
          { label: "Views", value: null },
          { label: "Gross", value: "A$1,204.50", change: "Up 12% vs previous 30 days" },
          { label: "Net", value: "A$1,120.00", emphasis: true },
        ]}
      />,
    );
    const terms = screen.getAllByRole("term");
    expect(terms[0]).toHaveTextContent("Views");
    const views = terms[0].nextElementSibling;
    expect(views).toHaveTextContent("—No data");
    expect(within(views as HTMLElement).getByText("—")).toHaveAttribute("aria-hidden", "true");
    expect(screen.getByText("Up 12% vs previous 30 days")).toBeInTheDocument();
    expect(terms[2].parentElement).toHaveClass("col-span-2");
    expect(screen.getByText("How these are worked out")).toBeInTheDocument();
    expect(screen.getByText(/Gross minus fees\. This is what Stripe pays out to you/)).toBeInTheDocument();
  });
});

describe("TimeSeriesChart", () => {
  const dates = Array.from({ length: 10 }, (_, i) => addDays("2026-10-01", i));
  const range = { from: "2026-10-01", to: "2026-10-10" };

  it("draws one bar per non-zero day and summarises itself for screen readers", () => {
    const values = [0, 3, null, 1, 0, 0, 0, 0, 0, 2];
    const { container } = render(
      <TimeSeriesChart title="Page views" unit="views" range={range} dates={dates} values={values} emptyText="None." />,
    );
    expect(container.querySelectorAll("rect")).toHaveLength(3);
    expect(screen.getByRole("img")).toHaveAccessibleName(
      "Page views per day, 1 to 10 October 2026. Total 6. Highest 3 on 2 October 2026.",
    );
    expect(screen.getByRole("heading", { level: 3, name: "Page views per day" })).toBeInTheDocument();
    expect(screen.getByText("Highest: 3 on 2 Oct")).toBeInTheDocument();
    expect(screen.queryByText("None.")).toBeNull();
  });

  it("shows the empty overlay when nothing happened", () => {
    render(<TimeSeriesChart title="Tickets sold" unit="tickets" range={range} dates={dates} values={dates.map(() => 0)} emptyText="No sales in this period." />);
    expect(screen.getByText("No sales in this period.")).toBeInTheDocument();
  });

  it("draws the previous period as a dashed line with a direct label", () => {
    const { container } = render(
      <TimeSeriesChart
        title="Page views"
        unit="views"
        range={range}
        dates={dates}
        values={dates.map(() => 2)}
        previous={dates.map(() => 1)}
        previousLabel="Previous 10 days"
        emptyText="None."
      />,
    );
    const line = container.querySelector("polyline");
    expect(line).toHaveAttribute("stroke-dasharray", "4 3");
    expect(screen.getAllByText("Previous 10 days").length).toBeGreaterThan(0);
  });

  it("goes weekly on phones past 31 days", () => {
    stubMatchMedia(true);
    const long = Array.from({ length: 40 }, (_, i) => addDays("2026-09-01", i));
    render(<TimeSeriesChart title="Page views" unit="views" range={{ from: long[0], to: long[39] }} dates={long} values={long.map(() => 1)} emptyText="None." />);
    expect(screen.getByRole("heading", { level: 3, name: "Page views per week" })).toBeInTheDocument();
  });

  it("a pointer over the plot reads out that bar (aria-hidden: the table is the accessible path)", () => {
    const { container } = render(
      <TimeSeriesChart title="Page views" unit="views" range={range} dates={dates} values={dates.map((_, i) => i)} emptyText="None." />,
    );
    const plot = container.querySelector("svg")?.parentElement;
    if (!plot) throw new Error("no plot");
    plot.getBoundingClientRect = () => ({ left: 0, width: 100, top: 0, height: 100, right: 100, bottom: 100, x: 0, y: 0, toJSON: () => ({}) });
    fireEvent.pointerMove(plot, { clientX: 25 });
    const readout = screen.getByText("3 Oct: 2 views");
    expect(readout).toHaveAttribute("aria-hidden", "true");
  });
});
