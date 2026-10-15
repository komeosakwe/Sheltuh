"use client";

import { Fragment, useEffect, useRef, useState, type ReactNode } from "react";

export interface DataColumn {
  key: string;
  label: string;
  numeric?: boolean;
}

export interface DataRow {
  key: string;
  /** The first column: the row's header. */
  header: ReactNode;
  /** One per column after the first. */
  cells: ReactNode[];
  /** Rows sharing a group are listed under its heading (see `groups`). */
  group?: string;
}

export interface DataGroup {
  header: ReactNode;
  /** Subtotals, one per column after the first. */
  cells: ReactNode[];
}

/** True while the element is wider than its box (then it needs to be a focusable scroll region). */
function useOverflows<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [overflows, setOverflows] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => setOverflows(el.scrollWidth > el.clientWidth + 1));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return { ref, overflows };
}

const numberClass = "text-right tabular-nums whitespace-nowrap";

/**
 * A report table (docs/design/favourites-analytics.md §5.12). From `sm` it's
 * a real table; on phones each row becomes a small definition list. Only one
 * is displayed at a time (display:none takes the other out of the
 * accessibility tree), so nothing is read twice.
 */
export default function DataTable({
  caption,
  columns,
  rows,
  totals,
  groups = {},
}: {
  caption: string;
  columns: DataColumn[];
  rows: DataRow[];
  totals?: ReactNode[];
  groups?: Record<string, DataGroup>;
}) {
  const { ref, overflows } = useOverflows<HTMLDivElement>();
  const rest = columns.slice(1);

  // Consecutive rows of the same group form one run (one tbody).
  const runs: { group?: string; rows: DataRow[] }[] = [];
  for (const row of rows) {
    const last = runs[runs.length - 1];
    if (last && last.group === row.group && row.group !== undefined) last.rows.push(row);
    else runs.push({ group: row.group, rows: [row] });
  }

  const cell = (content: ReactNode, i: number, bold = false) => (
    <td key={rest[i]?.key ?? i} className={`py-3 pr-4 last:pr-0 ${rest[i]?.numeric ? numberClass : ""} ${bold ? "font-semibold" : ""}`}>
      {content}
    </td>
  );

  return (
    <>
      <div
        ref={ref}
        className="hidden overflow-x-auto sm:block"
        {...(overflows ? { tabIndex: 0, role: "region", "aria-label": caption } : {})}
      >
        <table className="w-full border-collapse text-sm">
          <caption className="sr-only">{caption}</caption>
          <thead>
            <tr>
              {columns.map((column) => (
                <th
                  key={column.key}
                  scope="col"
                  className={`eyebrow pr-4 pb-3 align-bottom text-muted last:pr-0 ${column.numeric ? "text-right" : "text-left"}`}
                >
                  {column.label}
                </th>
              ))}
            </tr>
          </thead>
          {runs.map((run, runIndex) => {
            const group = run.group !== undefined ? groups[run.group] : undefined;
            return (
              <tbody key={run.group ?? `run-${runIndex}`}>
                {group && (
                  <tr className="border-t border-surface-border">
                    <th scope="rowgroup" className="py-3 pr-4 text-left font-semibold">
                      {group.header}
                    </th>
                    {group.cells.map((content, i) => cell(content, i, true))}
                  </tr>
                )}
                {run.rows.map((row) => (
                  <tr key={row.key} className="border-t border-surface-border">
                    <th scope="row" className={`py-3 pr-4 text-left align-top font-normal ${group ? "pl-4" : ""}`}>
                      {row.header}
                    </th>
                    {row.cells.map((content, i) => cell(content, i))}
                  </tr>
                ))}
              </tbody>
            );
          })}
          {totals && (
            <tfoot className="border-t border-foreground font-semibold">
              <tr>
                <th scope="row" className="py-3 pr-4 text-left">
                  Total
                </th>
                {totals.map((content, i) => cell(content, i))}
              </tr>
            </tfoot>
          )}
        </table>
      </div>

      <ul className="sm:hidden" aria-label={caption}>
        {runs.map((run, runIndex) => {
          const group = run.group !== undefined ? groups[run.group] : undefined;
          return (
            <Fragment key={run.group ?? `run-${runIndex}`}>
              {group && <PhoneRow header={group.header} cells={group.cells} columns={rest} bold />}
              {run.rows.map((row) => (
                <PhoneRow key={row.key} header={row.header} cells={row.cells} columns={rest} indent={Boolean(group)} />
              ))}
            </Fragment>
          );
        })}
        {totals && <PhoneRow header="Total" cells={totals} columns={rest} total />}
      </ul>
    </>
  );
}

function PhoneRow({
  header,
  cells,
  columns,
  total = false,
  bold = false,
  indent = false,
}: {
  header: ReactNode;
  cells: ReactNode[];
  columns: DataColumn[];
  total?: boolean;
  bold?: boolean;
  indent?: boolean;
}) {
  return (
    <li className={`border-t py-4 ${total ? "border-foreground" : "border-surface-border"} ${indent ? "pl-4" : ""}`.trim()}>
      <div className="text-base font-semibold">{header}</div>
      <dl className={`mt-2 grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 text-sm ${bold || total ? "font-semibold" : ""}`.trim()}>
        {columns.map((column, i) => (
          <Fragment key={column.key}>
            <dt className="text-muted">{column.label}</dt>
            <dd className="text-right tabular-nums">{cells[i]}</dd>
          </Fragment>
        ))}
      </dl>
    </li>
  );
}
