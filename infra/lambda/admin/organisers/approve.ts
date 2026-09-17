import { ConditionalCheckFailedException } from "@aws-sdk/client-dynamodb";
import { UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { requireAdmin } from "../../shared/auth";
import { ddb, TABLES } from "../../shared/db";
import { badRequest, conflict, handle, ok, type ApiEvent } from "../../shared/http";
import type { OrganiserRecord } from "../../shared/types";

export const handler = (event: ApiEvent) =>
  handle(async () => {
    const adminSub = requireAdmin(event);
    const ownerUserId = event.pathParameters?.ownerUserId;
    if (!ownerUserId) return badRequest("Missing ownerUserId in the URL.");

    const now = new Date().toISOString();
    try {
      const result = await ddb.send(
        new UpdateCommand({
          TableName: TABLES.organisers,
          Key: { ownerUserId },
          ConditionExpression: "attribute_exists(ownerUserId) AND #status = :pending",
          UpdateExpression:
            "SET #status = :approved, reviewedBy = :adminSub, reviewedAt = :now, updatedAt = :now " +
            "REMOVE rejectionReason",
          ExpressionAttributeNames: { "#status": "status" },
          ExpressionAttributeValues: { ":pending": "pending", ":approved": "approved", ":adminSub": adminSub, ":now": now },
          ReturnValues: "ALL_NEW",
        }),
      );
      return ok(result.Attributes as OrganiserRecord);
    } catch (err) {
      if (err instanceof ConditionalCheckFailedException) {
        return conflict("This application is no longer pending — it may already have been reviewed.");
      }
      throw err;
    }
  });
