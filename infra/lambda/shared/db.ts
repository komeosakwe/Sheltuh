import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";

const client = new DynamoDBClient({});
export const ddb = DynamoDBDocumentClient.from(client, {
  marshallOptions: { removeUndefinedValues: true },
});

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

export const TABLES = {
  get organisers() {
    return requireEnv("ORGANISERS_TABLE_NAME");
  },
  get events() {
    return requireEnv("EVENTS_TABLE_NAME");
  },
  get eventSlugs() {
    return requireEnv("EVENT_SLUGS_TABLE_NAME");
  },
};

export const INDEXES = {
  organisersByStatus: "status-index",
  eventsByStatus: "status-startsAt-index",
};
