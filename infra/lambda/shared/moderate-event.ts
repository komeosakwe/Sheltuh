import { ConditionalCheckFailedException } from "@aws-sdk/client-dynamodb";
import { UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { ddb, TABLES } from "./db";
import { HttpError } from "./http";
import type { EventRecord, EventStatus, ModerationLogEntry } from "./types";

interface ModerateParams {
  organiserId: string;
  eventId: string;
  fromStatus: EventStatus;
  toStatus: EventStatus;
  by: string;
  action: ModerationLogEntry["action"];
  reason?: string;
}

/** Shared conditional-update + moderation-log-append logic for every admin event decision. */
export async function moderateEvent(params: ModerateParams): Promise<EventRecord> {
  const now = new Date().toISOString();
  const logEntry: ModerationLogEntry = { action: params.action, by: params.by, at: now, reason: params.reason };

  const setClause = params.reason
    ? "SET #status = :toStatus, updatedAt = :now, rejectionReason = :reason, " +
      "moderationLog = list_append(if_not_exists(moderationLog, :emptyList), :logEntry)"
    : "SET #status = :toStatus, updatedAt = :now, " +
      "moderationLog = list_append(if_not_exists(moderationLog, :emptyList), :logEntry) REMOVE rejectionReason";

  try {
    const result = await ddb.send(
      new UpdateCommand({
        TableName: TABLES.events,
        Key: { organiserId: params.organiserId, eventId: params.eventId },
        ConditionExpression: "attribute_exists(eventId) AND #status = :fromStatus",
        UpdateExpression: setClause,
        ExpressionAttributeNames: { "#status": "status" },
        ExpressionAttributeValues: {
          ":fromStatus": params.fromStatus,
          ":toStatus": params.toStatus,
          ":now": now,
          ":emptyList": [],
          ":logEntry": [logEntry],
          ...(params.reason ? { ":reason": params.reason } : {}),
        },
        ReturnValues: "ALL_NEW",
      }),
    );
    return result.Attributes as EventRecord;
  } catch (err) {
    if (err instanceof ConditionalCheckFailedException) {
      throw new HttpError(
        409,
        `This event is no longer ${params.fromStatus.replace("_", " ")} — it may already have been reviewed.`,
      );
    }
    throw err;
  }
}
