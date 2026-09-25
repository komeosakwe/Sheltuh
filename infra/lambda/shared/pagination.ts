import { HttpError } from "./http";

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;

export function parseLimit(raw: string | undefined): number {
  if (!raw) return DEFAULT_LIMIT;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1) return DEFAULT_LIMIT;
  return Math.min(n, MAX_LIMIT);
}

/** Opaque cursor so clients never see or construct raw DynamoDB keys. */
export function encodeCursor(key: Record<string, unknown> | undefined): string | undefined {
  if (!key) return undefined;
  return Buffer.from(JSON.stringify(key), "utf-8").toString("base64url");
}

export function decodeCursor(raw: string | undefined): Record<string, unknown> | undefined {
  if (!raw) return undefined;
  try {
    return JSON.parse(Buffer.from(raw, "base64url").toString("utf-8"));
  } catch {
    throw new HttpError(400, "Invalid pagination cursor.");
  }
}
