// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import LiveEventFeed from "@/components/LiveEventFeed";
import type { PublicEvent } from "@/lib/api/public-events";
import { EVENT_CATEGORIES } from "@/lib/types";

const listPublicEvents = vi.fn();
vi.mock("@/lib/api/public-events", () => ({
  listPublicEvents: (...args: unknown[]) => listPublicEvents(...args),
}));

afterEach(cleanup);
beforeEach(() => {
  listPublicEvents.mockReset();
});

function makeEvent(id: string, overrides: Partial<PublicEvent> = {}): PublicEvent {
  return {
    organiserId: `org-${id}`,
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
    ticketTypes: [{ id: "t1", name: "GA", priceCents: 1000, feePolicy: "buyer-pays", quantityAvailable: 10 }],
    ...overrides,
  };
}

describe("LiveEventFeed — pagination against the public API", () => {
  it("loads more than one page via 'Load more' and shows every item across pages", async () => {
    listPublicEvents
      .mockResolvedValueOnce({ items: [makeEvent("a"), makeEvent("b")], nextCursor: "cursor-1" })
      .mockResolvedValueOnce({ items: [makeEvent("c")], nextCursor: undefined });

    render(<LiveEventFeed categories={EVENT_CATEGORIES} />);

    await waitFor(() => expect(screen.getByText("Event a")).toBeInTheDocument());
    expect(screen.getByText("Event b")).toBeInTheDocument();
    expect(screen.queryByText("Event c")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Load more" }));

    await waitFor(() => expect(screen.getByText("Event c")).toBeInTheDocument());
    // First page's items are still there — load more appends, it doesn't replace.
    expect(screen.getByText("Event a")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Load more" })).not.toBeInTheDocument();
    expect(listPublicEvents).toHaveBeenCalledTimes(2);
    expect(listPublicEvents.mock.calls[1][0]).toMatchObject({ cursor: "cursor-1" });
  });

  it("skips past an empty filtered page that still carries a cursor, to reach a later page with matches", async () => {
    listPublicEvents
      // First page under this filter has no matches, but isn't the end of the result set.
      .mockResolvedValueOnce({ items: [], nextCursor: "cursor-1" })
      .mockResolvedValueOnce({ items: [makeEvent("late-match")], nextCursor: undefined });

    render(<LiveEventFeed categories={EVENT_CATEGORIES} />);

    await waitFor(() => expect(screen.getByText("Event late-match")).toBeInTheDocument());
    expect(screen.queryByText(/no events match/i)).not.toBeInTheDocument();
    expect(listPublicEvents).toHaveBeenCalledTimes(2);
  });

  it("discards a stale response from a superseded filter change", async () => {
    let resolveFirst!: (value: { items: PublicEvent[]; nextCursor?: string }) => void;
    const firstRequest = new Promise<{ items: PublicEvent[]; nextCursor?: string }>((resolve) => {
      resolveFirst = resolve;
    });
    listPublicEvents
      .mockImplementationOnce(() => firstRequest)
      .mockResolvedValueOnce({ items: [makeEvent("second-filter-result")], nextCursor: undefined });

    render(<LiveEventFeed categories={EVENT_CATEGORIES} />);

    // Change the filter before the first (slow) request resolves.
    await waitFor(() => expect(listPublicEvents).toHaveBeenCalledTimes(1));
    fireEvent.change(screen.getByLabelText("On or after"), { target: { value: "2026-01-01" } });
    await waitFor(() => expect(listPublicEvents).toHaveBeenCalledTimes(2));

    // Now let the first (superseded) request resolve late.
    resolveFirst({ items: [makeEvent("stale-result")], nextCursor: undefined });

    await waitFor(() => expect(screen.getByText("Event second-filter-result")).toBeInTheDocument());
    expect(screen.queryByText("Event stale-result")).not.toBeInTheDocument();
  });

  it("de-duplicates an item that appears again across adjacent pages", async () => {
    listPublicEvents
      .mockResolvedValueOnce({ items: [makeEvent("a"), makeEvent("b")], nextCursor: "cursor-1" })
      .mockResolvedValueOnce({ items: [makeEvent("b"), makeEvent("c")], nextCursor: undefined });

    render(<LiveEventFeed categories={EVENT_CATEGORIES} />);
    await waitFor(() => expect(screen.getByText("Event a")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "Load more" }));
    await waitFor(() => expect(screen.getByText("Event c")).toBeInTheDocument());

    expect(screen.getAllByText("Event b")).toHaveLength(1);
  });

  it("never claims the loaded count is the total database count", async () => {
    listPublicEvents.mockResolvedValueOnce({ items: [makeEvent("a")], nextCursor: "cursor-1" });
    render(<LiveEventFeed categories={EVENT_CATEGORIES} />);
    await waitFor(() => expect(screen.getByText("Event a")).toBeInTheDocument());
    expect(screen.queryByText(/of \d+ events/i)).not.toBeInTheDocument();
  });
});
