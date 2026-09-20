import { GetCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { ddb, TABLES } from "../shared/db";
import { badRequest, handle, ok, type ApiEvent } from "../shared/http";
import { reserveInventory } from "../shared/inventory";
import { getStripe } from "../shared/stripe";
import { issueTickets } from "../shared/ticket-issuance";
import type { EventRecord, OrderRecord } from "../shared/types";

/**
 * Public — Stripe calls this directly, so there's no Cognito authorizer;
 * the Stripe-Signature header (verified against the webhook secret) is the
 * only trust boundary. This is also the ONLY place a paid order actually
 * becomes "paid" and gets its inventory decremented — never at checkout
 * time, so an abandoned Checkout Session never holds tickets hostage.
 */
export const handler = (event: ApiEvent) =>
  handle(async () => {
    const signature = event.headers?.["stripe-signature"] ?? event.headers?.["Stripe-Signature"];
    if (!signature) return badRequest("Missing Stripe-Signature header.");

    const rawBody = event.isBase64Encoded && event.body ? Buffer.from(event.body, "base64").toString("utf-8") : event.body;
    if (!rawBody) return badRequest("Missing request body.");

    const { stripe, webhookSecret } = await getStripe();

    let stripeEvent;
    try {
      stripeEvent = stripe.webhooks.constructEvent(rawBody, signature, webhookSecret);
    } catch {
      return badRequest("Invalid webhook signature.");
    }

    if (stripeEvent.type !== "checkout.session.completed") {
      // Acknowledged but not acted on — Stripe only retries on a non-2xx response.
      return ok({ received: true });
    }

    const session = stripeEvent.data.object;
    const orderResult = await ddb.send(new GetCommand({ TableName: TABLES.orders, Key: { orderId: session.id } }));
    const order = orderResult.Item as OrderRecord | undefined;

    // Unknown order, or a redelivery of a webhook we've already processed
    // (Stripe does this) — either way, nothing left to do.
    if (!order || order.status !== "pending") {
      return ok({ received: true });
    }

    const eventResult = await ddb.send(
      new GetCommand({ TableName: TABLES.events, Key: { organiserId: order.organiserId, eventId: order.eventId } }),
    );
    const eventRecord = eventResult.Item as EventRecord | undefined;

    const failedTicketTypeId = await reserveInventory(order.eventId, order.lineItems, eventRecord?.ticketTypes ?? []);

    const now = new Date().toISOString();
    if (failedTicketTypeId) {
      // The buyer's card has already been charged at this point. There's no
      // automatic refund here yet — this status exists so an admin can find
      // and manually refund these via the Stripe dashboard. See
      // docs/aws-setup.md's Stripe section for the known gap.
      console.error(`Order ${order.orderId} oversold on ticket type ${failedTicketTypeId} — needs a manual refund.`);
      await ddb.send(
        new UpdateCommand({
          TableName: TABLES.orders,
          Key: { orderId: order.orderId },
          UpdateExpression: "SET #status = :status, updatedAt = :now, stripePaymentIntentId = :pi",
          ExpressionAttributeNames: { "#status": "status" },
          ExpressionAttributeValues: {
            ":status": "oversold_refund_required",
            ":now": now,
            ":pi": typeof session.payment_intent === "string" ? session.payment_intent : session.payment_intent?.id,
          },
        }),
      );
      return ok({ received: true });
    }

    await ddb.send(
      new UpdateCommand({
        TableName: TABLES.orders,
        Key: { orderId: order.orderId },
        UpdateExpression: "SET #status = :status, tickets = :tickets, buyerEmail = :email, stripePaymentIntentId = :pi, updatedAt = :now",
        ExpressionAttributeNames: { "#status": "status" },
        ExpressionAttributeValues: {
          ":status": "paid",
          ":tickets": issueTickets(order.lineItems),
          ":email": session.customer_details?.email ?? undefined,
          ":pi": typeof session.payment_intent === "string" ? session.payment_intent : session.payment_intent?.id,
          ":now": now,
        },
      }),
    );

    return ok({ received: true });
  });
