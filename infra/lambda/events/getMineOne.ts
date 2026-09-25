import { GetCommand } from "@aws-sdk/lib-dynamodb";
import { ddb, TABLES } from "../shared/db";
import { badRequest, handle, notFound, ok, type ApiEvent } from "../shared/http";
import { requireApprovedOrganiser } from "../shared/organiser-guard";
import type { EventRecord } from "../shared/types";

export const handler = (event: ApiEvent) =>
  handle(async () => {
    const organiser = await requireApprovedOrganiser(event);
    const eventId = event.pathParameters?.eventId;
    if (!eventId) return badRequest("Missing eventId in the URL.");

    const result = await ddb.send(
      new GetCommand({
        TableName: TABLES.events,
        // organiser.organiserId, never a client-supplied organiserId, so this
        // can never read another organisation's event.
        Key: { organiserId: organiser.organiserId, eventId },
      }),
    );
    if (!result.Item) return notFound("Event not found.");
    return ok(result.Item as EventRecord);
  });
