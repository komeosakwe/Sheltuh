// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ReleaseTicketsPanel, { releasableTicketTypes } from "@/components/dashboard/ReleaseTicketsPanel";
import { ApiError } from "@/lib/api/client";
import type { EventRecord } from "@/lib/api/types";

const releaseTickets = vi.fn();
vi.mock("@/lib/api/events", () => ({
  releaseTickets: (...args: unknown[]) => releaseTickets(...args),
}));

afterEach(cleanup);
beforeEach(() => releaseTickets.mockReset());

const getToken = async () => "token";

function event(overrides: Partial<EventRecord> = {}): EventRecord {
  return {
    organiserId: "org-1",
    eventId: "evt-1",
    slug: "evt-1",
    title: "Neon Static",
    description: "d",
    category: "live-music",
    venueName: "v",
    venueAddress: "a",
    suburb: "s",
    startsAt: "2999-12-01T09:00:00.000Z",
    endsAt: "2999-12-01T12:00:00.000Z",
    organiserName: "Org",
    ticketTypes: [
      { id: "ga", name: "General admission", priceCents: 3000, feePolicy: "buyer-pays", quantityAvailable: 50 },
      { id: "vip", name: "VIP seats", priceCents: 9000, feePolicy: "buyer-pays", quantityAvailable: 20, seated: true },
    ],
    ticketsSold: { ga: 12, vip: 3 },
    status: "published",
    moderationLog: [],
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  } as EventRecord;
}

describe("releasableTicketTypes", () => {
  it("only general admission tiers of a published, upcoming, Sheltüh-ticketed event", () => {
    expect(releasableTicketTypes(event()).map((t) => t.id)).toEqual(["ga"]);
    expect(releasableTicketTypes(event({ status: "draft" }))).toEqual([]);
    expect(releasableTicketTypes(event({ status: "pending_review" }))).toEqual([]);
    expect(releasableTicketTypes(event({ ticketingMode: "external" }))).toEqual([]);
    expect(releasableTicketTypes(event({ endsAt: "2020-01-01T00:00:00.000Z" }))).toEqual([]);
  });
});

describe("ReleaseTicketsPanel", () => {
  it("lists sold / total for each general admission tier, not the seated one", () => {
    render(<ReleaseTicketsPanel event={event()} getToken={getToken} />);
    expect(screen.getByRole("heading", { name: "Release more tickets" })).toBeInTheDocument();
    expect(screen.getByText("General admission")).toBeInTheDocument();
    expect(screen.getByText("12 sold / 50")).toBeInTheDocument();
    expect(screen.queryByText("VIP seats")).not.toBeInTheDocument();
  });

  it("renders nothing when nothing can be released", () => {
    const { container } = render(<ReleaseTicketsPanel event={event({ status: "draft" })} getToken={getToken} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("a number that isn't above the current total shows an inline error and calls nothing", () => {
    render(<ReleaseTicketsPanel event={event()} getToken={getToken} />);
    const input = screen.getByLabelText("New total");
    expect(input).toHaveAttribute("min", "51");
    fireEvent.change(input, { target: { value: "50" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Enter more than 50.");
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(releaseTickets).not.toHaveBeenCalled();
  });

  it("saves, then shows the new total and a success message", async () => {
    releaseTickets.mockResolvedValue({ eventId: "evt-1", ticketTypeId: "ga", quantityAvailable: 80, quantitySold: 13 });
    render(<ReleaseTicketsPanel event={event()} getToken={getToken} />);
    fireEvent.change(screen.getByLabelText("New total"), { target: { value: "80" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Released. Now 80 on sale."));
    expect(releaseTickets).toHaveBeenCalledWith("evt-1", "ga", 80, getToken);
    expect(screen.getByText("13 sold / 80")).toBeInTheDocument();
    expect(screen.getByLabelText("New total")).toHaveValue(null);
    expect(screen.getByLabelText("New total")).toHaveAttribute("min", "81");
  });

  it("shows the server's field error, or its message", async () => {
    releaseTickets.mockRejectedValueOnce(
      new ApiError(400, "Please fix the highlighted fields.", { quantityAvailable: "Enter more than the current 55." }),
    );
    render(<ReleaseTicketsPanel event={event()} getToken={getToken} />);
    fireEvent.change(screen.getByLabelText("New total"), { target: { value: "60" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Enter more than the current 55."));

    releaseTickets.mockRejectedValueOnce(new ApiError(429, "Too many releases this hour. Try again later."));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Too many releases this hour. Try again later."));
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });
});
