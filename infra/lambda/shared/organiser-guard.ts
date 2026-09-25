import { GetCommand, QueryCommand } from "@aws-sdk/lib-dynamodb";
import { getCallerSub } from "./auth";
import { ddb, INDEXES, TABLES } from "./db";
import { HttpError, type ApiEvent } from "./http";
import type { OrganiserRecord } from "./types";

/** Loads the caller's own organiser record, requiring `status = approved`. */
export async function requireApprovedOrganiser(event: ApiEvent): Promise<OrganiserRecord> {
  const ownerUserId = getCallerSub(event);
  const result = await ddb.send(
    new GetCommand({ TableName: TABLES.organisers, Key: { ownerUserId } }),
  );
  const record = result.Item as OrganiserRecord | undefined;
  if (!record || record.status !== "approved") {
    throw new HttpError(403, "Your organiser application must be approved before you can submit events.");
  }
  return record;
}

/**
 * OrganisersTable is keyed by `ownerUserId`; `organiserId` (the id embedded
 * in every event/route) is a generated attribute, not the key — every other
 * lookup in this codebase is self-referential (a caller loading their own
 * record). The checkout route is the first one that needs to go the other
 * way, from a public EventRecord's `organiserId` to its owning organiser, so
 * it needs the GSI this queries.
 */
export async function findOrganiserByOrganiserId(organiserId: string): Promise<OrganiserRecord | undefined> {
  const result = await ddb.send(
    new QueryCommand({
      TableName: TABLES.organisers,
      IndexName: INDEXES.organisersByOrganiserId,
      KeyConditionExpression: "organiserId = :id",
      ExpressionAttributeValues: { ":id": organiserId },
      Limit: 1,
    }),
  );
  return (result.Items?.[0] as OrganiserRecord | undefined) ?? undefined;
}
