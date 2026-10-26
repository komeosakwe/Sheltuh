// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import OrderPaymentSummary from "@/components/checkout/OrderPaymentSummary";
import SeatPicker from "@/components/seating/SeatPicker";
import TicketSelector from "@/components/TicketSelector";
import { ApiError } from "@/lib/api/client";
import type { OrderPaymentSummary as PaymentSummary } from "@/lib/api/types";
import { SAMPLE_SEAT_MAPS } from "@/lib/sample-seat-maps";
import { sampleEvents } from "@/lib/sample-events";
import { SUPPORT_BLURB, SUPPORT_RECIPIENT_NOTE } from "@/lib/support";
import type { SheltuhEvent } from "@/lib/types";

/**
 * Support Sheltüh at checkout (components/checkout/SupportSheltuh.tsx): the
 * general admission ticket selector, the seat page, and the payment page's
 * summary. The confirmation page's line is in CheckoutConfirmation.test.tsx.
 */

// Live mode: checkout is only offered when the API is configured.
vi.mock("@/lib/api/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api/client")>()),
  isApiConfigured: true,
}));
const { createCheckoutSession, createSeatedCheckout, getSeatAvailability, cancelPendingOrder } = vi.hoisted(() => ({
  createCheckoutSession: vi.fn(),
  createSeatedCheckout: vi.fn(),
  getSeatAvailability: vi.fn(),
  cancelPendingOrder: vi.fn(),
}));
vi.mock("@/lib/api/orders", () => ({
  createCheckoutSession: (...args: unknown[]) => createCheckoutSession(...args),
}));
vi.mock("@/lib/api/seating", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api/seating")>()),
  createSeatedCheckout,
  getSeatAvailability,
  cancelPendingOrder,
}));

beforeEach(() => {
  createCheckoutSession.mockReset();
  createSeatedCheckout.mockReset();
  getSeatAvailability.mockReset();
  getSeatAvailability.mockImplementation(() => new Promise(() => {}));
  cancelPendingOrder.mockReset();
});
afterEach(() => {
  cleanup();
  window.sessionStorage.clear();
});

function liveEvent(slug: string): SheltuhEvent {
  const event = sampleEvents.find((e) => e.slug === slug);
  if (!event) throw new Error(`Fixture event not found: ${slug}`);
  return { ...event, organiserId: "org-1" };
}

/** Neon Static's General admission is A$30 + A$1.70 booking fee = A$31.70. */
const NEON = "neon-static";
const addGa = () => fireEvent.click(screen.getByRole("button", { name: "Increase quantity for General admission" }));
const removeGa = () => fireEvent.click(screen.getByRole("button", { name: "Decrease quantity for General admission" }));
/** The legend: the label, then a muted "(optional)", before any amount. */
const GROUP_NAME = "Support Sheltüh (optional)";
const group = () => screen.getByRole("group", { name: GROUP_NAME });
const chip = (name: string) => within(group()).getByRole("radio", { name });
const total = () => screen.getByText("Total").nextElementSibling;
const status = () => screen.getAllByRole("status").find((el) => el.className.includes("sr-only")) as HTMLElement;

describe("Support Sheltüh in the ticket selector (general admission)", () => {
  it("is hidden until a paid ticket is chosen, then offers A$2, A$5, A$10 and Other right above Checkout, none selected", () => {
    render(<TicketSelector event={liveEvent(NEON)} />);
    expect(screen.queryByRole("group", { name: GROUP_NAME })).toBeNull();
    addGa();
    const radios = within(group()).getAllByRole("radio");
    expect(radios.map((r) => r.getAttribute("value"))).toEqual(["200", "500", "1000", "other"]);
    expect(radios.map((r) => (r as HTMLInputElement).checked)).toEqual([false, false, false, false]);
    expect(radios.map((r) => r.closest("label")?.textContent)).toEqual(["A$2", "A$5", "A$10", "Other"]);
    // The blurb and the recipient note describe the group, and come before the chips; "(optional)" is muted in the legend.
    expect(group()).toHaveAccessibleDescription(`${SUPPORT_BLURB} ${SUPPORT_RECIPIENT_NOTE}`);
    expect(SUPPORT_RECIPIENT_NOTE).toBe("It goes to Sheltüh, not the event organiser.");
    const note = within(group()).getByText(SUPPORT_RECIPIENT_NOTE);
    expect(note.compareDocumentPosition(radios[0]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(note).not.toHaveClass("text-xs");
    expect(within(group()).getByText("(optional)")).toHaveClass("text-muted");
    expect(group().querySelector("legend")).toHaveTextContent("Support Sheltüh (optional)");
    // Right above Checkout: nothing interactive between the last chip and the button but Remove (none yet).
    const checkout = screen.getByRole("button", { name: "Checkout" });
    expect(group().compareDocumentPosition(checkout) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Remove Support Sheltüh" })).toBeNull();
    // Never "donation".
    expect(document.body.textContent).not.toMatch(/donat/i);
    // Big, friendly chips: 48px tall.
    expect(chip("A$5").nextElementSibling).toHaveClass("min-h-12");
  });

  it("one tap adds A$5: its own summary line, and the total goes up at once", () => {
    render(<TicketSelector event={liveEvent(NEON)} />);
    addGa();
    expect(total()).toHaveTextContent("A$31.70");
    fireEvent.click(chip("A$5"));
    expect(chip("A$5")).toBeChecked();
    expect(total()).toHaveTextContent("A$36.70");
    const line = screen.getByText("Support Sheltüh", { selector: "dt" });
    expect(line.nextElementSibling).toHaveTextContent("A$5");
    // The tickets' own lines don't change: it's not a fee.
    expect(screen.getByText("Tickets").nextElementSibling).toHaveTextContent("A$30");
    expect(screen.getByText("Booking fees").nextElementSibling).toHaveTextContent("A$1.70");
    expect(status()).toHaveTextContent(
      "Support Sheltüh: A$5 added. Total A$36.70 incl. booking fees and Support Sheltüh. Choose it again or press Remove to take it off.",
    );
    // The selected chip is orange with black text, plus a check (never colour alone).
    expect(chip("A$5").nextElementSibling).toHaveClass("peer-checked:bg-signal", "peer-checked:text-signal-foreground");
    expect(chip("A$5").nextElementSibling?.querySelector("svg")).not.toBeNull();
    expect(chip("A$2").nextElementSibling?.querySelector("svg")).toBeNull();
  });

  it("tapping the chosen chip again removes it; another chip replaces it", () => {
    render(<TicketSelector event={liveEvent(NEON)} />);
    addGa();
    fireEvent.click(chip("A$5"));
    fireEvent.click(chip("A$10"));
    expect(chip("A$10")).toBeChecked();
    expect(chip("A$5")).not.toBeChecked();
    expect(total()).toHaveTextContent("A$41.70");
    fireEvent.click(chip("A$10"));
    expect(within(group()).getAllByRole("radio").every((r) => !(r as HTMLInputElement).checked)).toBe(true);
    expect(total()).toHaveTextContent("A$31.70");
    expect(screen.queryByText("Support Sheltüh", { selector: "dt" })).toBeNull();
    expect(status()).toHaveTextContent("Support Sheltüh removed. Total A$31.70 incl. booking fees.");
  });

  it("keyboard: Space on the chosen chip removes it", () => {
    render(<TicketSelector event={liveEvent(NEON)} />);
    addGa();
    fireEvent.click(chip("A$5"));
    const five = chip("A$5");
    five.focus();
    // Space on a chip that isn't chosen is left to the browser (it chooses it).
    expect(fireEvent.keyDown(chip("A$2"), { key: " " })).toBe(true);
    expect(fireEvent.keyDown(five, { key: " " })).toBe(false);
    expect(five).not.toBeChecked();
    expect(five).toHaveFocus();
    expect(total()).toHaveTextContent("A$31.70");
  });

  it("keyboard: a Remove button clears it and keeps focus in the group", () => {
    render(<TicketSelector event={liveEvent(NEON)} />);
    addGa();
    fireEvent.click(chip("A$2"));
    const remove = screen.getByRole("button", { name: "Remove Support Sheltüh" });
    expect(remove).toHaveClass("min-h-11");
    fireEvent.click(remove);
    expect(chip("A$2")).not.toBeChecked();
    expect(chip("A$2")).toHaveFocus();
    expect(screen.queryByRole("button", { name: "Remove Support Sheltüh" })).toBeNull();
    expect(total()).toHaveTextContent("A$31.70");
  });

  it("passes the chosen amount to createCheckoutSession as its 6th argument", async () => {
    createCheckoutSession.mockReturnValue(new Promise(() => {}));
    render(<TicketSelector event={liveEvent(NEON)} />);
    addGa();
    fireEvent.click(chip("A$5"));
    fireEvent.click(screen.getByRole("button", { name: "Checkout" }));
    await waitFor(() => expect(createCheckoutSession).toHaveBeenCalledTimes(1));
    expect(createCheckoutSession).toHaveBeenCalledWith(
      "evt-neon-static",
      [{ ticketTypeId: "neon-static-ga", quantity: 1 }],
      undefined,
      undefined,
      undefined,
      500,
    );
  });

  it("sends no amount when none is chosen", async () => {
    createCheckoutSession.mockReturnValue(new Promise(() => {}));
    render(<TicketSelector event={liveEvent(NEON)} />);
    addGa();
    fireEvent.click(chip("A$5"));
    fireEvent.click(chip("A$5"));
    fireEvent.click(screen.getByRole("button", { name: "Checkout" }));
    await waitFor(() => expect(createCheckoutSession).toHaveBeenCalledTimes(1));
    expect(createCheckoutSession.mock.calls[0][5]).toBeUndefined();
  });

  it("Other: an A$ field, validated (A$1 to A$500, whole cents) with an inline error, and the total follows it", async () => {
    createCheckoutSession.mockReturnValue(new Promise(() => {}));
    render(<TicketSelector event={liveEvent(NEON)} />);
    addGa();
    // A tap (a pointer down on the chip, then its click) opens the field and puts focus in it.
    fireEvent.pointerDown(chip("Other").closest("label") as HTMLElement);
    fireEvent.click(chip("Other"));
    const field = screen.getByLabelText("Other amount");
    expect(field).toHaveFocus();
    expect(field).toHaveAttribute("inputmode", "decimal");
    expect(field).toHaveClass("min-h-12", "text-base");
    expect(field).toHaveAccessibleDescription("In Australian dollars, from A$1 to A$500.");

    // Not an amount yet: no error while typing, one once the field is left.
    fireEvent.change(field, { target: { value: "0.5" } });
    expect(screen.queryByRole("alert")).toBeNull();
    expect(total()).toHaveTextContent("A$31.70");
    const slot = screen.getByText("In Australian dollars, from A$1 to A$500.").parentElement as HTMLElement;
    expect(slot).toHaveClass("min-h-10");
    fireEvent.blur(field);
    expect(screen.getByRole("alert")).toHaveTextContent("The smallest amount is A$1.");
    expect(field).toHaveAttribute("aria-invalid", "true");
    // The error takes the hint's place, in the same slot (nothing below moves): never both.
    expect(field).toHaveAccessibleDescription("The smallest amount is A$1.");
    expect(screen.queryByText("In Australian dollars, from A$1 to A$500.")).toBeNull();
    expect(slot).toContainElement(screen.getByRole("alert"));
    expect(slot.children).toHaveLength(1);

    // Checkout with it invalid: refused here, focus on the field, nothing sent.
    fireEvent.click(screen.getByRole("button", { name: "Checkout" }));
    expect(field).toHaveFocus();
    expect(createCheckoutSession).not.toHaveBeenCalled();

    fireEvent.change(field, { target: { value: "500.01" } });
    expect(screen.getByRole("alert")).toHaveTextContent("The most you can add is A$500.");
    fireEvent.change(field, { target: { value: "7.505" } });
    expect(screen.getByRole("alert")).toHaveTextContent("Use whole cents, like 7.50.");
    fireEvent.change(field, { target: { value: "7.50" } });
    expect(screen.queryByRole("alert")).toBeNull();
    expect(field).not.toHaveAttribute("aria-invalid");
    expect(field).toHaveAccessibleDescription("In Australian dollars, from A$1 to A$500.");
    expect(total()).toHaveTextContent("A$39.20");
    expect(screen.getByText("Support Sheltüh", { selector: "dt" }).nextElementSibling).toHaveTextContent("A$7.50");

    fireEvent.click(screen.getByRole("button", { name: "Checkout" }));
    await waitFor(() => expect(createCheckoutSession).toHaveBeenCalledTimes(1));
    expect(createCheckoutSession.mock.calls[0][5]).toBe(750);
  });

  it("Other chosen from the keyboard (no pointer) doesn't pull focus out of the group", () => {
    render(<TicketSelector event={liveEvent(NEON)} />);
    addGa();
    const other = chip("Other");
    other.focus();
    // What the arrow keys do: a click with no pointer down before it.
    fireEvent.keyDown(other, { key: "ArrowRight" });
    fireEvent.click(other);
    expect(other).toBeChecked();
    expect(other).toHaveFocus();
    expect(screen.getByLabelText("Other amount")).toBeInTheDocument();
  });

  it("Checkout with Other open and nothing typed treats it as none: nothing shown as chosen, nothing sent", async () => {
    createCheckoutSession.mockReturnValue(new Promise(() => {}));
    render(<TicketSelector event={liveEvent(NEON)} />);
    addGa();
    fireEvent.click(chip("Other"));
    fireEvent.change(screen.getByLabelText("Other amount"), { target: { value: "  " } });
    fireEvent.click(screen.getByRole("button", { name: "Checkout" }));
    await waitFor(() => expect(createCheckoutSession).toHaveBeenCalledTimes(1));
    expect(createCheckoutSession.mock.calls[0][5]).toBeUndefined();
    expect(chip("Other")).not.toBeChecked();
    expect(screen.queryByLabelText("Other amount")).toBeNull();
    expect(screen.queryByText("Support Sheltüh", { selector: "dt" })).toBeNull();
  });

  it("goes (and is forgotten) when no paid ticket is left, and isn't pre-selected when one comes back", () => {
    render(<TicketSelector event={liveEvent(NEON)} />);
    addGa();
    fireEvent.click(chip("A$10"));
    removeGa();
    expect(screen.queryByRole("group", { name: GROUP_NAME })).toBeNull();
    expect(total()).toHaveTextContent("A$0");
    expect(status()).toHaveTextContent("General admission: 0. Total A$0.");
    addGa();
    expect(chip("A$10")).not.toBeChecked();
    expect(total()).toHaveTextContent("A$31.70");
  });

  it("isn't offered for free tickets, even in an event with paid ones", () => {
    const base = liveEvent(NEON);
    const event: SheltuhEvent = {
      ...base,
      ticketTypes: [
        { id: "paid", name: "Paid", priceCents: 2000, feePolicy: "buyer-pays", quantityAvailable: 10 },
        { id: "free", name: "Listener", priceCents: 0, feePolicy: "buyer-pays", quantityAvailable: 10 },
      ],
    };
    render(<TicketSelector event={event} />);
    fireEvent.click(screen.getByRole("button", { name: "Increase quantity for Listener" }));
    expect(screen.queryByRole("group", { name: GROUP_NAME })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Increase quantity for Paid" }));
    expect(group()).toBeInTheDocument();
  });

  it("isn't offered for a free-only event", () => {
    render(<TicketSelector event={liveEvent("brunswick-zine-fair")} />);
    fireEvent.click(screen.getByRole("button", { name: "Increase quantity for Free entry" }));
    expect(screen.queryByRole("group", { name: GROUP_NAME })).toBeNull();
  });

  it("says the API's refusal of the amount by the chips, not as a general error, and clears it on a new pick", async () => {
    createCheckoutSession.mockRejectedValue(
      new ApiError(400, "Check the highlighted fields.", { supportCents: "Support Sheltüh must be from A$1 to A$500." }),
    );
    render(<TicketSelector event={liveEvent(NEON)} />);
    addGa();
    fireEvent.click(chip("A$5"));
    fireEvent.click(screen.getByRole("button", { name: "Checkout" }));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Support Sheltüh must be from A$1 to A$500.");
    expect(group()).toContainElement(alert);
    expect(screen.queryByText("Check the highlighted fields.")).toBeNull();
    fireEvent.click(chip("A$2"));
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("is in the demo's preview too (nothing can be booked there)", () => {
    const event = sampleEvents.find((e) => e.slug === NEON) as SheltuhEvent;
    render(<TicketSelector event={event} />);
    addGa();
    fireEvent.click(chip("A$2"));
    expect(total()).toHaveTextContent("A$33.70");
    expect(screen.getByRole("button", { name: "Checkout unavailable in this demo" })).toBeDisabled();
  });
});

describe("Support Sheltüh on the seat page", () => {
  const seated = sampleEvents.find((e) => e.id === "evt-off-kilter") as SheltuhEvent;
  const sample = SAMPLE_SEAT_MAPS["evt-off-kilter"];
  const map = { version: sample.version, seatCount: sample.seatCount, template: sample.template };

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-21T00:00:00.000Z"));
    // Desktop: the summary card with its own Checkout.
    window.matchMedia = vi.fn().mockImplementation((query: string) => ({
      matches: query.includes("min-width: 64rem"),
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })) as unknown as typeof window.matchMedia;
  });
  afterEach(() => {
    vi.useRealTimers();
    Reflect.deleteProperty(window, "matchMedia");
  });

  function chooseSeat() {
    fireEvent.click(screen.getByRole("tab", { name: "List" }));
    const northA = screen.getByRole("group", { name: "North, Row A" });
    fireEvent.click(within(northA).getByRole("checkbox", { name: /^Seat 1, / }));
  }

  it("is offered once a paid seat is chosen, adds to the total, and is sent with the seated checkout", async () => {
    createSeatedCheckout.mockReturnValue(new Promise(() => {}));
    render(<SeatPicker event={{ ...seated, organiserId: "org-1" }} map={map} mode="live" initialUnavailable={sample.unavailable} />);
    expect(screen.queryByRole("group", { name: GROUP_NAME })).toBeNull();
    chooseSeat();
    expect(within(group()).getAllByRole("radio").every((r) => !(r as HTMLInputElement).checked)).toBe(true);
    const totals = screen.getByText("Total").closest("dl") as HTMLElement;
    expect(within(totals).getByText("A$36.90")).toBeInTheDocument();
    fireEvent.click(chip("A$10"));
    expect(within(totals).getByText("A$46.90")).toHaveClass("text-xl", "font-bold");
    expect(within(totals).getByText("Support Sheltüh").nextElementSibling).toHaveTextContent("A$10");
    // Face value and fees unchanged.
    expect(within(totals).getByText("Ticket face value").nextElementSibling).toHaveTextContent("A$35");
    fireEvent.click(screen.getByRole("button", { name: "Checkout" }));
    await waitFor(() => expect(createSeatedCheckout).toHaveBeenCalledTimes(1));
    const [, input] = createSeatedCheckout.mock.calls[0];
    expect(input.supportCents).toBe(1000);
    expect(input.seats).toEqual({ mapVersion: 1, seatIds: ["N-A1"] });
  });

  it("sends none when none is chosen, and forgets it when the last paid seat goes", async () => {
    createSeatedCheckout.mockReturnValue(new Promise(() => {}));
    render(<SeatPicker event={{ ...seated, organiserId: "org-1" }} map={map} mode="live" initialUnavailable={sample.unavailable} />);
    chooseSeat();
    fireEvent.click(chip("A$5"));
    fireEvent.click(screen.getByRole("button", { name: "Remove North, Row A, Seat 1" }));
    expect(screen.queryByRole("group", { name: GROUP_NAME })).toBeNull();
    chooseSeat();
    expect(chip("A$5")).not.toBeChecked();
    fireEvent.click(screen.getByRole("button", { name: "Checkout" }));
    await waitFor(() => expect(createSeatedCheckout).toHaveBeenCalledTimes(1));
    expect(createSeatedCheckout.mock.calls[0][1]).not.toHaveProperty("supportCents");
  });

  it("an invalid Other amount stops Checkout with an inline error on the field", () => {
    render(<SeatPicker event={{ ...seated, organiserId: "org-1" }} map={map} mode="live" initialUnavailable={sample.unavailable} />);
    chooseSeat();
    fireEvent.click(chip("Other"));
    const field = screen.getByLabelText("Other amount");
    fireEvent.change(field, { target: { value: "600" } });
    fireEvent.click(screen.getByRole("button", { name: "Checkout" }));
    expect(screen.getByRole("alert")).toHaveTextContent("The most you can add is A$500.");
    expect(field).toHaveFocus();
    expect(createSeatedCheckout).not.toHaveBeenCalled();
  });

  it("Other left empty at Checkout is none: unchosen, and the seated checkout carries no amount", async () => {
    createSeatedCheckout.mockReturnValue(new Promise(() => {}));
    render(<SeatPicker event={{ ...seated, organiserId: "org-1" }} map={map} mode="live" initialUnavailable={sample.unavailable} />);
    chooseSeat();
    fireEvent.click(chip("Other"));
    fireEvent.click(screen.getByRole("button", { name: "Checkout" }));
    await waitFor(() => expect(createSeatedCheckout).toHaveBeenCalledTimes(1));
    expect(createSeatedCheckout.mock.calls[0][1]).not.toHaveProperty("supportCents");
    expect(chip("Other")).not.toBeChecked();
  });

  it("isn't in an organiser's preview of the seat page", () => {
    render(<SeatPicker event={seated} map={map} mode="preview" initialUnavailable={sample.unavailable} />);
    chooseSeat();
    expect(screen.queryByRole("group", { name: GROUP_NAME })).toBeNull();
  });
});

describe("Support Sheltüh on the payment page's summary", () => {
  const base: PaymentSummary = {
    eventTitle: "Neon Static",
    eventSlug: "neon-static",
    seated: false,
    lines: [{ ticketTypeName: "General admission", quantity: 2, unitTotalCents: 3170, lineTotalCents: 6340, buyerPaysFee: true }],
    subtotalCents: 6000,
    buyerFeeCents: 340,
    totalCents: 6340,
  };

  it("is its own line, and the total (which includes it) says so", () => {
    render(<OrderPaymentSummary summary={{ ...base, supportCents: 500, totalCents: 6840 }} />);
    const line = document.querySelector("[data-support-line]") as HTMLElement;
    // Outside the phone fold ("Show n tickets"): seen before paying with the ticket lines closed.
    expect(document.getElementById("order-lines")).toHaveClass("hidden");
    expect(document.getElementById("order-lines")).not.toContainElement(line);
    expect(line).toHaveTextContent("Support Sheltüh");
    expect(line).toHaveTextContent("To Sheltüh, not the organiser");
    expect(line).toHaveTextContent("A$5");
    expect(document.querySelector("[data-order-total]")).toHaveTextContent("A$68.40");
    expect(screen.getByText("Includes A$3.40 in booking fees and A$5 for Support Sheltüh.")).toBeInTheDocument();
  });

  it("with no booking fee, still says the total includes it", () => {
    render(<OrderPaymentSummary summary={{ ...base, buyerFeeCents: 0, supportCents: 200, totalCents: 6200 }} />);
    expect(screen.getByText("No booking fee. Includes A$2 for Support Sheltüh.")).toBeInTheDocument();
  });

  it("with support, the refund terms say it's refunded only with the whole order; not without it", () => {
    const note = "Support Sheltüh is refunded only if your whole order is refunded.";
    const { unmount } = render(
      <OrderPaymentSummary summary={{ ...base, supportCents: 500, totalCents: 6840, refundPolicy: "no_change_of_mind" }} />,
    );
    const policy = document.querySelector("[data-refund-policy]") as HTMLElement;
    expect(within(policy).getByText(note)).toBeInTheDocument();
    unmount();
    render(<OrderPaymentSummary summary={{ ...base, refundPolicy: "no_change_of_mind" }} />);
    expect(document.querySelector("[data-refund-policy]")).not.toBeNull();
    expect(screen.queryByText(note)).toBeNull();
  });

  it("isn't there without it (unset, or from an older API)", () => {
    render(<OrderPaymentSummary summary={base} />);
    expect(document.querySelector("[data-support-line]")).toBeNull();
    expect(screen.queryByText(/Support Sheltüh/)).toBeNull();
    expect(screen.getByText("Includes A$3.40 in booking fees.")).toBeInTheDocument();
  });
});
