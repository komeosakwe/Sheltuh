import { TransactionCanceledException } from "@aws-sdk/client-dynamodb";
import { PutCommand, TransactWriteCommand } from "@aws-sdk/lib-dynamodb";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { OrderLineItem, TicketTypeInput } from "../lambda/shared/types";

const sendMock = vi.fn();

vi.mock("../lambda/shared/db", () => ({
  ddb: { send: (...args: unknown[]) => sendMock(...args) },
  TABLES: { ticketInventory: "test-ticket-inventory" },
  INDEXES: {},
}));

beforeEach(() => {
  sendMock.mockReset();
});

const TICKET_TYPES: TicketTypeInput[] = [
  { id: "ga", name: "General admission", priceCents: 3000, feePolicy: "buyer-pays", quantityAvailable: 2 },
];

function line(quantity: number): OrderLineItem[] {
  return [{ ticketTypeId: "ga", ticketTypeName: "General admission", unitPriceCents: 3000, feePolicy: "buyer-pays", quantity }];
}

describe("reserveInventory", () => {
  it("initialises the row from the event's declared cap, then atomically reserves — returns null on success", async () => {
    sendMock.mockImplementation((command) => {
      if (command instanceof PutCommand) return Promise.resolve({});
      if (command instanceof TransactWriteCommand) return Promise.resolve({});
      throw new Error("unexpected command");
    });

    const { reserveInventory } = await import("../lambda/shared/inventory");
    const result = await reserveInventory("evt-1", line(2), TICKET_TYPES);

    expect(result).toBeNull();
    const putCall = sendMock.mock.calls.find((c) => c[0] instanceof PutCommand);
    expect(putCall![0].input.Item).toEqual({
      eventId: "evt-1",
      ticketTypeId: "ga",
      quantityAvailable: 2,
      quantitySold: 0,
    });
    const transactCall = sendMock.mock.calls.find((c) => c[0] instanceof TransactWriteCommand);
    const update = transactCall![0].input.TransactItems[0].Update;
    expect(update.ConditionExpression).toBe("quantitySold + :qty <= quantityAvailable");
    expect(update.ExpressionAttributeValues[":qty"]).toBe(2);
  });

  it("treats a PutCommand ConditionalCheckFailedException (row already exists) as fine, not an error", async () => {
    const { ConditionalCheckFailedException } = await import("@aws-sdk/client-dynamodb");
    sendMock.mockImplementation((command) => {
      if (command instanceof PutCommand) {
        return Promise.reject(new ConditionalCheckFailedException({ message: "exists", $metadata: {} }));
      }
      if (command instanceof TransactWriteCommand) return Promise.resolve({});
      throw new Error("unexpected command");
    });

    const { reserveInventory } = await import("../lambda/shared/inventory");
    await expect(reserveInventory("evt-1", line(1), TICKET_TYPES)).resolves.toBeNull();
  });

  it("returns the failing ticket type id when the transaction's condition fails (would oversell)", async () => {
    sendMock.mockImplementation((command) => {
      if (command instanceof PutCommand) return Promise.resolve({});
      if (command instanceof TransactWriteCommand) {
        return Promise.reject(
          new TransactionCanceledException({
            message: "cancelled",
            $metadata: {},
            CancellationReasons: [{ Code: "ConditionalCheckFailed" }],
          }),
        );
      }
      throw new Error("unexpected command");
    });

    const { reserveInventory } = await import("../lambda/shared/inventory");
    const result = await reserveInventory("evt-1", line(2), TICKET_TYPES);
    expect(result).toBe("ga");
  });

  it("reserves every line item in a single transaction — never a partial reservation across ticket types", async () => {
    const twoLineItems: OrderLineItem[] = [
      { ticketTypeId: "ga", ticketTypeName: "GA", unitPriceCents: 3000, feePolicy: "buyer-pays", quantity: 1 },
      { ticketTypeId: "vip", ticketTypeName: "VIP", unitPriceCents: 8000, feePolicy: "organiser-absorbs", quantity: 1 },
    ];
    const bothTicketTypes: TicketTypeInput[] = [
      ...TICKET_TYPES,
      { id: "vip", name: "VIP", priceCents: 8000, feePolicy: "organiser-absorbs", quantityAvailable: 5 },
    ];
    sendMock.mockImplementation((command) => {
      if (command instanceof PutCommand) return Promise.resolve({});
      if (command instanceof TransactWriteCommand) return Promise.resolve({});
      throw new Error("unexpected command");
    });

    const { reserveInventory } = await import("../lambda/shared/inventory");
    await reserveInventory("evt-1", twoLineItems, bothTicketTypes);

    const transactCall = sendMock.mock.calls.find((c) => c[0] instanceof TransactWriteCommand);
    expect(transactCall![0].input.TransactItems).toHaveLength(2);
  });
});
