#!/usr/bin/env node
/**
 * Populates the dev DynamoDB tables with the same fictional sample events
 * used by the frontend's local demo mode, published so they show up on the
 * live public feed. This is the "development seed process" referenced in
 * docs/architecture.md — sample data never ships silently mixed into
 * production; it only ever appears here, run explicitly, against a dev
 * environment.
 *
 * Usage:
 *   npm install                # once, inside scripts/
 *   npm run seed-dev-data -- [--region ap-southeast-2] \
 *     [--events-table sheltuh-dev-events] \
 *     [--slugs-table sheltuh-dev-event-slugs]
 *
 * Requires AWS credentials with write access to those two tables — see
 * docs/aws-setup.md for the recommended temporary-credential/SSO setup.
 */
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, PutCommand } from "@aws-sdk/lib-dynamodb";
import { sampleEvents } from "../lib/sample-events";

function parseArgs() {
  const args = process.argv.slice(2);
  const get = (flag: string, fallback: string): string => {
    const i = args.indexOf(flag);
    return i === -1 ? fallback : args[i + 1];
  };
  return {
    region: get("--region", "ap-southeast-2"),
    eventsTable: get("--events-table", "sheltuh-dev-events"),
    slugsTable: get("--slugs-table", "sheltuh-dev-event-slugs"),
  };
}

function organiserIdFor(organiserName: string): string {
  return `seed-${organiserName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")}`;
}

async function main() {
  const { region, eventsTable, slugsTable } = parseArgs();
  const client = new DynamoDBClient({ region });
  const ddb = DynamoDBDocumentClient.from(client, { marshallOptions: { removeUndefinedValues: true } });

  const now = new Date().toISOString();
  let count = 0;

  for (const event of sampleEvents) {
    const organiserId = organiserIdFor(event.organiserName);

    await ddb.send(
      new PutCommand({
        TableName: eventsTable,
        Item: {
          organiserId,
          eventId: event.id,
          slug: event.slug,
          title: event.title,
          description: event.description,
          category: event.category,
          venueName: event.venueName,
          venueAddress: event.venueAddress,
          suburb: event.suburb,
          startsAt: event.startsAt,
          endsAt: event.endsAt,
          organiserName: event.organiserName,
          ticketTypes: event.ticketTypes,
          status: "published",
          moderationLog: [{ action: "approved", by: "seed-script", at: now }],
          createdAt: now,
          updatedAt: now,
        },
      }),
    );

    await ddb.send(
      new PutCommand({
        TableName: slugsTable,
        Item: { slug: event.slug, organiserId, eventId: event.id },
      }),
    );

    count += 1;
    console.log(`Seeded: ${event.title} (${event.slug})`);
  }

  console.log(`Done — seeded ${count} published events into ${eventsTable} / ${slugsTable} (${region}).`);
}

main().catch((err) => {
  console.error("Seeding failed:", err instanceof Error ? err.message : err);
  process.exit(1);
});
