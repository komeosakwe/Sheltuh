import { randomInt } from "node:crypto";

/**
 * Tracking-link codes (docs/architecture.md, "Organiser analytics"). Made by
 * the server only, from an alphabet without 0/1/i/l/o so they survive being
 * read aloud or retyped. Mirrors the check constraints in
 * supabase/migrations/20261006000000_event_analytics.sql.
 */
export const TRACKING_CODE_ALPHABET = "23456789abcdefghjkmnpqrstuvwxyz";
export const TRACKING_CODE_LENGTH = 8;
export const TRACKING_CODE_PATTERN = /^[2-9a-hjkmnp-z]{6,10}$/;

/** A fresh random code (31^8 ≈ 8.5 × 10^11 possibilities; unique per event, retried on a collision). */
export function generateTrackingCode(): string {
  let code = "";
  for (let i = 0; i < TRACKING_CODE_LENGTH; i += 1) {
    code += TRACKING_CODE_ALPHABET[randomInt(TRACKING_CODE_ALPHABET.length)];
  }
  return code;
}

/**
 * A client-supplied code if it's well-formed, else null. Never throws: an
 * unknown or malformed code is ignored, never an error (it may come from an
 * old or mangled link). Whether it's one of the event's codes is checked in SQL.
 */
export function parseTrackingCode(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const code = raw.trim().toLowerCase();
  return TRACKING_CODE_PATTERN.test(code) ? code : null;
}
