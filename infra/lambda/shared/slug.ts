import { ConditionalCheckFailedException } from "@aws-sdk/client-dynamodb";
import { PutCommand } from "@aws-sdk/lib-dynamodb";
import { ddb, TABLES } from "./db";
import { HttpError } from "./http";
import { slugify } from "./validation";

const MAX_ATTEMPTS = 5;

/**
 * Reserves a globally-unique slug for a new event via a conditional put on
 * the EventSlugs table (PK = slug). Falls back to a short random suffix on
 * collision rather than failing the whole submission.
 */
export async function allocateUniqueSlug(title: string, organiserId: string, eventId: string): Promise<string> {
  const base = slugify(title) || "event";

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    const candidate = attempt === 0 ? base : `${base}-${crypto.randomUUID().slice(0, 6)}`;
    try {
      await ddb.send(
        new PutCommand({
          TableName: TABLES.eventSlugs,
          Item: { slug: candidate, organiserId, eventId },
          ConditionExpression: "attribute_not_exists(slug)",
        }),
      );
      return candidate;
    } catch (err) {
      if (err instanceof ConditionalCheckFailedException) continue;
      throw err;
    }
  }

  throw new HttpError(500, "Could not allocate a unique event URL — try a different title.");
}
