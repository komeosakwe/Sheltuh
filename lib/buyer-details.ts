/**
 * What a buyer's name and email are used for, in the words shown at checkout,
 * on the payment page and to organisers (docs/architecture.md, "Organiser orders").
 */

/** Said beside the name field and above the payment form. */
export const DETAILS_NOTICE = "Your name and email are shared with the organiser of this event.";

/** Said to organisers by the Orders tab and its export. */
export const ORGANISER_USE_NOTE = "Use these details only for this event. Don't add them to a mailing list.";

/** The longest name, in characters (the API checks the same). */
export const BUYER_NAME_MAX = 80;

/** Months after an event ends that organisers can still see who bought. */
export const DETAILS_VISIBLE_MONTHS = 12;

/** What's wrong with a typed name, in words for the field, or null when it can be sent. */
export function buyerNameError(value: string): string | null {
  const name = value.trim();
  if (name === "") return "Enter your name.";
  if ([...name].length > BUYER_NAME_MAX) return `Use ${BUYER_NAME_MAX} characters or fewer.`;
  return null;
}
