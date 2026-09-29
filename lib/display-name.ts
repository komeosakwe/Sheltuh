/** Mirrors the API's limit (lib/server/profile-input.ts), counted in code points. */
export const DISPLAY_NAME_MAX = 40;

/** Length as the API counts it: code points, after trimming. */
export function displayNameLength(value: string): number {
  return Array.from(value.trim()).length;
}

/**
 * Client-side check before saving a display name. The API applies further
 * rules (no links, handles or reserved names) and its field error wins.
 */
export function validateDisplayName(value: string): string | null {
  const length = displayNameLength(value);
  if (length === 0) return "Enter a display name.";
  if (length > DISPLAY_NAME_MAX) return `Keep it to ${DISPLAY_NAME_MAX} characters or fewer.`;
  return null;
}
