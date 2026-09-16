import { ConditionalCheckFailedException } from "@aws-sdk/client-dynamodb";
import { GetCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { getCallerSub } from "../shared/auth";
import { ddb, TABLES } from "../shared/db";
import { conflict, handle, notFound, ok, parseBody, type ApiEvent } from "../shared/http";
import { canResubmitOrganiser } from "../shared/state";
import { toOwnOrganiserView, type OrganiserRecord } from "../shared/types";
import { fail, optionalUrl, requireCategories, requireEmail, requireString } from "../shared/validation";

interface ResubmitBody {
  displayName?: unknown;
  contactEmail?: unknown;
  description?: unknown;
  categories?: unknown;
  websiteUrl?: unknown;
}

export const handler = (event: ApiEvent) =>
  handle(async () => {
    const ownerUserId = getCallerSub(event);

    const existing = await ddb.send(
      new GetCommand({ TableName: TABLES.organisers, Key: { ownerUserId } }),
    );
    const record = existing.Item as OrganiserRecord | undefined;
    if (!record) return notFound("No organiser application found.");
    if (!canResubmitOrganiser(record.status)) {
      return conflict("Only a rejected application can be edited and resubmitted.");
    }

    const body = parseBody<ResubmitBody>(event) ?? {};
    const errors: Record<string, string> = {};
    const displayName = requireString(body.displayName, "displayName", errors, 120);
    const contactEmail = requireEmail(body.contactEmail, "contactEmail", errors);
    const description = requireString(body.description, "description", errors, 2000);
    const categories = requireCategories(body.categories, "categories", errors);
    const websiteUrl = optionalUrl(body.websiteUrl, "websiteUrl", errors);
    if (Object.keys(errors).length > 0) fail(errors);

    const now = new Date().toISOString();
    try {
      const result = await ddb.send(
        new UpdateCommand({
          TableName: TABLES.organisers,
          Key: { ownerUserId },
          ConditionExpression: "#status = :rejected",
          UpdateExpression:
            "SET displayName = :displayName, contactEmail = :contactEmail, description = :description, " +
            "categories = :categories, websiteUrl = :websiteUrl, #status = :pending, updatedAt = :now " +
            "REMOVE rejectionReason, reviewedBy, reviewedAt",
          ExpressionAttributeNames: { "#status": "status" },
          ExpressionAttributeValues: {
            ":rejected": "rejected",
            ":pending": "pending",
            ":displayName": displayName,
            ":contactEmail": contactEmail,
            ":description": description,
            ":categories": categories,
            ":websiteUrl": websiteUrl,
            ":now": now,
          },
          ReturnValues: "ALL_NEW",
        }),
      );
      return ok(toOwnOrganiserView(result.Attributes as OrganiserRecord));
    } catch (err) {
      if (err instanceof ConditionalCheckFailedException) {
        return conflict("Your application status changed — refresh and try again.");
      }
      throw err;
    }
  });
