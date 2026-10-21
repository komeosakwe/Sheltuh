import { requireCaller } from "../auth";
import { PG_UNIQUE_VIOLATION, pgErrorCode, type Db } from "../db";
import { created, HttpError, ok, readJson } from "../http";
import { parseMessageText } from "../message-input";
import { parseSocialHandles, SOCIAL_RULES } from "../organiser-input";
import { ORGANISER_SELECT, toOrganiser, toOwnOrganiserView } from "../records";
import type { Handler } from "../route";
import { canApplyAsOrganiser, canEditApprovedOrganiser, canResubmitOrganiser } from "../state";
import type { OrganiserRecord } from "../types";
import { fail, optionalUrl, requireCategories, requireEmail, requireString } from "../validation";
import { findOrganiserByOwner, requireApprovedOrganiser } from "./organiser-guard";

/** A column assignment for an organisers update. Column names only ever come from this file and SOCIAL_RULES. */
type Assignment = [column: string, value: unknown];

/** Mirrors the organisers.description check constraint (code points, like char_length). */
const MAX_DESCRIPTION_LENGTH = 2000;

/**
 * The organiser's bio: public once they're approved, so it gets the same
 * cleaning as messages (parseMessageText): no control, invisible or
 * text-direction characters (NUL included: a 400, not a database error),
 * line breaks normalised, no stacked marks. Links are fine in a bio.
 */
function parseDescription(value: unknown, errors: Record<string, string>): string {
  return parseMessageText(value, "description", errors, {
    allowLinks: true,
    label: "Descriptions",
    maxLength: MAX_DESCRIPTION_LENGTH,
  });
}

/**
 * An organiser application's fields (also an admin's platform-managed
 * organiser: lib/server/handlers/admin-authoring.ts). `existing`: the
 * rejected application being resubmitted, if any (its stored website is
 * kept as it is).
 */
export function parseApplication(body: Record<string, unknown>, existing?: OrganiserRecord) {
  const errors: Record<string, string> = {};
  const displayName = requireString(body.displayName, "displayName", errors, 120);
  const contactEmail = requireEmail(body.contactEmail, "contactEmail", errors);
  const description = parseDescription(body.description, errors);
  const categories = requireCategories(body.categories, "categories", errors);
  const websiteUrl = optionalUrl(body.websiteUrl, "websiteUrl", errors, { current: existing?.websiteUrl });
  const handles = parseSocialHandles(body, errors);
  if (Object.keys(errors).length > 0) fail(errors);
  return { displayName, contactEmail, description, categories, websiteUrl: websiteUrl ?? null, handles };
}

/** The social-handle columns a request sets (absent fields are left as they are). */
function handleAssignments(handles: ReturnType<typeof parseSocialHandles>): Assignment[] {
  return SOCIAL_RULES.filter((rule) => handles[rule.field] !== undefined).map((rule) => [
    rule.column,
    handles[rule.field],
  ]);
}

/** Fields fixed once an organiser is approved: changing them needs a fresh review. */
const REVIEWED_FIELDS = ["displayName", "contactEmail", "categories"] as const;

/**
 * An approved organiser's profile edit. Every field is optional: absent means
 * unchanged; null or blank clears websiteUrl or a handle. displayName,
 * contactEmail and categories may be sent back unchanged (so a client can
 * send the whole record) but not changed.
 */
function parseProfileEdit(body: Record<string, unknown>, current: OrganiserRecord): Assignment[] {
  const errors: Record<string, string> = {};
  const assignments: Assignment[] = [];

  for (const field of REVIEWED_FIELDS) {
    const value = body[field];
    if (value === undefined) continue;
    const unchanged =
      field === "categories"
        ? Array.isArray(value) &&
          JSON.stringify([...value].sort()) === JSON.stringify([...current.categories].sort())
        : typeof value === "string" && value.trim() === current[field];
    if (!unchanged) errors[field] = "This can't be changed once you're approved. Contact us to change it.";
  }

  if (body.description !== undefined) {
    assignments.push(["description", parseDescription(body.description, errors)]);
  }
  if (body.websiteUrl !== undefined) {
    assignments.push([
      "website_url",
      optionalUrl(body.websiteUrl, "websiteUrl", errors, { current: current.websiteUrl }) ?? null,
    ]);
  }
  assignments.push(...handleAssignments(parseSocialHandles(body, errors)));

  if (Object.keys(errors).length > 0) fail(errors);
  return assignments;
}

/** The `set` items and their parameters, numbered from `$firstParam`. */
function setClause(assignments: Assignment[], firstParam: number): { items: string[]; params: unknown[] } {
  return {
    items: assignments.map(([column], i) => `${column} = $${firstParam + i}`),
    params: assignments.map(([, value]) => value),
  };
}

/** POST /api/organisers/apply */
export const applyAsOrganiser: Handler = async (req, _params, { db, verifyAccessToken }) => {
  const caller = await requireCaller(req, verifyAccessToken);

  const existing = await findOrganiserByOwner(db, caller.userId);
  if (!canApplyAsOrganiser(existing?.status)) {
    throw new HttpError(
      409,
      existing?.status === "rejected"
        ? "You already have an application on file. Edit and resubmit it instead of applying again."
        : "You already have an application on file.",
    );
  }

  const input = parseApplication(await readJson(req));
  try {
    const [row] = await db.query<{ id: string }>(
      `insert into public.organisers (owner_user_id, display_name, contact_email, description, categories, website_url,
                                      instagram_handle, tiktok_handle, facebook_page, x_handle)
       values ($1, $2, $3, $4, array(select jsonb_array_elements_text($5::text::jsonb))::public.event_category[], $6,
               $7, $8, $9, $10)
       returning id`,
      [
        caller.userId,
        input.displayName,
        input.contactEmail,
        input.description,
        JSON.stringify(input.categories),
        input.websiteUrl,
        input.handles.instagramHandle ?? null,
        input.handles.tiktokHandle ?? null,
        input.handles.facebookPage ?? null,
        input.handles.xHandle ?? null,
      ],
    );
    const [record] = await db.query(`${ORGANISER_SELECT} where o.id = $1`, [row.id]);
    return created(toOwnOrganiserView(toOrganiser(record)));
  } catch (err) {
    // Lost a race with a second tab submitting the same application.
    if (pgErrorCode(err) === PG_UNIQUE_VIOLATION) {
      throw new HttpError(409, "You already have an application on file.");
    }
    throw err;
  }
};

/** GET /api/organisers/me */
export const getMyOrganiser: Handler = async (req, _params, { db, verifyAccessToken }) => {
  const caller = await requireCaller(req, verifyAccessToken);
  const record = await findOrganiserByOwner(db, caller.userId);
  if (!record) throw new HttpError(404, "No organiser application found.");
  return ok(toOwnOrganiserView(record));
};

/**
 * PATCH /api/organisers/me. What it does depends on the application's status:
 * - rejected: edit and resubmit the whole application (back to pending).
 *   Social handles are optional; ones not sent are kept.
 * - approved: edit the public profile (description, websiteUrl, social
 *   handles) without a new review; the status doesn't change.
 * - pending: 409.
 */
export const resubmitOrganiser: Handler = async (req, _params, { db, verifyAccessToken }) => {
  const caller = await requireCaller(req, verifyAccessToken);

  const existing = await findOrganiserByOwner(db, caller.userId);
  if (!existing) throw new HttpError(404, "No organiser application found.");
  if (canEditApprovedOrganiser(existing.status)) return editApprovedProfile(db, caller.userId, existing, req);
  if (!canResubmitOrganiser(existing.status)) {
    throw new HttpError(
      409,
      "Your application is being reviewed. You can edit it if it's rejected, or your profile once it's approved.",
    );
  }

  const input = parseApplication(await readJson(req), existing);
  const handles = setClause(handleAssignments(input.handles), 7);
  const rows = await db.query<{ id: string }>(
    `update public.organisers
     set display_name = $2, contact_email = $3, description = $4, categories = array(select jsonb_array_elements_text($5::text::jsonb))::public.event_category[],
         website_url = $6, ${handles.items.map((item) => `${item}, `).join("")}
         status = 'pending', rejection_reason = null, reviewed_by = null, reviewed_at = null
     where owner_user_id = $1 and status = 'rejected'
     returning id`,
    [
      caller.userId,
      input.displayName,
      input.contactEmail,
      input.description,
      JSON.stringify(input.categories),
      input.websiteUrl,
      ...handles.params,
    ],
  );
  if (rows.length === 0) throw new HttpError(409, "Your application status changed — refresh and try again.");

  const record = await findOrganiserByOwner(db, caller.userId);
  return ok(toOwnOrganiserView(record!));
};

/**
 * private.edit_organiser_profile, in one step: locks the row, checks it's
 * still approved, writes only the fields sent whose value really changes (so
 * two edits of different fields at once can't undo each other), and appends
 * the old and new values to private.organiser_profile_edits, which admins
 * see on the organiser queue. A no-op edit writes nothing.
 */
async function editApprovedProfile(db: Db, userId: string, existing: OrganiserRecord, req: Request) {
  const assignments = parseProfileEdit(await readJson(req), existing);
  if (assignments.length > 0) {
    const [row] = await db.query<{ result: "updated" | "unchanged" | "not_approved" | "not_found" }>(
      `select private.edit_organiser_profile($1, $2::text::jsonb) as result`,
      [userId, JSON.stringify(Object.fromEntries(assignments))],
    );
    if (row.result === "not_found") throw new HttpError(404, "No organiser application found.");
    if (row.result === "not_approved") {
      throw new HttpError(409, "Your organiser status changed — refresh and try again.");
    }
  }
  const record = await findOrganiserByOwner(db, userId);
  return ok(toOwnOrganiserView(record!));
}

/**
 * POST /api/organisers/me/connect/onboard — creates (or reuses) the
 * organiser's Stripe Connect Express account and returns a fresh onboarding
 * link. Stripe collects identity and bank details directly; Sheltüh never
 * sees them.
 */
export const connectOnboard: Handler = async (req, _params, deps) => {
  const caller = await requireCaller(req, deps.verifyAccessToken);
  const record = await requireApprovedOrganiser(deps.db, caller);
  const stripe = deps.stripe();
  const siteUrl = deps.siteUrl();

  let stripeAccountId = record.stripeAccountId;
  if (!stripeAccountId) {
    const account = await stripe.accounts.create({
      // Stripe's recommended way to describe an Express account: organisers
      // get the Express dashboard, Stripe collects their details, and the
      // platform pays Stripe's fees and covers losses (refunds, disputes).
      controller: {
        stripe_dashboard: { type: "express" },
        requirement_collection: "stripe",
        fees: { payer: "application" },
        losses: { payments: "application" },
      },
      country: "AU",
      email: record.contactEmail,
      capabilities: { card_payments: { requested: true }, transfers: { requested: true } },
      business_profile: { url: record.websiteUrl },
      metadata: { organiserId: record.organiserId },
    });
    stripeAccountId = account.id;
    await deps.db.query(`update public.organisers set stripe_account_id = $2 where id = $1`, [
      record.organiserId,
      stripeAccountId,
    ]);
  }

  const link = await stripe.accountLinks.create({
    account: stripeAccountId,
    type: "account_onboarding",
    refresh_url: `${siteUrl}/dashboard/payouts?refresh=1`,
    return_url: `${siteUrl}/dashboard/payouts?connected=1`,
  });
  return ok({ url: link.url });
};

/**
 * POST /api/organisers/me/connect/refresh — re-syncs payoutsEnabled from
 * Stripe, the only source of truth for whether the organiser can be paid.
 */
export const connectRefresh: Handler = async (req, _params, deps) => {
  const caller = await requireCaller(req, deps.verifyAccessToken);
  const record = await requireApprovedOrganiser(deps.db, caller);
  if (!record.stripeAccountId) return ok(toOwnOrganiserView(record));

  const account = await deps.stripe().accounts.retrieve(record.stripeAccountId);
  const payoutsEnabled = Boolean(account.charges_enabled && account.payouts_enabled);
  await deps.db.query(`update public.organisers set payouts_enabled = $2 where id = $1`, [
    record.organiserId,
    payoutsEnabled,
  ]);
  return ok(toOwnOrganiserView({ ...record, payoutsEnabled }));
};
