import { GetCommand } from "@aws-sdk/lib-dynamodb";
import { ddb, TABLES } from "../shared/db";
import { badRequest, handle, notFound, ok, type ApiEvent } from "../shared/http";
import type { OrderRecord } from "../shared/types";

/**
 * Public — the confirmation page has no buyer account to authenticate, so
 * the unguessable Stripe Checkout Session id (or, for a free order, the
 * equally unguessable synthetic id orders/checkout.ts mints) is the access
 * control here, the same way a long random link works as a bearer token.
 */
export const handler = (event: ApiEvent) =>
  handle(async () => {
    const { sessionId } = event.pathParameters ?? {};
    if (!sessionId) return badRequest("Missing sessionId in the URL.");

    const result = await ddb.send(new GetCommand({ TableName: TABLES.orders, Key: { orderId: sessionId } }));
    const order = result.Item as OrderRecord | undefined;
    if (!order) return notFound("Order not found.");

    // Never expose a still-pending order's tickets — they don't exist yet,
    // and this is called by an unauthenticated confirmation page.
    if (order.status === "pending") {
      return ok({ status: order.status });
    }

    return ok(order);
  });
