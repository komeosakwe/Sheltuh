import { ConditionalCheckFailedException } from "@aws-sdk/client-dynamodb";
import { UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { requireAdmin } from "../../shared/auth";
import { ddb, TABLES } from "../../shared/db";
import { badRequest, conflict, handle, ok, parseBody, type ApiEvent } from "../../shared/http";
import type { OrganiserRecord } from "../../shared/types";
import { fail, requireString } from "../../shared/validation";

interface RejectBody {
  reason?: unknown;
}

export const handler = (event: ApiEvent) =>
  handle(async () => {
    const adminSub = requireAdmin(event);
    const ownerUserId = event.pathParameters?.ownerUserId;
    if (!ownerUserId) return badRequest("Missing ownerUserId in the URL.");

    const body = parseBody<RejectBody>(event) ?? {};
    const errors: Record<string, string> = {};
    const reason = requireString(body.reason, "reason", errors, 1000);
    if (Object.keys(errors).length > 0) fail(errors);

    const now = new Date().toISOString();
    try {
      const result = await ddb.send(
        new UpdateCommand({
          TableName: TABLES.organisers,
          Key: { ownerUserId },
          ConditionExpression: "attribute_exists(ownerUserId) AND #status = :pending",
          UpdateExpression:
            "SET #status = :rejected, rejectionReason = :reason, reviewedBy = :adminSub, reviewedAt = :now, updatedAt = :now",
          ExpressionAttributeNames: { "#status": "status" },
          ExpressionAttributeValues: {
            ":pending": "pending",
            ":rejected": "rejected",
            ":reason": reason,
            ":adminSub": adminSub,
            ":now": now,
          },
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
