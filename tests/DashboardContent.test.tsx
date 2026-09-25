// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import DashboardContent from "@/components/dashboard/DashboardContent";
import type { EventRecord } from "@/lib/api/types";
import { fakeAuthValue, FakeAuthProvider } from "./test-utils/fakeAuth";

const listMyEvents = vi.fn();
vi.mock("@/lib/api/events", () => ({
  listMyEvents: (...args: unknown[]) => listMyEvents(...args),
}));

vi.mock("@/lib/auth/useOrganiser", () => ({
  useOrganiser: () => ({
    loading: false,
    organiser: { organiserId: "org-1", status: "approved" },
    error: null,
    refetch: vi.fn(),
  }),
}));

afterEach(cleanup);
beforeEach(() => {
  listMyEvents.mockReset();
});

function makeRecord(id: string, overrides: Partial<EventRecord> = {}): EventRecord {
  return {
    organiserId: "org-1",
    eventId: id,
    slug: id,
    title: `Event ${id}`,
    description: "d",
    category: "live-music",
    venueName: "v",
    venueAddress: "a",
    suburb: "s",
    startsAt: "2026-12-01T09:00:00.000Z",
    endsAt: "2026-12-01T12:00:00.000Z",
    organiserName: "Org",
    ticketTypes: [],
    status: "draft",
    moderationLog: [],
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function renderDashboard() {
  render(
    <FakeAuthProvider value={fakeAuthValue()}>
      <DashboardContent />
    </FakeAuthProvider>,
  );
}

describe("DashboardContent — pagination over the organiser's own events", () => {
  it("loads more than one page via 'Load more'", async () => {
    listMyEvents
      .mockResolvedValueOnce({ items: [makeRecord("a"), makeRecord("b")], nextCursor: "cursor-1" })
      .mockResolvedValueOnce({ items: [makeRecord("c")], nextCursor: undefined });

    renderDashboard();

    await waitFor(() => expect(screen.getByText("Event a")).toBeInTheDocument());
    expect(screen.queryByText("Event c")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Load more" }));

    await waitFor(() => expect(screen.getByText("Event c")).toBeInTheDocument());
    expect(screen.getByText("Event a")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Load more" })).not.toBeInTheDocument();
    expect(listMyEvents).toHaveBeenCalledTimes(2);
    expect(listMyEvents.mock.calls[1][1]).toBe("cursor-1");
  });

  it("skips past an empty page that still carries a cursor to reach a later page with results", async () => {
    listMyEvents
      .mockResolvedValueOnce({ items: [], nextCursor: "cursor-1" })
      .mockResolvedValueOnce({ items: [makeRecord("later")], nextCursor: undefined });

    renderDashboard();

    await waitFor(() => expect(screen.getByText("Event later")).toBeInTheDocument());
    expect(screen.queryByText(/haven.t created any events/i)).not.toBeInTheDocument();
  });

  it("de-duplicates an event that appears again across adjacent pages", async () => {
    listMyEvents
      .mockResolvedValueOnce({ items: [makeRecord("a"), makeRecord("b")], nextCursor: "cursor-1" })
      .mockResolvedValueOnce({ items: [makeRecord("b"), makeRecord("c")], nextCursor: undefined });

    renderDashboard();
    await waitFor(() => expect(screen.getByText("Event a")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "Load more" }));
    await waitFor(() => expect(screen.getByText("Event c")).toBeInTheDocument());

    expect(screen.getAllByText("Event b")).toHaveLength(1);
  });
});
