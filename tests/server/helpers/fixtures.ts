import { adminApproveEvent, adminApproveOrganiser } from "@/lib/server/handlers/admin";
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
  const params = { eventId: draft.eventId };
  await api.call(submitEventForReview, { token: organiser.token, params, method: "POST" });
  const res = await api.call(adminApproveEvent, { token: admin.token, params, method: "POST" });
  return res.body as EventRecord;
}

/** Marks an organiser's Stripe Connect account ready to take payments. */
export async function enablePayouts(api: TestApi, organiserId: string) {
  await api.db.query(
    `update public.organisers set stripe_account_id = 'acct_test_1', payouts_enabled = true where id = $1`,
    [organiserId],
  );
}
