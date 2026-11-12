/**
 * Member photos' limits (docs/architecture.md, "Member photos"), shared by
 * the API (lib/server/avatar.ts, lib/server/handlers/profile-photos.ts) and
 * the browser. No server-only imports: safe in client code.
 */

/** Photos per member, beside the profile photo (private.add_profile_photo and the table's trigger enforce it too). */
export const MAX_MEMBER_PHOTOS = 6;
/** profile_photos.description's bound, in characters (code points, like char_length). */
export const MAX_MEMBER_PHOTO_DESCRIPTION_LENGTH = 100;
/**
 * Largest upload read, in bytes; the stream is cut off past it (413). Under
 * Vercel's 4.5 MB request body limit. The browser downsizes well below it
 * (lib/image.ts prepareEventImage: at most 1600 px, under 2 MB).
 */
export const MAX_MEMBER_PHOTO_UPLOAD_BYTES = 4 * 1024 * 1024;
/** The stored photo's longest side, in pixels (fitted inside, never enlarged). */
export const MEMBER_PHOTO_MAX_SIDE = 1080;
/** The square thumbnail's side, in pixels (a gallery grid). */
export const MEMBER_PHOTO_THUMB_SIZE = 320;
