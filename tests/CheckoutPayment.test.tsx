// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useState, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import CheckoutPayment from "@/components/checkout/CheckoutPayment";
import { ApiError } from "@/lib/api/client";
import type { OrderPaymentLookup } from "@/lib/api/types";

/**
 * /checkout/pay (docs/design/checkout-pay.md): every state, with Stripe.js
 * and its React wrapper mocked (nothing here loads https://js.stripe.com).
 */

const ORDER_ID = `ord_${"ab12".repeat(8)}`;

const flags = vi.hoisted(() => ({ api: true, stripe: true, search: "" }));
const replace = vi.fn();

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(flags.search),
  // A new object every render: the page mustn't depend on the router's identity.
  useRouter: () => ({ replace, push: vi.fn() }),
}));
vi.mock("@/lib/api/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api/client")>()),
  get isApiConfigured() {
    return flags.api;
  },
}));
vi.mock("@/lib/stripe/config", () => ({
  get isStripeConfigured() {
    return flags.stripe;
  },
  get STRIPE_PUBLISHABLE_KEY() {
    return flags.stripe ? "pk_test_unit" : undefined;
  },
}));

// Every API helper the checkout pages could reach, so a test can prove only the GET was used.
const getOrderPayment = vi.fn();
const writes = {
  createCheckoutSession: vi.fn(),
  confirmFreeOrder: vi.fn(),
  cancelPendingOrder: vi.fn(),
  createSeatedCheckout: vi.fn(),
};
vi.mock("@/lib/api/orders", () => ({
  getOrderPayment: (...args: unknown[]) => getOrderPayment(...args),
  getOrderBySession: vi.fn(),
  createCheckoutSession: (...args: unknown[]) => writes.createCheckoutSession(...args),
  confirmFreeOrder: (...args: unknown[]) => writes.confirmFreeOrder(...args),
}));
vi.mock("@/lib/api/seating", () => ({
  cancelPendingOrder: (...args: unknown[]) => writes.cancelPendingOrder(...args),
  createSeatedCheckout: (...args: unknown[]) => writes.createSeatedCheckout(...args),
}));

const STRIPE = { id: "fake-stripe-instance" };
const getStripe = vi.fn();
vi.mock("@/lib/stripe/browser", () => ({ getStripe: () => getStripe() }));

interface ProviderCall {
  stripe: unknown;
  options: { clientSecret?: string | null };
}
const providerMounts: ProviderCall[] = [];
const providerRenders: ProviderCall[] = [];
let renderIframe = true;
vi.mock("@stripe/react-stripe-js", () => ({
  EmbeddedCheckoutProvider: ({ stripe, options, children }: ProviderCall & { children: ReactNode }) => {
    providerRenders.push({ stripe, options });
    // Once per mount, as the real provider calls createEmbeddedCheckoutPage once.
    useState(() => providerMounts.push({ stripe, options }));
    return <div data-testid="stripe-provider">{children}</div>;
  },
  EmbeddedCheckout: () => (
    <div data-testid="stripe-embedded">{renderIframe && <iframe title="Secure payment input frame" />}</div>
  ),
}));

const OPEN_GA: OrderPaymentLookup = {
  status: "open",
  clientSecret: "cs_test_secret_123",
  expiresAt: "2027-03-06T09:31:00.000Z", // 8:31 pm AEDT
  eventTitle: "Neon Static",
  eventSlug: "neon-static",
  eventStartsAt: "2027-03-06T09:00:00.000Z",
  eventEndsAt: "2027-03-06T12:30:00.000Z",
  venueName: "The Tote",
  suburb: "Collingwood",
  seated: false,
  lines: [
    { ticketTypeName: "General admission", quantity: 2, unitTotalCents: 3170, lineTotalCents: 6340 },
    { ticketTypeName: "Free list", quantity: 1, unitTotalCents: 0, lineTotalCents: 0 },
  ],
  subtotalCents: 6000,
  buyerFeeCents: 340,
  totalCents: 6340,
};

const OPEN_SEATED: OrderPaymentLookup = {
  ...OPEN_GA,
  eventTitle: "Off-Kilter",
  eventSlug: "off-kilter",
  seated: true,
  lines: [
    {
      ticketTypeName: "Full price",
      quantity: 2,
      unitTotalCents: 3690,
      lineTotalCents: 7380,
      seats: [
        { section: "North", row: "A", seat: "1", kind: "standard" },
        { section: "North", row: "A", seat: "2", kind: "standard" },
      ],
    },
  ],
  subtotalCents: 7000,
  buyerFeeCents: 380,
  totalCents: 7380,
};

beforeEach(() => {
  flags.api = true;
  flags.stripe = true;
  flags.search = `order=${ORDER_ID}`;
  renderIframe = true;
  getStripe.mockResolvedValue(STRIPE);
});

afterEach(() => {
  cleanup();
  getOrderPayment.mockReset();
  getStripe.mockReset();
  replace.mockReset();
  for (const fn of Object.values(writes)) fn.mockReset();
  providerMounts.length = 0;
  providerRenders.length = 0;
});

function heading() {
  return screen.getByRole("heading", { level: 1 });
}

function noWrites() {
  for (const fn of Object.values(writes)) expect(fn).not.toHaveBeenCalled();
}

describe("CheckoutPayment: open", () => {
  it("shows loading first, then the summary and Stripe's form with the client secret", async () => {
    getOrderPayment.mockResolvedValue(OPEN_GA);
    render(<CheckoutPayment />);
    expect(heading()).toHaveTextContent("Pay for your tickets");
    expect(screen.getByRole("status")).toHaveTextContent("Loading checkout…");

    await screen.findByTestId("stripe-embedded");
    expect(getOrderPayment).toHaveBeenCalledWith(ORDER_ID);
    expect(getStripe).toHaveBeenCalledTimes(1);
    expect(providerMounts).toEqual([{ stripe: STRIPE, options: { clientSecret: "cs_test_secret_123" } }]);
    expect(heading()).toHaveTextContent("Pay for your tickets");
    // The form's slot: white in both themes, named for screen readers.
    const form = screen.getByRole("region", { name: "Payment details" });
    expect(form.querySelector("[data-payment-slot]")).toHaveAttribute("data-surface", "paper");
    expect(await screen.findByText("Payment form ready")).toHaveAttribute("role", "status");
    expect(screen.queryByText("Loading the payment form…")).toBeNull();
    // Reads only.
    noWrites();
  });

  it("says what's being bought, and the all-inclusive total is the loudest number", async () => {
    getOrderPayment.mockResolvedValue(OPEN_GA);
    render(<CheckoutPayment />);
    const summary = await screen.findByRole("region", { name: "Neon Static" });
    expect(summary).toHaveClass("rounded-card", "border", "border-foreground", "bg-card");
    expect(within(summary).getByText("Sat 6 Mar, 8:00 pm – 11:30 pm")).toBeInTheDocument();
    expect(within(summary).getByText("The Tote, Collingwood")).toBeInTheDocument();
    expect(within(summary).getByText("2 × A$31.70 incl. fee")).toBeInTheDocument();
    expect(within(summary).getByText("1 × Free")).toBeInTheDocument();
    expect(within(summary).getByText("Free", { selector: "p.shrink-0" })).toBeInTheDocument();

    const total = summary.querySelector("[data-order-total]");
    expect(total).toHaveTextContent("A$63.40");
    expect(total).toHaveClass("text-xl", "font-bold", "tabular-nums");
    expect(within(summary).getByText("Total")).toHaveClass("text-lg", "font-bold");
    // Every other amount is smaller than the total.
    const lineAmount = within(summary).getByText("A$63.40", { selector: "li p" });
    expect(lineAmount).toHaveClass("text-sm");
    expect(lineAmount.className).not.toMatch(/text-(lg|xl)/);
    const fee = within(summary).getByText("Includes A$3.40 in booking fees.");
    expect(fee).toHaveClass("text-xs");
    // The fee note comes after the total, never before it.
    expect(total?.compareDocumentPosition(fee) ?? 0).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
  });

  it("a buyer who pays no booking fee is told so, and no line says 'incl. fee'", async () => {
    getOrderPayment.mockResolvedValue({
      ...OPEN_GA,
      lines: [{ ticketTypeName: "General admission", quantity: 2, unitTotalCents: 3000, lineTotalCents: 6000 }],
      buyerFeeCents: 0,
      totalCents: 6000,
    });
    render(<CheckoutPayment />);
    expect(await screen.findByText("No booking fee.")).toBeInTheDocument();
    expect(screen.getByText("2 × A$30")).toBeInTheDocument();
    expect(screen.queryByText(/incl\. fee/)).toBeNull();
  });

  it("phones fold the lines behind a toggle; the total is never inside it", async () => {
    getOrderPayment.mockResolvedValue(OPEN_GA);
    render(<CheckoutPayment />);
    const toggle = await screen.findByRole("button", { name: "Show 3 tickets" });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(toggle).toHaveAttribute("aria-controls", "order-lines");
    expect(toggle).toHaveClass("min-h-11", "lg:hidden");
    const region = document.getElementById("order-lines");
    expect(region).toHaveClass("hidden", "lg:block");
    expect(region?.querySelector("[data-order-total]")).toBeNull();
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(toggle).toHaveAccessibleName("Hide tickets");
    expect(region).toHaveClass("block");
    expect(region).not.toHaveClass("hidden");
  });

  it("general admission: back to the event, the ticket steps, and the terms and privacy links", async () => {
    getOrderPayment.mockResolvedValue(OPEN_GA);
    render(<CheckoutPayment />);
    expect(await screen.findByRole("link", { name: "Back to the event" })).toHaveAttribute("href", "/events/neon-static");
    const steps = screen.getByRole("list", { name: "Checkout steps" });
    expect(steps).toHaveTextContent("1 Choose tickets→2 Pay→3 Tickets by email");
    expect(within(steps).getByText("2 Pay").closest("li")).toHaveAttribute("aria-current", "step");
    expect(screen.getByRole("link", { name: "Purchase Terms" })).toHaveAttribute("href", "/purchase-terms");
    expect(screen.getByRole("link", { name: "Privacy Policy" })).toHaveAttribute("href", "/privacy");
    expect(screen.getByText(/Card details go straight to Stripe, our payment provider, and never reach Sheltüh\./)).toBeInTheDocument();
    // No hold line without seats.
    expect(screen.queryByText(/Your seats are held/)).toBeNull();
  });

  it("seated: back to change seats, the seat steps, each seat, and when the hold ends", async () => {
    getOrderPayment.mockResolvedValue(OPEN_SEATED);
    render(<CheckoutPayment />);
    expect(await screen.findByRole("link", { name: "Change seats" })).toHaveAttribute("href", "/events/off-kilter/seats");
    expect(screen.getByRole("list", { name: "Checkout steps" })).toHaveTextContent("1 Choose seats→2 Pay→3 Tickets by email");
    expect(screen.getByText("Your seats are held until 8:31 pm. Going back releases them.")).toBeInTheDocument();
    expect(screen.getByText("North · Row A · Seat 1")).toBeInTheDocument();
    expect(screen.getByText("North · Row A · Seat 2")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Show 2 seats" })).toBeInTheDocument();
  });

  it("an event without a slug goes back to Sheltüh", async () => {
    getOrderPayment.mockResolvedValue({ ...OPEN_GA, eventSlug: undefined });
    render(<CheckoutPayment />);
    expect(await screen.findByRole("link", { name: "Back to Sheltüh" })).toHaveAttribute("href", "/");
  });

  it("leaves focus alone on arrival (Next's route announcer has it)", async () => {
    getOrderPayment.mockResolvedValue(OPEN_GA);
    render(<CheckoutPayment />);
    await screen.findByTestId("stripe-embedded");
    expect(heading()).not.toHaveFocus();
  });

  it("keeps the loader in the slot until Stripe's iframe is there", async () => {
    renderIframe = false;
    getOrderPayment.mockResolvedValue(OPEN_GA);
    render(<CheckoutPayment />);
    await screen.findByTestId("stripe-embedded");
    expect(screen.getByText("Loading the payment form…")).toBeInTheDocument();
    expect(screen.queryByText("Payment form ready")).toBeNull();
    expect(document.querySelector("[data-payment-slot]")).toHaveClass("min-h-144");
  });
});

describe("CheckoutPayment: Stripe.js", () => {
  it("can't load (offline, a blocker): our own alert and Try again, which really tries again", async () => {
    getOrderPayment.mockResolvedValue(OPEN_GA);
    getStripe.mockRejectedValueOnce(new Error("Failed to load Stripe.js"));
    render(<CheckoutPayment />);
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(
      "The payment form didn’t load. Check your connection. If you use a content blocker, allow js.stripe.com, then try again. You haven’t been charged.",
    );
    // The summary stays; focus moves to the h1 on the change.
    expect(screen.getByRole("region", { name: "Neon Static" })).toBeInTheDocument();
    expect(heading()).toHaveFocus();
    expect(screen.queryByTestId("stripe-provider")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    await screen.findByTestId("stripe-embedded");
    expect(getStripe).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole("alert")).toBeNull();
    expect(providerMounts).toHaveLength(1);
  });

  it("resolving to nothing counts as a failed load", async () => {
    getOrderPayment.mockResolvedValue(OPEN_GA);
    getStripe.mockResolvedValue(null);
    render(<CheckoutPayment />);
    expect(await screen.findByRole("alert")).toHaveTextContent("The payment form didn’t load.");
    expect(screen.queryByTestId("stripe-provider")).toBeNull();
  });
});

describe("CheckoutPayment: never loads Stripe", () => {
  it("in the demo: says so, links to events, and calls nothing", async () => {
    flags.api = false;
    render(<CheckoutPayment />);
    expect(heading()).toHaveTextContent("Checkout isn’t available in this demo");
    expect(
      screen.getByText("This is a local prototype. No payment information is collected and no tickets are issued."),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Browse events" })).toHaveAttribute("href", "/");
    await act(async () => {});
    expect(getOrderPayment).not.toHaveBeenCalled();
    expect(getStripe).not.toHaveBeenCalled();
  });

  it("without a publishable key: card payments aren't available, with the way back", async () => {
    flags.stripe = false;
    getOrderPayment.mockResolvedValue(OPEN_GA);
    render(<CheckoutPayment />);
    expect(await screen.findByRole("heading", { level: 1, name: "Card payments aren’t available right now" })).toBeInTheDocument();
    expect(screen.getByText(/You haven’t been charged\. Try again later, or email/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "support@sheltuh.com.au" })).toHaveAttribute("href", "mailto:support@sheltuh.com.au");
    expect(screen.getByRole("link", { name: "Back to the event" })).toHaveAttribute("href", "/events/neon-static");
    expect(getStripe).not.toHaveBeenCalled();
    expect(screen.queryByTestId("stripe-provider")).toBeNull();
    expect(screen.queryByText(/Purchase Terms/)).toBeNull();
  });

  it("a 503 from the API is the same state, going home", async () => {
    getOrderPayment.mockRejectedValue(new ApiError(503, "Card payments aren't available right now."));
    render(<CheckoutPayment />);
    expect(await screen.findByRole("heading", { level: 1, name: "Card payments aren’t available right now" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Back to Sheltüh" })).toHaveAttribute("href", "/");
    expect(getStripe).not.toHaveBeenCalled();
  });
});

describe("CheckoutPayment: other answers", () => {
  it.each([
    [
      "closed, general admission (its time ran out, or the event can't be booked now)",
      { status: "closed", eventTitle: "Neon Static", eventSlug: "neon-static", seated: false },
      "This checkout has closed",
      "Your time to pay ran out, or this event can’t be booked right now. You haven’t been charged.",
      ["Back to the event", "/events/neon-static"],
    ],
    [
      "closed, seated",
      { status: "closed", eventTitle: "Off-Kilter", eventSlug: "off-kilter", seated: true },
      "This checkout has closed",
      "Your time to pay ran out, or this event can’t be booked right now. You haven’t been charged, and any seats held for you have been released.",
      ["Back to the event", "/events/off-kilter"],
    ],
    [
      "sold out, general admission",
      { status: "sold_out", eventTitle: "Neon Static", eventSlug: "neon-static", seated: false },
      "These tickets have just sold out",
      "Someone else booked the last ones while this checkout was open. You haven’t been charged.",
      ["Back to the event", "/events/neon-static"],
    ],
    [
      "sold out, seated",
      { status: "sold_out", eventTitle: "Off-Kilter", eventSlug: "off-kilter", seated: true },
      "These tickets have just sold out",
      "Some of your seats were booked by someone else while this checkout was open. You haven’t been charged. Choose other seats to continue.",
      ["Choose other seats", "/events/off-kilter/seats"],
    ],
    [
      "closed, event gone",
      { status: "closed", eventTitle: "Gone", seated: false },
      "This checkout has closed",
      "Your time to pay ran out, or this event can’t be booked right now. You haven’t been charged.",
      ["Back to Sheltüh", "/"],
    ],
  ] as const)("%s: its own h1, why, and one way out, with no summary or steps", async (_name, answer, title, body, [label, href]) => {
    getOrderPayment.mockResolvedValue(answer);
    render(<CheckoutPayment />);
    expect(await screen.findByRole("heading", { level: 1, name: title })).toBeInTheDocument();
    expect(screen.getByText(body)).toBeInTheDocument();
    const way = screen.getByRole("link", { name: label });
    expect(way).toHaveAttribute("href", href);
    expect(way).toHaveClass("btn-solid", "btn-lg");
    expect(screen.queryByRole("list", { name: "Checkout steps" })).toBeNull();
    expect(screen.queryByText("Total")).toBeNull();
    expect(getStripe).not.toHaveBeenCalled();
  });

  it.each([["processing"], ["done"]] as const)("%s: takes the buyer to their order", async (status) => {
    getOrderPayment.mockResolvedValue(status === "processing" ? { status, delayed: false } : { status });
    render(<CheckoutPayment />);
    expect(await screen.findByText("Taking you to your order…")).toBeInTheDocument();
    expect(replace).toHaveBeenCalledWith(`/checkout/success?session_id=${ORDER_ID}`);
    expect(getStripe).not.toHaveBeenCalled();
  });

  it("no order in the link: not found, without asking the API", async () => {
    flags.search = "";
    render(<CheckoutPayment />);
    expect(heading()).toHaveTextContent("We couldn’t find that checkout");
    expect(
      screen.getByText("The link may be incomplete. If you were charged, your tickets are on their way to your email."),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Back to Sheltüh" })).toHaveAttribute("href", "/");
    await act(async () => {});
    expect(getOrderPayment).not.toHaveBeenCalled();
  });

  it("a 404: not found", async () => {
    getOrderPayment.mockRejectedValue(new ApiError(404, "Order not found."));
    render(<CheckoutPayment />);
    expect(await screen.findByRole("heading", { level: 1, name: "We couldn’t find that checkout" })).toBeInTheDocument();
  });

  it("a 409: still being set up, and Try again loads it (focus to the h1)", async () => {
    getOrderPayment.mockRejectedValueOnce(new ApiError(409, "This checkout is still being set up.")).mockResolvedValue(OPEN_GA);
    render(<CheckoutPayment />);
    expect(await screen.findByRole("alert")).toHaveTextContent("This checkout is still being set up.");
    expect(heading()).toHaveTextContent("Pay for your tickets");
    expect(screen.getByRole("link", { name: "Back to Sheltüh" })).toHaveAttribute("href", "/");
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    await screen.findByTestId("stripe-embedded");
    expect(getOrderPayment).toHaveBeenCalledTimes(2);
    expect(heading()).toHaveFocus();
  });

  it("any other failure: an alert saying nothing was charged, and Try again", async () => {
    getOrderPayment.mockRejectedValue(new TypeError("Failed to fetch"));
    render(<CheckoutPayment />);
    expect(await screen.findByRole("alert")).toHaveTextContent("Couldn’t load checkout right now. You haven’t been charged.");
    expect(screen.getByRole("button", { name: "Try again" })).toHaveClass("btn-outline");
  });
});

describe("CheckoutPayment: asking again", () => {
  it("back from the back/forward cache: asks again, keeping the same form when it's still open", async () => {
    getOrderPayment.mockResolvedValue(OPEN_GA);
    render(<CheckoutPayment />);
    await screen.findByTestId("stripe-embedded");
    await act(async () => {
      window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: false }));
    });
    expect(getOrderPayment).toHaveBeenCalledTimes(1);
    await act(async () => {
      window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true }));
    });
    expect(getOrderPayment).toHaveBeenCalledTimes(2);
    // Not mounted again, and given the very same options (Stripe.js takes them once).
    expect(providerMounts).toHaveLength(1);
    expect(new Set(providerRenders.map((call) => call.options)).size).toBe(1);
    expect(heading()).not.toHaveFocus();
  });

  it("back from the cache after it closed: the closed state, with focus on its h1", async () => {
    getOrderPayment
      .mockResolvedValueOnce(OPEN_SEATED)
      .mockResolvedValue({ status: "closed", eventTitle: "Off-Kilter", eventSlug: "off-kilter", seated: true });
    render(<CheckoutPayment />);
    await screen.findByTestId("stripe-embedded");
    await act(async () => {
      window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true }));
    });
    const h1 = await screen.findByRole("heading", { level: 1, name: "This checkout has closed" });
    expect(h1).toHaveFocus();
    expect(screen.queryByTestId("stripe-provider")).toBeNull();
  });

  it("once the checkout's time is up, asks again", async () => {
    getOrderPayment
      .mockResolvedValueOnce({ ...OPEN_GA, expiresAt: new Date(Date.now() - 1000).toISOString() })
      .mockResolvedValue({ status: "closed", eventTitle: "Neon Static", eventSlug: "neon-static", seated: false });
    render(<CheckoutPayment />);
    expect(await screen.findByRole("heading", { level: 1, name: "This checkout has closed" }, { timeout: 3000 })).toHaveFocus();
    expect(getOrderPayment).toHaveBeenCalledTimes(2);
  });

  it("asks only by GET, whatever happens", async () => {
    getOrderPayment.mockResolvedValueOnce(OPEN_SEATED).mockResolvedValue({ status: "processing", delayed: true });
    render(<CheckoutPayment />);
    await screen.findByTestId("stripe-embedded");
    await act(async () => {
      window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true }));
    });
    await waitFor(() => expect(replace).toHaveBeenCalled());
    noWrites();
  });
});
