// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import EventDetailsView from "@/components/EventDetailsView";
import CheckoutCancelled from "@/components/seating/CheckoutCancelled";
import SeatMapEditor from "@/components/seating/editor/SeatMapEditor";
import SeatedTicketsPanel from "@/components/seating/SeatedTicketsPanel";
import { seatMapAccess } from "@/components/seating/editor/SeatMapEditorPage";
import { ApiError } from "@/lib/api/client";
import { SAMPLE_SEAT_MAPS } from "@/lib/sample-seat-maps";
import { sampleEvents } from "@/lib/sample-events";
import type { SheltuhEvent } from "@/lib/types";

const { cancelPendingOrder, params } = vi.hoisted(() => ({ cancelPendingOrder: vi.fn(), params: { order: "ord_abc" as string | null } }));
vi.mock("@/lib/api/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api/client")>()),
  isApiConfigured: true,
}));
vi.mock("@/lib/api/seating", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api/seating")>()),
  cancelPendingOrder,
}));
vi.mock("next/navigation", () => ({
  usePathname: () => "/",
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(params.order ? { order: params.order } : {}),
}));
vi.mock("@/lib/api/going", () => ({ getGoingSummary: vi.fn(() => new Promise(() => {})) }));

const seated = sampleEvents.find((e) => e.id === "evt-off-kilter") as SheltuhEvent;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-21T00:00:00.000Z"));
  cancelPendingOrder.mockReset();
  params.order = "ord_abc";
  HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement) {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close = function close(this: HTMLDialogElement) {
    this.removeAttribute("open");
  };
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("event page for a seated event (docs/design/seating.md §5.1)", () => {
  it("shows the seated panel, not the ticket selector, and both CTAs go to the seat page", () => {
    const { container } = render(<EventDetailsView event={seated} demo />);
    const tickets = container.querySelector("#tickets") as HTMLElement;
    expect(within(tickets).queryByRole("button", { name: /Increase quantity/ })).toBeNull();
    expect(within(tickets).getByText("1 Choose seats")).toBeInTheDocument();
    expect(within(tickets).getByRole("link", { name: "Choose your seats" })).toHaveAttribute("href", "/events/off-kilter-a-new-play/seats");
    expect(within(tickets).getByText("A$36.90 incl. booking fee")).toBeInTheDocument();
    expect(within(tickets).getByText("Only 10 seats left")).toBeInTheDocument();
    expect(within(tickets).getByText("Few seats left in Concession.")).toBeInTheDocument();
    expect(within(tickets).getByText("Nothing is held until you press Checkout on the next page.")).toBeInTheDocument();
    const bar = container.querySelector("[data-buy-bar]") as HTMLElement;
    const cta = within(bar).getByRole("link", { name: "Choose seats" });
    expect(cta).toHaveAttribute("href", "/events/off-kilter-a-new-play/seats");
    expect(cta).toHaveClass("btn-signal");
  });

  it("sold out: no Choose your seats, the waitlist instead", () => {
    const soldOut: SheltuhEvent = {
      ...seated,
      soldOut: true,
      ticketTypes: seated.ticketTypes.map((t) => ({ ...t, soldOut: true, remaining: 0 })),
    };
    const { container } = render(<EventDetailsView event={soldOut} demo />);
    expect(screen.queryByRole("link", { name: "Choose your seats" })).toBeNull();
    expect(screen.getByRole("heading", { name: "Sold out. Join the waitlist." })).toBeInTheDocument();
    expect(within(container.querySelector("[data-buy-bar]") as HTMLElement).getByRole("link", { name: "Join waitlist" })).toHaveAttribute(
      "href",
      "#tickets",
    );
  });
});

describe("seated panel tier rows (V6: the standard ticket row)", () => {
  it("each tier: the name, the all-inclusive price under it, then the fee breakdown in quiet sentence case", () => {
    const { container } = render(<SeatedTicketsPanel event={seated} demo />);
    const rows = container.querySelectorAll("ul > li");
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      const lines = Array.from(row.querySelectorAll(":scope > div > p"));
      // Name, then the price (never in a separate right-hand column).
      expect(lines[1]).toHaveClass("text-base", "font-semibold", "tabular-nums");
      expect(lines[1]).toHaveTextContent(/A\$|Free/);
      // The breakdown (or the standing note) under it: 12px muted, not mono.
      expect(lines[2]).toHaveClass("text-xs", "text-muted");
      expect(lines[2]).not.toHaveClass("meta");
    }
    expect(within(container).getAllByText(/ ticket \+ A\$[\d.]+ booking fee$/).length).toBeGreaterThan(0);
  });
});

describe("seated panel once the event has ended (§5.1)", () => {
  it("no Choose your seats: says sales have ended", () => {
    vi.setSystemTime(new Date("2026-12-01T00:00:00.000Z"));
    render(<SeatedTicketsPanel event={seated} demo />);
    expect(screen.queryByRole("link", { name: "Choose your seats" })).toBeNull();
    expect(screen.queryByRole("list", { name: "How booking works" })).toBeNull();
    expect(screen.getByText("Ticket sales for this event have ended.")).toBeInTheDocument();
  });
});

describe("/checkout/cancelled (§5.12)", () => {
  it("releases the seats once and says so, focusing the h1, with the event named above it", async () => {
    cancelPendingOrder.mockResolvedValue({ status: "released", eventTitle: "Off-Kilter: A New Play", eventSlug: "off-kilter" });
    // Released here, so the seat page won't try again on Back.
    window.sessionStorage.setItem("sheltuh:pending-checkout", JSON.stringify({ orderId: "ord_abc", slug: "off-kilter", at: Date.now() }));
    render(<CheckoutCancelled />);
    expect(window.sessionStorage.getItem("sheltuh:pending-checkout")).toBeNull();
    // Loading has its heading too.
    expect(screen.getByRole("heading", { level: 1, name: "Checkout cancelled" })).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent(/Releasing your seats/);
    await waitFor(() => expect(screen.queryByRole("status")).toBeNull());
    const heading = screen.getByRole("heading", { level: 1, name: "Checkout cancelled" });
    await waitFor(() => expect(heading).toHaveFocus());
    expect(screen.getByText("Off-Kilter: A New Play")).toBeInTheDocument();
    expect(cancelPendingOrder).toHaveBeenCalledTimes(1);
    expect(cancelPendingOrder).toHaveBeenCalledWith("ord_abc");
    expect(screen.getByText("You weren’t charged, and your seats have been released for others.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Choose seats again" })).toHaveAttribute("href", "/events/off-kilter/seats");
    expect(screen.getByRole("link", { name: "Back to the event" })).toHaveAttribute("href", "/events/off-kilter");
  });

  it("already paid: links to the order", async () => {
    cancelPendingOrder.mockResolvedValue({ status: "paid", eventTitle: "Off-Kilter" });
    render(<CheckoutCancelled />);
    expect(await screen.findByRole("heading", { name: "This order is already paid" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "See your order" })).toHaveAttribute("href", "/checkout/success?session_id=ord_abc");
  });

  it("an error says the hold lapses on its own, and Try again calls again", async () => {
    cancelPendingOrder.mockRejectedValueOnce(new ApiError(409, "Still being set up."));
    cancelPendingOrder.mockResolvedValueOnce({ status: "released", eventTitle: "Off-Kilter" });
    render(<CheckoutCancelled />);
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "We couldn’t release your seats just now. They’ll be released automatically within 35 minutes. You weren’t charged.",
    );
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByText("You weren’t charged, and your seats have been released for others.")).toBeInTheDocument();
    expect(screen.getByText("Off-Kilter")).toBeInTheDocument();
    expect(cancelPendingOrder).toHaveBeenCalledTimes(2);
  });

  it("no order in the link: nothing is called", () => {
    params.order = null;
    render(<CheckoutCancelled />);
    expect(screen.getByRole("heading", { name: "Nothing to cancel" })).toBeInTheDocument();
    expect(cancelPendingOrder).not.toHaveBeenCalled();
  });
});

describe("organiser seat-map editor (§5.13)", () => {
  const event: SheltuhEvent = { ...seated, organiserId: "org-1", seating: undefined, ticketTypes: seated.ticketTypes.map((t) => ({ ...t, seated: undefined })) };

  it("adds a rectangular section and saves the validated map", async () => {
    const onSave = vi.fn(async (template) => ({ eventId: event.id, version: 4, seatCount: 20, template }));
    render(<SeatMapEditor event={event} initial={null} status="Draft" locked={false} onSave={onSave} />);
    expect(screen.getByText("The seat map editor needs a screen at least 1024px wide.")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Section name"), { target: { value: "Stalls" } });
    fireEvent.change(screen.getByLabelText("Rows"), { target: { value: "2" } });
    fireEvent.click(screen.getByRole("button", { name: "Add section" }));
    expect(screen.getByText("20 seats · 1 tier")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Select Stalls" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    expect(onSave.mock.calls[0][0].sections[0].rows).toHaveLength(2);
    expect(await screen.findByText("Seat map saved: 20 seats.")).toBeInTheDocument();
  });

  it("selected seats get the toolbar: block them, then undo", () => {
    render(
      <SeatMapEditor
        event={event}
        initial={{ eventId: event.id, version: 1, seatCount: 60, template: SAMPLE_SEAT_MAPS["evt-off-kilter"].template }}
        status="Draft"
        locked={false}
        onSave={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Select North" }));
    const toolbar = screen.getByRole("toolbar", { name: "Selected seats" });
    expect(within(toolbar).getByText("15 selected")).toBeInTheDocument();
    const blocked = within(toolbar).getByRole("button", { name: "Blocked" });
    expect(blocked).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(blocked);
    expect(within(screen.getByRole("toolbar")).getByRole("button", { name: "Blocked" })).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    expect(within(screen.getByRole("toolbar")).getByRole("button", { name: "Blocked" })).toHaveAttribute("aria-pressed", "false");
  });

  it("an approved event's map is locked: no Save or toolbar, Export and Preview stay", () => {
    const access = seatMapAccess({ status: "published", ticketingLocked: true });
    expect(access).toMatchObject({ status: "Approved · locked", locked: true });
    expect(seatMapAccess({ status: "draft", ticketingLocked: false }).locked).toBe(false);
    render(
      <SeatMapEditor
        event={event}
        initial={{ eventId: event.id, version: 1, seatCount: 60, template: SAMPLE_SEAT_MAPS["evt-off-kilter"].template }}
        status={access.status}
        locked
        lockedMessage={access.message}
        onSave={vi.fn()}
      />,
    );
    expect(screen.getByText(/This seat map is locked because the event is approved/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Save" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Add section" })).toBeNull();
    expect(screen.getByRole("button", { name: "Export" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Preview as buyer" }));
    expect(screen.getByRole("button", { name: "Checkout is off in preview" })).toBeDisabled();
  });
  const sampleRecord = { eventId: event.id, version: 1, seatCount: 60, template: SAMPLE_SEAT_MAPS["evt-off-kilter"].template };

  it("selects rows and single seats from the Sections list with the keyboard (2.1.1)", () => {
    render(<SeatMapEditor event={event} initial={sampleRecord} status="Draft" locked={false} onSave={vi.fn()} />);
    const disclosure = screen.getByRole("button", { name: "Rows and seats in North" });
    expect(disclosure).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(disclosure);
    expect(disclosure).toHaveAttribute("aria-expanded", "true");
    const rowA = screen.getByRole("checkbox", { name: "North, Row A" });
    fireEvent.click(rowA);
    expect(within(screen.getByRole("toolbar", { name: "Selected seats" })).getByText("5 selected")).toBeInTheDocument();
    expect(rowA).toBeChecked();
    expect(screen.getByText("5 seats selected.")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Seats in North, Row A" }));
    const seats = screen.getByRole("group", { name: "Seats in North, Row A" });
    fireEvent.click(within(seats).getByRole("checkbox", { name: "Seat 1" }));
    expect(within(screen.getByRole("toolbar")).getByText("4 selected")).toBeInTheDocument();
    expect(rowA).not.toBeChecked();
    expect((rowA as HTMLInputElement).indeterminate).toBe(true);
    // A partly chosen row: checking it adds the rest; checking it again clears the row.
    fireEvent.click(rowA);
    expect(within(screen.getByRole("toolbar")).getByText("5 selected")).toBeInTheDocument();
    fireEvent.click(rowA);
    expect(screen.queryByRole("toolbar")).toBeNull();
  });

  it("focus has somewhere to go when its control is removed: Delete section, Remove map, the toolbar's Delete", async () => {
    const onRemove = vi.fn(async () => {});
    const { container } = render(
      <SeatMapEditor event={event} initial={sampleRecord} status="Draft" locked={false} onSave={vi.fn()} onRemove={onRemove} />,
    );
    // Toolbar Delete: the toolbar goes with the selection, so focus goes to the canvas.
    fireEvent.click(screen.getByRole("button", { name: "Select North" }));
    fireEvent.click(within(screen.getByRole("toolbar", { name: "Selected seats" })).getByRole("button", { name: "Delete" }));
    expect(screen.queryByRole("toolbar")).toBeNull();
    expect(container.querySelector('[aria-label^="Seat map canvas"]')).toHaveFocus();

    // Delete section: its row in the list is gone, so the Sections heading.
    screen.getByRole("button", { name: "Delete East" }).focus();
    fireEvent.click(screen.getByRole("button", { name: "Delete East" }));
    fireEvent.click(within(screen.getByRole("dialog", { name: "Delete section?" })).getByRole("button", { name: "Delete section" }));
    expect(screen.queryByRole("button", { name: "Delete East" })).toBeNull();
    expect(screen.getByRole("heading", { name: "Sections" })).toHaveFocus();

    // Remove map: its button is gone, so the h1.
    screen.getByRole("button", { name: "Remove map" }).focus();
    fireEvent.click(screen.getByRole("button", { name: "Remove map" }));
    await act(async () => {
      fireEvent.click(within(screen.getByRole("dialog", { name: "Remove the seat map?" })).getByRole("button", { name: "Remove map" }));
    });
    expect(onRemove).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("heading", { level: 1, name: "Seat map" })).toHaveFocus();
  });
});
