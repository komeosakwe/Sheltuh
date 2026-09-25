import { QueryCommand } from "@aws-sdk/lib-dynamodb";
import { requireAdmin } from "../../shared/auth";
import { ddb, INDEXES, TABLES } from "../../shared/db";
import { badRequest, handle, ok, type ApiEvent } from "../../shared/http";
import { decodeCursor, encodeCursor, parseLimit } from "../../shared/pagination";
import type { EventRecord, EventStatus } from "../../shared/types";

const VALID_STATUSES: EventStatus[] = ["draft", "pending_review", "published", "rejected"];

export const handler = (event: ApiEvent) =>
  handle(async () => {
    requireAdmin(event);

    const qs = event.queryStringParameters ?? {};
    const status = (qs.status ?? "pending_review") as EventStatus;
    if (!VALID_STATUSES.includes(status)) {
      return badRequest(`status must be one of: ${VALID_STATUSES.join(", ")}`);
    }

    const result = await ddb.send(
      new QueryCommand({
        TableName: TABLES.events,
        IndexName: INDEXES.eventsByStatus,
        KeyConditionExpression: "#status = :status",
        ExpressionAttributeNames: { "#status": "status" },
        ExpressionAttributeValues: { ":status": status },
        Limit: parseLimit(qs.limit),
        ExclusiveStartKey: decodeCursor(qs.cursor),
      }),
    );

    return ok({
      items: (result.Items ?? []) as EventRecord[],
      nextCursor: encodeCursor(result.LastEvaluatedKey),
    });
  });
