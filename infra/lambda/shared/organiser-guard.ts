import { GetCommand } from "@aws-sdk/lib-dynamodb";
import { getCallerSub } from "./auth";
import { ddb, TABLES } from "./db";
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
