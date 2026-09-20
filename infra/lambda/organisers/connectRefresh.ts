import { UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { requireApprovedOrganiser } from "../shared/organiser-guard";
import { ddb, TABLES } from "../shared/db";
import { handle, ok, type ApiEvent } from "../shared/http";
import { getStripe } from "../shared/stripe";
import { toOwnOrganiserView } from "../shared/types";

/**
 * Re-syncs `payoutsEnabled` from Stripe — the organiser lands back here
 * after finishing (or abandoning) the Connect onboarding flow, and Stripe's
 * own account status is the only source of truth for whether they can
 * actually receive money yet.
 */
export const handler = (event: ApiEvent) =>
  handle(async () => {
    const record = await requireApprovedOrganiser(event);

    if (!record.stripeAccountId) {
      return ok(toOwnOrganiserView(record));
    }

    const { stripe } = await getStripe();
    const account = await stripe.accounts.retrieve(record.stripeAccountId);
    const payoutsEnabled = Boolean(account.charges_enabled && account.payouts_enabled);

    const result = await ddb.send(
      new UpdateCommand({
        TableName: TABLES.organisers,
        Key: { ownerUserId: record.ownerUserId },
        UpdateExpression: "SET payoutsEnabled = :enabled, updatedAt = :now",
        ExpressionAttributeValues: { ":enabled": payoutsEnabled, ":now": new Date().toISOString() },
        ReturnValues: "ALL_NEW",
      }),
    );

    return ok(toOwnOrganiserView(result.Attributes as typeof record));
  });
