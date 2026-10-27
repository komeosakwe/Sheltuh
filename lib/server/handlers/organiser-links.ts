import { createHash, randomBytes } from "node:crypto";
import type {
  AdminOrganiserLinkCreated,
  OrganiserLinkJoinResult,
  OrganiserLinkView,
} from "@/lib/api/types";
import { ORGANISER_JOIN_PATH, ORGANISER_LINK_DAYS, ORGANISER_LINK_UNAVAILABLE } from "@/lib/invites";
import type { EventCategory } from "@/lib/types";
import { requireAdmin, requireVerifiedCaller } from "../auth";
import { clientIp, clientKey } from "../client-key";
import type { Db } from "../db";
import type { Deps } from "../deps";
import { createdPrivate, HttpError, okPrivate, readJson } from "../http";
import { decodeCursor, isUuid, parseLimit, toPage } from "../pagination";
import { ADMIN_ORGANISER_LINK_SELECT, toAdminOrganiserLink } from "../records";
import type { Handler } from "../route";
import { fail, requireCategories, requireString } from "../validation";

/**
 * Organiser links (docs/architecture.md, "Organiser links";
 * supabase/migrations/20261111000500_organiser_invite_links.sql). An admin
 * makes a link with no email or details and sends it however they like;
 * whoever opens it signs up or signs in as usual (any address, verified),
 * types their organiser name, and becomes an approved organiser. Each link
 * works once, for 7 days, and can be cancelled until it's used. The link is
 * `/organisers/join#token=…`: the token is in the fragment, so it's never in
 * a server log or a Referer, and only its SHA-256 is stored. The token is
 * never logged, and is in no response but the admin's create.
 *
 * Unlike an emailed invite, nothing here asks Supabase Auth for anything
 * (no SUPABASE_ADMIN_INVITE_KEY): the person uses the ordinary sign-up or
 * sign-in.
 */
export const ORGANISER_LINK_LIMITS = {
  /** How long a link works (lib/invites.ts ORGANISER_LINK_DAYS, which the pages say). */
  linkDays: ORGANISER_LINK_DAYS,
  /** Links made, per admin. */
  adminHourly: { hits: 20, window: "1 hour" },
  /** Links made, platform-wide: each one can make an approved organiser. */
  platformDaily: { hits: 50, window: "1 day" },
  /** Join attempts per account, whatever the outcome. */
  joinsPerAccount: { bucket: "organiser_link_joins", hits: 10, window: "1 hour" },
  /** Join attempts per client (IP address, keyed: lib/server/client-key.ts), whatever the outcome. */
  joinsPerClient: { bucket: "organiser_link_joins", hits: 30, window: "1 hour" },
  /** Link checks (the join page opening) per client, whatever the outcome. */
  viewsPerClient: { bucket: "organiser_link_views", hits: 60, window: "1 hour" },
} as const;

/** 32 random bytes, base64url: 43 characters (as lib/link-token.ts). */
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const hashToken = (token: string) => createHash("sha256").update(token, "utf8").digest("hex");

/** Mirrors the organisers.display_name check constraint, as the application does (parseApplication). */
const MAX_DISPLAY_NAME_LENGTH = 120;

const LINK_NOT_FOUND = "Organiser link not found.";

/**
 * Unknown, used, expired or cancelled: one answer for all of them, so the
 * link's history isn't revealed to whoever holds it.
 */
function unavailable(): never {
  throw new HttpError(404, ORGANISER_LINK_UNAVAILABLE, undefined, { code: "unavailable" });
}

/** A well-formed token from the body, or the same 404 as an unknown one (a link cut short reads as unusable). */
function readToken(body: Record<string, unknown>): string {
  const token = typeof body.token === "string" ? body.token : "";
  if (!TOKEN_PATTERN.test(token)) unavailable();
  return token;
}

/**
 * The secret client keys are salted with (as checkout's and the invites'
 * limits), or undefined when it isn't configured (logged): the per-client
 * limits then fail open.
 */
function rateLimitSecret(deps: Deps): string | undefined {
  try {
    return deps.stripeWebhookSecret();
  } catch {
    console.error("STRIPE_WEBHOOK_SECRET isn't set: the organiser links' per-client limit was skipped.");
    return undefined;
  }
}

/** One hit on this client's counter: false when it's over. Fails open (logged) without a secret or client IP. */
async function takeClientHit(
  req: Request,
  deps: Deps,
  limit: { bucket: string; hits: number; window: string },
): Promise<boolean> {
  const secret = rateLimitSecret(deps);
  if (!secret) return true;
  const ip = clientIp(req);
  if (!ip) {
    console.warn("Organiser link request without a client IP header: the per-client limit was skipped.");
    return true;
  }
  const [row] = await deps.db.query<{ allowed: boolean }>(
    `select private.take_client_rate_limit($1, $2, $3, $4::interval) as allowed`,
    [clientKey(ip, secret), limit.bucket, limit.hits, limit.window],
  );
  return row.allowed;
}

const TOO_MANY = "That's been tried a lot. Wait a while, then try again.";

// ---------------------------------------------------------------------------
// Admins
// ---------------------------------------------------------------------------

async function readAdminLink(db: Db, linkId: string) {
  const [row] = await db.query(`${ADMIN_ORGANISER_LINK_SELECT} where l.id = $1`, [linkId]);
  return row ? toAdminOrganiserLink(row) : undefined;
}

/**
 * GET /api/admin/organiser-links?cursor&limit — admin. Every link, newest
 * first, with its state (`expired` worked out from its expiry), who made it,
 * and the organiser it made. Never a token or its hash.
 */
export const adminListOrganiserLinks: Handler = async (req, _params, { db, verifyAccessToken }) => {
  await requireAdmin(req, verifyAccessToken);
  const url = new URL(req.url);
  const offset = decodeCursor(url.searchParams.get("cursor"));
  const limit = parseLimit(url.searchParams.get("limit"));
  const rows = await db.query(
    `${ADMIN_ORGANISER_LINK_SELECT} order by l.created_at desc, l.id desc limit $1 offset $2`,
    [limit + 1, offset],
  );
  return okPrivate(toPage(rows.map(toAdminOrganiserLink), offset, limit));
};

/**
 * POST /api/admin/organiser-links — admin; no body. A new link, valid 7
 * days. 201 {link, url} (private, no-store): the only time the URL (and its
 * token) is ever sent; 429 over 20 an hour (this admin) or 50 a day
 * (everyone).
 */
export const adminCreateOrganiserLink: Handler = async (req, _params, deps) => {
  const admin = await requireAdmin(req, deps.verifyAccessToken);
  const token = randomBytes(32).toString("base64url");
  const [row] = await deps.db.query<{ result: string; link_id: string | null }>(
    `select * from private.create_organiser_invite_link($1, $2, $3::interval, $4, $5::interval, $6, $7::interval)`,
    [
      admin.userId,
      hashToken(token),
      `${ORGANISER_LINK_LIMITS.linkDays} days`,
      ORGANISER_LINK_LIMITS.adminHourly.hits,
      ORGANISER_LINK_LIMITS.adminHourly.window,
      ORGANISER_LINK_LIMITS.platformDaily.hits,
      ORGANISER_LINK_LIMITS.platformDaily.window,
    ],
  );
  if (row.result === "rate_limited") {
    throw new HttpError(
      429,
      `That's a lot of organiser links. You can make ${ORGANISER_LINK_LIMITS.adminHourly.hits} an hour, and the team ${ORGANISER_LINK_LIMITS.platformDaily.hits} a day. Try again later.`,
    );
  }
  if (row.result !== "created") throw new Error(`Unexpected create_organiser_invite_link result: ${row.result}`);
  const link = await readAdminLink(deps.db, row.link_id as string);
  if (!link) throw new HttpError(404, LINK_NOT_FOUND); // deleted meanwhile
  const result: AdminOrganiserLinkCreated = {
    link,
    url: `${deps.siteUrl()}${ORGANISER_JOIN_PATH}#token=${token}`,
  };
  return createdPrivate(result);
};

/**
 * POST /api/admin/organiser-links/[linkId]/cancel — admin. The link stops
 * working at once. 200 the link; 404; 409 not active (used, cancelled or
 * expired). One conditional update, so a cancel racing a join can't both
 * succeed.
 */
export const adminCancelOrganiserLink: Handler<{ linkId: string }> = async (req, { linkId }, { db, verifyAccessToken }) => {
  const admin = await requireAdmin(req, verifyAccessToken);
  if (!isUuid(linkId)) throw new HttpError(404, LINK_NOT_FOUND);
  const [cancelled] = await db.query<{ id: string }>(
    `update private.organiser_invite_links set status = 'cancelled', cancelled_at = now(), cancelled_by = $2
      where id = $1 and status = 'active' and expires_at > now()
      returning id`,
    [linkId, admin.userId],
  );
  const link = await readAdminLink(db, linkId);
  if (!link) throw new HttpError(404, LINK_NOT_FOUND);
  if (!cancelled) throw new HttpError(409, "Only a link that hasn't been used or expired can be cancelled.");
  return okPrivate(link);
};

// ---------------------------------------------------------------------------
// The person joining
// ---------------------------------------------------------------------------

/**
 * POST /api/organiser-links/view {token} — public (the token is the
 * credential). Read-only, so opening the link (or a chat app's preview
 * fetching the page) changes nothing. 200 {expiresAt}; 404 `code:
 * "unavailable"` for a malformed, unknown, used, expired or cancelled link,
 * or one whose creator is no longer an admin (one answer for all); 429 over
 * 60 an hour from this client.
 */
export const viewOrganiserLink: Handler = async (req, _params, deps) => {
  const token = readToken(await readJson(req));
  if (!(await takeClientHit(req, deps, ORGANISER_LINK_LIMITS.viewsPerClient))) throw new HttpError(429, TOO_MANY);
  const [row] = await deps.db.query<{ expires_at: string | Date }>(
    `select l.expires_at from private.organiser_invite_links l
      where l.token_hash = $1 and l.status = 'active' and l.expires_at > now()
        and private.account_invite_inviter_is_admin(l.created_by)`,
    [hashToken(token)],
  );
  if (!row) unavailable();
  const view: OrganiserLinkView = { expiresAt: new Date(row.expires_at).toISOString() };
  return okPrivate(view);
};

/** The new organiser's name and categories, if sent (the application's rules); null when neither is. */
function parseDetails(body: Record<string, unknown>): { displayName: string; categories: EventCategory[] } | null {
  if (body.displayName === undefined && body.categories === undefined) return null;
  const errors: Record<string, string> = {};
  const displayName = requireString(body.displayName, "displayName", errors, MAX_DISPLAY_NAME_LENGTH);
  const categories = requireCategories(body.categories, "categories", errors);
  if (Object.keys(errors).length > 0) fail(errors);
  return { displayName, categories };
}

/**
 * POST /api/organiser-links/join {token, displayName?, categories?} — a
 * signed-in caller with a verified email. Joins with the link
 * (private.join_with_organiser_invite_link, one transaction): an account
 * with no organiser gets a new one, approved (`displayName` and
 * `categories` required, the application's rules; their verified email is
 * its contact email); a pending application is approved as it is. The link
 * is then used up. Idempotent for the account that used it.
 * 200 {organiserId, displayName}; 400 malformed fields (or none for a new
 * organiser); 401; 403 email not verified; 404 `code: "unavailable"`
 * (malformed, unknown, used by another account, expired, cancelled); 409
 * `code: "already_organiser"` (approved) or `"rejected"` (rejected or
 * taken down), with the link left unused, or `"conflict"` (an application
 * arrived at the same moment: try again); 429 over 10 an hour for this
 * account or 30 from this client.
 */
export const joinWithOrganiserLink: Handler = async (req, _params, deps) => {
  const caller = await requireVerifiedCaller(req, deps.verifyAccessToken);
  const body = await readJson(req);
  const token = readToken(body);
  const details = parseDetails(body);

  const { bucket, hits, window } = ORGANISER_LINK_LIMITS.joinsPerAccount;
  const [account] = await deps.db.query<{ allowed: boolean }>(
    `select private.take_rate_limit($1, $2, $3, $4::interval) as allowed`,
    [caller.userId, bucket, hits, window],
  );
  if (!account.allowed || !(await takeClientHit(req, deps, ORGANISER_LINK_LIMITS.joinsPerClient))) {
    throw new HttpError(429, TOO_MANY);
  }

  const [row] = await deps.db.query<{ result: string; organiser_id: string | null }>(
    `select * from private.join_with_organiser_invite_link($1, $2, $3, $4, $5::text::jsonb)`,
    [
      hashToken(token),
      caller.userId,
      caller.email,
      details?.displayName ?? null,
      details ? JSON.stringify(details.categories) : null,
    ],
  );
  switch (row.result) {
    case "joined":
    case "already_joined": {
      const [organiser] = await deps.db.query<{ display_name: string }>(
        `select o.display_name from public.organisers o where o.id = $1`,
        [row.organiser_id],
      );
      if (!organiser) unavailable(); // deleted meanwhile
      const result: OrganiserLinkJoinResult = {
        organiserId: row.organiser_id as string,
        displayName: organiser.display_name,
      };
      return okPrivate(result);
    }
    case "unavailable":
      return unavailable();
    case "details_required":
      return fail({
        displayName: "Enter your organiser name.",
        categories: "Choose at least one category.",
      });
    case "already_organiser":
      throw new HttpError(
        409,
        "Your account is already an organiser, so this link wasn't used. Pass it back to whoever sent it.",
        undefined,
        { code: "already_organiser" },
      );
    case "rejected":
      throw new HttpError(
        409,
        "Your account's organiser profile isn't active, so this link wasn't used. Contact the Sheltüh team.",
        undefined,
        { code: "rejected" },
      );
    case "conflict":
      throw new HttpError(409, "Your organiser status just changed. Try again.", undefined, { code: "conflict" });
    default:
      throw new Error(`Unexpected join_with_organiser_invite_link result: ${row.result}`);
  }
};
