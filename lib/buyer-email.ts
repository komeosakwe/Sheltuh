import { ApiError } from "@/lib/api/client";

/**
 * The checkout's ticket email on the client (components/checkout/BuyerEmailField.tsx):
 * the quick shape check before sending, and the server's suggestion after a
 * refusal. The server's checks are the real ones (docs/architecture.md,
 * "Buyer email checks").
 */

/** Roughly an address: something@something.something, no spaces. */
const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Said when the ticket email is missing or isn't shaped like an address. */
export const BUYER_EMAIL_MISSING = "Enter the email address to send your tickets to.";

/** What's wrong with a typed ticket email, in words for the field, or null when it can be sent. */
export function buyerEmailError(value: string): string | null {
  return EMAIL_SHAPE.test(value.trim()) ? null : BUYER_EMAIL_MISSING;
}

/**
 * The server's corrected address from a refused email (a 400 with `code`
 * `email_typo` / `email_no_mail` and a `suggestion`: BuyerEmailErrorCode),
 * for the field's "Did you mean …?". Null for anything else.
 */
export function emailSuggestionOf(err: unknown): string | null {
  if (!(err instanceof ApiError) || err.status !== 400 || !err.body) return null;
  const { suggestion } = err.body;
  return typeof suggestion === "string" && suggestion.trim() !== "" ? suggestion : null;
}
