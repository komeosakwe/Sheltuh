import { PutCommand } from "@aws-sdk/lib-dynamodb";
import { ddb, TABLES } from "../shared/db";
import { created, handle, parseBody, type ApiEvent } from "../shared/http";
import { newSortableId } from "../shared/ids";
import { requireApprovedOrganiser } from "../shared/organiser-guard";
import { parseEventInput } from "../shared/event-input";
import { allocateUniqueSlug } from "../shared/slug";
import type { EventRecord } from "../shared/types";

export const handler = (event: ApiEvent) =>
  handle(async () => {
    const organiser = await requireApprovedOrganiser(event);
    const input = parseEventInput(parseBody(event) ?? {});

    const eventId = newSortableId();
    const slug = await allocateUniqueSlug(input.title, organiser.organiserId, eventId);
    const now = new Date().toISOString();

    const record: EventRecord = {
      organiserId: organiser.organiserId,
      eventId,
      slug,
      ...input,
      organiserName: organiser.displayName,
      status: "draft",
      moderationLog: [],
      createdAt: now,
      updatedAt: now,
    };

    await ddb.send(
      new PutCommand({
        TableName: TABLES.events,
        Item: record,
        ConditionExpression: "attribute_not_exists(eventId)",
      }),
    );

    return created(record);
  });
