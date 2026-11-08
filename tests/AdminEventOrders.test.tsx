// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import EventOrders from "@/components/dashboard/EventOrders";
import { ApiError } from "@/lib/api/client";
import type { EventOrders as EventOrdersData } from "@/lib/api/types";
import { fakeAuthValue, FakeAuthProvider } from "./test-utils/fakeAuth";

// The admin scope is not behind the organiser gate: no organiser lookup is made.
const useOrganiser = vi.fn();
vi.mock("@/lib/auth/useOrganiser", () => ({ useOrganiser: () => useOrganiser() }));
const api = { getEventOrders: vi.fn(), downloadEventOrdersCsv: vi.fn() };
vi.mock("@/lib/api/event-orders", () => ({
  getEventOrders: (...a: unknown[]) => api.getEventOrders(...a),
  downloadEventOrdersCsv: (...a: unknown[]) => api.downloadEventOrdersCsv(...a),
}));

const PAGE: EventOrdersData = {
  event: { title: "Night Market", slug: "night-market", timeZone: "Australia/Melbourne", endsAt: "2027-03-06T12:30:00.000Z" },
  detailsVisibleUntil: "2028-03-06T12:30:00.000Z",
  items: [
    {
      reference: "REF1",
      placedAt: "2026-11-04T09:05:00.000Z",
      status: "paid",
      buyerName: "Buyer 1",
      buyerEmail: "buyer1@example.com",
      tickets: [{ ticketTypeName: "General", quantity: 2 }],
      paidCents: 6460,
      refundedCents: 0,
    },
  ],
  total: 1,
};

beforeEach(() => {
  api.getEventOrders.mockReset();
  useOrganiser.mockReset();
  useOrganiser.mockReturnValue({ loading: false, organiser: null, error: null, refetch: vi.fn() });
});
afterEach(cleanup);

function renderAdmin() {
  return render(
    <FakeAuthProvider value={fakeAuthValue({ email: "admin@sheltuh.example", isAdmin: true })}>
      <EventOrders eventId="evt-1" scope="admin" />
    </FakeAuthProvider>,
  );
}

describe("EventOrders — admin scope", () => {
  it("lists the orders without needing an organiser account, and links back to the admin edit page", async () => {
    api.getEventOrders.mockResolvedValue(PAGE);
    renderAdmin();
    expect(await screen.findByRole("table", { name: "Orders for Night Market" })).toBeInTheDocument();
    expect(screen.getAllByText("buyer1@example.com").length).toBeGreaterThan(0);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Orders");
    expect(screen.getByRole("link", { name: /Edit event/ })).toHaveAttribute("href", "/admin/events/evt-1/edit");
    expect(api.getEventOrders).toHaveBeenCalledWith("evt-1", expect.any(Function), expect.objectContaining({ q: "" }));
    expect(screen.queryByText(/organiser application/)).toBeNull();
  });

  it("says only the organiser can see the buyers on a 404, with a way back to the admin events", async () => {
    api.getEventOrders.mockRejectedValue(new ApiError(404, "Event not found."));
    renderAdmin();
    expect(await screen.findByRole("heading", { level: 1, name: "Orders not available" })).toBeInTheDocument();
    expect(screen.getByText("Only the event’s organiser can see its buyers.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Back to events" })).toHaveAttribute("href", "/admin/events");
    expect(screen.getByRole("link", { name: /Edit event/ })).toHaveAttribute("href", "/admin/events/evt-1/edit");
  });

  it("shows other failures with a retry, not the 404 message", async () => {
    api.getEventOrders.mockRejectedValue(new ApiError(500, "Boom."));
    renderAdmin();
    expect(await screen.findByRole("alert")).toHaveTextContent("Couldn’t load orders.");
    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
    expect(screen.queryByText(/Only the event/)).toBeNull();
  });
});
