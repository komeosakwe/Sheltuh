import {
  customTagKey,
  inTagOrder,
  isOrganiserTag,
  isTagLabel,
  MAX_CUSTOM_TAGS,
  MAX_PROFILE_TAGS,
  ORGANISER_TAGS,
  parseCustomTag,
  type OrganiserTag,
} from "@/lib/api/organiser-tags";
import { requireCaller } from "../auth";
import { HttpError, okPrivate, readJson } from "../http";
import { toOwnOrganiserView } from "../records";
import type { Handler } from "../route";
import type { OrganiserTagsInput } from "../types";
import { fail } from "../validation";
import { findOrganiserByOwner } from "./organiser-guard";

/**
 * Organiser profile categories (docs/architecture.md, "Organiser profiles",
 * "Categories"; supabase/migrations/20261128000100_organiser_tags.sql). The
 * organiser is always the caller's own, from the token. The write goes
 * through private.set_organiser_tags, which locks the organiser row, writes
 * only what changes and logs it.
 */

const NO_ORGANISER = "No organiser application found.";
const NOT_APPROVED = "Your organiser application must be approved before you can choose categories.";

/**
 * The request body: both lists required. List items: known slugs only,
 * repeats dropped, sorted into list order, at most MAX_PROFILE_TAGS. Own
 * words: at most MAX_CUSTOM_TAGS, each checked by parseCustomTag (errors on
 * `customTags.<i>`), not repeating another (folded: case and accents) or a
 * list label; at most MAX_PROFILE_TAGS chips in all. 400 with fieldErrors
 * keyed `profileTags`, `customTags` and `customTags.<i>`.
 */
export function parseOrganiserTags(body: Record<string, unknown>): OrganiserTagsInput {
  const errors: Record<string, string> = {};

  let profileTags: OrganiserTag[] = [];
  const rawProfile = body.profileTags;
  if (!Array.isArray(rawProfile)) {
    errors.profileTags = "Choose categories from the list (an empty list for none).";
  } else if (rawProfile.length > ORGANISER_TAGS.length || !rawProfile.every(isOrganiserTag)) {
    errors.profileTags = "Choose categories from the list.";
  } else {
    profileTags = inTagOrder(rawProfile);
    if (profileTags.length > MAX_PROFILE_TAGS) errors.profileTags = `Choose up to ${MAX_PROFILE_TAGS}.`;
  }

  const customTags: string[] = [];
  const rawCustom = body.customTags;
  if (!Array.isArray(rawCustom)) {
    errors.customTags = "Send your own words as a list (an empty list for none).";
  } else if (rawCustom.length > MAX_CUSTOM_TAGS) {
    errors.customTags = `Add up to ${MAX_CUSTOM_TAGS} of your own.`;
  } else {
    const seen = new Set<string>();
    rawCustom.forEach((raw, i) => {
      const parsed = parseCustomTag(raw);
      if (!parsed.ok) {
        errors[`customTags.${i}`] = parsed.error;
        return;
      }
      const key = customTagKey(parsed.value);
      if (seen.has(key)) {
        errors[`customTags.${i}`] = "You've already added this one.";
      } else if (isTagLabel(parsed.value)) {
        errors[`customTags.${i}`] = "That's in the list: choose it there instead.";
      } else {
        seen.add(key);
        customTags.push(parsed.value);
      }
    });
  }

  if (!errors.profileTags && !errors.customTags && profileTags.length + customTags.length > MAX_PROFILE_TAGS) {
    errors.customTags = `Choose up to ${MAX_PROFILE_TAGS} in all, your own words included.`;
  }
  if (Object.keys(errors).length > 0) fail(errors);
  return { profileTags, customTags };
}

/**
 * PUT /api/organisers/me/tags — body {profileTags, customTags}
 * (OrganiserTagsInput): the whole new set of chips on the caller's public
 * profile. An approved organiser only (403, checked before the body is read);
 * 400 as parseOrganiserTags; 409 if the organiser stopped being approved
 * before the write. 200 with the caller's organiser record (unchanged, and
 * nothing logged, if it already was so), `private, no-store`.
 */
export const putMyOrganiserTags: Handler = async (req, _params, { db, verifyAccessToken }) => {
  const caller = await requireCaller(req, verifyAccessToken);
  const organiser = await findOrganiserByOwner(db, caller.userId);
  if (!organiser || organiser.status !== "approved") throw new HttpError(403, NOT_APPROVED);

  const { profileTags, customTags } = parseOrganiserTags(await readJson(req));
  const [{ result }] = await db.query<{ result: "updated" | "unchanged" | "not_approved" | "not_found" }>(
    `select private.set_organiser_tags($1, $2::text[], $3::text[]) as result`,
    [caller.userId, profileTags, customTags],
  );
  if (result === "not_found") throw new HttpError(404, NO_ORGANISER);
  if (result === "not_approved") throw new HttpError(409, "Your organiser status changed — refresh and try again.");
  const record = await findOrganiserByOwner(db, caller.userId);
  if (!record) throw new HttpError(404, NO_ORGANISER);
  return okPrivate(toOwnOrganiserView(record));
};
