import { QueryCommand } from "@aws-sdk/lib-dynamodb";
import { ddb, TABLES } from "../shared/db";
import { handle, ok, type ApiEvent } from "../shared/http";
import { decodeCursor, encodeCursor, parseLimit } from "../shared/pagination";
import { requireApprovedOrganiser } from "../shared/organiser-guard";
import type { EventRecord } from "../shared/types";

export const handler = (event: ApiEvent) =>
  handle(async () => {
    const organiser = await requireApprovedOrganiser(event);
    const qs = event.queryStringParameters ?? {};

    const result = await ddb.send(
      new QueryCommand({
        TableName: TABLES.events,
        KeyConditionExpression: "organiserId = :organiserId",
        ExpressionAttributeValues: { ":organiserId": organiser.organiserId },
        Limit: parseLimit(qs.limit),
        ExclusiveStartKey: decodeCursor(qs.cursor),
        ScanIndexForward: false,
      }),
    );

    return ok({
      items: (result.Items ?? []) as EventRecord[],
      nextCursor: encodeCursor(result.LastEvaluatedKey),
    });
  });
