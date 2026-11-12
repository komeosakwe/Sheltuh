/** Longest first sentence shown as written in the event page's age tag; a longer one is only in Good to know. */
const AGE_TAG_MAX = 12;

/**
 * The event page's short age tag (beside the category, the owner's event mock "18+"), from the organiser's
 * free-text age restriction (its first sentence), or null for none:
 * - an age with a plus that starts it: "18+. Licensed venue." and "18+ (ID checked)" → "18+";
 * - otherwise a short first sentence as written: "All ages. Under-16s with an adult." → "All ages";
 * - nothing for an empty or long one ("Recommended 15+ for coarse language" is advice, not a limit, and
 *   Good to know says it in full).
 */
export function ageTagLabel(ageRestriction: string | undefined): string | null {
  const first = ageRestriction?.trim().split(/\.(?:\s|$)/)[0]?.trim();
  if (!first) return null;
  const plus = /^(\d{1,2})\s*\+/.exec(first);
  if (plus) return `${plus[1]}+`;
  return first.length <= AGE_TAG_MAX ? first : null;
}
