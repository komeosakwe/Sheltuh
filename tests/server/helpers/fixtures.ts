import { adminApproveEvent, adminApproveOrganiser } from "@/lib/server/handlers/admin";
import { publishEvent } from "@/lib/server/handlers/event-publish";
import { createEventDraft, submitEventForReview } from "@/lib/server/handlers/events";
import { applyAsOrganiser } from "@/lib/server/handlers/organisers";
import type { EventRecord } from "@/lib/server/types";
import type { TestApi } from "./api";

export const application = {
  displayName: "Static Collective",
  contactEmail: "hello@static.example",
  description: "Warehouse gigs in Collingwood.",
  categories: ["live-music"],
  websiteUrl: "https://static.example",
};

export function eventInput(overrides: Record<string, unknown> = {}) {
  return {
    title: "Neon Static",
    description: "Four bands, one warehouse.",
    category: "live-music",
    venueName: "The Tote",
    venueAddress: "71 Johnston St",
    suburb: "Collingwood",
    start: { date: "2027-03-06", time: "20:00" },
    end: { date: "2027-03-06", time: "23:30" },
    ticketTypes: [
      { id: "ga", name: "General admission", priceCents: 3000, feePolicy: "buyer-pays", quantityAvailable: 10 },
    ],
    ...overrides,
  };
}

export async function signUpAdmin(api: TestApi) {
  return api.signUp({ admin: true });
}

/** A signed-up user with an admin-approved organiser application. */
export async function approvedOrganiser(api: TestApi, admin: { token: string }, overrides: Record<string, unknown> = {}) {
  const user = await api.signUp();
  const applied = await api.call(applyAsOrganiser, { token: user.token, body: { ...application, ...overrides } });
  const organiserId = applied.body.organiserId as string;
  await api.call(adminApproveOrganiser, { token: admin.token, params: { organiserId }, method: "POST" });
  return { ...user, organiserId };
}

export async function draftEvent(api: TestApi, organiser: { token: string }, overrides: Record<string, unknown> = {}) {
  const res = await api.call(createEventDraft, { token: organiser.token, body: eventInput(overrides) });
  if (res.status !== 201) throw new Error(`createEventDraft failed: ${JSON.stringify(res.body)}`);
  return res.body as EventRecord;
}

export async function publishedEvent(
  api: TestApi,
  organiser: { token: string },
  admin: { token: string },
  overrides: Record<string, unknown> = {},
) {
  const draft = await draftEvent(api, organiser, overrides);
  // A paid event can only be submitted once its organiser can be paid out
  // (private.submit_event), so an organiser selling paid tickets has set up
  // payouts first. Tests of an organiser whose payouts are off since then use
  // disablePayouts after this.
  if (hasPaidSheltuhTickets(draft)) await setUpPayouts(api, draft.organiserId);
  const params = { eventId: draft.eventId };
  await api.call(submitEventForReview, { token: organiser.token, params, method: "POST" });
  const res = await api.call(adminApproveEvent, { token: admin.token, params, method: "POST" });
  return res.body as EventRecord;
}

/**
 * A draft the organiser published themselves (POST /api/events/{id}/publish:
 * live without review, logged `approved` by their own account), setting up
 * their payouts first if it has paid tickets, as publishedEvent does. Throws
 * unless it went live (not to review): use a fresh organiser for each one past
 * the per-account cap.
 */
export async function selfPublishedEvent(
  api: TestApi,
  organiser: { token: string },
  overrides: Record<string, unknown> = {},
) {
  const draft = await draftEvent(api, organiser, overrides);
  if (hasPaidSheltuhTickets(draft)) await setUpPayouts(api, draft.organiserId);
  const res = await api.call(publishEvent, { token: organiser.token, params: { eventId: draft.eventId }, method: "POST" });
  if (res.status !== 200 || res.body.status !== "published") {
    throw new Error(`publishEvent didn't publish: ${res.status} ${JSON.stringify(res.body)}`);
  }
  return res.body as EventRecord;
}

function hasPaidSheltuhTickets(event: EventRecord): boolean {
  return (event.ticketingMode ?? "sheltuh") === "sheltuh" && event.ticketTypes.some((t) => t.priceCents > 0);
}

/**
 * Payouts on for an organiser that doesn't have them yet, keeping any Stripe
 * account it has (or giving it one of its own: account ids are unique, so
 * unlike enablePayouts this works for any number of organisers). A paid
 * event can only be submitted or published once its organiser has them.
 */
export async function setUpPayouts(api: TestApi, organiserId: string) {
  await api.db.query(
    `update public.organisers
        set stripe_account_id = coalesce(stripe_account_id, 'acct_test_' || replace(id::text, '-', '')),
            payouts_enabled = true
      where id = $1 and not payouts_enabled`,
    [organiserId],
  );
}

/**
 * Payouts off again (Stripe restricted the account, say) for an organiser
 * whose paid event is already submitted or published.
 */
export async function disablePayouts(api: TestApi, organiserId: string) {
  await api.db.query(`update public.organisers set payouts_enabled = false where id = $1`, [organiserId]);
}

/** Marks an organiser's Stripe Connect account ready to take payments. */
export async function enablePayouts(api: TestApi, organiserId: string) {
  await api.db.query(
    `update public.organisers set stripe_account_id = 'acct_test_1', payouts_enabled = true where id = $1`,
    [organiserId],
  );
}

/**
 * Inserts an order straight into the database in any status, for tests that
 * only care that "an order with this email and status exists" (e.g. Who's
 * Going eligibility). Real checkouts go through createCheckout.
 */
export async function insertOrder(
  api: TestApi,
  event: { eventId: string; organiserId: string },
  buyerEmail: string | null,
  status: "pending" | "paid" | "failed" | "oversold_refund_required" | "refunded" = "paid",
) {
  const orderId = `ord_${crypto.randomUUID().replace(/-/g, "")}`;
  await api.db.query(
    `insert into public.orders (id, event_id, organiser_id, event_title, buyer_email, line_items,
       subtotal_cents, buyer_fee_cents, total_cents, application_fee_cents, status)
     values ($1, $2, $3, 'Test event', $4, '[]'::jsonb, 0, 0, 0, 0, $5::public.order_status)`,
    [orderId, event.eventId, event.organiserId, buyerEmail, status],
  );
  return orderId;
}
