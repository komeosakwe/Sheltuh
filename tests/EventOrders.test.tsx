// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import EventOrders from "@/components/dashboard/EventOrders";
import { ApiError } from "@/lib/api/client";
import type { EventOrderRow, EventOrdersPage } from "@/lib/api/types";
import { fakeAuthValue, FakeAuthProvider } from "./test-utils/fakeAuth";

vi.mock("@/lib/auth/useOrganiser", () => ({
  useOrganiser: () => ({ loading: false, organiser: { organiserId: "org-1", status: "approved" }, error: null, refetch: vi.fn() }),
}));
const api = { getEventOrders: vi.fn(), downloadEventOrdersCsv: vi.fn() };
vi.mock("@/lib/api/event-orders", () => ({
  getEventOrders: (...a: unknown[]) => api.getEventOrders(...a),
  downloadEventOrdersCsv: (...a: unknown[]) => api.downloadEventOrdersCsv(...a),
}));
const saveBlob = vi.fn();
vi.mock("@/components/analytics/ExportCsvButton", () => ({ saveBlob: (...a: unknown[]) => saveBlob(...a) }));

const NOTE = "Use these details only for this event. Don't add them to a mailing list.";

function order(n: number, extra: Partial<EventOrderRow> = {}): EventOrderRow {
  return {
    reference: `REF${n}`,
    placedAt: "2026-11-04T09:05:00.000Z",
    status: "paid",
    buyerName: `Buyer ${n}`,
    buyerEmail: `buyer${n}@example.com`,
    tickets: [{ ticketTypeName: "General", quantity: 2 }],
    paidCents: 6460,
    refundedCents: 0,
    ...extra,
  };
}

function pageOf(items: EventOrderRow[], extra: Partial<EventOrdersPage> = {}): EventOrdersPage {
  return {
    event: { title: "Night Market", slug: "night-market", timeZone: "Australia/Melbourne", endsAt: "2027-03-06T12:30:00.000Z" },
    detailsVisibleUntil: "2028-03-06T12:30:00.000Z",
    items,
    total: items.length,
    ...extra,
  };
}

beforeEach(() => {
  for (const fn of Object.values(api)) fn.mockReset();
  saveBlob.mockReset();
});
afterEach(cleanup);

function renderOrders() {
  return render(
    <FakeAuthProvider value={fakeAuthValue()}>
      <EventOrders eventId="evt-1" />
    </FakeAuthProvider>,
  );
}

describe("EventOrders", () => {
  it("lists orders as a table (with a caption) and as cards, with the details or a dash", async () => {
    api.getEventOrders.mockResolvedValue(
      pageOf([
        order(1),
        order(2, { buyerName: null, buyerEmail: null, paidCents: 0, tickets: [{ ticketTypeName: "Free", quantity: 1 }] }),
        order(3, { status: "refunded", refundedCents: 6460 }),
        order(4, { status: "refunded", refundedCents: 1500 }),
      ]),
    );
    renderOrders();
    const table = await screen.findByRole("table", { name: "Orders for Night Market" });
    expect(within(table).getAllByRole("columnheader").map((h) => h.textContent)).toEqual([
      "Name",
      "Email",
      "Tickets",
      "Paid",
      "Placed",
      "Status",
    ]);
    const rows = within(table).getAllByRole("row").slice(1);
    expect(rows).toHaveLength(4);
    expect(within(rows[0]).getByText("Buyer 1")).toBeInTheDocument();
    expect(within(rows[0]).getByText("buyer1@example.com")).toBeInTheDocument();
    expect(within(rows[0]).getByText("2 × General")).toBeInTheDocument();
    expect(within(rows[0]).getByText("A$64.60")).toBeInTheDocument();
    expect(within(rows[0]).getByText("Wed 4 Nov, 8:05 pm")).toBeInTheDocument();
    expect(within(rows[0]).getByText("Paid")).toBeInTheDocument();
    expect(within(rows[1]).getAllByText("—")).toHaveLength(2);
    expect(within(rows[1]).getByText("Free")).toBeInTheDocument();
    expect(within(rows[2]).getByText("Refunded")).toBeInTheDocument();
    expect(within(rows[3]).getByText("Part refunded A$15")).toBeInTheDocument();
    // Phones get the same rows as cards (CSS shows one of the two).
    const cards = screen.getByRole("list", { name: "Orders for Night Market" });
    expect(cards).toHaveClass("lg:hidden");
    expect(within(cards).getAllByRole("listitem")).toHaveLength(4);
    expect(table.parentElement).toHaveClass("hidden", "lg:block");
    expect(screen.getByRole("status")).toHaveTextContent("4 orders.");
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Orders");
    expect(screen.getByText("Night Market")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Edit event/ })).toHaveAttribute("href", "/dashboard/evt-1");
    // Within the 12 months: no removal footer.
    expect(screen.queryByText(/Buyer details are removed/)).toBeNull();
  });

  it("says details are removed once past the 12 months", async () => {
    api.getEventOrders.mockResolvedValue(pageOf([order(1, { buyerName: null, buyerEmail: null })], { detailsVisibleUntil: "2020-01-01T00:00:00.000Z" }));
    renderOrders();
    expect(await screen.findByText("Buyer details are removed 12 months after the event.")).toBeInTheDocument();
  });

  it("says No orders yet. with nothing to export", async () => {
    api.getEventOrders.mockResolvedValue(pageOf([]));
    renderOrders();
    expect(await screen.findByText("No orders yet.")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("No orders yet.");
    expect(screen.queryByRole("table")).toBeNull();
    expect(screen.queryByRole("button", { name: "Export CSV" })).toBeNull();
  });

  it("searches 300 ms after the last keystroke, with a labelled search field, and says the count", async () => {
    api.getEventOrders.mockImplementation(async (_id: string, _t: unknown, q: { q?: string }) =>
      q.q ? pageOf([order(7)], { total: 1 }) : pageOf([order(1), order(2)]),
    );
    renderOrders();
    await screen.findByRole("table");
    const search = screen.getByLabelText("Search orders");
    expect(search).toHaveAttribute("type", "search");
    expect(search).toHaveClass("min-h-12", "text-base");
    expect(api.getEventOrders).toHaveBeenCalledTimes(1);
    fireEvent.change(search, { target: { value: "an" } });
    fireEvent.change(search, { target: { value: " anna " } });
    expect(api.getEventOrders).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(api.getEventOrders).toHaveBeenCalledTimes(2));
    expect(api.getEventOrders.mock.calls[1][2]).toEqual({ q: "anna", limit: 20 });
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("1 order matches “anna”."));
    expect(within(screen.getByRole("table")).getByText("Buyer 7")).toBeInTheDocument();
  });

  it("says when nothing matches the search", async () => {
    api.getEventOrders.mockImplementation(async (_id: string, _t: unknown, q: { q?: string }) =>
      q.q ? pageOf([], { total: 0 }) : pageOf([order(1)]),
    );
    renderOrders();
    await screen.findByRole("table");
    fireEvent.change(screen.getByLabelText("Search orders"), { target: { value: "zzz" } });
    expect(await screen.findByText("No orders match “zzz”.")).toBeInTheDocument();
    expect(screen.queryByRole("table")).toBeNull();
    // Still exportable: the file is every order, not the search.
    expect(screen.getByRole("button", { name: "Export CSV" })).toBeInTheDocument();
  });

  it("shows more with the cursor, appends, and drops the button on the last page", async () => {
    api.getEventOrders
      .mockResolvedValueOnce(pageOf([order(1), order(2)], { nextCursor: "c2", total: 3 }))
      .mockResolvedValueOnce(pageOf([order(3)], { total: 3 }));
    renderOrders();
    await screen.findByRole("table");
    fireEvent.click(screen.getByRole("button", { name: "Show more" }));
    await waitFor(() => expect(within(screen.getByRole("table")).getAllByRole("row")).toHaveLength(4));
    expect(api.getEventOrders.mock.calls[1][2]).toEqual({ q: "", cursor: "c2", limit: 20 });
    expect(screen.queryByRole("button", { name: "Show more" })).toBeNull();
  });

  it("says a failed Show more, and keeps the rows", async () => {
    api.getEventOrders
      .mockResolvedValueOnce(pageOf([order(1)], { nextCursor: "c2", total: 2 }))
      .mockRejectedValueOnce(new ApiError(500, "Boom"));
    renderOrders();
    await screen.findByRole("table");
    fireEvent.click(screen.getByRole("button", { name: "Show more" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Couldn’t load orders.");
    expect(within(screen.getByRole("table")).getAllByRole("row")).toHaveLength(2);
    expect(screen.getByRole("button", { name: "Show more" })).toBeInTheDocument();
  });

  it("exports every order, with the use note beside the button, and saves the file", async () => {
    api.getEventOrders.mockResolvedValue(pageOf([order(1)]));
    api.downloadEventOrdersCsv.mockResolvedValue(new Blob(["x"]));
    renderOrders();
    await screen.findByRole("table");
    expect(screen.getByText(NOTE)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Export CSV" }));
    await waitFor(() => expect(saveBlob).toHaveBeenCalledTimes(1));
    expect(api.downloadEventOrdersCsv).toHaveBeenCalledWith("evt-1", expect.any(Function));
    expect(saveBlob.mock.calls[0][1]).toBe("sheltuh-night-market-orders.csv");
  });

  it.each([
    [429, "Too many exports. Try again in an hour."],
    [409, "Too many orders to export."],
    [500, "Couldn’t prepare the file. Try again."],
  ])("says a %s export refusal", async (status, text) => {
    api.getEventOrders.mockResolvedValue(pageOf([order(1)]));
    api.downloadEventOrdersCsv.mockRejectedValue(new ApiError(status, "Too many orders to export."));
    renderOrders();
    await screen.findByRole("table");
    fireEvent.click(screen.getByRole("button", { name: "Export CSV" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(text);
    expect(saveBlob).not.toHaveBeenCalled();
  });

  it("says a rate-limited list in words, and tries again", async () => {
    api.getEventOrders.mockRejectedValueOnce(new ApiError(429, "Slow down.", undefined, { code: "rate_limited" }));
    api.getEventOrders.mockResolvedValueOnce(pageOf([order(1)]));
    renderOrders();
    expect(await screen.findByRole("alert")).toHaveTextContent("Too many searches. Wait a few minutes, then try again.");
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByRole("table")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("says Couldn’t load orders. for any other failure", async () => {
    api.getEventOrders.mockRejectedValue(new ApiError(500, "Boom"));
    renderOrders();
    expect(await screen.findByRole("alert")).toHaveTextContent("Couldn’t load orders.");
  });

  it("says Event not found for another organiser's event", async () => {
    api.getEventOrders.mockRejectedValue(new ApiError(404, "Not found."));
    renderOrders();
    expect(await screen.findByRole("heading", { level: 1, name: "Event not found" })).toBeInTheDocument();
  });

  it("shows the loading state before the first answer", () => {
    api.getEventOrders.mockReturnValue(new Promise(() => {}));
    renderOrders();
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Orders");
    expect(document.querySelector('[aria-busy="true"]')).not.toBeNull();
    expect(screen.queryByRole("table")).toBeNull();
  });
});
