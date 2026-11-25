"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";

export interface DataColumn<Row> {
  key: string;
  header: string;
  cell: (row: Row) => ReactNode;
  align?: "start" | "end";
  /** References and dates (#A90133C9, Fri 20 Nov) in Mono/S (a machine code in Plex Mono: `code`). */
  type?: "text" | "mono" | "code";
  /**
   * Dropped below this width, as the tablet and phone frames drop columns. What it says isn't lost:
   * below that width it's a line under the row's header cell ("Event: Here & Now").
   */
  hideBelow?: "md" | "lg";
  /** The cell that names the row (th scope="row"): the order, the person, the payout date. */
  rowHeader?: boolean;
}

/** The column hidden below the width; its line in the row header shown only there. */
const HIDE: Record<NonNullable<DataColumn<unknown>["hideBelow"]>, { column: string; line: string }> = {
  md: { column: "max-md:hidden", line: "md:hidden" },
  lg: { column: "max-lg:hidden", line: "lg:hidden" },
};

const TYPE: Record<NonNullable<DataColumn<unknown>["type"]>, string> = {
  text: "label-tag",
  mono: "mono-s",
  code: "font-mono text-xs leading-4",
};

/**
 * "Org / Table" (Latte's dashboard Components 465:7337: the Orders, Attendees and Payouts tables):
 * a well of surface/muted, radius 16, px 16 py 8; the header row in Label/Tag text/secondary; each
 * row under a 1px border/subtle line, 12px tall padding, 12px between columns, its cells 12/16
 * Medium in black, references and dates in Mono/S, statuses as pills (the caller's cells).
 *
 * A real table with a caption (hidden unless `showCaption`), column headers and a row header (the
 * `rowHeader` column, else the first). On a narrow screen it scrolls sideways inside its well,
 * never the page: only then is the well a focusable, named region, so it can be scrolled from the
 * keyboard (a tab stop that scrolls nothing would only be in the way). `empty` is shown in place
 * of rows when there are none: each list says it in its own words ("No orders yet.").
 */
export default function DataWell<Row>({
  caption,
  showCaption = false,
  columns,
  rows,
  rowKey,
  empty,
}: {
  caption: string;
  showCaption?: boolean;
  columns: DataColumn<Row>[];
  rows: Row[];
  rowKey: (row: Row) => string;
  empty: ReactNode;
}) {
  const captionId = useId();
  const wellRef = useRef<HTMLDivElement>(null);
  const [overflows, setOverflows] = useState(false);

  useEffect(() => {
    const well = wellRef.current;
    if (!well || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => setOverflows(well.scrollWidth > well.clientWidth + 1));
    observer.observe(well);
    const table = well.firstElementChild;
    if (table) observer.observe(table);
    return () => observer.disconnect();
  }, []);

  const headerIndex = Math.max(
    0,
    columns.findIndex((column) => column.rowHeader),
  );
  const dropped = columns.filter((column) => column.hideBelow);
  const alignClass = (column: DataColumn<Row>) => (column.align === "end" ? "text-right" : "text-left");
  const hideClass = (column: DataColumn<Row>) => (column.hideBelow ? HIDE[column.hideBelow].column : "");

  return (
    <div
      ref={wellRef}
      role={overflows ? "region" : undefined}
      aria-labelledby={overflows ? captionId : undefined}
      tabIndex={overflows ? 0 : undefined}
      data-data-well=""
      data-overflows={overflows ? "" : undefined}
      className="overflow-x-auto rounded-card bg-surface px-4 py-2 focus-visible:outline-offset-2"
    >
      <table className="w-full border-collapse">
        <caption id={captionId} className={showCaption ? "body-s pb-2 text-left font-semibold" : "sr-only"}>
          {caption}
        </caption>
        <thead>
          <tr>
            {columns.map((column) => (
              <th
                key={column.key}
                scope="col"
                className={`label-tag px-2 py-3 whitespace-nowrap text-muted ${alignClass(column)} ${hideClass(column)}`.trim()}
              >
                {column.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr className="border-t border-surface-border">
              <td colSpan={columns.length} data-data-well-empty="" className="body-s px-2 py-6 text-center text-muted">
                {empty}
              </td>
            </tr>
          ) : (
            rows.map((row) => (
              <tr key={rowKey(row)} className="border-t border-surface-border">
                {columns.map((column, index) => {
                  const isHeader = index === headerIndex;
                  const Cell = isHeader ? "th" : "td";
                  return (
                    <Cell
                      key={column.key}
                      scope={isHeader ? "row" : undefined}
                      className={`${TYPE[column.type ?? "text"]} px-2 py-3 align-middle text-foreground ${alignClass(column)} ${hideClass(column)}`.trim()}
                    >
                      {column.cell(row)}
                      {isHeader &&
                        dropped.map((hidden) =>
                          hidden.hideBelow ? (
                            <span
                              key={hidden.key}
                              data-dropped-column={hidden.key}
                              className={`mono-s mt-1 block text-left font-normal text-muted ${HIDE[hidden.hideBelow].line}`}
                            >
                              {hidden.header}: {hidden.cell(row)}
                            </span>
                          ) : null,
                        )}
                    </Cell>
                  );
                })}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
