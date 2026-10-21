// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it } from "vitest";
import TicketQr from "@/components/tickets/TicketQr";
import { QR_QUIET_ZONE_MODULES, ticketQrMatrix } from "@/lib/ticket-qr";

afterEach(cleanup);

const CODE = "7KQM-2HXD";

/**
 * Paints the rendered path back onto a grid, one cell per module. Every
 * subpath must be a whole-module horizontal run (`M x y h n v 1 h -n z`), and
 * no module may be painted twice.
 */
function drawPath(d: string, size: number): boolean[][] {
  const grid = Array.from({ length: size }, () => Array.from({ length: size }, () => false));
  const run = /M(\d+) (\d+)h(\d+)v1h-(\d+)z/g;
  let consumed = 0;
  for (const m of d.matchAll(run)) {
    expect(m.index).toBe(consumed); // nothing between runs
    consumed += m[0].length;
    const [x, y, n, back] = [Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4])];
    expect(back).toBe(n);
    for (let i = 0; i < n; i++) {
      expect(grid[y][x + i], `module ${x + i},${y} painted twice`).toBe(false);
      grid[y][x + i] = true;
    }
  }
  expect(consumed).toBe(d.length);
  return grid;
}

/** The matrix with its light quiet zone on every side. */
function withQuietZone(matrix: boolean[][]): boolean[][] {
  const q = QR_QUIET_ZONE_MODULES;
  const size = matrix.length + q * 2;
  return Array.from({ length: size }, (_, y) =>
    Array.from({ length: size }, (_, x) => matrix[y - q]?.[x - q] ?? false),
  );
}

const rows = (grid: boolean[][]) => grid.map((row) => row.map((dark) => (dark ? "#" : ".")).join(""));

function renderQr(code: string) {
  const { container } = render(<TicketQr code={code} />);
  return container;
}

describe("TicketQr", () => {
  it("draws exactly the ticket's QR modules, offset by a 4-module quiet zone, on a 29-module plate", () => {
    const container = renderQr(CODE);
    const svg = container.querySelector("svg");
    expect(svg).toHaveAttribute("viewBox", "0 0 29 29");
    expect(svg).toHaveAttribute("shape-rendering", "crispEdges");

    const rect = container.querySelector("rect");
    expect(rect).toHaveAttribute("width", "29");
    expect(rect).toHaveAttribute("height", "29");

    const paths = container.querySelectorAll("path");
    expect(paths).toHaveLength(1);
    const matrix = ticketQrMatrix(CODE);
    expect(matrix).not.toBeNull();
    expect(rows(drawPath(paths[0].getAttribute("d") ?? "", 29))).toEqual(rows(withQuietZone(matrix ?? [])));
  });

  it("draws different codes differently", () => {
    const d = (code: string) => {
      const { container, unmount } = render(<TicketQr code={code} />);
      const value = container.querySelector("path")?.getAttribute("d");
      unmount();
      return value;
    };
    expect(d("7KQM-2HXD")).not.toEqual(d("A2B3-C4D5"));
  });

  it("is an image named for its ticket", () => {
    renderQr(CODE);
    expect(screen.getByRole("img", { name: "QR code for ticket 7KQM-2HXD" })).toBeInTheDocument();
  });

  it.each([
    ["an old-style code", "ABC123"],
    ["lower case", "7kqm-2hxd"],
    ["no hyphen", "7KQM2HXD"],
    ["the QR payload itself", "SH1:7KQM-2HXD"],
    ["a confusable letter", "7KQO-2HXD"],
    ["surrounding space", " 7KQM-2HXD"],
    ["nothing", ""],
  ])("renders nothing for %s", (_, code) => {
    const container = renderQr(code);
    expect(container).toBeEmptyDOMElement();
  });

  it("is pure black on pure white, with no theme colour, currentColor or token class to tint it", () => {
    const container = renderQr(CODE);
    expect(container.querySelector("rect")).toHaveAttribute("fill", "#ffffff");
    expect(container.querySelector("path")).toHaveAttribute("fill", "#000000");
    const html = container.innerHTML;
    expect(html).not.toMatch(/currentColor/i);
    expect(html).not.toMatch(/var\(--/);
    // No colour utility anywhere (text-*, bg-*, fill-*, stroke-*, border-*), only sizing.
    const classes = Array.from(container.querySelectorAll("[class]")).flatMap((el) =>
      (el.getAttribute("class") ?? "").split(/\s+/),
    );
    expect(classes.filter((c) => /(^|:)(text|bg|fill|stroke|border)-/.test(c))).toEqual([]);
  });

  it("opts the plate out of forced colours, print colour saving and automatic dark modes", () => {
    const html = renderToStaticMarkup(<TicketQr code={CODE} />);
    expect(html).toMatch(/forced-color-adjust:none/);
    expect(html).toMatch(/print-color-adjust:exact/);
    expect(html).toMatch(/color-scheme:only light/);
  });

  it("is 203px under 375px wide, 232px from 375px and 40mm in print (whole-pixel modules)", () => {
    const container = renderQr(CODE);
    const plate = container.firstElementChild;
    const classes = (plate?.getAttribute("class") ?? "").split(/\s+/);
    expect(classes).toEqual(expect.arrayContaining(["size-[203px]", "min-[375px]:size-[232px]", "print:size-[40mm]"]));
    expect(203 % 29).toBe(0);
    expect(232 % 29).toBe(0);
    expect(container.querySelector("svg")).toHaveClass("size-full");
  });
});
