import { ConditionalCheckFailedException } from "@aws-sdk/client-dynamodb";
import { UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { getCallerSub } from "../shared/auth";
import { ddb, TABLES } from "../shared/db";
import { badRequest, conflict, forbidden, handle, ok, type ApiEvent } from "../shared/http";
import { requireApprovedOrganiser } from "../shared/organiser-guard";
import { SUBMITTABLE_EVENT_STATUSES } from "../shared/state";
import type { EventRecord, ModerationLogEntry } from "../shared/types";

export const handler = (event: ApiEvent) =>
  handle(async () => {
    const organiser = await requireApprovedOrganiser(event);
    const { organiserId, eventId } = event.pathParameters ?? {};
    if (!organiserId || !eventId) return badRequest("Missing organiserId or eventId in the URL.");
    if (organiserId !== organiser.organiserId) {
      return forbidden("You can only submit your own organisation's events.");
    }

    const now = new Date().toISOString();
    const logEntry: ModerationLogEntry = { action: "submitted", by: getCallerSub(event), at: now };

    try {
      const result = await ddb.send(
        new UpdateCommand({
          TableName: TABLES.events,
          Key: { organiserId, eventId },
          ConditionExpression: "attribute_exists(eventId) AND #status IN (:draft, :rejected)",
          UpdateExpression:
            "SET #status = :pendingReview, updatedAt = :now, " +
            "moderationLog = list_append(if_not_exists(moderationLog, :emptyList), :logEntry) " +
            "REMOVE rejectionReason",
          ExpressionAttributeNames: { "#status": "status" },
          ExpressionAttributeValues: {
            ":draft": SUBMITTABLE_EVENT_STATUSES[0],
            ":rejected": SUBMITTABLE_EVENT_STATUSES[1],
            ":pendingReview": "pending_review",
            ":now": now,
            ":emptyList": [],
            ":logEntry": [logEntry],
          },
          ReturnValues: "ALL_NEW",
        }),
      );
      return ok(result.Attributes as EventRecord);
    } catch (err) {
      if (err instanceof ConditionalCheckFailedException) {
        return conflict("Only a draft or rejected event can be submitted for review.");
      }
      throw err;
    }
  });
