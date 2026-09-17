import { QueryCommand } from "@aws-sdk/lib-dynamodb";
import { requireAdmin } from "../../shared/auth";
import { ddb, INDEXES, TABLES } from "../../shared/db";
import { badRequest, handle, ok, type ApiEvent } from "../../shared/http";
import { decodeCursor, encodeCursor, parseLimit } from "../../shared/pagination";
import type { OrganiserRecord, OrganiserStatus } from "../../shared/types";

const VALID_STATUSES: OrganiserStatus[] = ["pending", "approved", "rejected"];

export const handler = (event: ApiEvent) =>
  handle(async () => {
    requireAdmin(event);

    const qs = event.queryStringParameters ?? {};
    const status = (qs.status ?? "pending") as OrganiserStatus;
    if (!VALID_STATUSES.includes(status)) {
      return badRequest(`status must be one of: ${VALID_STATUSES.join(", ")}`);
    }

    const result = await ddb.send(
      new QueryCommand({
        TableName: TABLES.organisers,
        IndexName: INDEXES.organisersByStatus,
        KeyConditionExpression: "#status = :status",
        ExpressionAttributeNames: { "#status": "status" },
        ExpressionAttributeValues: { ":status": status },
        Limit: parseLimit(qs.limit),
        ExclusiveStartKey: decodeCursor(qs.cursor),
        ScanIndexForward: false,
      }),
    );

    return ok({
      items: (result.Items ?? []) as OrganiserRecord[],
      nextCursor: encodeCursor(result.LastEvaluatedKey),
    });
  });
