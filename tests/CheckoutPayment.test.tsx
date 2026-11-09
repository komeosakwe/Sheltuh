// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import CheckoutPayment from "@/components/checkout/CheckoutPayment";
import StripePreconnect from "@/components/checkout/StripePreconnect";
import { ApiError } from "@/lib/api/client";
import type { OrderPaymentLookup } from "@/lib/api/types";
import { REFUND_ACL_STATEMENT } from "@/lib/refund-policy";

/**
 * /checkout/pay (docs/design/checkout-pay.md): every state, with Stripe.js
 * faked (nothing here loads https://js.stripe.com). Its React wrapper,
 * @stripe/react-stripe-js, is the real one, so the provider's own checks run
 * against the guarded Stripe the page hands it (lib/stripe/embedded.ts).
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

/**
 * What a fake embedded Checkout does when created: mount an iframe (Stripe's form), mount nothing,
 * reject, or never answer. Each instance is kept, to check it's destroyed.
 */
type CreateMode = "iframe" | "no-iframe" | "reject" | "hang";
interface FakeEmbedded {
  options: { clientSecret?: string };
  mount: ReturnType<typeof vi.fn>;
  unmount: ReturnType<typeof vi.fn>;
  destroy: ReturnType<typeof vi.fn>;
}
const fake = { modes: [] as CreateMode[], instances: [] as FakeEmbedded[], resolveHung: [] as (() => void)[] };

function createEmbeddedCheckoutPage(options: { clientSecret?: string }): Promise<FakeEmbedded> {
  const mode = fake.modes.shift() ?? "iframe";
  if (mode === "reject") return Promise.reject(new Error("Stripe couldn't set up the form"));
  let frame: HTMLIFrameElement | null = null;
  const instance: FakeEmbedded = {
    options,
    mount: vi.fn((target: HTMLElement) => {
      if (mode === "no-iframe") return;
      frame = document.createElement("iframe");
      frame.title = "Secure payment input frame";
      target.appendChild(frame);
    }),
    unmount: vi.fn(() => frame?.remove()),
    destroy: vi.fn(() => frame?.remove()),
  };
  if (mode === "hang") {
    // Resolves only when a test says so (after the page has given up).
    return new Promise((resolve) => {
      fake.resolveHung.push(() => {
        fake.instances.push(instance);
        resolve(instance);
      });
    });
  }
  fake.instances.push(instance);
  return Promise.resolve(instance);
}

/** Stripe.js's instance, with only what the provider checks for and what the page uses. */
const STRIPE = {
  elements: vi.fn(),
  createToken: vi.fn(),
  createPaymentMethod: vi.fn(),
  confirmCardPayment: vi.fn(),
  createEmbeddedCheckoutPage: vi.fn(createEmbeddedCheckoutPage),
};
const getStripe = vi.fn();
// The page's early start of Stripe.js (lib/stripe/browser.ts, tested in tests/stripe-browser.test.ts).
const preloadStripe = vi.fn();
vi.mock("@/lib/stripe/browser", () => ({ getStripe: () => getStripe(), preloadStripe: () => preloadStripe() }));

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
    { ticketTypeName: "General admission", quantity: 2, unitTotalCents: 3230, lineTotalCents: 6460, buyerPaysFee: true },
    { ticketTypeName: "Free list", quantity: 1, unitTotalCents: 0, lineTotalCents: 0, buyerPaysFee: false },
  ],
  subtotalCents: 6000,
  buyerFeeCents: 460,
  totalCents: 6460,
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
      unitTotalCents: 3760,
      lineTotalCents: 7520,
      buyerPaysFee: true,
      seats: [
        { section: "North", row: "A", seat: "1", kind: "standard" },
        { section: "North", row: "A", seat: "2", kind: "standard" },
      ],
    },
  ],
  subtotalCents: 7000,
  buyerFeeCents: 520,
  totalCents: 7520,
};

/**
 * An open answer with `msLeft` to pay by the server's clock, which is `skewMs` ahead of this device's
 * (negative: behind), as the API sends it: the deadline and the server's own time.
 */
function openFor(msLeft: number, { skewMs = 0, base = OPEN_GA }: { skewMs?: number; base?: OrderPaymentLookup } = {}): OrderPaymentLookup {
  const serverNow = Date.now() + skewMs;
  return {
    ...base,
    status: "open",
    expiresAt: new Date(serverNow + msLeft).toISOString(),
    serverTime: new Date(serverNow).toISOString(),
  } as OrderPaymentLookup;
}

beforeEach(() => {
  flags.api = true;
  flags.stripe = true;
  flags.search = `order=${ORDER_ID}`;
  fake.modes = [];
  fake.instances = [];
  fake.resolveHung = [];
  getStripe.mockResolvedValue(STRIPE);
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  getOrderPayment.mockReset();
  getStripe.mockReset();
  preloadStripe.mockReset();
  STRIPE.createEmbeddedCheckoutPage.mockClear();
  replace.mockReset();
  for (const fn of Object.values(writes)) fn.mockReset();
});

function stripeFrame() {
  return document.querySelector<HTMLIFrameElement>('[data-payment-slot] iframe[title="Secure payment input frame"]');
}

/** Stripe's form is in the slot (its iframe). */
async function formMounted() {
  await waitFor(() => expect(stripeFrame()).not.toBeNull());
}

/** Runs pending timers and promises under fake timers. */
async function advance(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

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

    await formMounted();
    expect(getOrderPayment).toHaveBeenCalledWith(ORDER_ID);
    expect(getStripe).toHaveBeenCalledTimes(1);
    // The real provider accepted the guarded Stripe and created the form once, with this order's secret.
    expect(STRIPE.createEmbeddedCheckoutPage).toHaveBeenCalledTimes(1);
    expect(STRIPE.createEmbeddedCheckoutPage).toHaveBeenCalledWith({ clientSecret: "cs_test_secret_123" });
    expect(heading()).toHaveTextContent("Pay for your tickets");
    // The form's slot: white in both themes, named for screen readers.
    const form = screen.getByRole("region", { name: "Payment details" });
    expect(form.querySelector("[data-payment-slot]")).toHaveAttribute("data-surface", "paper");
    expect(await screen.findByText("Payment form ready")).toHaveAttribute("role", "status");
    expect(screen.queryByText("Loading the payment form…")).toBeNull();
    expect(form.querySelector("[data-payment-slot]")).not.toHaveClass("min-h-144");
    // Reads only.
    noWrites();
  });

  it("says what's being bought, and the all-inclusive total is the loudest number", async () => {
    getOrderPayment.mockResolvedValue(OPEN_GA);
    render(<CheckoutPayment />);
    const summary = await screen.findByRole("region", { name: "Neon Static" });
    expect(summary).toHaveClass("rounded-card", "border", "border-foreground", "bg-card");
    expect(within(summary).getByText("Sat 6 Mar, 8:00 pm – 11:30 pm")).toBeInTheDocument();
    expect(within(summary).getByText("The Tote, Collingwood, VIC")).toBeInTheDocument();
    expect(within(summary).getByText("2 × A$32.30 incl. fee")).toBeInTheDocument();
    expect(within(summary).getByText("1 × Free")).toBeInTheDocument();
    expect(within(summary).getByText("Free", { selector: "p.shrink-0" })).toBeInTheDocument();

    const total = summary.querySelector("[data-order-total]");
    expect(total).toHaveTextContent("A$64.60");
    expect(total).toHaveClass("text-xl", "font-bold", "tabular-nums");
    expect(within(summary).getByText("Total")).toHaveClass("text-lg", "font-bold");
    // Every other amount is smaller than the total.
    const lineAmount = within(summary).getByText("A$64.60", { selector: "li p" });
    expect(lineAmount).toHaveClass("text-sm");
    expect(lineAmount.className).not.toMatch(/text-(lg|xl)/);
    const fee = within(summary).getByText("Includes A$4.60 in booking fees.");
    expect(fee).toHaveClass("text-xs");
    // The fee note comes after the total, never before it.
    expect(total?.compareDocumentPosition(fee) ?? 0).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
  });

  it("says the event's refund policy, dated from its start, with the ACL line, under the total (before paying)", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-01T00:00:00.000Z"));
    try {
      // The event starts Sat 6 Mar 2027, 8:00 pm AEDT.
      getOrderPayment.mockResolvedValue({ ...OPEN_GA, refundPolicy: "days_before", refundDays: 7 });
      render(<CheckoutPayment />);
      const summary = await screen.findByRole("region", { name: "Neon Static" });
      const refunds = summary.querySelector<HTMLElement>("[data-refund-policy]");
      if (!refunds) throw new Error("no refund policy");
      // "Refund policy:", not "Refunds: Refunds available…".
      expect(refunds).toHaveTextContent(
        "Refund policy: Refunds available until Sat 27 Feb 2027, 8:00 pm (7 days before the event).",
      );
      expect(within(refunds).getByText(REFUND_ACL_STATEMENT)).toHaveClass("text-sm", "text-muted");
      const total = summary.querySelector("[data-order-total]");
      expect(total?.compareDocumentPosition(refunds) ?? 0).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    } finally {
      vi.useRealTimers();
    }
  });

  it("a Perth event: the date and refund deadline in Perth time, named, and a seat hold ending in Perth time", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-01T00:00:00.000Z"));
    try {
      // 8:00 pm – 11:30 pm AEDT is 5:00 pm – 8:30 pm AWST; the hold's 8:31 pm AEDT is 5:31 pm AWST.
      getOrderPayment.mockResolvedValue({
        ...OPEN_SEATED,
        eventTitle: "Neon Static",
        eventTimeZone: "Australia/Perth",
        eventState: "WA",
        refundPolicy: "days_before",
        refundDays: 7,
      });
      render(<CheckoutPayment />);
      const summary = await screen.findByRole("region", { name: "Neon Static" });
      expect(within(summary).getByText("Sat 6 Mar, 5:00 pm – 8:30 pm Perth time")).toBeInTheDocument();
      expect(summary.querySelector("[data-refund-policy]")).toHaveTextContent(
        "Refund policy: Refunds available until Sat 27 Feb 2027, 5:00 pm (7 days before the event).",
      );
      expect(screen.getByText("Your seats are held until 5:31 pm Perth time. Going back releases them.")).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it("says the refund window has closed once the deadline has passed", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2027-03-03T09:00:00.000Z"));
    try {
      getOrderPayment.mockResolvedValue({ ...OPEN_GA, refundPolicy: "days_before", refundDays: 7 });
      render(<CheckoutPayment />);
      const summary = await screen.findByRole("region", { name: "Neon Static" });
      expect(summary.querySelector("[data-refund-policy]")).toHaveTextContent(
        "Refund policy: The refund window for this event has closed. No refunds for change of mind.",
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it("no_change_of_mind says so; a response without a policy (or with invalid days) says nothing about refunds", async () => {
    getOrderPayment.mockResolvedValue({ ...OPEN_GA, refundPolicy: "no_change_of_mind" });
    render(<CheckoutPayment />);
    expect(await screen.findByText("No refunds for change of mind.", { exact: false })).toBeInTheDocument();
    cleanup();

    for (const lookup of [OPEN_GA, { ...OPEN_GA, refundPolicy: "days_before" as const }]) {
      getOrderPayment.mockResolvedValue(lookup);
      render(<CheckoutPayment />);
      await screen.findByRole("region", { name: "Neon Static" });
      expect(document.querySelector("[data-refund-policy]")).toBeNull();
      expect(screen.queryByText(REFUND_ACL_STATEMENT)).toBeNull();
      cleanup();
    }
  });

  it("a buyer who pays no booking fee is told so, and no line says 'incl. fee'", async () => {
    getOrderPayment.mockResolvedValue({
      ...OPEN_GA,
      lines: [
        { ticketTypeName: "General admission", quantity: 2, unitTotalCents: 3000, lineTotalCents: 6000, buyerPaysFee: false },
      ],
      buyerFeeCents: 0,
      totalCents: 6000,
    });
    render(<CheckoutPayment />);
    expect(await screen.findByText("No booking fee.")).toBeInTheDocument();
    expect(screen.getByText("2 × A$30")).toBeInTheDocument();
    expect(screen.queryByText(/incl\. fee/)).toBeNull();
  });

  it("'incl. fee' goes by each line: an absorbed line's price says nothing, even when another line has a fee", async () => {
    getOrderPayment.mockResolvedValue({
      ...OPEN_GA,
      lines: [
        { ticketTypeName: "General admission", quantity: 1, unitTotalCents: 3230, lineTotalCents: 3230, buyerPaysFee: true },
        { ticketTypeName: "Supporter", quantity: 1, unitTotalCents: 5000, lineTotalCents: 5000, buyerPaysFee: false },
      ],
      subtotalCents: 8000,
      buyerFeeCents: 230,
      totalCents: 8230,
    });
    render(<CheckoutPayment />);
    const summary = await screen.findByRole("region", { name: "Neon Static" });
    expect(within(summary).getByText("1 × A$32.30 incl. fee")).toBeInTheDocument();
    expect(within(summary).getByText("1 × A$50")).toBeInTheDocument();
    expect(within(summary).getByText("Includes A$2.30 in booking fees.")).toBeInTheDocument();
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

  it("general admission: back to the event, no step indicator, and the terms and privacy links", async () => {
    getOrderPayment.mockResolvedValue(OPEN_GA);
    render(<CheckoutPayment />);
    expect(await screen.findByRole("link", { name: "Back to the event" })).toHaveAttribute("href", "/events/neon-static");
    // Owner (28 Oct 2026, less helper text): no "1 Choose tickets → 2 Pay → 3 Tickets by email".
    expect(screen.queryByRole("list", { name: "Checkout steps" })).toBeNull();
    expect(screen.getByRole("link", { name: "Purchase Terms" })).toHaveAttribute("href", "/purchase-terms");
    expect(screen.getByRole("link", { name: "Privacy Policy" })).toHaveAttribute("href", "/privacy");
    expect(screen.getByRole("link", { name: "Purchase Terms" })).toHaveClass("whitespace-nowrap");
    expect(screen.getByRole("link", { name: "Privacy Policy" })).toHaveClass("whitespace-nowrap");
    expect(screen.getByText(/Card details go to Stripe, not Sheltüh\./)).toBeInTheDocument();
    // Said once, above Stripe's form: who sees the name and email.
    const notice = screen.getByText("Your name and email are shared with the organiser of this event.");
    expect(screen.getAllByText(notice.textContent ?? "")).toHaveLength(1);
    // No hold line without seats.
    expect(screen.queryByText(/Your seats are held/)).toBeNull();
  });

  it("seated: back to change seats, each seat, and when the hold ends (Melbourne time)", async () => {
    getOrderPayment.mockResolvedValue(OPEN_SEATED);
    render(<CheckoutPayment />);
    expect(await screen.findByRole("link", { name: "Change seats" })).toHaveAttribute("href", "/events/off-kilter/seats");
    expect(screen.queryByRole("list", { name: "Checkout steps" })).toBeNull();
    // Melbourne's time, like the event's, and said so: a device elsewhere would otherwise misread it.
    expect(screen.getByText("Your seats are held until 8:31 pm Melbourne time. Going back releases them.")).toBeInTheDocument();
    expect(screen.getByText("North · Row A · Seat 1")).toBeInTheDocument();
    expect(screen.getByText("North · Row A · Seat 2")).toBeInTheDocument();
    // Each seat takes the line's full width (a child of the line, not of its name column).
    const seat = screen.getByText("North · Row A · Seat 1").closest("[data-seat-line]");
    expect(seat?.parentElement?.tagName).toBe("LI");
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
    await formMounted();
    expect(heading()).not.toHaveFocus();
    // Focused only by script, and not a control: no focus ring.
    expect(heading()).toHaveAttribute("tabindex", "-1");
    expect(heading()).toHaveClass("focus:outline-none!");
  });

  it("keeps the loader in the slot until Stripe's iframe is there", async () => {
    fake.modes = ["no-iframe"];
    getOrderPayment.mockResolvedValue(OPEN_GA);
    render(<CheckoutPayment />);
    await waitFor(() => expect(fake.instances[0]?.mount).toHaveBeenCalled());
    expect(screen.getByText("Loading the payment form…")).toBeInTheDocument();
    expect(screen.queryByText("Payment form ready")).toBeNull();
    expect(document.querySelector("[data-payment-slot]")).toHaveClass("min-h-144");
  });

  it("an iframe that's there but not yet drawn: still loading; ready (and announced) once it has a height", async () => {
    const observers: { callback: ResizeObserverCallback; targets: Element[] }[] = [];
    vi.stubGlobal(
      "ResizeObserver",
      class {
        targets: Element[] = [];
        constructor(callback: ResizeObserverCallback) {
          observers.push({ callback, targets: this.targets });
        }
        observe(target: Element) {
          this.targets.push(target);
        }
        unobserve() {}
        disconnect() {}
      },
    );
    getOrderPayment.mockResolvedValue(OPEN_GA);
    render(<CheckoutPayment />);
    await formMounted();
    await waitFor(() => expect(observers).toHaveLength(1));
    const frame = stripeFrame();
    expect(observers[0].targets).toEqual([frame]);
    // Inserted, 0 high (jsdom's layout): not ready.
    act(() => observers[0].callback([], {} as ResizeObserver));
    expect(screen.getByText("Loading the payment form…")).toBeInTheDocument();
    expect(screen.queryByText("Payment form ready")).toBeNull();
    expect(document.querySelector("[data-payment-slot]")).toHaveClass("min-h-144");

    if (frame) frame.getBoundingClientRect = () => DOMRect.fromRect({ width: 600, height: 640 });
    act(() => observers[0].callback([], {} as ResizeObserver));
    expect(screen.getByText("Payment form ready")).toBeInTheDocument();
    expect(screen.queryByText("Loading the payment form…")).toBeNull();
    expect(document.querySelector("[data-payment-slot]")).not.toHaveClass("min-h-144");
  });
});

const FORM_FAILED =
  "The payment form didn’t load. Check your connection. If you use a content blocker, allow js.stripe.com, then try again. You haven’t been charged.";

/** The failed slot: our alert and Try again, no Stripe form, and no reserved height. */
function expectFormFailed() {
  expect(screen.getByRole("alert")).toHaveTextContent(FORM_FAILED);
  expect(stripeFrame()).toBeNull();
  expect(screen.queryByText("Loading the payment form…")).toBeNull();
  expect(document.querySelector("[data-payment-slot]")).not.toHaveClass("min-h-144");
  expect(screen.getByRole("button", { name: "Try again" })).toHaveClass("min-h-11");
}

describe("CheckoutPayment: Stripe.js and its form", () => {
  it("can't load (offline, a blocker): our own alert, and Try again loads the checkout afresh", async () => {
    getOrderPayment.mockResolvedValue(OPEN_GA);
    getStripe.mockRejectedValueOnce(new Error("Failed to load Stripe.js"));
    render(<CheckoutPayment />);
    await screen.findByRole("alert");
    expectFormFailed();
    // The summary stays; focus moves to the h1 on the change.
    expect(screen.getByRole("region", { name: "Neon Static" })).toBeInTheDocument();
    expect(heading()).toHaveFocus();
    expect(STRIPE.createEmbeddedCheckoutPage).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    await formMounted();
    // The checkout is asked for again (it may have closed meanwhile), and Stripe.js is loaded again.
    expect(getOrderPayment).toHaveBeenCalledTimes(2);
    expect(getStripe).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole("alert")).toBeNull();
    expect(STRIPE.createEmbeddedCheckoutPage).toHaveBeenCalledTimes(1);
    expect(heading()).toHaveFocus();
  });

  it("resolving to nothing counts as a failed load", async () => {
    getOrderPayment.mockResolvedValue(OPEN_GA);
    getStripe.mockResolvedValue(null);
    render(<CheckoutPayment />);
    await screen.findByRole("alert");
    expectFormFailed();
  });

  it("Stripe can't set up the form (it rejects): the same alert, not an endless loader, and Try again mounts a new one", async () => {
    fake.modes = ["reject"];
    getOrderPayment.mockResolvedValue(OPEN_GA);
    render(<CheckoutPayment />);
    await screen.findByRole("alert");
    expectFormFailed();
    expect(heading()).toHaveFocus();
    expect(STRIPE.createEmbeddedCheckoutPage).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    await formMounted();
    expect(getOrderPayment).toHaveBeenCalledTimes(2);
    expect(STRIPE.createEmbeddedCheckoutPage).toHaveBeenCalledTimes(2);
    expect(STRIPE.createEmbeddedCheckoutPage).toHaveBeenLastCalledWith({ clientSecret: "cs_test_secret_123" });
    expect(await screen.findByText("Payment form ready")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("a form that never appears: after 20 s, the alert; one that turns up late is destroyed, and Try again works", async () => {
    vi.useFakeTimers();
    fake.modes = ["hang"];
    getOrderPayment.mockResolvedValue(OPEN_GA);
    render(<CheckoutPayment />);
    await advance(0);
    expect(STRIPE.createEmbeddedCheckoutPage).toHaveBeenCalledTimes(1);
    expect(screen.getByText("Loading the payment form…")).toBeInTheDocument();
    await advance(19_999);
    expect(screen.queryByRole("alert")).toBeNull();
    await advance(1);
    expectFormFailed();
    expect(heading()).toHaveFocus();

    // Stripe answers after the page gave up: that form is destroyed, never shown.
    await act(async () => {
      fake.resolveHung[0]();
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(fake.instances[0].destroy).toHaveBeenCalledTimes(1);
    expect(fake.instances[0].mount).not.toHaveBeenCalled();
    expectFormFailed();

    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    await advance(0);
    expect(stripeFrame()).not.toBeNull();
    expect(screen.getByText("Payment form ready")).toBeInTheDocument();
    expect(STRIPE.createEmbeddedCheckoutPage).toHaveBeenCalledTimes(2);
    // Ready: the watchdog is off.
    await advance(30_000);
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("Stripe.js that never loads is covered by the same 20 s", async () => {
    vi.useFakeTimers();
    getStripe.mockReturnValue(new Promise(() => undefined));
    getOrderPayment.mockResolvedValue(OPEN_GA);
    render(<CheckoutPayment />);
    await advance(0);
    expect(screen.getByText("Loading the payment form…")).toBeInTheDocument();
    await advance(20_000);
    expectFormFailed();
  });

  it("a new form is only created once the last one is destroyed (Stripe.js allows one at a time)", async () => {
    const order: string[] = [];
    STRIPE.createEmbeddedCheckoutPage.mockImplementation((options) => {
      order.push("create");
      return createEmbeddedCheckoutPage(options).then((instance) => {
        instance.destroy.mockImplementation(() => order.push("destroy"));
        return instance;
      });
    });
    getOrderPayment
      .mockResolvedValueOnce(OPEN_GA)
      .mockResolvedValueOnce({ status: "closed", eventTitle: "Neon Static", eventSlug: "neon-static", seated: false })
      .mockResolvedValue(OPEN_GA);
    render(<CheckoutPayment />);
    await formMounted();
    // Closed (a back/forward restore), then open again: the first form went with the closed state.
    await act(async () => {
      window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true }));
    });
    await screen.findByRole("heading", { level: 1, name: "This checkout has closed" });
    await act(async () => {
      window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true }));
    });
    await formMounted();
    expect(order).toEqual(["create", "destroy", "create"]);
    STRIPE.createEmbeddedCheckoutPage.mockImplementation(createEmbeddedCheckoutPage);
  });
});

describe("CheckoutPayment: never loads Stripe", () => {
  it("in the demo: says so, links to events, and calls nothing", async () => {
    flags.api = false;
    render(<CheckoutPayment />);
    expect(heading()).toHaveTextContent("Checkout isn’t available in this demo");
    expect(
      screen.getByText("Demo only. Nothing is charged or issued."),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Browse events" })).toHaveAttribute("href", "/");
    await act(async () => {});
    expect(getOrderPayment).not.toHaveBeenCalled();
    expect(getStripe).not.toHaveBeenCalled();
    expect(preloadStripe).not.toHaveBeenCalled();
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
    expect(preloadStripe).not.toHaveBeenCalled();
    expect(stripeFrame()).toBeNull();
    expect(STRIPE.createEmbeddedCheckoutPage).not.toHaveBeenCalled();
    expect(screen.queryByText(/Purchase Terms/)).toBeNull();
  });
});

describe("CheckoutPayment: Stripe.js starts loading at once", () => {
  it("at mount, beside the first GET and before it answers; the form then shares that load", async () => {
    let answer: (value: OrderPaymentLookup) => void = () => undefined;
    getOrderPayment.mockReturnValue(new Promise<OrderPaymentLookup>((resolve) => (answer = resolve)));
    render(<CheckoutPayment />);
    await act(async () => {});
    expect(getOrderPayment).toHaveBeenCalledTimes(1);
    expect(preloadStripe).toHaveBeenCalledTimes(1);
    // Still waiting on the order: no form, and the form's own getStripe() hasn't been asked yet.
    expect(screen.getByText("Loading checkout…")).toBeInTheDocument();
    expect(getStripe).not.toHaveBeenCalled();

    await act(async () => answer(OPEN_GA));
    await formMounted();
    expect(getStripe).toHaveBeenCalledTimes(1);
    expect(STRIPE.createEmbeddedCheckoutPage).toHaveBeenCalledTimes(1);
    // Once per page, not again for each answer.
    expect(preloadStripe).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["closed", { status: "closed", eventTitle: "Neon Static", eventSlug: "neon-static", seated: false }],
    ["sold out", { status: "sold_out", eventTitle: "Off-Kilter", eventSlug: "off-kilter", seated: true }],
    ["done", { status: "done" }],
    ["processing", { status: "processing", delayed: false }],
  ] as const)("%s: loaded early, but no form is ever created", async (_name, answer) => {
    getOrderPayment.mockResolvedValue(answer);
    render(<CheckoutPayment />);
    await waitFor(() => expect(screen.queryByText("Loading checkout…")).toBeNull());
    await act(async () => {});
    expect(preloadStripe).toHaveBeenCalledTimes(1);
    expect(getStripe).not.toHaveBeenCalled();
    expect(STRIPE.createEmbeddedCheckoutPage).not.toHaveBeenCalled();
    expect(stripeFrame()).toBeNull();
  });

  it("an answer that fails (a 404): loaded early, no form", async () => {
    getOrderPayment.mockRejectedValue(new ApiError(404, "Not found"));
    render(<CheckoutPayment />);
    expect(await screen.findByRole("heading", { level: 1, name: "We couldn’t find that checkout" })).toBeInTheDocument();
    expect(preloadStripe).toHaveBeenCalledTimes(1);
    expect(STRIPE.createEmbeddedCheckoutPage).not.toHaveBeenCalled();
  });

  it("no order in the link: nothing to pay, so nothing loads", async () => {
    flags.search = "";
    render(<CheckoutPayment />);
    await act(async () => {});
    expect(preloadStripe).not.toHaveBeenCalled();
  });
});

describe("StripePreconnect (the payment page's head)", () => {
  const preconnectLink = () => document.head.querySelector('link[rel="preconnect"][href="https://js.stripe.com"]');

  // React adds a given hint once per page (it remembers it after removal too), so the cases that must
  // add nothing run first, in one test.
  it("a preconnect to Stripe.js in live mode with a key only: never in the demo or without a key", () => {
    flags.api = false;
    render(<StripePreconnect />);
    expect(preconnectLink()).toBeNull();
    cleanup();

    flags.api = true;
    flags.stripe = false;
    render(<StripePreconnect />);
    expect(preconnectLink()).toBeNull();
    cleanup();

    flags.stripe = true;
    const { container } = render(<StripePreconnect />);
    const link = preconnectLink();
    expect(link).not.toBeNull();
    // No crossorigin: stripe-js adds its script without one.
    expect(link).not.toHaveAttribute("crossorigin");
    // Nothing on the page itself.
    expect(container).toBeEmptyDOMElement();
    link?.remove();
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
    [
      "closed (ended: cancelled or failed), seated",
      { status: "closed", reason: "ended", eventTitle: "Off-Kilter", eventSlug: "off-kilter", seated: true },
      "This checkout has closed",
      "Your time to pay ran out, or this event can’t be booked right now. You haven’t been charged, and any seats held for you have been released.",
      ["Back to the event", "/events/off-kilter"],
    ],
    [
      "time's up, general admission",
      { status: "closed", reason: "time_up", eventTitle: "Neon Static", eventSlug: "neon-static", seated: false },
      "Time’s up",
      "Your order wasn’t placed and you haven’t been charged.",
      ["Start again", "/events/neon-static#tickets"],
    ],
    [
      "time's up, seated",
      { status: "closed", reason: "time_up", eventTitle: "Off-Kilter", eventSlug: "off-kilter", seated: true },
      "Time’s up",
      "Your order wasn’t placed and you haven’t been charged. Your seats have been released.",
      ["Start again", "/events/off-kilter#tickets"],
    ],
    [
      "time's up, event gone",
      { status: "closed", reason: "time_up", eventTitle: "Gone", seated: false },
      "Time’s up",
      "Your order wasn’t placed and you haven’t been charged.",
      ["Back to Sheltüh", "/"],
    ],
    [
      "unconfirmed (the server couldn't ask Stripe), seated",
      { status: "closed", reason: "unconfirmed", eventTitle: "Off-Kilter", eventSlug: "off-kilter", seated: true },
      "We couldn’t confirm your payment",
      "Check your email for tickets before trying again.",
      ["Back to the event", "/events/off-kilter"],
    ],
    [
      "unavailable (the event can't be booked right now), seated",
      { status: "closed", reason: "unavailable", eventTitle: "Off-Kilter", eventSlug: "off-kilter", seated: true },
      "This checkout has closed",
      "This event isn’t taking bookings right now. You haven’t been charged.",
      ["Back to the event", "/events/off-kilter"],
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
    expect(screen.getByRole("heading", { level: 1 })).toHaveClass("text-balance", "focus:outline-none!");
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
      screen.getByText("If you were charged, your tickets are on their way."),
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
    await formMounted();
    expect(getOrderPayment).toHaveBeenCalledTimes(2);
    expect(heading()).toHaveFocus();
  });

  it("a 429 (asked too often): wait a minute, nothing charged, and Try again loads it", async () => {
    getOrderPayment
      .mockRejectedValueOnce(new ApiError(429, "Too many requests. Try again in a minute."))
      .mockResolvedValue(OPEN_GA);
    render(<CheckoutPayment />);
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Too many tries — wait a minute, then try again. You haven’t been charged.",
    );
    expect(heading()).toHaveTextContent("Pay for your tickets");
    // Nothing of Stripe's until the checkout itself has been read.
    expect(getStripe).not.toHaveBeenCalled();
    const again = screen.getByRole("button", { name: "Try again" });
    expect(again).toHaveClass("btn-outline", "min-h-11");
    fireEvent.click(again);
    await formMounted();
    expect(getOrderPayment).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole("alert")).toBeNull();
    expect(heading()).toHaveFocus();
    noWrites();
  });

  it("any other failure: an alert saying nothing was charged, and Try again", async () => {
    getOrderPayment.mockRejectedValue(new TypeError("Failed to fetch"));
    render(<CheckoutPayment />);
    expect(await screen.findByRole("alert")).toHaveTextContent("Couldn’t load checkout right now. You haven’t been charged.");
    expect(screen.getByRole("button", { name: "Try again" })).toHaveClass("btn-outline", "min-h-11");
  });
});

describe("CheckoutPayment: asking again", () => {
  it("back from the back/forward cache: asks again, keeping the same form when it's still open", async () => {
    getOrderPayment.mockResolvedValue(OPEN_GA);
    render(<CheckoutPayment />);
    await formMounted();
    await act(async () => {
      window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: false }));
    });
    expect(getOrderPayment).toHaveBeenCalledTimes(1);
    await act(async () => {
      window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true }));
    });
    expect(getOrderPayment).toHaveBeenCalledTimes(2);
    // Not created again, and never destroyed (the provider would warn on new options).
    expect(STRIPE.createEmbeddedCheckoutPage).toHaveBeenCalledTimes(1);
    expect(fake.instances[0].destroy).not.toHaveBeenCalled();
    expect(stripeFrame()).not.toBeNull();
    expect(heading()).not.toHaveFocus();
  });

  it("back from the cache after it closed: the closed state, with focus on its h1", async () => {
    getOrderPayment
      .mockResolvedValueOnce(OPEN_SEATED)
      .mockResolvedValue({ status: "closed", eventTitle: "Off-Kilter", eventSlug: "off-kilter", seated: true });
    render(<CheckoutPayment />);
    await formMounted();
    await act(async () => {
      window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true }));
    });
    const h1 = await screen.findByRole("heading", { level: 1, name: "This checkout has closed" });
    expect(h1).toHaveFocus();
    expect(stripeFrame()).toBeNull();
    expect(fake.instances[0].destroy).toHaveBeenCalledTimes(1);
  });

  it("once the checkout's time is up, time's up at once, and asks again a second after it", async () => {
    vi.useFakeTimers();
    getOrderPayment
      .mockResolvedValueOnce(openFor(60_000))
      .mockResolvedValue({ status: "closed", reason: "time_up", eventTitle: "Neon Static", eventSlug: "neon-static", seated: false });
    render(<CheckoutPayment />);
    await advance(0);
    expect(getOrderPayment).toHaveBeenCalledTimes(1);
    await advance(59_999);
    expect(stripeFrame()).not.toBeNull();
    await advance(1);
    expect(screen.getByRole("heading", { level: 1, name: "Time’s up" })).toHaveFocus();
    expect(stripeFrame()).toBeNull();
    expect(getOrderPayment).toHaveBeenCalledTimes(1);
    await advance(999);
    expect(getOrderPayment).toHaveBeenCalledTimes(1);
    await advance(1);
    expect(getOrderPayment).toHaveBeenCalledTimes(2);
    // The server agrees: the same panel, focus left where it is, and nothing more to ask.
    expect(screen.getByRole("heading", { level: 1, name: "Time’s up" })).toHaveFocus();
    await advance(60_000);
    expect(getOrderPayment).toHaveBeenCalledTimes(2);
  });

  it("an open answer already past its deadline: time's up, no form, and asks again 5 s apart at least until it's closed", async () => {
    vi.useFakeTimers();
    const expired = openFor(-1_000);
    getOrderPayment
      .mockResolvedValueOnce(expired)
      .mockResolvedValueOnce(expired)
      .mockResolvedValue({ status: "closed", reason: "time_up", eventTitle: "Neon Static", eventSlug: "neon-static", seated: false });
    render(<CheckoutPayment />);
    await advance(0);
    expect(getOrderPayment).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("heading", { level: 1, name: "Time’s up" })).toHaveFocus();
    // Not straight away (no tight loop): 5 s on.
    await advance(4_999);
    expect(getOrderPayment).toHaveBeenCalledTimes(1);
    await advance(1);
    expect(getOrderPayment).toHaveBeenCalledTimes(2);
    // Still open past its deadline: no form, and asked again.
    expect(stripeFrame()).toBeNull();
    await advance(4_999);
    expect(getOrderPayment).toHaveBeenCalledTimes(2);
    await advance(1);
    expect(getOrderPayment).toHaveBeenCalledTimes(3);
    expect(screen.getByRole("heading", { level: 1, name: "Time’s up" })).toBeInTheDocument();
    await advance(30_000);
    expect(getOrderPayment).toHaveBeenCalledTimes(3);
    // Stripe's form was never created.
    expect(STRIPE.createEmbeddedCheckoutPage).not.toHaveBeenCalled();
    expect(getStripe).not.toHaveBeenCalled();
  });

  it("asks only by GET, whatever happens", async () => {
    getOrderPayment.mockResolvedValueOnce(OPEN_SEATED).mockResolvedValue({ status: "processing", delayed: true });
    render(<CheckoutPayment />);
    await formMounted();
    await act(async () => {
      window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true }));
    });
    await waitFor(() => expect(replace).toHaveBeenCalled());
    noWrites();
  });
});

const MIN = 60_000;
const countdown = () => document.querySelector<HTMLElement>("[data-countdown]");
const announcer = () => document.querySelector<HTMLElement>("[data-countdown-announcer]");

describe("CheckoutPayment: the countdown (15 minutes to pay)", () => {
  it("says the time left as mm:ss above Stripe's form, ticking down; the ticking text isn't announced", async () => {
    vi.useFakeTimers();
    getOrderPayment.mockResolvedValue(openFor(14 * MIN + 32_000));
    render(<CheckoutPayment />);
    await advance(0);
    expect(stripeFrame()).not.toBeNull();
    const clock = countdown();
    expect(clock).toHaveTextContent("Complete your order in 14:32");
    expect(within(clock as HTMLElement).getByText("14:32")).toHaveClass("tabular-nums");
    // Near the top of the form: before the details notice and Stripe's slot, and kept in view while paying.
    const slot = document.querySelector("[data-payment-slot]");
    expect(clock?.compareDocumentPosition(slot as Node)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    expect(clock?.parentElement).toHaveClass("sticky", "bg-background");
    // Not a live region, nor inside one: screen readers aren't told every second.
    expect(clock?.closest("[aria-live], [role=status], [role=alert], [role=timer]")).toBeNull();
    expect(announcer()).toHaveAttribute("aria-live", "polite");
    expect(announcer()).toBeEmptyDOMElement();
    // No animation, so nothing to stop for reduced motion.
    expect(clock?.outerHTML).not.toMatch(/animate-|transition/);

    await advance(1_000);
    expect(countdown()).toHaveTextContent("Complete your order in 14:31");
    await advance(60_000);
    expect(countdown()).toHaveTextContent("Complete your order in 13:31");
    expect(announcer()).toBeEmptyDOMElement();
  });

  it.each([
    ["10 minutes behind", -10 * MIN],
    ["7 minutes ahead", 7 * MIN],
  ])("a device clock %s still counts down to the server's deadline", async (_name, skewMs) => {
    vi.useFakeTimers();
    getOrderPayment.mockResolvedValue(openFor(14 * MIN + 32_000, { skewMs: -skewMs }));
    render(<CheckoutPayment />);
    await advance(0);
    expect(countdown()).toHaveTextContent("Complete your order in 14:32");
    await advance(14 * MIN + 31_999);
    expect(countdown()).toHaveTextContent("Complete your order in 00:01");
    expect(stripeFrame()).not.toBeNull();
    await advance(1);
    expect(screen.getByRole("heading", { level: 1, name: "Time’s up" })).toBeInTheDocument();
  });

  it("turns orange with a clock icon in the last 2 minutes (not by colour alone)", async () => {
    vi.useFakeTimers();
    getOrderPayment.mockResolvedValue(openFor(2 * MIN + 1_000));
    render(<CheckoutPayment />);
    await advance(0);
    expect(countdown()).toHaveTextContent("Complete your order in 02:01");
    expect(countdown()).not.toHaveAttribute("data-urgent");
    expect(countdown()).toHaveClass("border-foreground", "bg-card", "text-foreground");
    expect(countdown()?.querySelector("svg")).toBeNull();

    await advance(1_000);
    expect(countdown()).toHaveTextContent("Complete your order in 02:00");
    expect(countdown()).toHaveAttribute("data-urgent", "true");
    // --signal-ink on --tint: 6.4:1 Light, 7.1:1 Dark (small text needs 4.5:1).
    expect(countdown()).toHaveClass("border-signal-ink", "bg-tint", "text-signal-ink", "font-semibold");
    expect(countdown()).not.toHaveClass("text-foreground");
    const icon = countdown()?.querySelector("svg");
    expect(icon).not.toBeNull();
    expect(icon).toHaveAttribute("aria-hidden", "true");
  });

  it("tells screen readers only at 5:00, 1:00 and time's up", async () => {
    vi.useFakeTimers();
    getOrderPayment
      .mockResolvedValueOnce(openFor(5 * MIN + 2_000))
      .mockResolvedValue({ status: "closed", reason: "time_up", eventTitle: "Neon Static", eventSlug: "neon-static", seated: false });
    render(<CheckoutPayment />);
    await advance(0);
    expect(announcer()).toBeEmptyDOMElement();
    await advance(1_000);
    expect(countdown()).toHaveTextContent("05:01");
    expect(announcer()).toBeEmptyDOMElement();
    await advance(1_000);
    expect(countdown()).toHaveTextContent("05:00");
    expect(announcer()).toHaveTextContent("5 minutes left to complete your order.");
    await advance(2 * MIN);
    expect(announcer()).toHaveTextContent("5 minutes left to complete your order.");
    await advance(2 * MIN - 1_000);
    expect(countdown()).toHaveTextContent("01:01");
    expect(announcer()).toHaveTextContent("5 minutes left to complete your order.");
    await advance(1_000);
    expect(announcer()).toHaveTextContent("1 minute left to complete your order.");
    await advance(MIN);
    // The same region, still there with the time's-up panel.
    expect(screen.getByRole("heading", { level: 1, name: "Time’s up" })).toBeInTheDocument();
    expect(announcer()).toHaveTextContent("Time’s up. You haven’t been charged.");
    expect(document.querySelectorAll("[data-countdown-announcer]")).toHaveLength(1);
  });

  it("arriving with less than 5 minutes left says nothing until 1:00", async () => {
    vi.useFakeTimers();
    getOrderPayment.mockResolvedValue(openFor(3 * MIN));
    render(<CheckoutPayment />);
    await advance(0);
    await advance(MIN);
    expect(announcer()).toBeEmptyDOMElement();
    await advance(MIN);
    expect(announcer()).toHaveTextContent("1 minute left to complete your order.");
  });

  it("at zero: Stripe's form goes, the time's-up panel with Start again to the event's tickets, focus on its h1", async () => {
    vi.useFakeTimers();
    getOrderPayment.mockResolvedValueOnce(openFor(30_000)).mockReturnValue(new Promise(() => undefined));
    render(<CheckoutPayment />);
    await advance(0);
    expect(stripeFrame()).not.toBeNull();
    await advance(30_000);
    const h1 = screen.getByRole("heading", { level: 1, name: "Time’s up" });
    expect(h1).toHaveFocus();
    expect(h1).toHaveClass("focus:outline-none!");
    expect(screen.getByText("Your order wasn’t placed and you haven’t been charged.")).toBeInTheDocument();
    const again = screen.getByRole("link", { name: "Start again" });
    expect(again).toHaveAttribute("href", "/events/neon-static#tickets");
    expect(again).toHaveClass("btn-solid", "btn-lg");
    // Stripe's form isn't left mounted: its instance is destroyed, and the summary and countdown are gone.
    expect(stripeFrame()).toBeNull();
    expect(document.querySelector("[data-payment-slot]")).toBeNull();
    expect(fake.instances[0].destroy).toHaveBeenCalledTimes(1);
    expect(countdown()).toBeNull();
    expect(screen.queryByText("Total")).toBeNull();
    noWrites();
  });

  it("seated at zero: says the seats were released, and Start again goes to the event's tickets", async () => {
    vi.useFakeTimers();
    getOrderPayment.mockResolvedValueOnce(openFor(10_000, { base: OPEN_SEATED })).mockReturnValue(new Promise(() => undefined));
    render(<CheckoutPayment />);
    await advance(0);
    expect(countdown()).toHaveTextContent("Complete your order in 00:10");
    await advance(10_000);
    expect(screen.getByRole("heading", { level: 1, name: "Time’s up" })).toHaveFocus();
    expect(
      screen.getByText("Your order wasn’t placed and you haven’t been charged. Your seats have been released."),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Start again" })).toHaveAttribute("href", "/events/off-kilter#tickets");
    expect(stripeFrame()).toBeNull();
  });

  it("Stripe took the payment in time: the re-read after zero goes to the order", async () => {
    vi.useFakeTimers();
    getOrderPayment.mockResolvedValueOnce(openFor(5_000)).mockResolvedValue({ status: "processing", delayed: false });
    render(<CheckoutPayment />);
    await advance(0);
    await advance(5_000);
    expect(screen.getByRole("heading", { level: 1, name: "Time’s up" })).toBeInTheDocument();
    await advance(1_000);
    expect(replace).toHaveBeenCalledWith(`/checkout/success?session_id=${ORDER_ID}`);
  });

  it("after zero, a late open answer never brings the form back", async () => {
    vi.useFakeTimers();
    getOrderPayment
      .mockResolvedValueOnce(openFor(5_000))
      // The re-read: still open by the server's clock for 2 s more (a slow answer).
      .mockImplementationOnce(async () => openFor(2_000))
      .mockRejectedValue(new TypeError("Failed to fetch"));
    render(<CheckoutPayment />);
    await advance(0);
    await advance(5_000);
    expect(getOrderPayment).toHaveBeenCalledTimes(1);
    await advance(1_000);
    expect(getOrderPayment).toHaveBeenCalledTimes(2);
    expect(screen.getByRole("heading", { level: 1, name: "Time’s up" })).toBeInTheDocument();
    expect(stripeFrame()).toBeNull();
    // Asked again no sooner than 5 s.
    await advance(4_999);
    expect(getOrderPayment).toHaveBeenCalledTimes(2);
    await advance(1);
    expect(getOrderPayment).toHaveBeenCalledTimes(3);
    expect(screen.queryByRole("alert")).toBeNull();
    expect(stripeFrame()).toBeNull();
    expect(STRIPE.createEmbeddedCheckoutPage).toHaveBeenCalledTimes(1);
  });

  it("after zero, a failed re-read never keeps saying 'not charged': unconfirmed, asked again every 10 s at most 3 times; a later time_up brings time's up back", async () => {
    vi.useFakeTimers();
    const timeUp = { status: "closed", reason: "time_up", eventTitle: "Neon Static", eventSlug: "neon-static", seated: false } as const;
    getOrderPayment
      .mockResolvedValueOnce(openFor(5_000))
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockResolvedValueOnce(timeUp);
    render(<CheckoutPayment />);
    await advance(0);
    await advance(5_000);
    expect(screen.getByRole("heading", { level: 1, name: "Time’s up" })).toBeInTheDocument();
    // The re-read 1 s after the deadline fails: we can't say whether Stripe took a last-second payment.
    await advance(1_000);
    expect(getOrderPayment).toHaveBeenCalledTimes(2);
    expect(screen.getByRole("heading", { level: 1, name: "We couldn’t confirm your payment" })).toBeInTheDocument();
    expect(screen.queryByText(/haven’t been charged/)).toBeNull();
    await advance(9_999);
    expect(getOrderPayment).toHaveBeenCalledTimes(2);
    await advance(1);
    expect(getOrderPayment).toHaveBeenCalledTimes(3);
    expect(screen.getByRole("heading", { level: 1, name: "We couldn’t confirm your payment" })).toBeInTheDocument();
    // Then the server answers: closed, time's up (nothing was paid).
    await advance(10_000);
    expect(getOrderPayment).toHaveBeenCalledTimes(4);
    expect(screen.getByRole("heading", { level: 1, name: "Time’s up" })).toBeInTheDocument();
    expect(stripeFrame()).toBeNull();
  });

  it("a time's up the server confirmed stays when a later read fails (a back/forward restore)", async () => {
    getOrderPayment
      .mockResolvedValueOnce({ status: "closed", reason: "time_up", eventTitle: "Neon Static", eventSlug: "neon-static", seated: false })
      .mockRejectedValue(new TypeError("Failed to fetch"));
    render(<CheckoutPayment />);
    await screen.findByRole("heading", { level: 1, name: "Time’s up" });
    await act(async () => {
      window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true }));
    });
    await waitFor(() => expect(getOrderPayment).toHaveBeenCalledTimes(2));
    expect(screen.getByRole("heading", { level: 1, name: "Time’s up" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { level: 1, name: "We couldn’t confirm your payment" })).toBeNull();
  });

  it("after zero, reads that keep failing stop after 3 more tries, on the unconfirmed panel", async () => {
    vi.useFakeTimers();
    getOrderPayment.mockResolvedValueOnce(openFor(5_000)).mockRejectedValue(new TypeError("Failed to fetch"));
    render(<CheckoutPayment />);
    await advance(0);
    await advance(5_000);
    await advance(1_000);
    expect(getOrderPayment).toHaveBeenCalledTimes(2);
    for (let i = 0; i < 3; i += 1) await advance(10_000);
    expect(getOrderPayment).toHaveBeenCalledTimes(5);
    await advance(60_000);
    expect(getOrderPayment).toHaveBeenCalledTimes(5);
    expect(screen.getByRole("heading", { level: 1, name: "We couldn’t confirm your payment" })).toBeInTheDocument();
  });

  it("unconfirmed after zero: replaces time's up (never 'not charged'), asks again every 10 s, and goes to the order once Stripe has it", async () => {
    vi.useFakeTimers();
    const unconfirmed = { status: "closed", reason: "unconfirmed", eventTitle: "Neon Static", eventSlug: "neon-static", seated: false } as const;
    getOrderPayment
      .mockResolvedValueOnce(openFor(5_000))
      .mockResolvedValueOnce(unconfirmed)
      .mockResolvedValueOnce(unconfirmed)
      .mockResolvedValue({ status: "processing", delayed: false });
    render(<CheckoutPayment />);
    await advance(0);
    await advance(5_000);
    expect(screen.getByRole("heading", { level: 1, name: "Time’s up" })).toBeInTheDocument();
    await advance(1_000);
    const h1 = screen.getByRole("heading", { level: 1, name: "We couldn’t confirm your payment" });
    expect(h1).toHaveFocus();
    expect(screen.getByText("Check your email for tickets before trying again.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Back to the event" })).toHaveAttribute("href", "/events/neon-static");
    // Nothing on the page, or left in the live region, says the buyer wasn't charged.
    expect(document.body.textContent).not.toMatch(/haven’t been charged/);
    expect(announcer()).toBeEmptyDOMElement();
    expect(stripeFrame()).toBeNull();
    expect(getOrderPayment).toHaveBeenCalledTimes(2);
    await advance(10_000);
    expect(getOrderPayment).toHaveBeenCalledTimes(3);
    expect(screen.getByRole("heading", { level: 1, name: "We couldn’t confirm your payment" })).toBeInTheDocument();
    await advance(10_000);
    expect(replace).toHaveBeenCalledWith(`/checkout/success?session_id=${ORDER_ID}`);
  });

  it("unconfirmed: asked again at most 3 times, then left; a later time's up answer says time's up", async () => {
    vi.useFakeTimers();
    const unconfirmed = { status: "closed", reason: "unconfirmed", eventTitle: "Neon Static", eventSlug: "neon-static", seated: false } as const;
    getOrderPayment.mockResolvedValue(unconfirmed);
    render(<CheckoutPayment />);
    await advance(0);
    expect(screen.getByRole("heading", { level: 1, name: "We couldn’t confirm your payment" })).toBeInTheDocument();
    for (let i = 0; i < 5; i++) await advance(10_000);
    expect(getOrderPayment).toHaveBeenCalledTimes(4);
    expect(STRIPE.createEmbeddedCheckoutPage).not.toHaveBeenCalled();

    // Once the server has closed it for good (Stripe answered), a re-read (back/forward) says time's up.
    getOrderPayment.mockResolvedValue({ ...unconfirmed, reason: "time_up" });
    await act(async () => {
      window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true }));
    });
    await advance(0);
    expect(screen.getByRole("heading", { level: 1, name: "Time’s up" })).toBeInTheDocument();
  });

  it("a device that slept past the deadline: on waking, time's up straight away and the server is asked again", async () => {
    vi.useFakeTimers();
    getOrderPayment
      .mockResolvedValueOnce(openFor(10 * MIN))
      .mockResolvedValue({ status: "closed", reason: "time_up", eventTitle: "Neon Static", eventSlug: "neon-static", seated: false });
    render(<CheckoutPayment />);
    await advance(0);
    expect(countdown()).toHaveTextContent("10:00");
    // Asleep: the clock moves on, but no timer runs (as on a suspended phone).
    vi.setSystemTime(Date.now() + 3 * MIN);
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    // Worked out from the deadline, not by counting ticks.
    expect(countdown()).toHaveTextContent("07:00");
    expect(getOrderPayment).toHaveBeenCalledTimes(1);

    vi.setSystemTime(Date.now() + 20 * MIN);
    await act(async () => {
      window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: false }));
    });
    expect(screen.getByRole("heading", { level: 1, name: "Time’s up" })).toHaveFocus();
    expect(stripeFrame()).toBeNull();
    // Only the latest moment passed is said.
    expect(announcer()).toHaveTextContent("Time’s up. You haven’t been charged.");
    await advance(0);
    expect(getOrderPayment).toHaveBeenCalledTimes(2);
  });

  it("closed with time's up on arrival: the panel, focus on its h1, and Stripe's form never created", async () => {
    getOrderPayment.mockResolvedValue({ status: "closed", reason: "time_up", eventTitle: "Off-Kilter", eventSlug: "off-kilter", seated: true });
    render(<CheckoutPayment />);
    const h1 = await screen.findByRole("heading", { level: 1, name: "Time’s up" });
    // Focused by an effect just after the panel is drawn.
    await waitFor(() => expect(h1).toHaveFocus());
    expect(screen.getByRole("link", { name: "Start again" })).toHaveAttribute("href", "/events/off-kilter#tickets");
    expect(getStripe).not.toHaveBeenCalled();
    expect(STRIPE.createEmbeddedCheckoutPage).not.toHaveBeenCalled();
    expect(countdown()).toBeNull();
    // Nothing announced: the panel arrived as the page, not at the end of a countdown.
    expect(announcer()).toBeEmptyDOMElement();
  });

  it("unavailable on arrival: says the event isn't taking bookings, with focus on the h1", async () => {
    getOrderPayment.mockResolvedValue({ status: "closed", reason: "unavailable", eventTitle: "Neon Static", eventSlug: "neon-static", seated: false });
    render(<CheckoutPayment />);
    const h1 = await screen.findByRole("heading", { level: 1, name: "This checkout has closed" });
    await waitFor(() => expect(h1).toHaveFocus());
    expect(screen.getByText("This event isn’t taking bookings right now. You haven’t been charged.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Back to the event" })).toHaveAttribute("href", "/events/neon-static");
  });

  it("unavailable while open (a back/forward restore): the form goes, and focus moves to the h1", async () => {
    getOrderPayment
      .mockResolvedValueOnce(openFor(10 * MIN))
      .mockResolvedValue({ status: "closed", reason: "unavailable", eventTitle: "Neon Static", eventSlug: "neon-static", seated: false });
    render(<CheckoutPayment />);
    await formMounted();
    await act(async () => {
      window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true }));
    });
    expect(await screen.findByText("This event isn’t taking bookings right now. You haven’t been charged.")).toBeInTheDocument();
    await waitFor(() => expect(heading()).toHaveFocus());
    expect(stripeFrame()).toBeNull();
  });

  it("an older response without serverTime counts by this device's clock, never showing more than 15:00", async () => {
    vi.useFakeTimers();
    // OPEN_GA's expiresAt is months away and it has no serverTime.
    getOrderPayment.mockResolvedValue(OPEN_GA);
    render(<CheckoutPayment />);
    await advance(0);
    expect(countdown()).toHaveTextContent("Complete your order in 15:00");
    expect(stripeFrame()).not.toBeNull();
  });
});
