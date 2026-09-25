import { GetCommand, PutCommand } from "@aws-sdk/lib-dynamodb";
import { getCallerSub } from "../shared/auth";
import { ddb, TABLES } from "../shared/db";
import { conflict, created, handle, parseBody, type ApiEvent } from "../shared/http";
import { canApplyAsOrganiser } from "../shared/state";
import type { OrganiserRecord } from "../shared/types";
import { toOwnOrganiserView } from "../shared/types";
import { fail, requireCategories, requireEmail, requireString, optionalUrl } from "../shared/validation";

interface ApplyBody {
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
    const existingStatus = (existing.Item as OrganiserRecord | undefined)?.status;
    if (!canApplyAsOrganiser(existingStatus)) {
      return conflict(
        existingStatus === "rejected"
          ? "You already have an application on file. Edit and resubmit it instead of applying again."
          : "You already have an application on file.",
      );
    }

    const body = parseBody<ApplyBody>(event) ?? {};
    const errors: Record<string, string> = {};
    const displayName = requireString(body.displayName, "displayName", errors, 120);
    const contactEmail = requireEmail(body.contactEmail, "contactEmail", errors);
    const description = requireString(body.description, "description", errors, 2000);
    const categories = requireCategories(body.categories, "categories", errors);
    const websiteUrl = optionalUrl(body.websiteUrl, "websiteUrl", errors);
    if (Object.keys(errors).length > 0) fail(errors);

    const now = new Date().toISOString();
    const record: OrganiserRecord = {
      ownerUserId,
      organiserId: crypto.randomUUID(),
      displayName,
      contactEmail,
      description,
      categories,
      websiteUrl,
      status: "pending",
      createdAt: now,
      updatedAt: now,
    };

    await ddb.send(
      new PutCommand({
        TableName: TABLES.organisers,
        Item: record,
        ConditionExpression: "attribute_not_exists(ownerUserId)",
      }),
    );

    return created(toOwnOrganiserView(record));
  });
