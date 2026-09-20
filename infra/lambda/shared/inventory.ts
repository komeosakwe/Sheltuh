import { ConditionalCheckFailedException, TransactionCanceledException } from "@aws-sdk/client-dynamodb";
import { PutCommand, TransactWriteCommand } from "@aws-sdk/lib-dynamodb";
import { ddb, TABLES } from "./db";
import type { OrderLineItem, TicketTypeInput } from "./types";

async function ensureInventoryRow(eventId: string, ticketType: TicketTypeInput): Promise<void> {
  try {
    await ddb.send(
      new PutCommand({
        TableName: TABLES.ticketInventory,
        Item: { eventId, ticketTypeId: ticketType.id, quantityAvailable: ticketType.quantityAvailable, quantitySold: 0 },
        ConditionExpression: "attribute_not_exists(eventId)",
      }),
    );
  } catch (err) {
    // Another request already created this row — fine, that's the point of the condition.
    if (!(err instanceof ConditionalCheckFailedException)) throw err;
  }
}

/**
 * Atomically reserves inventory for every line item in one order, or none —
 * a single DynamoDB transaction, so a multi-ticket-type order can never
 * partially oversell one type while succeeding on another. Returns the id
 * of the first ticket type that didn't have enough left, or null if the
 * whole reservation succeeded.
 */
export async function reserveInventory(
  eventId: string,
  lineItems: OrderLineItem[],
  ticketTypes: TicketTypeInput[],
): Promise<string | null> {
  for (const line of lineItems) {
    const ticketType = ticketTypes.find((t) => t.id === line.ticketTypeId);
    if (ticketType) await ensureInventoryRow(eventId, ticketType);
  }

  try {
    await ddb.send(
      new TransactWriteCommand({
        TransactItems: lineItems.map((line) => ({
          Update: {
            TableName: TABLES.ticketInventory,
            Key: { eventId, ticketTypeId: line.ticketTypeId },
            UpdateExpression: "ADD quantitySold :qty",
            ConditionExpression: "quantitySold + :qty <= quantityAvailable",
            ExpressionAttributeValues: { ":qty": line.quantity },
          },
        })),
      }),
    );
    return null;
  } catch (err) {
    if (err instanceof TransactionCanceledException) {
      const failedIndex = (err.CancellationReasons ?? []).findIndex((r) => r.Code === "ConditionalCheckFailed");
      return lineItems[failedIndex >= 0 ? failedIndex : 0]?.ticketTypeId ?? null;
    }
    throw err;
  }
}
