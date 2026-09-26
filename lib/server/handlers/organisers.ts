import { requireCaller } from "../auth";
import { PG_UNIQUE_VIOLATION, pgErrorCode } from "../db";
import { created, HttpError, ok, readJson } from "../http";
import { ORGANISER_SELECT, toOrganiser, toOwnOrganiserView } from "../records";
import type { Handler } from "../route";
import { canApplyAsOrganiser, canResubmitOrganiser } from "../state";
import { fail, optionalUrl, requireCategories, requireEmail, requireString } from "../validation";
import { findOrganiserByOwner, requireApprovedOrganiser } from "./organiser-guard";

function parseApplication(body: Record<string, unknown>) {
  const errors: Record<string, string> = {};
  const displayName = requireString(body.displayName, "displayName", errors, 120);
  const contactEmail = requireEmail(body.contactEmail, "contactEmail", errors);
  const description = requireString(body.description, "description", errors, 2000);
  const categories = requireCategories(body.categories, "categories", errors);
  const websiteUrl = optionalUrl(body.websiteUrl, "websiteUrl", errors);
  if (Object.keys(errors).length > 0) fail(errors);
  return { displayName, contactEmail, description, categories, websiteUrl: websiteUrl ?? null };
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
      `insert into public.organisers (owner_user_id, display_name, contact_email, description, categories, website_url)
       values ($1, $2, $3, $4, array(select jsonb_array_elements_text($5::text::jsonb))::public.event_category[], $6)
       returning id`,
      [caller.userId, input.displayName, input.contactEmail, input.description, JSON.stringify(input.categories), input.websiteUrl],
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

/** PATCH /api/organisers/me — edit and resubmit a rejected application. */
export const resubmitOrganiser: Handler = async (req, _params, { db, verifyAccessToken }) => {
  const caller = await requireCaller(req, verifyAccessToken);

  const existing = await findOrganiserByOwner(db, caller.userId);
  if (!existing) throw new HttpError(404, "No organiser application found.");
  if (!canResubmitOrganiser(existing.status)) {
    throw new HttpError(409, "Only a rejected application can be edited and resubmitted.");
  }

  const input = parseApplication(await readJson(req));
  const rows = await db.query<{ id: string }>(
    `update public.organisers
     set display_name = $2, contact_email = $3, description = $4, categories = array(select jsonb_array_elements_text($5::text::jsonb))::public.event_category[],
         website_url = $6, status = 'pending', rejection_reason = null, reviewed_by = null, reviewed_at = null
     where owner_user_id = $1 and status = 'rejected'
     returning id`,
    [caller.userId, input.displayName, input.contactEmail, input.description, JSON.stringify(input.categories), input.websiteUrl],
  );
  if (rows.length === 0) throw new HttpError(409, "Your application status changed — refresh and try again.");

  const record = await findOrganiserByOwner(db, caller.userId);
  return ok(toOwnOrganiserView(record!));
};

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
