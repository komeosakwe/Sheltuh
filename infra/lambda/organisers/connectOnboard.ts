import { UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { requireApprovedOrganiser } from "../shared/organiser-guard";
import { ddb, TABLES } from "../shared/db";
import { handle, ok, serverError, type ApiEvent } from "../shared/http";
import { getStripe } from "../shared/stripe";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

/**
 * Creates (or reuses) the organiser's Stripe Connect Express account and
 * returns a fresh Account Link URL to send them to for onboarding. Express
 * accounts can't legally receive a payout until Stripe has collected
 * identity/bank details directly from the organiser — Sheltüh never
 * touches that data itself.
 */
export const handler = (event: ApiEvent) =>
  handle(async () => {
    const record = await requireApprovedOrganiser(event);
    const frontendUrl = requireEnv("FRONTEND_URL");
    const { stripe } = await getStripe();

    let stripeAccountId = record.stripeAccountId;
    if (!stripeAccountId) {
      const account = await stripe.accounts.create({
        type: "express",
        country: "AU",
        email: record.contactEmail,
        capabilities: {
          card_payments: { requested: true },
          transfers: { requested: true },
        },
        business_profile: { url: record.websiteUrl },
      });
      stripeAccountId = account.id;

      await ddb.send(
        new UpdateCommand({
          TableName: TABLES.organisers,
          Key: { ownerUserId: record.ownerUserId },
          UpdateExpression: "SET stripeAccountId = :id, updatedAt = :now",
          ExpressionAttributeValues: { ":id": stripeAccountId, ":now": new Date().toISOString() },
        }),
      );
    }

    if (!stripeAccountId) return serverError("Couldn't create a Stripe account.");

    const accountLink = await stripe.accountLinks.create({
      account: stripeAccountId,
      type: "account_onboarding",
      refresh_url: `${frontendUrl}/dashboard/payouts?refresh=1`,
      return_url: `${frontendUrl}/dashboard/payouts?connected=1`,
    });

    return ok({ url: accountLink.url });
  });
