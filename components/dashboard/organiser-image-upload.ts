import { SESSION_EXPIRED_MESSAGE } from "@/components/whos-going/shared";
import { ApiError } from "@/lib/api/client";
import { SessionExpiredError } from "@/lib/auth/AuthContext";
import { ImageError } from "@/lib/image";

/**
 * What the organiser's logo and cover fields share (OrganiserLogoField,
 * OrganiserCoverField): the types the API takes, the check before anything
 * is sent, and the plain words for each of the API's answers.
 */

/** What the API takes (docs/architecture.md, "Organiser profiles" → Logo: sniffed from the bytes). */
export const LOGO_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;

const TOO_LARGE = "That image is over 2 MB, even after shrinking it. Choose a smaller one.";

/** Checked before anything is sent; the server checks again (and decides by the bytes, not the name). */
export function logoFileError(file: File): string | null {
  if (!(LOGO_TYPES as readonly string[]).includes(file.type)) return "Choose a JPEG, PNG or WebP image.";
  if (file.size === 0) return "That file is empty. Choose another image.";
  return null;
}

/** What to say when an upload or removal fails: plain words for each of the API's answers. */
export function logoErrorMessage(err: unknown, fallback: string): string {
  if (err instanceof SessionExpiredError) return SESSION_EXPIRED_MESSAGE;
  if (err instanceof ImageError) return err.message;
  if (!(err instanceof ApiError)) return fallback;
  switch (err.status) {
    case 401:
      return SESSION_EXPIRED_MESSAGE; // The token was refused: trying again won't help, signing in will.
    case 0:
      return err.message; // No connection: the client's own wording.
    case 400:
      return err.fieldErrors?.logo ?? "We couldn’t use that file. Choose a JPEG, PNG or WebP image.";
    case 403:
      return "Only approved organisers can add a logo. Reload the page to check your profile’s status.";
    case 404:
      return "We couldn’t find your organiser profile. Reload the page and try again.";
    case 409:
      return "Your organiser profile changed while the logo was uploading, so it wasn’t saved. Reload the page to check its status.";
    case 413:
      return TOO_LARGE;
    case 429:
      return "You’ve changed your logo a lot today. Try again tomorrow.";
    case 503:
      return "We’re busy processing images right now. Try again in a minute.";
    default:
      return fallback;
  }
}

