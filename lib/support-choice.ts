/**
 * The checkout's Support Sheltüh choice (components/checkout/SupportSheltuh.tsx):
 * what the buyer has picked, and the amount it adds. Shared by the general
 * admission ticket selector and the seat page, so both read and validate the
 * "Other" amount the same way. The limits and copy are lib/support.ts's.
 */
import { formatAud } from "./format";
import { isValidSupportCents, SUPPORT_MAX_CENTS, SUPPORT_MIN_CENTS } from "./support";

/** Nothing picked (the start: nothing is ever pre-selected), one of the presets, or Other with what's typed. */
export type SupportChoice =
  | { option: "none" }
  | { option: "preset"; cents: number }
  | { option: "other"; text: string };

export const NO_SUPPORT: SupportChoice = { option: "none" };

/** An "Other" amount as typed: whole cents (0 when nothing's typed), or why it can't be used. */
export type ParsedSupportAmount = { ok: true; cents: number } | { ok: false; error: string };

export const SUPPORT_RANGE_ERROR = `Enter an amount from ${formatAud(SUPPORT_MIN_CENTS)} to ${formatAud(SUPPORT_MAX_CENTS)}.`;

/**
 * Reads an "Other" amount in dollars ("7", "7.5", "7.50", "$7", "A$7"). Empty
 * is 0 (nothing added, no error). Otherwise it must be whole cents from
 * SUPPORT_MIN_CENTS to SUPPORT_MAX_CENTS (isValidSupportCents).
 */
export function parseSupportAmount(text: string): ParsedSupportAmount {
  const trimmed = text.trim().replace(/^a?\$\s*/i, "");
  if (trimmed === "") return { ok: true, cents: 0 };
  const match = /^(\d*)(?:\.(\d*))?$/.exec(trimmed);
  if (!match || (match[1] === "" && (match[2] ?? "") === "")) {
    return { ok: false, error: "Enter an amount in dollars, like 7 or 7.50." };
  }
  const whole = match[1] ?? "";
  const fraction = (match[2] ?? "").replace(/0+$/, "");
  if (fraction.length > 2) return { ok: false, error: "Use whole cents, like 7.50." };
  // Digits only, so no floating-point rounding: dollars × 100 plus the cents.
  const cents = Number(whole || "0") * 100 + Number(fraction.padEnd(2, "0"));
  if (cents === 0 || !isValidSupportCents(cents)) return { ok: false, error: SUPPORT_RANGE_ERROR };
  return { ok: true, cents };
}

/** The amount the choice adds to the order: 0 for none, or an "Other" that's empty or not valid yet. */
export function supportCentsOf(choice: SupportChoice): number {
  if (choice.option === "preset") return choice.cents;
  if (choice.option === "other") {
    const parsed = parseSupportAmount(choice.text);
    return parsed.ok ? parsed.cents : 0;
  }
  return 0;
}

/** Why the choice can't be sent (an "Other" amount that isn't valid), or null. */
export function supportErrorOf(choice: SupportChoice): string | null {
  if (choice.option !== "other") return null;
  const parsed = parseSupportAmount(choice.text);
  return parsed.ok ? null : parsed.error;
}

/** What a total "includes", for the status announcements: "booking fees", plus Support Sheltüh when there is some. */
export function totalIncludesWords(supportCents: number): string {
  return supportCents > 0 ? "booking fees and Support Sheltüh" : "booking fees";
}
