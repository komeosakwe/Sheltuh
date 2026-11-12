import { MAX_MEMBER_PHOTO_DESCRIPTION_LENGTH } from "@/lib/member-photo-rules";
import { EMOJI_TAG_SEQUENCE, parseMessageText } from "./message-input";
import { parseHandle, SOCIAL_RULES } from "./organiser-input";
import { containsLink, hasInvisibleOrControl, parseDisplayName } from "./profile-input";
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

/**
 * PATCH /api/profiles/me/photos/{photoId} body: `{description}`, a member
 * photo's alt text and caption. null or blank clears it (null returned).
 * Otherwise cleaned like a bio (parseMessageText: no control, invisible or
 * text-direction characters, no stacked marks), with the display name's
 * check for characters that render as nothing (hasInvisibleOrControl;
 * emoji and script joiners excepted), on one line (every run of
 * whitespace, line breaks included, becomes one space), at most
 * MAX_MEMBER_PHOTO_DESCRIPTION_LENGTH characters, and without links (it's a
 * description, and shows on a photo anyone who may see the profile sees).
 * 400 with fieldErrors.description.
 */
export function parsePhotoDescription(body: Record<string, unknown>): string | null {
  const value = body.description;
  if (value === null || (typeof value === "string" && value.trim() === "")) return null;
  const errors: Record<string, string> = {};
  if (value === undefined) {
    errors.description = "Write a description, or send null to remove it.";
  } else {
    const text = parseMessageText(value, "description", errors, {
      allowLinks: true,
      label: "Descriptions",
      maxLength: MAX_MEMBER_PHOTO_DESCRIPTION_LENGTH,
    });
    if (text) {
      const oneLine = text.replace(/\s+/g, " ");
      // The display name's check for characters that render as nothing (Hangul
      // fillers, the blank Braille pattern, other default-ignorables), so a
      // description can't show up blank. The joiners parseMessageText allows
      // (inside emoji and some scripts, and emoji flag tags) are kept.
      if (hasInvisibleOrControl(oneLine.replace(EMOJI_TAG_SEQUENCE, "").replace(/[\u200C\u200D]/g, ""))) {
        errors.description = "Descriptions can't contain invisible characters.";
      } else if (containsLink(oneLine)) {
        errors.description = "Descriptions can't include links.";
      } else {
        return oneLine;
      }
    }
  }
  fail(errors);
}
