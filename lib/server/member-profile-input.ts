import { parseMessageText } from "./message-input";
import { parseHandle, SOCIAL_RULES } from "./organiser-input";
import { parseDisplayName } from "./profile-input";
import { fail } from "./validation";

/**
 * A member's profile edits (docs/architecture.md, "Member profiles"): what
 * other verified members see once the profile is visible.
 */

/** Mirrors the profiles.bio check constraint (code points, like char_length). */
export const MAX_BIO_LENGTH = 200;

export interface ProfilePatch {
  displayName?: string;
  profileVisible?: boolean;
  /** null clears it. */
  bio?: string | null;
  /** Without the '@'; null clears it. */
  instagramHandle?: string | null;
}

/**
 * PATCH /api/profiles/me body. Every field is optional (absent: unchanged).
 * `bio` is cleaned like an organiser's bio (parseMessageText: no control,
 * invisible or text-direction characters, line breaks normalised, no stacked
 * marks), at most 200 characters; `instagramHandle` follows the organiser
 * handle rules (a leading '@' is dropped). null or blank clears either.
 */
export function parseProfilePatch(body: Record<string, unknown>): ProfilePatch {
  const errors: Record<string, string> = {};
  const patch: ProfilePatch = {};
  if (body.displayName !== undefined) patch.displayName = parseDisplayName(body.displayName, "displayName", errors);
  if (body.profileVisible !== undefined) {
    if (typeof body.profileVisible === "boolean") patch.profileVisible = body.profileVisible;
    else errors.profileVisible = "Must be true or false.";
  }
  if (body.bio !== undefined) {
    if (body.bio === null || (typeof body.bio === "string" && body.bio.trim() === "")) patch.bio = null;
    else patch.bio = parseMessageText(body.bio, "bio", errors, { allowLinks: true, label: "Bios", maxLength: MAX_BIO_LENGTH });
  }
  if (body.instagramHandle !== undefined) {
    const rule = SOCIAL_RULES.find((r) => r.field === "instagramHandle")!;
    const handle = parseHandle(body.instagramHandle, rule, errors);
    if (handle !== undefined) patch.instagramHandle = handle;
  }
  if (Object.keys(errors).length > 0) fail(errors);
  return patch;
}
