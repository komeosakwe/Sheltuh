// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import TicketLockPanel, { lockableTicketTypes } from "@/components/dashboard/TicketLockPanel";
import { ApiError } from "@/lib/api/client";
import type { EventRecord } from "@/lib/api/types";

const setTicketLock = vi.fn();
vi.mock("@/lib/api/events", () => ({
  setTicketLock: (...args: unknown[]) => setTicketLock(...args),
}));

afterEach(cleanup);
beforeEach(() => setTicketLock.mockReset());

const getToken = async () => "token";

function event(overrides: Partial<EventRecord> = {}): EventRecord {
  return {
    organiserId: "org-1",
    eventId: "evt-1",
    slug: "evt-1",
    title: "Cinder",
    description: "d",
    category: "live-music",
    venueName: "v",
    venueAddress: "a",
    suburb: "s",
    startsAt: "2999-12-01T09:00:00.000Z",
    endsAt: "2999-12-01T12:00:00.000Z",
    organiserName: "Org",
    ticketTypes: [
      { id: "t1", name: "First release", priceCents: 2800, feePolicy: "buyer-pays", quantityAvailable: 50 },
      {
        id: "t2",
        name: "Second release",
        priceCents: 3500,
        feePolicy: "buyer-pays",
        quantityAvailable: 50,
        opensAfterPrevious: true,
        opensAfter: { ticketTypeId: "t1", name: "First release" },
      },
      { id: "t3", name: "Final release", priceCents: 4200, feePolicy: "buyer-pays", quantityAvailable: 50 },
      { id: "t4", name: "Front row", priceCents: 9000, feePolicy: "buyer-pays", quantityAvailable: 20, seated: true },
    ],
    ticketsSold: { t1: 12 },
    status: "published",
    moderationLog: [],
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  } as EventRecord;
}

function row(name: string): HTMLElement {
  const item = screen.getByText(name).closest("li");
  if (!item) throw new Error(`No row for ${name}`);
  return item;
}

describe("lockableTicketTypes", () => {
  it("general admission tiers after the first, of a published, upcoming, Sheltüh-ticketed event", () => {
    expect(lockableTicketTypes(event()).map((r) => [r.ticket.id, r.above.id])).toEqual([
      ["t2", "t1"],
      ["t3", "t2"],
    ]);
    expect(lockableTicketTypes(event({ status: "draft" }))).toEqual([]);
    expect(lockableTicketTypes(event({ status: "pending_review" }))).toEqual([]);
    expect(lockableTicketTypes(event({ ticketingMode: "external" }))).toEqual([]);
    expect(lockableTicketTypes(event({ endsAt: "2020-01-01T00:00:00.000Z" }))).toEqual([]);
  });
});

describe("TicketLockPanel", () => {
  it("one row per general admission tier from the second: status, and a labelled checkbox", () => {
    render(<TicketLockPanel event={event()} getToken={getToken} />);
    expect(screen.getByRole("heading", { name: "Release order" })).toBeInTheDocument();
    expect(screen.queryByText("First release", { selector: "p" })).not.toBeInTheDocument();
    expect(screen.queryByText("Front row")).not.toBeInTheDocument();
    expect(within(row("Second release")).getByText("Waiting")).toBeInTheDocument();
    expect(within(row("Second release")).getByLabelText("Opens when First release sells out")).toBeChecked();
    expect(within(row("Final release")).getByText("On sale")).toBeInTheDocument();
    expect(within(row("Final release")).getByLabelText("Opens when Second release sells out")).not.toBeChecked();
  });

  it("renders nothing when nothing can be changed", () => {
    const { container } = render(<TicketLockPanel event={event({ status: "draft" })} getToken={getToken} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("saves a tick, then shows the new status and a saved message", async () => {
    setTicketLock.mockResolvedValue({
      eventId: "evt-1",
      ticketTypeId: "t3",
      opensAfterPrevious: true,
      opensAfter: { ticketTypeId: "t2", name: "Second release" },
    });
    render(<TicketLockPanel event={event()} getToken={getToken} />);
    const final = row("Final release");
    fireEvent.click(within(final).getByLabelText("Opens when Second release sells out"));
    fireEvent.click(within(final).getByRole("button", { name: "Save Final release" }));
    await waitFor(() => expect(within(final).getByRole("status")).toHaveTextContent("Saved."));
    expect(setTicketLock).toHaveBeenCalledWith("evt-1", "t3", true, getToken);
    expect(within(final).getByText("Waiting")).toBeInTheDocument();
    expect(within(final).getByLabelText("Opens when Second release sells out")).toBeChecked();
  });

  it("unticking saves false, and the tier is on sale", async () => {
    setTicketLock.mockResolvedValue({ eventId: "evt-1", ticketTypeId: "t2", opensAfterPrevious: false });
    render(<TicketLockPanel event={event()} getToken={getToken} />);
    const second = row("Second release");
    fireEvent.click(within(second).getByLabelText("Opens when First release sells out"));
    fireEvent.click(within(second).getByRole("button", { name: "Save Second release" }));
    await waitFor(() => expect(within(second).getByText("On sale")).toBeInTheDocument());
    expect(setTicketLock).toHaveBeenCalledWith("evt-1", "t2", false, getToken);
  });

  it("an unchanged box saves nothing", () => {
    render(<TicketLockPanel event={event()} getToken={getToken} />);
    const save = within(row("Second release")).getByRole("button", { name: "Save Second release" });
    expect(save).toHaveAttribute("aria-disabled", "true");
    fireEvent.click(save);
    expect(setTicketLock).not.toHaveBeenCalled();
  });

  it("announces the server's field error, or its message, and keeps the tick", async () => {
    setTicketLock.mockRejectedValueOnce(
      new ApiError(400, "Please fix the highlighted fields.", { opensAfterPrevious: "The first ticket can't wait." }),
    );
    render(<TicketLockPanel event={event()} getToken={getToken} />);
    const final = row("Final release");
    const box = within(final).getByLabelText("Opens when Second release sells out");
    fireEvent.click(box);
    fireEvent.click(within(final).getByRole("button", { name: "Save Final release" }));
    await waitFor(() => expect(within(final).getByRole("alert")).toHaveTextContent("The first ticket can't wait."));
    expect(box).toHaveAttribute("aria-invalid", "true");
    expect(box).toBeChecked();

    setTicketLock.mockRejectedValueOnce(new ApiError(429, "Too many changes. Try again later."));
    fireEvent.click(within(final).getByRole("button", { name: "Save Final release" }));
    await waitFor(() => expect(within(final).getByRole("alert")).toHaveTextContent("Too many changes. Try again later."));
    expect(within(final).queryByRole("status")).not.toBeInTheDocument();
    expect(within(final).getByText("On sale")).toBeInTheDocument();
  });
});
