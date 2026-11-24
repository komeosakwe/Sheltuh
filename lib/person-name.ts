/**
 * The longest name a person can type for others to see (a buyer's, a ticket transfer's sender, recipient and
 * holder), in characters (code points): the API's and the database's limit (lib/server/order-input.ts).
 */
export const PERSON_NAME_MAX_LENGTH = 80;

/** The first word of a person's name ("Alex" of "Alex Chen"), for "Alex sent you a ticket"; the whole name if it has one word. */
export function firstName(name: string): string {
  const trimmed = name.trim();
  return trimmed.split(/\s+/u)[0] ?? trimmed;
}
