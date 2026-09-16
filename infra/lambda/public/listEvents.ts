import { QueryCommand } from "@aws-sdk/lib-dynamodb";
import { ddb, INDEXES, TABLES } from "../shared/db";
import { badRequest, handle, ok, type ApiEvent } from "../shared/http";
import { melbourneLocalToUtcIso } from "../shared/melbourne-time";
import { decodeCursor, encodeCursor, parseLimit } from "../shared/pagination";
import { EVENT_CATEGORIES, toPublicEvent, type EventCategory, type EventRecord } from "../shared/types";

/**
 * Public, unauthenticated: only ever reads the `published` partition of the
 * status GSI — a draft, pending_review or rejected event is structurally
 * unreachable through this handler, not just filtered out by convention.
 */
export const handler = (event: ApiEvent) =>
  handle(async () => {
    const qs = event.queryStringParameters ?? {};

    const category = qs.category;
    if (category && !EVENT_CATEGORIES.includes(category as EventCategory)) {
      return badRequest(`category must be one of: ${EVENT_CATEGORIES.join(", ")}`);
    }

    const pricing = qs.pricing;
    if (pricing && pricing !== "free" && pricing !== "paid") {
      return badRequest("pricing must be 'free' or 'paid'.");
    }

    let startsAtFloor: string | undefined;
    if (qs.onOrAfter) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(qs.onOrAfter)) {
        return badRequest("onOrAfter must be formatted YYYY-MM-DD.");
      }
      try {
        startsAtFloor = melbourneLocalToUtcIso(qs.onOrAfter, "00:00");
      } catch {
        return badRequest("onOrAfter is not a valid date.");
      }
    }

    const result = await ddb.send(
      new QueryCommand({
        TableName: TABLES.events,
        IndexName: INDEXES.eventsByStatus,
        KeyConditionExpression: startsAtFloor ? "#status = :status AND startsAt >= :floor" : "#status = :status",
        FilterExpression: category ? "category = :category" : undefined,
        ExpressionAttributeNames: { "#status": "status" },
        ExpressionAttributeValues: {
          ":status": "published",
          ...(startsAtFloor ? { ":floor": startsAtFloor } : {}),
          ...(category ? { ":category": category } : {}),
        },
        Limit: parseLimit(qs.limit),
        ExclusiveStartKey: decodeCursor(qs.cursor),
      }),
    );

    let items = (result.Items ?? []) as EventRecord[];
    if (pricing) {
      // ticketTypes is a nested list, so "every ticket is free" can't be a
      // native FilterExpression — applied here instead of in DynamoDB.
      items = items.filter((item) => {
        const free = item.ticketTypes.every((t) => t.priceCents === 0);
        return pricing === "free" ? free : !free;
      });
    }

    return ok({
      items: items.map(toPublicEvent),
      nextCursor: encodeCursor(result.LastEvaluatedKey),
    });
  });
