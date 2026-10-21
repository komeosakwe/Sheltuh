// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import EventDetailsView from "@/components/EventDetailsView";
import CheckoutCancelled from "@/components/seating/CheckoutCancelled";
import SeatMapEditor from "@/components/seating/editor/SeatMapEditor";
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

describe("/checkout/cancelled (§5.12)", () => {
  it("releases the seats once and says so, focusing the event title", async () => {
    cancelPendingOrder.mockResolvedValue({ status: "released", eventTitle: "Off-Kilter: A New Play", eventSlug: "off-kilter" });
    render(<CheckoutCancelled />);
    expect(screen.getByRole("status")).toHaveTextContent(/Releasing your seats/);
    const heading = await screen.findByRole("heading", { name: "Off-Kilter: A New Play" });
    await waitFor(() => expect(heading).toHaveFocus());
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
    expect(await screen.findByRole("heading", { name: "Off-Kilter" })).toBeInTheDocument();
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
});
