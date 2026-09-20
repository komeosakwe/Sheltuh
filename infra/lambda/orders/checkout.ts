import { GetCommand, PutCommand } from "@aws-sdk/lib-dynamodb";
import { calculateBookingFeeCents, calculateOrderSummary } from "../shared/fees";
import { ddb, TABLES } from "../shared/db";
import { badRequest, conflict, created, handle, notFound, parseBody, type ApiEvent } from "../shared/http";
import { reserveInventory } from "../shared/inventory";
import { findOrganiserByOrganiserId } from "../shared/organiser-guard";
import { parseCheckoutLineItems } from "../shared/order-input";
import { getStripe } from "../shared/stripe";
import { issueTickets } from "../shared/ticket-issuance";
import type { EventRecord, OrderLineItem, OrderRecord, TicketInventoryRecord } from "../shared/types";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

/**
 * The platform's cut (Stripe's application_fee_amount) is the same booking-
 * fee amount regardless of who nominally pays it — a buyer-pays ticket adds
 * it on top of the buyer's total, an organiser-absorbed one deducts it from
 * the organiser's proceeds instead. Either way it's this sum.
 */
function applicationFeeFor(line: OrderLineItem): number {
  return calculateBookingFeeCents(line.unitPriceCents) * line.quantity;
}

function totalsFor(lineItems: OrderLineItem[]) {
  let subtotalCents = 0;
  let buyerFeeCents = 0;
  let applicationFeeCents = 0;
  for (const line of lineItems) {
    const summary = calculateOrderSummary(line.unitPriceCents, line.quantity, line.feePolicy);
    subtotalCents += summary.subtotalCents;
    buyerFeeCents += summary.buyerFeeCents;
    applicationFeeCents += applicationFeeFor(line);
  }
  return { subtotalCents, buyerFeeCents, totalCents: subtotalCents + buyerFeeCents, applicationFeeCents };
}

/**
 * Public — guest checkout, matching the rest of the app's "buying tickets
 * never requires an account" promise. A wholly free order (every requested
 * ticket type priced at 0) never touches Stripe at all — there's no payment
 * to process, and Stripe Checkout isn't meant for $0 charges. Everything
 * else goes through a real Checkout Session with a destination charge onto
 * the organiser's Connect account.
 */
export const handler = (event: ApiEvent) =>
  handle(async () => {
    const { organiserId, eventId } = event.pathParameters ?? {};
    if (!organiserId || !eventId) return badRequest("Missing organiserId or eventId in the URL.");

    const eventResult = await ddb.send(new GetCommand({ TableName: TABLES.events, Key: { organiserId, eventId } }));
    const eventRecord = eventResult.Item as EventRecord | undefined;
    if (!eventRecord || eventRecord.status !== "published") {
      return notFound("This event isn't available for booking.");
    }

    const lineItems = parseCheckoutLineItems(parseBody(event) ?? {}, eventRecord.ticketTypes);
    const totals = totalsFor(lineItems);
    const now = new Date().toISOString();

    if (totals.totalCents === 0) {
      const failedTicketTypeId = await reserveInventory(eventId, lineItems, eventRecord.ticketTypes);
      if (failedTicketTypeId) {
        const name = lineItems.find((l) => l.ticketTypeId === failedTicketTypeId)?.ticketTypeName ?? "that ticket";
        return conflict(`"${name}" just sold out.`);
      }

      const orderId = `free_${eventId}_${crypto.randomUUID()}`;
      const order: OrderRecord = {
        orderId,
        organiserId,
        eventId,
        eventTitle: eventRecord.title,
        lineItems,
        subtotalCents: 0,
        buyerFeeCents: 0,
        totalCents: 0,
        applicationFeeCents: 0,
        status: "paid",
        stripeCheckoutSessionId: orderId,
        tickets: issueTickets(lineItems),
        createdAt: now,
        updatedAt: now,
      };
      await ddb.send(new PutCommand({ TableName: TABLES.orders, Item: order }));

      const frontendUrl = requireEnv("FRONTEND_URL");
      return created({ url: `${frontendUrl}/checkout/success?session_id=${orderId}` });
    }

    // A paid order needs somewhere for the money to go.
    const organiser = await findOrganiserByOrganiserId(organiserId);
    if (!organiser?.stripeAccountId || !organiser.payoutsEnabled) {
      return conflict("This organiser hasn't finished setting up payouts yet — ticket sales aren't open.");
    }

    // Best-effort: skip anything already known to be sold out. A tighter
    // race at the very last ticket is still possible here — it's closed off
    // for real at payment-confirmation time (orders/webhook.ts), not here.
    for (const line of lineItems) {
      const inventory = await ddb.send(
        new GetCommand({ TableName: TABLES.ticketInventory, Key: { eventId, ticketTypeId: line.ticketTypeId } }),
      );
      const item = inventory.Item as TicketInventoryRecord | undefined;
      const sold = item?.quantitySold ?? 0;
      const declaredCap = eventRecord.ticketTypes.find((t) => t.id === line.ticketTypeId)?.quantityAvailable ?? 0;
      const available = item?.quantityAvailable ?? declaredCap;
      if (sold + line.quantity > available) {
        return conflict(`Only ${Math.max(available - sold, 0)} of "${line.ticketTypeName}" left.`);
      }
    }

    const frontendUrl = requireEnv("FRONTEND_URL");
    const { stripe } = await getStripe();

    const stripeLineItems = lineItems.flatMap((line) => {
      const items = [
        {
          price_data: {
            currency: "aud",
            product_data: { name: `${line.ticketTypeName} — ${eventRecord.title}` },
            unit_amount: line.unitPriceCents,
          },
          quantity: line.quantity,
        },
      ];
      if (line.feePolicy === "buyer-pays" && line.unitPriceCents > 0) {
        items.push({
          price_data: {
            currency: "aud",
            product_data: { name: "Booking fee" },
            unit_amount: calculateBookingFeeCents(line.unitPriceCents),
          },
          quantity: line.quantity,
        });
      }
      return items;
    });

    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      line_items: stripeLineItems,
      payment_intent_data: {
        application_fee_amount: totals.applicationFeeCents,
        transfer_data: { destination: organiser.stripeAccountId },
      },
      success_url: `${frontendUrl}/checkout/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${frontendUrl}/events/${eventRecord.slug}`,
      metadata: { eventId, organiserId },
    });

    if (!session.url) throw new Error("Stripe did not return a Checkout Session URL.");

    const order: OrderRecord = {
      orderId: session.id,
      organiserId,
      eventId,
      eventTitle: eventRecord.title,
      lineItems,
      subtotalCents: totals.subtotalCents,
      buyerFeeCents: totals.buyerFeeCents,
      totalCents: totals.totalCents,
      applicationFeeCents: totals.applicationFeeCents,
      status: "pending",
      stripeCheckoutSessionId: session.id,
      tickets: [],
      createdAt: now,
      updatedAt: now,
    };

    await ddb.send(new PutCommand({ TableName: TABLES.orders, Item: order }));

    return created({ url: session.url });
  });
