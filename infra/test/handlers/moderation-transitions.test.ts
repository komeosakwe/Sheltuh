import { ConditionalCheckFailedException } from "@aws-sdk/client-dynamodb";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { adminClaims, callHandler, fakeEvent, organiserClaims } from "../helpers/fake-event";

const sendMock = vi.fn();

vi.mock("../../lambda/shared/db", () => ({
  ddb: { send: (...args: unknown[]) => sendMock(...args) },
  TABLES: { organisers: "test-organisers", events: "test-events", eventSlugs: "test-event-slugs" },
  INDEXES: { organisersByStatus: "status-index", eventsByStatus: "status-startsAt-index" },
}));

function conditionalCheckFailed() {
  return Promise.reject(new ConditionalCheckFailedException({ message: "conditional check failed", $metadata: {} }));
}

beforeEach(() => {
  sendMock.mockReset();
});

describe("event moderation — allowed transitions", () => {
  it("approve: pending_review -> published succeeds", async () => {
    sendMock.mockResolvedValue({ Attributes: { eventId: "evt-1", status: "published" } });
    const { handler } = await import("../../lambda/admin/events/approve");
    const result = await callHandler(handler, 
      fakeEvent({ claims: adminClaims("admin-1"), pathParameters: { organiserId: "org-1", eventId: "evt-1" } }),
    );
    expect(result.statusCode).toBe(200);
  });

  it("reject: pending_review -> rejected succeeds and requires a reason", async () => {
    sendMock.mockResolvedValue({ Attributes: { eventId: "evt-1", status: "rejected" } });
    const { handler } = await import("../../lambda/admin/events/reject");
    const result = await callHandler(handler, 
      fakeEvent({
        claims: adminClaims("admin-1"),
        pathParameters: { organiserId: "org-1", eventId: "evt-1" },
        body: { reason: "Missing venue details" },
      }),
    );
    expect(result.statusCode).toBe(200);
  });

  it("reject: rejects the request itself (400) if no reason is given, without touching the DB", async () => {
    const { handler } = await import("../../lambda/admin/events/reject");
    const result = await callHandler(handler, 
      fakeEvent({ claims: adminClaims("admin-1"), pathParameters: { organiserId: "org-1", eventId: "evt-1" }, body: {} }),
    );
    expect(result.statusCode).toBe(400);
    expect(sendMock).not.toHaveBeenCalled();
  });

  it("unpublish: published -> draft succeeds", async () => {
    sendMock.mockResolvedValue({ Attributes: { eventId: "evt-1", status: "draft" } });
    const { handler } = await import("../../lambda/admin/events/unpublish");
    const result = await callHandler(handler, 
      fakeEvent({ claims: adminClaims("admin-1"), pathParameters: { organiserId: "org-1", eventId: "evt-1" } }),
    );
    expect(result.statusCode).toBe(200);
  });
});

describe("event moderation — forbidden transitions", () => {
  it("approve: rejected with 409 (not silently accepted) when the event isn't pending_review", async () => {
    sendMock.mockImplementation(conditionalCheckFailed);
    const { handler } = await import("../../lambda/admin/events/approve");
    const result = await callHandler(handler, 
      fakeEvent({ claims: adminClaims("admin-1"), pathParameters: { organiserId: "org-1", eventId: "evt-1" } }),
    );
    expect(result.statusCode).toBe(409);
  });

  it("unpublish: rejected with 409 when the event isn't currently published", async () => {
    sendMock.mockImplementation(conditionalCheckFailed);
    const { handler } = await import("../../lambda/admin/events/unpublish");
    const result = await callHandler(handler, 
      fakeEvent({ claims: adminClaims("admin-1"), pathParameters: { organiserId: "org-1", eventId: "evt-1" } }),
    );
    expect(result.statusCode).toBe(409);
  });

  it("reject: rejected with 409 when the event isn't pending_review (e.g. already published)", async () => {
    sendMock.mockImplementation(conditionalCheckFailed);
    const { handler } = await import("../../lambda/admin/events/reject");
    const result = await callHandler(handler, 
      fakeEvent({
        claims: adminClaims("admin-1"),
        pathParameters: { organiserId: "org-1", eventId: "evt-1" },
        body: { reason: "test" },
      }),
    );
    expect(result.statusCode).toBe(409);
  });
});

describe("event moderation — requires admin, regardless of transition validity", () => {
  it("a signed-in but non-admin organiser cannot approve, reject or unpublish", async () => {
    const cases = [
      () => import("../../lambda/admin/events/approve"),
      () => import("../../lambda/admin/events/reject"),
      () => import("../../lambda/admin/events/unpublish"),
    ];
    for (const load of cases) {
      const { handler } = await load();
      const result = await callHandler(handler, 
        fakeEvent({
          claims: organiserClaims("some-organiser"),
          pathParameters: { organiserId: "org-1", eventId: "evt-1" },
          body: { reason: "test" },
        }),
      );
      expect(result.statusCode).toBe(403);
    }
    expect(sendMock).not.toHaveBeenCalled();
  });
});

describe("organiser application moderation — allowed and forbidden transitions", () => {
  it("approve succeeds for a pending application", async () => {
    sendMock.mockResolvedValue({ Attributes: { ownerUserId: "applicant-1", status: "approved" } });
    const { handler } = await import("../../lambda/admin/organisers/approve");
    const result = await callHandler(handler, 
      fakeEvent({ claims: adminClaims("admin-1"), pathParameters: { ownerUserId: "applicant-1" } }),
    );
    expect(result.statusCode).toBe(200);
  });

  it("approve is rejected with 409 for an application that isn't pending (e.g. already approved)", async () => {
    sendMock.mockImplementation(conditionalCheckFailed);
    const { handler } = await import("../../lambda/admin/organisers/approve");
    const result = await callHandler(handler, 
      fakeEvent({ claims: adminClaims("admin-1"), pathParameters: { ownerUserId: "applicant-1" } }),
    );
    expect(result.statusCode).toBe(409);
  });

  it("reject is rejected with 409 for an application that isn't pending", async () => {
    sendMock.mockImplementation(conditionalCheckFailed);
    const { handler } = await import("../../lambda/admin/organisers/reject");
    const result = await callHandler(handler, 
      fakeEvent({
        claims: adminClaims("admin-1"),
        pathParameters: { ownerUserId: "applicant-1" },
        body: { reason: "Incomplete details" },
      }),
    );
    expect(result.statusCode).toBe(409);
  });
});
