import { beforeEach, describe, expect, it, vi } from "vitest";
import { adminClaims, callHandler, fakeEvent, organiserClaims } from "../helpers/fake-event";

const sendMock = vi.fn();

vi.mock("../../lambda/shared/db", () => ({
  ddb: { send: (...args: unknown[]) => sendMock(...args) },
  TABLES: { organisers: "test-organisers", events: "test-events", eventSlugs: "test-event-slugs" },
  INDEXES: { organisersByStatus: "status-index", eventsByStatus: "status-startsAt-index" },
}));

const MY_ORGANISER = {
  ownerUserId: "caller-user",
  organiserId: "org-mine",
  displayName: "My Org",
  contactEmail: "me@example.com",
  description: "d",
  categories: ["live-music"],
  status: "approved",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

const OTHERS_EVENT_INPUT = {
  title: "Not yours",
  description: "d",
  category: "live-music",
  venueName: "v",
  venueAddress: "a",
  suburb: "s",
  start: { date: "2026-12-01", time: "20:00" },
  end: { date: "2026-12-01", time: "23:00" },
  ticketTypes: [{ name: "GA", priceCents: 1000, feePolicy: "buyer-pays", quantityAvailable: 10 }],
};

beforeEach(() => {
  sendMock.mockReset();
});

describe("updateDraft — cross-organiser tampering", () => {
  it("rejects with 403 when the path organiserId isn't the caller's own, and never touches the events table", async () => {
    sendMock.mockImplementation((command) => {
      // The only DB call that should happen is the organiser-guard's GetItem
      // on the organisers table — the events table must never be touched.
      if (command.input.TableName === "test-organisers") {
        return Promise.resolve({ Item: MY_ORGANISER });
      }
      throw new Error(`Unexpected DB call: ${JSON.stringify(command.input)}`);
    });

    const { handler } = await import("../../lambda/events/updateDraft");
    const result = await callHandler(handler, 
      fakeEvent({
        claims: organiserClaims("caller-user"),
        pathParameters: { organiserId: "org-someone-elses", eventId: "evt-1" },
        body: OTHERS_EVENT_INPUT,
      }),
    );

    expect(result.statusCode).toBe(403);
    // Only the organiser lookup happened — no UpdateCommand against the events table.
    expect(sendMock).toHaveBeenCalledTimes(1);
    expect(sendMock.mock.calls[0][0].input.TableName).toBe("test-organisers");
  });

  it("allows the update when the path organiserId matches the caller's own organisation", async () => {
    sendMock.mockImplementation((command) => {
      if (command.input.TableName === "test-organisers") {
        return Promise.resolve({ Item: MY_ORGANISER });
      }
      if (command.input.TableName === "test-events") {
        return Promise.resolve({ Attributes: { ...OTHERS_EVENT_INPUT, organiserId: "org-mine", eventId: "evt-1" } });
      }
      throw new Error(`Unexpected DB call: ${JSON.stringify(command.input)}`);
    });

    const { handler } = await import("../../lambda/events/updateDraft");
    const result = await callHandler(handler, 
      fakeEvent({
        claims: organiserClaims("caller-user"),
        pathParameters: { organiserId: "org-mine", eventId: "evt-1" },
        body: OTHERS_EVENT_INPUT,
      }),
    );

    expect(result.statusCode).toBe(200);
    expect(sendMock).toHaveBeenCalledTimes(2);
  });
});

describe("submit — cross-organiser tampering", () => {
  it("rejects submitting another organisation's event for review", async () => {
    sendMock.mockImplementation((command) => {
      if (command.input.TableName === "test-organisers") {
        return Promise.resolve({ Item: MY_ORGANISER });
      }
      throw new Error(`Unexpected DB call: ${JSON.stringify(command.input)}`);
    });

    const { handler } = await import("../../lambda/events/submit");
    const result = await callHandler(handler, 
      fakeEvent({
        claims: organiserClaims("caller-user"),
        pathParameters: { organiserId: "org-someone-elses", eventId: "evt-1" },
      }),
    );

    expect(result.statusCode).toBe(403);
    expect(sendMock).toHaveBeenCalledTimes(1);
  });
});

describe("getMineOne — structurally scoped to the caller's own organisation", () => {
  it("always reads with the caller's own organiserId, ignoring anything else in the request", async () => {
    sendMock.mockImplementation((command) => {
      if (command.input.TableName === "test-organisers") {
        return Promise.resolve({ Item: MY_ORGANISER });
      }
      if (command.input.TableName === "test-events") {
        // Assert the Key used organiserId "org-mine" — never anything else.
        expect(command.input.Key).toEqual({ organiserId: "org-mine", eventId: "evt-1" });
        return Promise.resolve({ Item: { organiserId: "org-mine", eventId: "evt-1", status: "draft" } });
      }
      throw new Error(`Unexpected DB call: ${JSON.stringify(command.input)}`);
    });

    const { handler } = await import("../../lambda/events/getMineOne");
    const result = await callHandler(handler, 
      fakeEvent({ claims: organiserClaims("caller-user"), pathParameters: { eventId: "evt-1" } }),
    );

    expect(result.statusCode).toBe(200);
  });
});

describe("admin approval requires the admins group, even for a signed-in organiser", () => {
  it("rejects a non-admin organiser's attempt to approve an application with 403, before any DB call", async () => {
    const { handler } = await import("../../lambda/admin/organisers/approve");
    const result = await callHandler(handler, 
      fakeEvent({ claims: organiserClaims("caller-user"), pathParameters: { ownerUserId: "some-applicant" } }),
    );

    expect(result.statusCode).toBe(403);
    expect(sendMock).not.toHaveBeenCalled();
  });

  it("allows an admin to approve", async () => {
    sendMock.mockResolvedValue({ Attributes: { ownerUserId: "some-applicant", status: "approved" } });

    const { handler } = await import("../../lambda/admin/organisers/approve");
    const result = await callHandler(handler, 
      fakeEvent({ claims: adminClaims("admin-1"), pathParameters: { ownerUserId: "some-applicant" } }),
    );

    expect(result.statusCode).toBe(200);
  });
});
