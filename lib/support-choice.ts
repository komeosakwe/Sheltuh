/**
 * The checkout's Support Sheltüh choice (components/checkout/SupportSheltuh.tsx):
 * what the buyer has picked, and the amount it adds. Shared by the general
 * admission ticket selector and the seat page, so both read and validate the
 * "Other" amount the same way. The limits and copy are lib/support.ts's.
 */
import { formatAud } from "./format";
import { SUPPORT_MAX_CENTS, SUPPORT_MIN_CENTS } from "./support";

/** Nothing picked (the start: nothing is ever pre-selected), one of the presets, or Other with what's typed. */
export type SupportChoice =
  | { option: "none" }
  | { option: "preset"; cents: number }
  | { option: "other"; text: string };

export const NO_SUPPORT: SupportChoice = { option: "none" };

/** An "Other" amount as typed: whole cents (0 when nothing's typed), or why it can't be used. */
export type ParsedSupportAmount = { ok: true; cents: number } | { ok: false; error: string };

/** An "Other" amount below SUPPORT_MIN_CENTS (0 included, once something's typed). */
export const SUPPORT_MIN_ERROR = `The smallest amount is ${formatAud(SUPPORT_MIN_CENTS)}.`;

/** An "Other" amount above SUPPORT_MAX_CENTS. */
export const SUPPORT_MAX_ERROR = `The most you can add is ${formatAud(SUPPORT_MAX_CENTS)}.`;

/**
 * Reads an "Other" amount in dollars ("7", "7.5", "7.50", "$7", "A$7"). Empty
 * is 0 (nothing added, no error). Otherwise it must be whole cents from
 * SUPPORT_MIN_CENTS to SUPPORT_MAX_CENTS (what isValidSupportCents, the
 * API's check, allows), each limit with its own error.
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
  if (cents < SUPPORT_MIN_CENTS) return { ok: false, error: SUPPORT_MIN_ERROR };
  if (cents > SUPPORT_MAX_CENTS) return { ok: false, error: SUPPORT_MAX_ERROR };
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

/**
 * Other chosen with nothing typed (or only spaces): no support. Checkout
 * treats it as none, clearing the choice (so nothing shows as chosen) and
 * sending nothing.
 */
export function isEmptyOther(choice: SupportChoice): boolean {
  return choice.option === "other" && choice.text.trim() === "";
}

/** After an amount is added (a preset chosen), how to take it off, for the status announcement. */
export function supportAddedHint(next: SupportChoice): string {
  return next.option === "preset" ? " Choose it again or press Remove to take it off." : "";
}
