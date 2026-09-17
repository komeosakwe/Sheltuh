import { ConditionalCheckFailedException } from "@aws-sdk/client-dynamodb";
import { UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { ddb, TABLES } from "../shared/db";
import { parseEventInput } from "../shared/event-input";
import { badRequest, conflict, forbidden, handle, parseBody, ok, type ApiEvent } from "../shared/http";
import { requireApprovedOrganiser } from "../shared/organiser-guard";
import { EDITABLE_EVENT_STATUSES } from "../shared/state";
import type { EventRecord } from "../shared/types";

export const handler = (event: ApiEvent) =>
  handle(async () => {
    const organiser = await requireApprovedOrganiser(event);
    const { organiserId, eventId } = event.pathParameters ?? {};
    if (!organiserId || !eventId) return badRequest("Missing organiserId or eventId in the URL.");
    if (organiserId !== organiser.organiserId) {
      return forbidden("You can only edit your own organisation's events.");
    }

    const input = parseEventInput(parseBody(event) ?? {});
    const now = new Date().toISOString();

    try {
      const result = await ddb.send(
        new UpdateCommand({
          TableName: TABLES.events,
          Key: { organiserId, eventId },
          ConditionExpression: "attribute_exists(eventId) AND #status IN (:draft, :rejected)",
          UpdateExpression:
            "SET title = :title, description = :description, category = :category, " +
            "venueName = :venueName, venueAddress = :venueAddress, suburb = :suburb, " +
            "startsAt = :startsAt, endsAt = :endsAt, ticketTypes = :ticketTypes, updatedAt = :now",
          ExpressionAttributeNames: { "#status": "status" },
          ExpressionAttributeValues: {
            ":draft": EDITABLE_EVENT_STATUSES[0],
            ":rejected": EDITABLE_EVENT_STATUSES[1],
            ":title": input.title,
            ":description": input.description,
            ":category": input.category,
            ":venueName": input.venueName,
            ":venueAddress": input.venueAddress,
            ":suburb": input.suburb,
            ":startsAt": input.startsAt,
            ":endsAt": input.endsAt,
            ":ticketTypes": input.ticketTypes,
            ":now": now,
          },
          ReturnValues: "ALL_NEW",
        }),
      );
      return ok(result.Attributes as EventRecord);
    } catch (err) {
      if (err instanceof ConditionalCheckFailedException) {
        return conflict("This event can't be edited while it's pending review or published.");
      }
      throw err;
    }
  });
