/**
 * CSV for organiser exports (RFC 4180: every cell quoted, quotes doubled,
 * CRLF line ends). Text cells are defended against formula injection: a
 * spreadsheet treats a cell starting with = + - @ (or a tab or carriage
 * return before one) as a formula, so organiser-supplied text that does
 * (an event title, a ticket-type name, a tracking-link label) gets a leading
 * single quote, which spreadsheets show as plain text. Numbers are written
 * by the server and passed through as numbers (money as `{ cents }`).
 */

/** `{ cents }`: money, written as decimal dollars ("1204.50"). */
export type CsvCell = string | number | { cents: number } | null | undefined;

const FORMULA_START = /^[\s]*[=+\-@\t\r]/;

/** One cell, quoted. */
export function csvCell(value: CsvCell): string {
  if (value === null || value === undefined) return '""';
  if (typeof value === "number") return `"${Number.isFinite(value) ? String(value) : ""}"`;
  if (typeof value === "object") return `"${centsToDecimal(value.cents)}"`;
  const text = FORMULA_START.test(value) ? `'${value}` : value;
  return `"${text.replace(/"/g, '""')}"`;
}

/**
 * The whole file. Starts with a UTF-8 byte-order mark so Excel reads
 * non-ASCII text (Sheltüh, accented titles) correctly.
 */
export function toCsv(rows: CsvCell[][]): string {
  return `﻿${rows.map((row) => row.map(csvCell).join(",")).join("\r\n")}\r\n`;
}

/** Integer cents as plain decimal dollars ("1204.50"), for spreadsheets. */
export function centsToDecimal(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(Math.round(cents));
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
}

/** A downloadable CSV response. Never cached: it's the organiser's business data. */
export function csvResponse(filename: string, rows: CsvCell[][]): Response {
  // Callers build filenames from slugs and dates only; strip anything else anyway.
  const safe = filename.replace(/[^A-Za-z0-9._-]/g, "_");
  return new Response(toCsv(rows), {
    status: 200,
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="${safe}"`,
      "cache-control": "private, no-store",
      "x-content-type-options": "nosniff",
    },
  });
}
