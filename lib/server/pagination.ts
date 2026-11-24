import { HttpError } from "./http";

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;

export function parseLimit(raw: string | null): number {
  if (!raw) return DEFAULT_LIMIT;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1) return DEFAULT_LIMIT;
  return Math.min(n, MAX_LIMIT);
}

/** Opaque to clients, so the scheme (currently a row offset) can change without breaking them. */
export function encodeCursor(offset: number): string {
  return Buffer.from(JSON.stringify({ o: offset }), "utf-8").toString("base64url");
}

/**
 * The largest row offset a cursor may carry: 50,000 pages of 20, far past any
 * real list. Anything above (a forged cursor such as 1e300, which is an
 * integer to JavaScript but not to a bigint) is a 400, not a database error.
 */
export const MAX_CURSOR_OFFSET = 1_000_000;

export function decodeCursor(raw: string | null): number {
  if (!raw) return 0;
  try {
    const { o } = JSON.parse(Buffer.from(raw, "base64url").toString("utf-8")) as { o?: unknown };
    if (typeof o === "number" && Number.isInteger(o) && o >= 0 && o <= MAX_CURSOR_OFFSET) return o;
  } catch {
    // fall through
  }
  throw new HttpError(400, "Invalid pagination cursor.");
}

/**
 * Builds a page from a query that fetched `limit + 1` rows: the extra row only proves
 * another page exists, and is dropped.
 */
export function toPage<T>(rows: T[], offset: number, limit: number): { items: T[]; nextCursor?: string } {
  const hasMore = rows.length > limit;
  return {
    items: hasMore ? rows.slice(0, limit) : rows,
    nextCursor: hasMore ? encodeCursor(offset + limit) : undefined,
  };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Route ids are uuids; anything else can't exist, so it's a 404 rather than a database cast error. */
export function isUuid(value: string): boolean {
  return UUID.test(value);
}
