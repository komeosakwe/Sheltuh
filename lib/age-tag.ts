/**
 * The event page's short age tag (beside the category, the owner's event mock "18+"), from the organiser's
 * free-text age restriction (its first sentence), or null for none. Only an age or "All ages", never other
 * words (Good to know says the rest in full):
 * - an age with a plus that starts it: "18+. Licensed venue." and "18+ (ID checked)" → "18+";
 * - "All ages" as written: "All ages. Under-16s with an adult." → "All ages";
 * - anything else is null ("Recommended 15+ for coarse language" is advice, not a limit).
 */
export function ageTagLabel(ageRestriction: string | undefined): string | null {
  const first = ageRestriction?.trim().split(/\.(?:\s|$)/)[0]?.trim();
  if (!first) return null;
  const plus = /^(\d{1,2})\s*\+/.exec(first);
  if (plus) return `${plus[1]}+`;
  return /^all ages$/i.test(first) ? "All ages" : null;
}
