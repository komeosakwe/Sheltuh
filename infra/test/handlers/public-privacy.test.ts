import { beforeEach, describe, expect, it, vi } from "vitest";
import { callHandler, fakeEvent } from "../helpers/fake-event";

const sendMock = vi.fn();

vi.mock("../../lambda/shared/db", () => ({
  ddb: { send: (...args: unknown[]) => sendMock(...args) },
  TABLES: { organisers: "test-organisers", events: "test-events", eventSlugs: "test-event-slugs" },
  INDEXES: { organisersByStatus: "status-index", eventsByStatus: "status-startsAt-index" },
}));

beforeEach(() => {
  sendMock.mockReset();
});

const BASE_EVENT = {
  organiserId: "org-1",
  eventId: "evt-1",
  slug: "my-event",
  title: "My Event",
  description: "d",
  category: "live-music",
  venueName: "v",
  venueAddress: "a",
  suburb: "s",
  startsAt: "2026-12-01T09:00:00.000Z",
  endsAt: "2026-12-01T12:00:00.000Z",
  organiserName: "Org",
  ticketTypes: [{ id: "t1", name: "GA", priceCents: 1000, feePolicy: "buyer-pays", quantityAvailable: 10 }],
  moderationLog: [],
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

describe("public getEventBySlug — draft/rejected/pending_review events stay private", () => {
  it.each(["draft", "pending_review", "rejected"] as const)("returns 404 for a %s event, not its details", async (status) => {
    sendMock.mockImplementation((command) => {
      if (command.input.TableName === "test-event-slugs") {
        return Promise.resolve({ Item: { slug: "my-event", organiserId: "org-1", eventId: "evt-1" } });
      }
      if (command.input.TableName === "test-events") {
        return Promise.resolve({ Item: { ...BASE_EVENT, status } });
      }
      throw new Error("unexpected call");
    });

    const { handler } = await import("../../lambda/public/getEventBySlug");
    const result = await callHandler(handler, fakeEvent({ pathParameters: { slug: "my-event" } }));

    expect(result.statusCode).toBe(404);
    expect(result.body).not.toContain("My Event");
  });

  it("returns the event only once it is published", async () => {
    sendMock.mockImplementation((command) => {
      if (command.input.TableName === "test-event-slugs") {
        return Promise.resolve({ Item: { slug: "my-event", organiserId: "org-1", eventId: "evt-1" } });
      }
      if (command.input.TableName === "test-events") {
        return Promise.resolve({ Item: { ...BASE_EVENT, status: "published" } });
      }
      throw new Error("unexpected call");
    });

    const { handler } = await import("../../lambda/public/getEventBySlug");
    const result = await callHandler(handler, fakeEvent({ pathParameters: { slug: "my-event" } }));

    expect(result.statusCode).toBe(200);
    expect(result.body).toContain("My Event");
    // Never leaks internal-only fields (organiserId, moderationLog, status) via the public route.
    expect(result.body).not.toContain("moderationLog");
    expect(result.body).not.toContain("org-1");
  });

  it("returns 404 for a slug that never existed, without ever reading the events table", async () => {
    sendMock.mockImplementation((command) => {
      if (command.input.TableName === "test-event-slugs") return Promise.resolve({});
      throw new Error("should not query the events table for an unknown slug");
    });

    const { handler } = await import("../../lambda/public/getEventBySlug");
    const result = await callHandler(handler, fakeEvent({ pathParameters: { slug: "no-such-event" } }));

    expect(result.statusCode).toBe(404);
    expect(sendMock).toHaveBeenCalledTimes(1);
  });
});

describe("public listEvents — only ever queries the published partition", () => {
  it("always sends status = published regardless of query params", async () => {
    sendMock.mockResolvedValue({ Items: [] });

    const { handler } = await import("../../lambda/public/listEvents");
    await handler(fakeEvent({ queryStringParameters: { category: "live-music" } }));

    expect(sendMock).toHaveBeenCalledTimes(1);
    const sentCommand = sendMock.mock.calls[0][0];
    expect(sentCommand.input.ExpressionAttributeValues[":status"]).toBe("published");
    expect(sentCommand.input.IndexName).toBe("status-startsAt-index");
  });

  it("never accepts a client-supplied status filter to widen beyond published", async () => {
    sendMock.mockResolvedValue({ Items: [] });

    const { handler } = await import("../../lambda/public/listEvents");
    // Even if a caller tries to sneak a "status" query param in, the handler
    // doesn't read it at all — it hardcodes "published".
    await handler(fakeEvent({ queryStringParameters: { status: "draft" } as unknown as Record<string, string> }));

    const sentCommand = sendMock.mock.calls[0][0];
    expect(sentCommand.input.ExpressionAttributeValues[":status"]).toBe("published");
  });
});
