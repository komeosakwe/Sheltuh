import { requireAdmin, requireCaller, requireVerifiedCaller } from "../auth";
import { HttpError, okPrivate, readJson } from "../http";
import { parseMessageText } from "../message-input";
import { isUuid } from "../pagination";
import {
  ADMIN_PROFILE_SELECT,
  avatarVersionOf,
  conversationVisibleTo,
  EVENT_SELECT,
  toAdminMemberProfile,
  toMemberProfile,
  toPublicEventFromRow,
} from "../records";
import type { Handler } from "../route";
import type { ProfileContentField } from "../types";
import { fail } from "../validation";

/**
 * Member profiles (docs/architecture.md, "Member profiles"): another member's
 * opt-in profile and photo. Who may see one is decided in one place,
 * private.member_profile_visible: the viewer has a profile; neither is
 * suspended; neither blocks the other; and the profile is visible (or the
 * viewer's own). Plus, here, a verified email. Anything else is the same 404
 * as a profile that doesn't exist, so nobody learns whether it does. Every
 * response is private and never stored by shared caches.
 */

const NOT_FOUND = "Profile not found.";

/**
 * Profile views per member per window, like the Who's Going list: well above
 * anyone browsing, well below a scrape.
 */
export const PROFILE_VIEW_RATE_LIMIT = { hits: 30, window: "10 minutes" } as const;

/** Most events a profile lists. */
export const PROFILE_EVENT_LIMIT = 24;

/**
 * Photo fetches per member per window (304s included): far above a member
 * scrolling Who's Going lists and conversations (each list page is itself
 * rate-limited), and a bound on bulk downloading. Admins aren't limited.
 */
export const AVATAR_VIEW_RATE_LIMIT = { hits: 600, window: "10 minutes" } as const;

/**
 * Admins can read any member's profile and photos (moderation). Each such
 * read is logged, by the admin's account id and opaque ids only (never the
 * member's name, content or account id), so access can be audited.
 */
export function logAdminRead(adminId: string, what: string): void {
  console.info(`Admin ${adminId} read ${what}.`);
}

/**
 * A photo response. `private, no-cache` with an ETag: the browser may keep
 * it, but asks again every time, and every request passes the visibility
 * check before a 304, so a block or a hidden profile applies at once.
 * `Cross-Origin-Resource-Policy` stops other sites embedding it.
 */
export function avatarResponse(req: Request, data: Uint8Array, version: string, thumb: boolean): Response {
  const etag = `"${version}-${thumb ? "t" : "f"}"`;
  const headers = {
    "content-type": "image/webp",
    "x-content-type-options": "nosniff",
    "cache-control": "private, no-cache",
    "cross-origin-resource-policy": "same-origin",
    etag,
  };
  if (req.headers.get("if-none-match") === etag) return new Response(null, { status: 304, headers });
  return new Response(new Uint8Array(data), { status: 200, headers });
}

/**
 * GET /api/profiles/[profileId] — verified members with a profile that isn't
 * suspended; rate-limited (429). The display name, bio, Instagram handle,
 * photo, the open events the member has opted in to, and whether the caller
 * can message them. 404 for anything the caller may not see.
 */
export const getMemberProfile: Handler<{ profileId: string }> = async (req, { profileId }, { db, verifyAccessToken }) => {
  const caller = await requireVerifiedCaller(req, verifyAccessToken);
  if (!isUuid(profileId)) throw new HttpError(404, NOT_FOUND);

  const [viewer] = await db.query<{ eligible: boolean }>(
    `select exists (select 1 from public.profiles p where p.user_id = $1)
            and not exists (select 1 from private.social_suspensions s where s.user_id = $1) as eligible`,
    [caller.userId],
  );
  // Not eligible to see any profile: the same 404, rather than saying why.
  if (!viewer.eligible) throw new HttpError(404, NOT_FOUND);

  const [{ allowed }] = await db.query<{ allowed: boolean }>(
    `select private.take_rate_limit($1, 'member_profiles', $2, $3::interval) as allowed`,
    [caller.userId, PROFILE_VIEW_RATE_LIMIT.hits, PROFILE_VIEW_RATE_LIMIT.window],
  );
  if (!allowed) throw new HttpError(429, "Too many requests. Try again in a few minutes.");

  // One statement: who it is (if visible), and the messaging state between them.
  // Messaging mirrors private.request_conversation: a shared open event both
  // are opted in to, and no conversation ever (conversation_pairs).
  const [row] = await db.query(
    `with t as (select private.member_profile_visible($1, $2) as user_id)
     select p.public_id, p.display_name, p.bio, p.instagram_handle, p.user_id = $1 as is_you,
            ${avatarVersionOf("p.user_id")} as avatar_version,
            (p.user_id <> $1
              and exists (select 1 from public.event_attendees a
                            join public.event_attendees mine on mine.event_id = a.event_id and mine.user_id = $1
                            join public.events e on e.id = a.event_id
                           where a.user_id = p.user_id and e.status = 'published' and e.whos_going_enabled
                             and e.ends_at > now() and e.ticketing_mode = 'sheltuh')
              and not exists (select 1 from private.conversation_pairs cp
                               where cp.user_low = least($1, p.user_id) and cp.user_high = greatest($1, p.user_id))
            ) as can_message,
            (select c.id from public.conversations c
              where c.user_low = least($1, p.user_id) and c.user_high = greatest($1, p.user_id)
                and ${conversationVisibleTo("$1")}) as conversation_id
       from t join public.profiles p on p.user_id = t.user_id`,
    [caller.userId, profileId],
  );
  if (!row) throw new HttpError(404, NOT_FOUND);

  const events = await db.query(
    `${EVENT_SELECT}
      where e.id in (select a.event_id from public.event_attendees a
                      join public.profiles p on p.user_id = a.user_id
                     where p.public_id = $1)
        and e.status = 'published' and e.whos_going_enabled and e.ends_at > now() and e.ticketing_mode = 'sheltuh'
      order by e.starts_at, e.id
      limit $2`,
    [profileId, PROFILE_EVENT_LIMIT],
  );

  return okPrivate(
    toMemberProfile(row, events.map(toPublicEventFromRow), {
      canMessage: row.can_message === true,
      conversationId: (row.conversation_id as string | null) ?? undefined,
    }),
  );
};

/**
 * GET /api/profiles/[profileId]/avatar[?size=thumb] — the photo (512 px, or
 * the 96 px thumbnail), never public: verified members who may see the
 * profile (the same rule as GET /profiles/{id}), rate-limited (429), and
 * admins (moderation, logged), whatever its visibility. 404 otherwise.
 */
export const getMemberAvatar: Handler<{ profileId: string }> = async (req, { profileId }, { db, verifyAccessToken }) => {
  const caller = await requireCaller(req, verifyAccessToken);
  if (!caller.isAdmin && (!caller.emailVerified || !caller.email)) {
    throw new HttpError(403, "Verify your email address first.");
  }
  if (!isUuid(profileId)) throw new HttpError(404, NOT_FOUND);
  if (!caller.isAdmin) {
    const [{ allowed }] = await db.query<{ allowed: boolean }>(
      `select private.take_rate_limit($1, 'avatar_views', $2, $3::interval) as allowed`,
      [caller.userId, AVATAR_VIEW_RATE_LIMIT.hits, AVATAR_VIEW_RATE_LIMIT.window],
    );
    if (!allowed) throw new HttpError(429, "Too many requests. Try again in a few minutes.");
  }
  const thumb = new URL(req.url).searchParams.get("size") === "thumb";
  const [row] = await db.query<{ data: Uint8Array; version: string }>(
    `select case when $3 then a.thumb else a.image end as data,
            floor(extract(epoch from a.updated_at) * 1000)::bigint::text as version
       from public.profiles p
       join private.profile_avatars a on a.user_id = p.user_id
      where p.public_id = $2
        and ($4 or p.user_id = private.member_profile_visible($1, $2))`,
    [caller.userId, profileId, thumb, caller.isAdmin],
  );
  if (!row) throw new HttpError(404, "Photo not found.");
  if (caller.isAdmin) logAdminRead(caller.userId, `the ${thumb ? "thumbnail" : "photo"} of member profile ${profileId}`);
  return avatarResponse(req, row.data, row.version, thumb);
};

// ---------------------------------------------------------------------------
// Admin
// ---------------------------------------------------------------------------

const CONTENT_FIELDS: readonly ProfileContentField[] = ["avatar", "bio", "instagram"];

/** GET /api/admin/profiles/[profileId] — admin: the profile whatever its visibility, and its moderation log. Logged. */
export const adminGetMemberProfile: Handler<{ profileId: string }> = async (
  req,
  { profileId },
  { db, verifyAccessToken },
) => {
  const admin = await requireAdmin(req, verifyAccessToken);
  if (!isUuid(profileId)) throw new HttpError(404, NOT_FOUND);
  const [row] = await db.query(`${ADMIN_PROFILE_SELECT} where p.public_id = $1`, [profileId]);
  if (!row) throw new HttpError(404, NOT_FOUND);
  logAdminRead(admin.userId, `member profile ${profileId}`);
  return okPrivate(toAdminMemberProfile(row));
};

/**
 * POST /api/admin/profiles/[profileId]/remove-content {fields, reason} —
 * admin: removes the member's photo, bio and/or Instagram handle
 * (private.admin_remove_profile_content), logged with the admin and reason
 * (never the content). 200 with the profile and `removed` (empty when none
 * of them was set: nothing logged); 400; 404.
 */
export const adminRemoveProfileContent: Handler<{ profileId: string }> = async (
  req,
  { profileId },
  { db, verifyAccessToken },
) => {
  const admin = await requireAdmin(req, verifyAccessToken);
  const body = await readJson(req);
  const errors: Record<string, string> = {};
  const fields = body.fields;
  if (
    !Array.isArray(fields) ||
    fields.length === 0 ||
    !fields.every((f) => CONTENT_FIELDS.includes(f as ProfileContentField))
  ) {
    errors.fields = "Choose what to remove: avatar, bio or instagram.";
  }
  const reason = parseMessageText(body.reason, "reason", errors, { allowLinks: true, label: "Reasons", maxLength: 500 });
  if (Object.keys(errors).length > 0) fail(errors);
  if (!isUuid(profileId)) throw new HttpError(404, NOT_FOUND);

  const [result] = await db.query<{ result: string; removed: ProfileContentField[] }>(
    `select * from private.admin_remove_profile_content($1, $2, $3::text[], $4)`,
    [admin.userId, profileId, [...new Set(fields as string[])], reason],
  );
  if (result.result === "not_found") throw new HttpError(404, NOT_FOUND);
  if (result.result !== "removed" && result.result !== "unchanged") {
    throw new Error(`Unexpected admin_remove_profile_content result: ${result.result}`);
  }
  const [row] = await db.query(`${ADMIN_PROFILE_SELECT} where p.public_id = $1`, [profileId]);
  return okPrivate({ ...toAdminMemberProfile(row), removed: result.removed ?? [] });
};
