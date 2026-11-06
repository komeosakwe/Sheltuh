// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import EventDetailsView from "@/components/EventDetailsView";
import { sampleEvents } from "@/lib/sample-events";
import type { SheltuhEvent } from "@/lib/types";
import { SOFT_KEYBOARD_MIN_PX } from "@/lib/use-soft-keyboard";
import { FakeAuthProvider, fakeAuthValue } from "./test-utils/fakeAuth";
import { typeName } from "./test-utils/buyerName";
import { selectCard } from "./test-utils/ticketCards";

/**
 * The event page's phone buy bar as the one Checkout for a general admission event (owner, 6 Nov 2026):
 * it presses the ticket selector's own submit, shows the same total as the Order summary, and tells the
 * buyer what's missing instead of sitting disabled.
 */

// Live mode: checkout is only offered when the API is configured.
vi.mock("@/lib/api/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api/client")>()),
  isApiConfigured: true,
}));
const createCheckoutSession = vi.fn();
vi.mock("@/lib/api/orders", () => ({
  createCheckoutSession: (...args: unknown[]) => createCheckoutSession(...args),
}));
// Who's Going's own loads (a live event page makes them): nothing here is about them.
vi.mock("@/lib/api/going", () => ({
  getGoingSummary: vi.fn().mockResolvedValue({ count: 0, closed: true, countHidden: false }),
  getMyGoingStatus: vi.fn().mockResolvedValue({ going: false }),
  listGoingAttendees: vi.fn().mockResolvedValue({ attendees: [] }),
  setGoing: vi.fn(),
  unsetGoing: vi.fn(),
}));

// The sample events are dated Sept–Dec 2026, and an ended event has no buy bar: read them before then.
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-09-01T00:00:00.000Z"));
});
afterEach(() => {
  cleanup();
  createCheckoutSession.mockReset();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function live(slug: string, patch: Partial<SheltuhEvent> = {}): SheltuhEvent {
  const event = sampleEvents.find((e) => e.slug === slug);
  if (!event) throw new Error(`Fixture event not found: ${slug}`);
  return { ...event, organiserId: "org-1", ...patch };
}

function bar(): HTMLElement {
  const element = document.querySelector<HTMLElement>("[data-buy-bar]");
  if (!element) throw new Error("buy bar not rendered");
  return element;
}

/** The Order summary's total, as read from its own row. */
function summaryTotal(): string {
  return screen.getByText("Total").nextElementSibling?.textContent ?? "";
}

/** The bar's amount, the first line of its text. */
function barAmount(): string {
  return bar().querySelector("p")?.textContent ?? "";
}

const more = (name: string) => screen.getByRole("button", { name: `Increase quantity for ${name}` });
const less = (name: string) => screen.getByRole("button", { name: `Decrease quantity for ${name}` });

describe("the buy bar before anything is chosen", () => {
  it("keeps the 'From' price and is a link to the tickets, not a disabled button", () => {
    render(<EventDetailsView event={live("neon-static")} demo={false} />);
    expect(within(bar()).getByText("From A$32.30")).toBeInTheDocument();
    const link = within(bar()).getByRole("link", { name: "Buy tickets" });
    expect(link).toHaveAttribute("href", "#tickets");
    expect(within(bar()).queryByRole("button")).toBeNull();
  });

  it("is the page's only Buy tickets / Checkout action below lg: the panel's Checkout is hidden there but stays for desktop", () => {
    render(<EventDetailsView event={live("neon-static")} demo={false} />);
    const checkout = screen.getByRole("button", { name: "Checkout" });
    expect(checkout).toHaveClass("max-lg:hidden");
    expect(checkout).toBeDisabled();
  });
});

describe("the buy bar once tickets are chosen", () => {
  it("shows the order total and presses the same checkout as the panel, with the same request", async () => {
    createCheckoutSession.mockReturnValue(new Promise(() => {}));
    render(
      <FakeAuthProvider value={fakeAuthValue({ email: "mia@example.com" })}>
        <EventDetailsView event={live("neon-static")} demo={false} />
      </FakeAuthProvider>,
    );
    fireEvent.click(more("General admission"));
    typeName();
    const button = within(bar()).getByRole("button", { name: "Buy tickets" });
    expect(within(bar()).queryByRole("link")).toBeNull();
    expect(barAmount()).toBe("A$32.30");
    expect(within(bar()).getByText("incl. booking fee")).toBeInTheDocument();
    expect(button).toHaveClass("btn-signal");

    await act(async () => {
      fireEvent.click(button);
    });
    expect(createCheckoutSession).toHaveBeenCalledTimes(1);
    const fromBar = createCheckoutSession.mock.calls[0];
    expect(fromBar).toEqual([
      expect.any(String),
      [{ ticketTypeId: expect.any(String), quantity: 1 }],
      "mia@example.com",
      undefined,
      undefined,
      undefined,
      "Alex Doe",
    ]);

    // The panel's own Checkout sends exactly the same arguments.
    cleanup();
    createCheckoutSession.mockClear();
    render(
      <FakeAuthProvider value={fakeAuthValue({ email: "mia@example.com" })}>
        <EventDetailsView event={live("neon-static")} demo={false} />
      </FakeAuthProvider>,
    );
    fireEvent.click(more("General admission"));
    typeName();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Checkout" }));
    });
    expect(createCheckoutSession.mock.calls[0]).toEqual(fromBar);
  });

  it("its total is the Order summary's total at every step: quantities, a second tier, back to nothing", () => {
    render(<EventDetailsView event={live("neon-static")} demo={false} />);
    const steps: Array<() => void> = [
      () => fireEvent.click(more("General admission")),
      () => fireEvent.click(more("General admission")),
      () => selectCard("VIP (side-of-stage viewing)"),
      () => {
        selectCard("General admission");
        fireEvent.click(less("General admission"));
      },
    ];
    for (const step of steps) {
      step();
      expect(barAmount()).toBe(summaryTotal());
    }
    expect(barAmount()).toBe("A$87.30");
    fireEvent.click(less("General admission"));
    selectCard("VIP (side-of-stage viewing)");
    fireEvent.click(less("VIP (side-of-stage viewing)"));
    // Nothing chosen again: back to the link and the "From" price.
    expect(within(bar()).getByRole("link", { name: "Buy tickets" })).toBeInTheDocument();
    expect(barAmount()).toBe("From A$32.30");
  });

  it("matches the summary for group tiers (groups of people priced as the server does)", () => {
    const base = live("neon-static");
    const event: SheltuhEvent = {
      ...base,
      ticketTypes: [
        { id: "single", name: "Single", priceCents: 3500, feePolicy: "buyer-pays", quantityAvailable: 50 },
        { id: "group", name: "Group of 4", priceCents: 12000, feePolicy: "buyer-pays", quantityAvailable: 40, admits: 4 },
      ],
    };
    render(<EventDetailsView event={event} demo={false} />);
    selectCard("Group of 4");
    expect(barAmount()).toBe("A$127.70");
    fireEvent.click(more("Group of 4"));
    selectCard("Single");
    expect(barAmount()).toBe(summaryTotal());
    expect(barAmount()).toBe("A$293.00");
  });

  it("a free booking: the total is A$0 with no booking fee, and the button reads Free tickets", async () => {
    createCheckoutSession.mockReturnValue(new Promise(() => {}));
    render(
      <FakeAuthProvider value={fakeAuthValue({ email: "mia@example.com" })}>
        <EventDetailsView event={live("brunswick-zine-fair")} demo={false} />
      </FakeAuthProvider>,
    );
    fireEvent.click(more("Free entry"));
    expect(barAmount()).toBe("A$0.00");
    expect(barAmount()).toBe(summaryTotal());
    expect(within(bar()).getByText("No booking fee")).toBeInTheDocument();
    typeName();
    await act(async () => {
      fireEvent.click(within(bar()).getByRole("button", { name: "Free tickets" }));
    });
    expect(createCheckoutSession).toHaveBeenCalledTimes(1);
  });

  it("includes Support Sheltüh in the bar's total, as the summary does, and says so", () => {
    // Support Sheltüh is switched off by default (lib/support.ts): without it, the bar says only the booking fee.
    render(<EventDetailsView event={live("neon-static")} demo={false} />);
    fireEvent.click(more("General admission"));
    expect(barAmount()).toBe(summaryTotal());
    expect(within(bar()).getByText("incl. booking fee")).toBeInTheDocument();
  });
});

describe("pressing the bar with the name missing", () => {
  it("focuses the name field and says 'Enter your name.', sending nothing", () => {
    render(<EventDetailsView event={live("neon-static")} demo={false} />);
    fireEvent.click(more("General admission"));
    fireEvent.click(within(bar()).getByRole("button", { name: "Buy tickets" }));
    const field = screen.getByLabelText("Your name");
    expect(field).toHaveFocus();
    expect(field).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByRole("alert")).toHaveTextContent("Enter your name.");
    expect(createCheckoutSession).not.toHaveBeenCalled();
    // It stays a working button (never hard-disabled for a reason the buyer can't see).
    expect(within(bar()).getByRole("button", { name: "Buy tickets" })).not.toHaveAttribute("aria-disabled", "true");
  });

  it("Enter in the name field closes the keyboard (blurs it), so the bar can return", () => {
    render(<EventDetailsView event={live("neon-static")} demo={false} />);
    const field = screen.getByLabelText("Your name");
    field.focus();
    expect(field).toHaveFocus();
    expect(field).toHaveAttribute("enterkeyhint", "done");
    fireEvent.keyDown(field, { key: "Enter" });
    expect(field).not.toHaveFocus();
  });
});

describe("while it works", () => {
  it("says it's opening checkout, is busy, ignores another tap, and recovers (with the error shown) on failure", async () => {
    let reject: (err: unknown) => void = () => {};
    createCheckoutSession.mockReturnValue(new Promise((_, r) => (reject = r)));
    render(<EventDetailsView event={live("neon-static")} demo={false} />);
    fireEvent.click(more("General admission"));
    typeName();
    const button = within(bar()).getByRole("button", { name: "Buy tickets" });
    button.focus();
    fireEvent.click(button);
    fireEvent.click(button);
    fireEvent.click(screen.getByRole("button", { name: /Opening checkout/ }));
    expect(createCheckoutSession).toHaveBeenCalledTimes(1);
    const busy = within(bar()).getByRole("button", { name: "Opening…" });
    expect(busy).toHaveAttribute("aria-busy", "true");
    expect(busy).toHaveAttribute("aria-disabled", "true");
    expect(busy).toHaveFocus();

    await act(async () => reject(new Error("Those tickets just sold out.")));
    expect(screen.getByRole("alert")).toHaveTextContent("Those tickets just sold out.");
    const again = within(bar()).getByRole("button", { name: "Buy tickets" });
    expect(again).not.toHaveAttribute("aria-busy");
    expect(again).toHaveFocus();
  });
});

describe("sold-out and waiting releases, and the steppers' limits", () => {
  /** A first release sold out, a second on sale (a few left), a third waiting for the second. */
  function released(): SheltuhEvent {
    const event = live("cinder-warehouse-sessions");
    const [first, second, third] = event.ticketTypes;
    return {
      ...event,
      ticketTypes: [
        { ...first, soldOut: true, remaining: 0 },
        { ...second, opensAfter: undefined, opensAfterPrevious: undefined, remaining: 3 },
        third,
      ],
    };
  }

  it("a sold-out release is a muted card with a Sold out badge and no stepper, and can't be chosen", () => {
    render(<EventDetailsView event={released()} demo={false} />);
    const card = screen.getByText("First release").closest("li") as HTMLElement;
    expect(card).toHaveClass("bg-surface");
    expect(within(card).getByText("Sold out")).toBeInTheDocument();
    expect(within(card).queryByRole("group")).toBeNull();
    expect(within(card).queryByRole("button")).toBeNull();
    expect(screen.queryByRole("button", { name: "Increase quantity for First release" })).toBeNull();
    // A tier waiting for the one above is muted the same way.
    const waiting = screen.getByText("Final release").closest("li") as HTMLElement;
    expect(waiting).toHaveClass("bg-surface");
    expect(within(waiting).getByText("Opens after Second release")).toBeInTheDocument();
    expect(within(waiting).queryByRole("button")).toBeNull();
  });

  it("the chosen release gets the orange border; nothing else does", () => {
    render(<EventDetailsView event={released()} demo={false} />);
    const second = screen.getByText("Second release").closest("li") as HTMLElement;
    expect(second).not.toHaveClass("border-signal");
    fireEvent.click(more("Second release"));
    expect(second).toHaveClass("border-signal");
    expect(screen.getByText("First release").closest("li")).not.toHaveClass("border-signal");
  });

  it("the stepper stops at what's left: minus at 0 and plus at the cap are aria-disabled, and the bar follows", () => {
    render(<EventDetailsView event={released()} demo={false} />);
    const minus = less("Second release");
    const plus = more("Second release");
    expect(minus).toHaveAttribute("aria-disabled", "true");
    expect(plus).toHaveAttribute("aria-disabled", "false");
    for (let i = 0; i < 5; i++) fireEvent.click(plus);
    expect(screen.getByRole("group", { name: "Quantity for Second release" })).toHaveTextContent("3");
    expect(plus).toHaveAttribute("aria-disabled", "true");
    expect(within(screen.getByRole("region", { name: "Select your tickets" })).getByRole("status")).toHaveTextContent("Second release: 3. Only 3 left.");
    expect(barAmount()).toBe("A$112.80");
    // 44px targets.
    expect(plus).toHaveClass("h-12", "w-14");
    expect(minus).toHaveClass("h-12", "w-14");
    fireEvent.click(minus);
    fireEvent.click(minus);
    fireEvent.click(minus);
    fireEvent.click(minus);
    expect(minus).toHaveAttribute("aria-disabled", "true");
    expect(screen.getByRole("group", { name: "Quantity for Second release" })).toHaveTextContent("0");
  });
});

describe("release cards and the one quantity stepper below them (owner's mockup, 6 Nov 2026)", () => {
  it("each release is a compact card: uppercase name, bold amount, and a status pill (Available only when it's on sale)", () => {
    const event = live("cinder-warehouse-sessions");
    const [first, second, third] = event.ticketTypes;
    render(
      <EventDetailsView
        event={{ ...event, ticketTypes: [{ ...first, soldOut: true, remaining: 0 }, { ...second, opensAfter: undefined, opensAfterPrevious: undefined }, third] }}
        demo={false}
      />,
    );
    const cards = screen.getAllByRole("listitem").filter((li) => li.hasAttribute("data-ticket-card"));
    expect(cards).toHaveLength(3);
    expect(within(cards[0]).getByText("Sold out")).toHaveClass("rounded-full");
    expect(within(cards[1]).getByText("Available")).toHaveClass("rounded-full", "text-signal-ink");
    // A tier waiting on the one above shows its words, not Available.
    expect(within(cards[2]).queryByText("Available")).toBeNull();
    expect(within(cards[2]).getByText("Opens after Second release")).toBeInTheDocument();
    expect(within(cards[1]).getByText("Second release")).toHaveClass("uppercase", "font-bold");
  });

  it("the stepper is below the cards, with a Quantity label, and tapping a card moves it while every release keeps its count", () => {
    render(<EventDetailsView event={live("neon-static")} demo={false} />);
    const list = screen.getAllByRole("list").find((ul) => ul.querySelector("[data-ticket-card]"));
    if (!list) throw new Error("cards not rendered");
    const group = screen.getByRole("group", { name: "Quantity for General admission" });
    expect(list.contains(group)).toBe(false);
    expect(list.compareDocumentPosition(group) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByText("Quantity")).toBeInTheDocument();
    fireEvent.click(more("General admission"));
    fireEvent.click(more("General admission"));
    // Another card: the stepper is now its, the first card says what's chosen of it, the total is both.
    selectCard("VIP (side-of-stage viewing)");
    expect(screen.queryByRole("group", { name: "Quantity for General admission" })).toBeNull();
    expect(screen.getByRole("group", { name: "Quantity for VIP (side-of-stage viewing)" })).toHaveTextContent("1");
    expect(screen.getByText("2 selected")).toBeInTheDocument();
    expect(barAmount()).toBe("A$119.60");
    expect(barAmount()).toBe(summaryTotal());
    expect(screen.getByText("General admission").closest("li")).toHaveClass("border-signal", "bg-tint");
    expect(screen.getByText("VIP (side-of-stage viewing)").closest("button")).toHaveAttribute("aria-pressed", "true");
    selectCard("General admission");
    expect(screen.getByRole("group", { name: "Quantity for General admission" })).toHaveTextContent("2");
    expect(screen.getByText("1 selected")).toBeInTheDocument();
  });
});

describe("other events keep their own bar", () => {
  it("a sold-out event's bar stays the Join waitlist link", () => {
    const event = live("neon-static");
    render(
      <EventDetailsView
        event={{ ...event, soldOut: true, ticketTypes: event.ticketTypes.map((t) => ({ ...t, soldOut: true, remaining: 0 })) }}
        demo={false}
      />,
    );
    expect(within(bar()).getByRole("link", { name: "Join waitlist" })).toHaveAttribute("href", "#tickets");
    expect(within(bar()).queryByRole("button")).toBeNull();
  });

  it("the demo has no checkout, so the bar stays a link and the panel's button says why it's unavailable", () => {
    render(<EventDetailsView event={{ ...live("neon-static"), organiserId: undefined }} demo />);
    expect(within(bar()).getByRole("link", { name: "Buy tickets" })).toHaveAttribute("href", "#tickets");
    expect(screen.getByRole("button", { name: "Checkout unavailable in this demo" })).toBeDisabled();
  });
});

describe("the on-screen keyboard", () => {
  function stubViewport(height: number, scale = 1) {
    const listeners = new Set<() => void>();
    const viewport = {
      height,
      scale,
      addEventListener: (_: string, listener: () => void) => listeners.add(listener),
      removeEventListener: (_: string, listener: () => void) => listeners.delete(listener),
    };
    vi.stubGlobal("visualViewport", viewport);
    Object.defineProperty(window, "visualViewport", { configurable: true, value: viewport });
    return {
      resize(next: number) {
        viewport.height = next;
        act(() => listeners.forEach((listener) => listener()));
      },
    };
  }

  afterEach(() => {
    Reflect.deleteProperty(window, "visualViewport");
  });

  it("hides the bar (in place) while a text field has focus and the keyboard has shrunk the viewport, then brings it back", () => {
    const viewport = stubViewport(window.innerHeight);
    render(<EventDetailsView event={live("neon-static")} demo={false} />);
    expect(bar()).not.toHaveClass("invisible");
    const field = screen.getByLabelText("Your name");
    act(() => field.focus());
    // Focus alone (a hardware keyboard, no soft keyboard): the bar stays, so Tab still reaches it.
    expect(bar()).not.toHaveClass("invisible");
    viewport.resize(window.innerHeight - SOFT_KEYBOARD_MIN_PX - 100);
    expect(bar()).toHaveClass("invisible");
    act(() => field.blur());
    expect(bar()).not.toHaveClass("invisible");
  });

  it("never mistakes a pinch zoom for a keyboard", () => {
    const viewport = stubViewport(window.innerHeight, 2);
    render(<EventDetailsView event={live("neon-static")} demo={false} />);
    act(() => screen.getByLabelText("Your name").focus());
    viewport.resize(window.innerHeight / 2);
    expect(bar()).not.toHaveClass("invisible");
  });
});
