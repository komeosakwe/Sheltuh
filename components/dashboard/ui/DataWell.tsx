import { useId, type ReactNode } from "react";

export interface DataColumn<Row> {
  key: string;
  header: string;
  cell: (row: Row) => ReactNode;
  align?: "start" | "end";
  /** References and dates (#A90133C9, Fri 20 Nov) in Mono/S (a machine code in Plex Mono: `code`). */
  type?: "text" | "mono" | "code";
  /** Dropped below this width, as the tablet and phone frames drop columns. */
  hideBelow?: "md" | "lg";
  /** The cell that names the row (th scope="row"): the order, the person, the payout date. */
  rowHeader?: boolean;
}

const HIDE: Record<NonNullable<DataColumn<unknown>["hideBelow"]>, string> = {
  md: "max-md:hidden",
  lg: "max-lg:hidden",
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
 * A real table with a caption (hidden unless `showCaption`), column headers and a row header. On a
 * narrow screen it scrolls sideways inside its well, never the page: the well is then a focusable,
 * named region, so it can be scrolled from the keyboard. `empty` is shown in place of rows when
 * there are none (each list's own words: "No orders yet.").
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
  empty?: ReactNode;
}) {
  const captionId = useId();
  const alignClass = (column: DataColumn<Row>) => (column.align === "end" ? "text-right" : "text-left");
  const hideClass = (column: DataColumn<Row>) => (column.hideBelow ? HIDE[column.hideBelow] : "");

  return (
    <div
      role="region"
      aria-labelledby={captionId}
      tabIndex={0}
      data-data-well=""
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
          {rows.length === 0 && empty ? (
            <tr className="border-t border-surface-border">
              <td colSpan={columns.length} className="body-s px-2 py-6 text-center text-muted">
                {empty}
              </td>
            </tr>
          ) : (
            rows.map((row) => (
              <tr key={rowKey(row)} className="border-t border-surface-border">
                {columns.map((column) => {
                  const Cell = column.rowHeader ? "th" : "td";
                  return (
                    <Cell
                      key={column.key}
                      scope={column.rowHeader ? "row" : undefined}
                      className={`${TYPE[column.type ?? "text"]} px-2 py-3 align-middle text-foreground ${alignClass(column)} ${hideClass(column)}`.trim()}
                    >
                      {column.cell(row)}
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
