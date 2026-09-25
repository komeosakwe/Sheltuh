import { GetCommand } from "@aws-sdk/lib-dynamodb";
import { ddb, TABLES } from "../shared/db";
import { badRequest, handle, notFound, ok, type ApiEvent } from "../shared/http";
import { toPublicEvent, type EventRecord } from "../shared/types";

export const handler = (event: ApiEvent) =>
  handle(async () => {
    const slug = event.pathParameters?.slug;
    if (!slug) return badRequest("Missing slug in the URL.");

    const slugLookup = await ddb.send(
      new GetCommand({ TableName: TABLES.eventSlugs, Key: { slug } }),
    );
    if (!slugLookup.Item) return notFound("Event not found.");

    const { organiserId, eventId } = slugLookup.Item as { organiserId: string; eventId: string };
    const result = await ddb.send(
      new GetCommand({ TableName: TABLES.events, Key: { organiserId, eventId } }),
    );
    const record = result.Item as EventRecord | undefined;

    // A slug can outlive publication (e.g. unpublished back to draft) — the
    // public endpoint must still only ever return a currently-published event.
    if (!record || record.status !== "published") return notFound("Event not found.");

    return ok(toPublicEvent(record));
  });
