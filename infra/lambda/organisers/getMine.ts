import { GetCommand } from "@aws-sdk/lib-dynamodb";
import { getCallerSub } from "../shared/auth";
import { ddb, TABLES } from "../shared/db";
import { handle, notFound, ok, type ApiEvent } from "../shared/http";
import { toOwnOrganiserView, type OrganiserRecord } from "../shared/types";

export const handler = (event: ApiEvent) =>
  handle(async () => {
    const ownerUserId = getCallerSub(event);
    const result = await ddb.send(
      new GetCommand({ TableName: TABLES.organisers, Key: { ownerUserId } }),
    );
    if (!result.Item) return notFound("No organiser application found.");
    return ok(toOwnOrganiserView(result.Item as OrganiserRecord));
  });
