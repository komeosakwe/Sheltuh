import { createHash, randomBytes } from "node:crypto";
import type {
  AcceptInviteResult,
  AdminInviteSendResult,
  InviteAccountLink,
  InviteKind,
  InviteStatus,
  InviteView,
  MyInvite,
} from "@/lib/api/types";
import { requireAdmin, requireVerifiedCaller } from "../auth";
import { AuthAdminError } from "../auth-admin";
import { clientIp, clientKey } from "../client-key";
import type { Db } from "../db";
import type { Deps } from "../deps";
import { maskEmail, redactForLog } from "../email-address";
import { createdPrivate, HttpError, okPrivate, readJson } from "../http";
import { buildInviteEmail, inviteLink } from "../invite-email";
import { decodeCursor, isUuid, parseLimit, toPage } from "../pagination";
import { ADMIN_INVITE_SELECT, toAdminInvite } from "../records";
import type { Handler } from "../route";
import { fail, requireEmail } from "../validation";
import { parseApplication } from "./organisers";

/**
 * Account invites (docs/architecture.md, "Account invites";
 * supabase/migrations/20261108000000_account_invites.sql). An admin invites
 * someone who asked to join, as an organiser (approved once they accept) or
 * a member; we email them `/invite#token=…` ourselves. On that page,
 * "Create account" asks Supabase Auth for a sign-up token just in time
 * (lib/server/auth-admin.ts), and the signed-in invitee with a verified email
 * equal to the invite's accepts it. Only the token's SHA-256 is stored; the
 * address and the token are never logged.
 */
export const INVITE_LIMITS = {
  /** How long a link works. */
  linkDays: 14,
  /** Invites created or resent, per admin. */
  adminHourly: { hits: 20, window: "1 hour" },
  /** Invites created or resent, platform-wide (the shared Workspace SMTP quota is about 2,000 a day). */
  platformDaily: { hits: 100, window: "1 day" },
  /** No resend sooner than this after the last send. */
  resendCooldown: "60 seconds",
  /** Sign-up tokens requested with one link. */
  linksPerInvite: 10,
  /** "Create account" requests per client (IP address, keyed: lib/server/client-key.ts). */
  linkRequestsPerClient: { bucket: "invite_account_links", hits: 20, window: "1 hour" },
} as const;

/** 32 random bytes, base64url: 43 characters (lib/link-token.ts). */
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const hashToken = (token: string) => createHash("sha256").update(token, "utf8").digest("hex");

const STATUSES: readonly InviteStatus[] = ["pending", "accepted", "revoked", "expired"];
const KINDS: readonly InviteKind[] = ["organiser", "member"];

const INVITE_NOT_FOUND = "Invite not found.";
const LINK_NOT_FOUND = "This invite link isn't valid. Check it's the whole link from your email.";
const UNAVAILABLE = "Invites aren't available right now. Try again later.";
const ACCOUNT_SETUP_UNAVAILABLE = "We can't set up your account from here right now. Create your account with the sign-up form instead.";

/** Why an invite can't be used any more: a 410 with a `code` the invite page tells apart. */
function gone(reason: "expired" | "revoked" | "used"): never {
  const message =
    reason === "expired"
      ? "This invite has expired. Ask the Sheltüh team to send you a new one."
      : reason === "revoked"
        ? "This invite has been withdrawn. Contact the Sheltüh team if you think that's a mistake."
        : "This invite has already been used. Sign in to continue.";
  throw new HttpError(410, message, undefined, { code: reason });
}

function readToken(body: Record<string, unknown>): string {
  const token = typeof body.token === "string" ? body.token : "";
  if (!TOKEN_PATTERN.test(token)) fail({ token: "This link is incomplete. Open it from your email again." });
  return token;
}

/** A new link: the token (emailed, never stored) and its hash (stored). */
function newToken(): { token: string; tokenHash: string } {
  const token = randomBytes(32).toString("base64url");
  return { token, tokenHash: hashToken(token) };
}

// ---------------------------------------------------------------------------
// Admins
// ---------------------------------------------------------------------------

/** The organisers columns an organiser invite's organiser is created with (private.accept_account_invite). */
type OrganiserProfile = Record<string, string | string[] | null>;

function parseCreateBody(body: Record<string, unknown>): {
  kind: InviteKind;
  email: string;
  profile: OrganiserProfile | null;
} {
  const errors: Record<string, string> = {};
  const kind = KINDS.includes(body.kind as InviteKind) ? (body.kind as InviteKind) : undefined;
  if (!kind) errors.kind = "Choose Organiser or Member.";
  const email = requireEmail(body.email, "email", errors);
  if (body.consent !== true) errors.consent = "Confirm they asked to be invited.";

  let profile: OrganiserProfile | null = null;
  if (kind === "organiser") {
    if (!body.organiser || typeof body.organiser !== "object" || Array.isArray(body.organiser)) {
      errors.organiser = "Enter the organiser's details.";
    } else {
      // The application's fields and rules (the bio included), as for a platform-managed organiser.
      try {
        const input = parseApplication(body.organiser as Record<string, unknown>);
        profile = {
          display_name: input.displayName,
          contact_email: input.contactEmail,
          description: input.description,
          categories: input.categories,
          website_url: input.websiteUrl,
          instagram_handle: input.handles.instagramHandle ?? null,
          tiktok_handle: input.handles.tiktokHandle ?? null,
          facebook_page: input.handles.facebookPage ?? null,
          x_handle: input.handles.xHandle ?? null,
          featured_video_provider: input.featuredVideo?.provider ?? null,
          featured_video_id: input.featuredVideo?.id ?? null,
        };
      } catch (err) {
        if (!(err instanceof HttpError) || err.statusCode !== 400 || !err.fieldErrors) throw err;
        for (const [field, message] of Object.entries(err.fieldErrors)) errors[`organiser.${field}`] = message;
      }
    }
  } else if (kind === "member" && body.organiser !== undefined && body.organiser !== null) {
    errors.organiser = "A member invite has no organiser details.";
  }

  if (Object.keys(errors).length > 0 || !kind) fail(errors);
  return { kind, email, profile };
}

async function readAdminInvite(db: Db, inviteId: string) {
  const [row] = await db.query(`${ADMIN_INVITE_SELECT} where i.id = $1`, [inviteId]);
  return row ? toAdminInvite(row) : undefined;
}

/**
 * Emails an invite's link. Never throws: a failure is recorded on the invite
 * (only if `tokenHash` is still its link) and logged without the address or
 * the token. Returns whether it was sent.
 */
async function sendInviteEmail(deps: Deps, inviteId: string, token: string, tokenHash: string): Promise<boolean> {
  try {
    const [invite] = await deps.db.query<{ email: string; kind: InviteKind; organiser_name: string | null }>(
      `select i.email, i.kind, i.organiser_profile ->> 'display_name' as organiser_name
         from private.account_invites i where i.id = $1`,
      [inviteId],
    );
    if (!invite) throw new Error("the invite no longer exists");
    await deps.sendEmail(
      buildInviteEmail({
        to: invite.email,
        kind: invite.kind,
        organiserName: invite.organiser_name ?? undefined,
        link: inviteLink(deps.siteUrl(), token),
        daysValid: INVITE_LIMITS.linkDays,
        siteUrl: deps.siteUrl(),
      }),
    );
    return true;
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown error";
    console.error("Invite email failed:", redactForLog(message.split(token).join("[token]")));
    try {
      await deps.db.query(
        `update private.account_invites set last_send_failed_at = now() where id = $1 and token_hash = $2`,
        [inviteId, tokenHash],
      );
    } catch {
      console.error("Invite email failure could not be recorded.");
    }
    return false;
  }
}

const ALLOWANCE_USED = `You've sent a lot of invites. You can send ${INVITE_LIMITS.adminHourly.hits} an hour, and the team ${INVITE_LIMITS.platformDaily.hits} a day. Try again later.`;

/**
 * GET /api/admin/invites?status&cursor&limit — admin. Invites in one status
 * (default `pending`), newest first. `expired` includes pending invites whose
 * link has run out (and `pending` leaves them out).
 */
export const adminListInvites: Handler = async (req, _params, { db, verifyAccessToken }) => {
  await requireAdmin(req, verifyAccessToken);
  const url = new URL(req.url);
  const status = (url.searchParams.get("status") ?? "pending") as InviteStatus;
  if (!STATUSES.includes(status)) fail({ status: "Unknown status." });
  const offset = decodeCursor(url.searchParams.get("cursor"));
  const limit = parseLimit(url.searchParams.get("limit"));
  const where =
    status === "pending"
      ? `i.status = 'pending' and i.expires_at > now()`
      : status === "expired"
        ? `(i.status = 'expired' or (i.status = 'pending' and i.expires_at <= now()))`
        : `i.status = $3`;
  const rows = await db.query(
    `${ADMIN_INVITE_SELECT} where ${where} order by i.created_at desc, i.id desc limit $1 offset $2`,
    status === "accepted" || status === "revoked" ? [limit + 1, offset, status] : [limit + 1, offset],
  );
  return okPrivate(toPage(rows.map(toAdminInvite), offset, limit));
};

/**
 * POST /api/admin/invites {kind, email, consent: true, organiser?} — admin.
 * Saves the invite, then emails the link. 201 {invite, emailSent}; 400
 * fieldErrors (`kind`, `email`, `consent`, `organiser`, `organiser.<field>`:
 * the application's rules); 409 already a pending invite for the address, or
 * (organiser) its account already has an organiser; 429 allowance; 503 when
 * invites aren't configured (nothing written).
 */
export const adminCreateInvite: Handler = async (req, _params, deps) => {
  const admin = await requireAdmin(req, deps.verifyAccessToken);
  if (!deps.authAdmin()) throw new HttpError(503, UNAVAILABLE);
  const { kind, email, profile } = parseCreateBody(await readJson(req));
  const { token, tokenHash } = newToken();
  const [row] = await deps.db.query<{ result: string; invite_id: string | null }>(
    `select * from private.create_account_invite($1, $2, $3, $4, $5::text::jsonb, $6::interval,
                                                 $7, $8::interval, $9, $10::interval)`,
    [
      admin.userId,
      kind,
      email,
      tokenHash,
      profile ? JSON.stringify(profile) : null,
      `${INVITE_LIMITS.linkDays} days`,
      INVITE_LIMITS.adminHourly.hits,
      INVITE_LIMITS.adminHourly.window,
      INVITE_LIMITS.platformDaily.hits,
      INVITE_LIMITS.platformDaily.window,
    ],
  );
  switch (row.result) {
    case "created":
      break;
    case "already_invited":
      throw new HttpError(409, "This address already has an invite waiting.", {
        email: "This address already has an invite waiting. Resend that one instead.",
      });
    case "already_organiser":
      throw new HttpError(409, "This address's account already has an organiser.", {
        email: "This address's account already has an organiser.",
      });
    case "rate_limited":
      throw new HttpError(429, ALLOWANCE_USED);
    default:
      throw new Error(`Unexpected create_account_invite result: ${row.result}`);
  }
  const inviteId = row.invite_id as string;
  const emailSent = await sendInviteEmail(deps, inviteId, token, tokenHash);
  const result: AdminInviteSendResult = { invite: (await readAdminInvite(deps.db, inviteId))!, emailSent };
  return createdPrivate(result);
};

/**
 * POST /api/admin/invites/[inviteId]/resend — admin. A new link (the old one
 * stops working), 14 days from now, emailed. A pending or expired invite.
 * 200 {invite, emailSent}; 404; 409 accepted or revoked (or the address has
 * another pending invite by now); 429 sent in the last minute, or allowance;
 * 503 when invites aren't configured.
 */
export const adminResendInvite: Handler<{ inviteId: string }> = async (req, { inviteId }, deps) => {
  const admin = await requireAdmin(req, deps.verifyAccessToken);
  if (!deps.authAdmin()) throw new HttpError(503, UNAVAILABLE);
  if (!isUuid(inviteId)) throw new HttpError(404, INVITE_NOT_FOUND);
  const { token, tokenHash } = newToken();
  const [row] = await deps.db.query<{ result: string }>(
    `select * from private.resend_account_invite($1, $2, $3, $4::interval, $5::interval, $6, $7::interval, $8, $9::interval)`,
    [
      admin.userId,
      inviteId,
      tokenHash,
      `${INVITE_LIMITS.linkDays} days`,
      INVITE_LIMITS.resendCooldown,
      INVITE_LIMITS.adminHourly.hits,
      INVITE_LIMITS.adminHourly.window,
      INVITE_LIMITS.platformDaily.hits,
      INVITE_LIMITS.platformDaily.window,
    ],
  );
  switch (row.result) {
    case "resent":
      break;
    case "not_found":
      throw new HttpError(404, INVITE_NOT_FOUND);
    case "not_pending":
      throw new HttpError(409, "This invite has been accepted or withdrawn, so it can't be resent.");
    case "already_invited":
      throw new HttpError(409, "This address has another invite waiting. Resend that one instead.");
    case "too_soon":
      throw new HttpError(429, "This invite was sent less than a minute ago. Wait a minute, then resend it.");
    case "rate_limited":
      throw new HttpError(429, ALLOWANCE_USED);
    default:
      throw new Error(`Unexpected resend_account_invite result: ${row.result}`);
  }
  const emailSent = await sendInviteEmail(deps, inviteId, token, tokenHash);
  const result: AdminInviteSendResult = { invite: (await readAdminInvite(deps.db, inviteId))!, emailSent };
  return okPrivate(result);
};

/**
 * POST /api/admin/invites/[inviteId]/revoke — admin. The link stops working
 * at once. 200 the invite; 404; 409 not pending (accepted, revoked, or
 * expired). One conditional update, so a revoke racing an acceptance can't
 * both succeed.
 */
export const adminRevokeInvite: Handler<{ inviteId: string }> = async (req, { inviteId }, { db, verifyAccessToken }) => {
  const admin = await requireAdmin(req, verifyAccessToken);
  if (!isUuid(inviteId)) throw new HttpError(404, INVITE_NOT_FOUND);
  const [revoked] = await db.query<{ id: string }>(
    `update private.account_invites set status = 'revoked', revoked_at = now(), revoked_by = $2
      where id = $1 and status = 'pending' and expires_at > now()
      returning id`,
    [inviteId, admin.userId],
  );
  const invite = await readAdminInvite(db, inviteId);
  if (!invite) throw new HttpError(404, INVITE_NOT_FOUND);
  if (!revoked) throw new HttpError(409, "Only an invite that's still waiting can be withdrawn.");
  return okPrivate(invite);
};

// ---------------------------------------------------------------------------
// The invitee
// ---------------------------------------------------------------------------

/**
 * POST /api/invites/view {token} — public (the emailed token is the
 * credential). Read-only, so opening the link (or a mail scanner doing so)
 * changes nothing. 200 InviteView; 400 malformed; 404 unknown; 410 expired,
 * revoked or used (`code`).
 */
export const viewInvite: Handler = async (req, _params, deps) => {
  const token = readToken(await readJson(req));
  const [row] = await deps.db.query<{
    kind: InviteKind;
    email: string;
    status: InviteStatus;
    lapsed: boolean;
    expires_at: string | Date;
    organiser_name: string | null;
    has_account: boolean;
  }>(
    `select i.kind, i.email, i.status, i.expires_at <= now() as lapsed, i.expires_at,
            i.organiser_profile ->> 'display_name' as organiser_name,
            exists (select 1 from auth.users u
                     where lower(u.email) = lower(i.email) and u.email_confirmed_at is not null) as has_account
       from private.account_invites i where i.token_hash = $1`,
    [hashToken(token)],
  );
  if (!row) throw new HttpError(404, LINK_NOT_FOUND);
  if (row.status === "accepted") gone("used");
  if (row.status === "revoked") gone("revoked");
  if (row.status === "expired" || row.lapsed) gone("expired");
  const view: InviteView = {
    kind: row.kind,
    maskedEmail: maskEmail(row.email),
    ...(row.organiser_name ? { organiserName: row.organiser_name } : {}),
    expiresAt: new Date(row.expires_at).toISOString(),
    account: row.has_account ? "existing" : "new",
    passwordSetup: deps.authAdmin() !== undefined,
  };
  return okPrivate(view);
};

/**
 * The secret client keys are salted with (as checkout's limits:
 * lib/server/handlers/orders.ts), or undefined when it isn't configured
 * (logged): the per-client limit then fails open.
 */
function rateLimitSecret(deps: Deps): string | undefined {
  try {
    return deps.stripeWebhookSecret();
  } catch {
    console.error("STRIPE_WEBHOOK_SECRET isn't set: the invite link requests' per-client limit was skipped.");
    return undefined;
  }
}

/** One hit on this client's "Create account" counter: false when it's over. Fails open (logged) without a secret or client IP. */
async function takeLinkRequest(req: Request, deps: Deps): Promise<boolean> {
  const secret = rateLimitSecret(deps);
  if (!secret) return true;
  const ip = clientIp(req);
  if (!ip) {
    console.warn("Invite link request without a client IP header: the per-client limit was skipped.");
    return true;
  }
  const { bucket, hits, window } = INVITE_LIMITS.linkRequestsPerClient;
  const [row] = await deps.db.query<{ allowed: boolean }>(
    `select private.take_client_rate_limit($1, $2, $3, $4::interval) as allowed`,
    [clientKey(ip, secret), bucket, hits, window],
  );
  return row.allowed;
}

const HAS_ACCOUNT = "This email address already has a Sheltüh account. Sign in to accept the invite.";
const TOO_MANY_LINKS = "That's been tried a lot. Wait a while, or ask the Sheltüh team to send a new invite.";

/**
 * POST /api/invites/account-link {token} — public (the emailed token is the
 * credential). "Create account": asks Supabase Auth for a sign-up token for
 * the invite's address (no email is sent) and returns its hash, which the
 * browser verifies (`verifyOtp`, type `invite`) before setting a password.
 * 200 {tokenHash} (private, no-store); 400; 404; 410 (`code`); 409
 * `code: "has_account"` (sign in instead); 429 over 10 per link or 20 an hour
 * from this client; 503 when it isn't configured or Supabase Auth failed
 * (the page falls back to the ordinary sign-up).
 */
export const getInviteAccountLink: Handler = async (req, _params, deps) => {
  const token = readToken(await readJson(req));
  const authAdmin = deps.authAdmin();
  if (!authAdmin) throw new HttpError(503, ACCOUNT_SETUP_UNAVAILABLE, undefined, { code: "unavailable" });
  if (!(await takeLinkRequest(req, deps))) throw new HttpError(429, TOO_MANY_LINKS);

  const [row] = await deps.db.query<{ result: string; email: string | null }>(
    `select * from private.issue_invite_account_link($1, $2)`,
    [hashToken(token), INVITE_LIMITS.linksPerInvite],
  );
  switch (row.result) {
    case "ok":
      break;
    case "not_found":
      throw new HttpError(404, LINK_NOT_FOUND);
    case "used":
    case "revoked":
    case "expired":
      return gone(row.result);
    case "has_account":
      throw new HttpError(409, HAS_ACCOUNT, undefined, { code: "has_account" });
    case "limit":
      throw new HttpError(429, TOO_MANY_LINKS);
    default:
      throw new Error(`Unexpected issue_invite_account_link result: ${row.result}`);
  }

  let link: Awaited<ReturnType<typeof authAdmin.generateInviteLink>>;
  try {
    link = await authAdmin.generateInviteLink(row.email as string);
  } catch (err) {
    // AuthAdminError's message holds no key, address or token.
    console.error("Invite sign-up link failed:", err instanceof AuthAdminError ? err.message : "unknown error");
    throw new HttpError(503, ACCOUNT_SETUP_UNAVAILABLE, undefined, { code: "unavailable" });
  }
  if (link === "exists") throw new HttpError(409, HAS_ACCOUNT, undefined, { code: "has_account" });
  const result: InviteAccountLink = { tokenHash: link.tokenHash };
  return okPrivate(result);
};

/**
 * GET /api/invites/me — a signed-in caller with a verified email. The invite
 * waiting for that address (ignoring case), if any. 200 MyInvite; 404 none.
 */
export const getMyInvite: Handler = async (req, _params, { db, verifyAccessToken }) => {
  const caller = await requireVerifiedCaller(req, verifyAccessToken);
  const [row] = await db.query<{
    id: string;
    kind: InviteKind;
    organiser_name: string | null;
    expires_at: string | Date;
  }>(
    `select i.id, i.kind, i.organiser_profile ->> 'display_name' as organiser_name, i.expires_at
       from private.account_invites i
      where lower(i.email) = lower($1) and i.status = 'pending' and i.expires_at > now()`,
    [caller.email],
  );
  if (!row) throw new HttpError(404, "There's no invite waiting for this account's email address.");
  const invite: MyInvite = {
    inviteId: row.id,
    kind: row.kind,
    ...(row.organiser_name ? { organiserName: row.organiser_name } : {}),
    expiresAt: new Date(row.expires_at).toISOString(),
  };
  return okPrivate(invite);
};

/**
 * POST /api/invites/accept {inviteId} — a signed-in caller whose verified
 * email is the invite's (ignoring case). An organiser invite creates their
 * organiser, approved, in the same step. Idempotent for the same account.
 * 200 AcceptInviteResult; 404 unknown or not theirs; 409 the account already
 * has an organiser; 410 expired, revoked or used by another account (`code`).
 */
export const acceptInvite: Handler = async (req, _params, { db, verifyAccessToken }) => {
  const caller = await requireVerifiedCaller(req, verifyAccessToken);
  const body = await readJson(req);
  const inviteId = typeof body.inviteId === "string" ? body.inviteId : "";
  if (!isUuid(inviteId)) throw new HttpError(404, INVITE_NOT_FOUND);
  const [row] = await db.query<{ result: string; kind: InviteKind | null; organiser_id: string | null }>(
    `select * from private.accept_account_invite($1, $2, $3)`,
    [inviteId, caller.userId, caller.email],
  );
  switch (row.result) {
    case "accepted":
    case "already_accepted": {
      const result: AcceptInviteResult = {
        kind: row.kind as InviteKind,
        ...(row.organiser_id ? { organiserId: row.organiser_id } : {}),
      };
      return okPrivate(result);
    }
    case "not_found":
      throw new HttpError(404, INVITE_NOT_FOUND);
    case "has_organiser":
      throw new HttpError(
        409,
        "Your account already has an organiser profile, so it can't take on another. Contact the Sheltüh team.",
      );
    case "used":
    case "revoked":
    case "expired":
      return gone(row.result);
    default:
      throw new Error(`Unexpected accept_account_invite result: ${row.result}`);
  }
};
