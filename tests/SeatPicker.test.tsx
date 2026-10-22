// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import SeatPicker from "@/components/seating/SeatPicker";
import { ApiError } from "@/lib/api/client";
import { SAMPLE_SEAT_MAPS } from "@/lib/sample-seat-maps";
import { sampleEvents } from "@/lib/sample-events";
import { encodeAvailability } from "@/lib/seating/availability";
import type { SeatMapTemplate } from "@/lib/seating/template";
import type { SheltuhEvent } from "@/lib/types";

const { createSeatedCheckout, getSeatAvailability, cancelPendingOrder } = vi.hoisted(() => ({
  createSeatedCheckout: vi.fn(),
  getSeatAvailability: vi.fn(),
  cancelPendingOrder: vi.fn(),
}));
vi.mock("@/lib/api/seating", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api/seating")>()),
  createSeatedCheckout,
  getSeatAvailability,
  cancelPendingOrder,
}));

const event = sampleEvents.find((e) => e.id === "evt-off-kilter") as SheltuhEvent;
const sample = SAMPLE_SEAT_MAPS["evt-off-kilter"];
const map = { version: sample.version, seatCount: sample.seatCount, template: sample.template };

/** jsdom has no matchMedia: answer the desktop query (≥1024px) as `desktop` says. */
function setViewport(desktop: boolean) {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: desktop && query.includes("min-width: 64rem"),
    media: query,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  })) as unknown as typeof window.matchMedia;
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-21T00:00:00.000Z"));
  window.sessionStorage.clear();
  HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement) {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close = function close(this: HTMLDialogElement) {
    this.removeAttribute("open");
  };
  createSeatedCheckout.mockReset();
  getSeatAvailability.mockReset();
  getSeatAvailability.mockImplementation(() => new Promise(() => {}));
  cancelPendingOrder.mockReset();
  setViewport(true);
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  Reflect.deleteProperty(window, "matchMedia");
});

function renderPicker(overrides: Partial<Parameters<typeof SeatPicker>[0]> = {}) {
  return render(<SeatPicker event={event} map={map} mode="demo" initialUnavailable={sample.unavailable} {...overrides} />);
}

const status = () => screen.getAllByRole("status").find((el) => el.className.includes("sr-only")) as HTMLElement;
const row = (name: string) => screen.getByRole("group", { name });
/** The List tab, with every section opened (with four sections, only the first starts open). */
function showList() {
  fireEvent.click(screen.getByRole("tab", { name: "List" }));
  for (const name of [/^East/, /^South/, /^West/]) {
    const header = screen.getByRole("button", { name });
    if (header.getAttribute("aria-expanded") === "false") fireEvent.click(header);
  }
}
/** The seats drawn on the map (not the legend's swatches). */
const mapSeat = (container: HTMLElement, selector = "") => container.querySelectorAll(`[role="img"] [data-seat]${selector}`);

describe("seat page: map and list are equivalent (docs/design/seating.md §7)", () => {
  it("shows every seat in both, with the same unavailable seats, and a choice in one shows in the other", () => {
    const { container } = renderPicker();
    expect(mapSeat(container)).toHaveLength(60);
    expect(mapSeat(container, '[data-state="unavailable"]')).toHaveLength(sample.unavailable.length);
    expect(screen.getByRole("img", { name: /^Seat map of The Esplanade Studio\. 43 seats available\./ })).toBeInTheDocument();

    showList();
    fireEvent.click(screen.getByLabelText("Available seats only"));
    const boxes = screen.getAllByRole("checkbox").filter((el) => el.hasAttribute("data-seat-id"));
    expect(boxes).toHaveLength(60);
    expect(boxes.filter((el) => (el as HTMLInputElement).disabled)).toHaveLength(sample.unavailable.length);
    expect(within(row("North, Row A")).getByRole("checkbox", { name: "Seat 3, unavailable" })).toBeDisabled();

    // Choose in the list: the map shows it chosen (orange with a check).
    fireEvent.click(within(row("North, Row A")).getByRole("checkbox", { name: "Seat 1, Full price, A$36.90 incl. booking fee" }));
    expect(status()).toHaveTextContent("Added North, Row A, Seat 1, A$36.90. 1 seat, total A$36.90 incl. booking fees.");
    fireEvent.click(screen.getByRole("tab", { name: "Map" }));
    const chosen = container.querySelector('[data-seat="N-A1"]');
    expect(chosen).toHaveAttribute("data-state", "selected");
    expect(chosen?.querySelector('[data-glyph="check"]')).not.toBeNull();

    // Choose on the map: the list shows it checked.
    fireEvent.click(container.querySelector('[data-seat="N-A2"] rect') as Element);
    showList();
    expect(within(row("North, Row A")).getByRole("checkbox", { name: /^Seat 2, Full price/ })).toBeChecked();
  }, 30_000); // Renders the full sample map twice (map + list); slow under parallel load, not a hang.

  it("keeps the tab for the session, and the arrow keys move between the tabs", () => {
    renderPicker();
    const mapTab = screen.getByRole("tab", { name: "Map" });
    expect(mapTab).toHaveAttribute("aria-selected", "true");
    mapTab.focus();
    fireEvent.keyDown(mapTab, { key: "ArrowRight" });
    expect(screen.getByRole("tab", { name: "List" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tab", { name: "List" })).toHaveFocus();
    expect(window.sessionStorage.getItem("sheltuh:seat-tab")).toBe("list");
    // Home and End go to the first and last tabs.
    fireEvent.keyDown(screen.getByRole("tab", { name: "List" }), { key: "Home" });
    expect(screen.getByRole("tab", { name: "Map" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tab", { name: "Map" })).toHaveFocus();
    fireEvent.keyDown(screen.getByRole("tab", { name: "Map" }), { key: "End" });
    expect(screen.getByRole("tab", { name: "List" })).toHaveFocus();
  });

  it("the skip link opens the list and moves focus to its first section", () => {
    renderPicker();
    fireEvent.click(screen.getByRole("link", { name: "Choose seats from a list" }));
    expect(screen.getByRole("tab", { name: "List" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("button", { name: /^North/ })).toHaveFocus();
  });
});

describe("seat page: limits and prompts (§5.8)", () => {
  it("refuses an 11th seat, leaves the box unchecked and says why", () => {
    renderPicker();
    showList();
    const boxes = screen.getAllByRole("checkbox", { name: /^Seat \d+, Full price/ });
    expect(boxes.length).toBeGreaterThan(10);
    boxes.slice(0, 10).forEach((box) => fireEvent.click(box));
    expect(boxes.slice(0, 10).every((box) => (box as HTMLInputElement).checked)).toBe(true);
    fireEvent.click(boxes[10]);
    expect(boxes[10]).not.toBeChecked();
    // Not disabled: nobody is stranded on a disabled control.
    expect(boxes[10]).toBeEnabled();
    expect(status()).toHaveTextContent("That’s 10 seats, the most for one order. Remove one to choose another.");
    expect(screen.getAllByText("That’s 10 seats, the most for one order. Remove one to choose another.").length).toBeGreaterThan(1);
  });

  it("asks before a wheelchair space, once per visit; Cancel leaves it unchosen", () => {
    renderPicker();
    showList();
    const westC = row("West, Row C");
    const space = within(westC).getByRole("checkbox", { name: "Seat 1, wheelchair space, Full price, A$36.90 incl. booking fee" });
    fireEvent.click(space);
    const dialog = screen.getByRole("dialog", { name: "Wheelchair space" });
    expect(dialog).toHaveTextContent("Book it only if you or someone in your group needs it.");
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(space).not.toBeChecked();
    fireEvent.click(space);
    fireEvent.click(within(screen.getByRole("dialog", { name: "Wheelchair space" })).getByRole("button", { name: "Choose this seat" }));
    expect(space).toBeChecked();
    // Asked once per kind: removing and choosing again doesn't ask.
    fireEvent.click(space);
    fireEvent.click(space);
    expect(space).toBeChecked();
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});

describe("seat page: summary (§5.10; ACCC all-inclusive prices)", () => {
  it("lists each seat's all-inclusive price, then tickets, fees and the total", () => {
    renderPicker();
    showList();
    fireEvent.click(within(row("North, Row A")).getByRole("checkbox", { name: /^Seat 1, / }));
    fireEvent.click(within(row("North, Row C")).getByRole("checkbox", { name: /^Seat 1, / }));
    const card = screen.getByRole("heading", { name: "Your seats" }).parentElement as HTMLElement;
    const lines = within(card).getAllByRole("listitem");
    expect(lines.map((li) => li.textContent)).toEqual([
      expect.stringContaining("North · Row A · Seat 1"),
      expect.stringContaining("North · Row C · Seat 1"),
    ]);
    expect(lines[0]).toHaveTextContent("Full price");
    expect(lines[0]).toHaveTextContent("A$36.90");
    expect(lines[1]).toHaveTextContent("Concession");
    expect(lines[1]).toHaveTextContent("A$26.50");
    // Each line's price includes its fee, and says so; the lines add up to the total.
    expect(within(lines[0]).getByText("incl. fee")).toBeInTheDocument();
    const totals = within(card).getByText("Total").closest("dl") as HTMLElement;
    // Face value + fees = total (the same total the lines add up to).
    expect(within(totals).getByText("Ticket face value")).toBeInTheDocument();
    expect(within(totals).getByText("A$60")).toBeInTheDocument();
    expect(within(totals).getByText("A$3.40")).toBeInTheDocument();
    expect(within(totals).getByText("A$63.40")).toHaveClass("text-xl", "font-bold");
    // Demo: checkout is off, and says so.
    expect(screen.getByRole("button", { name: "Checkout unavailable in this demo" })).toBeDisabled();
  });

  it("removing a seat moves focus to the next remove button, then to the heading", () => {
    renderPicker();
    showList();
    fireEvent.click(within(row("North, Row A")).getByRole("checkbox", { name: /^Seat 1, / }));
    fireEvent.click(within(row("North, Row A")).getByRole("checkbox", { name: /^Seat 2, / }));
    fireEvent.click(screen.getByRole("button", { name: "Remove North, Row A, Seat 1" }));
    expect(screen.getByRole("button", { name: "Remove North, Row A, Seat 2" })).toHaveFocus();
    expect(status()).toHaveTextContent("Removed North, Row A, Seat 1. 1 seat, total A$36.90 incl. booking fees.");
    fireEvent.click(screen.getByRole("button", { name: "Remove North, Row A, Seat 2" }));
    expect(screen.getByRole("heading", { name: "Your seats" })).toHaveFocus();
    expect(screen.getByText("No seats chosen yet. Choose up to 10 seats.")).toBeInTheDocument();
  });

  it("on phones the summary is a sheet opened from the seat bar, which takes focus", () => {
    setViewport(false);
    const { container } = renderPicker();
    expect(container.querySelector("[data-seat-bar]")).not.toBeNull();
    expect(screen.queryByRole("heading", { name: "Your seats" })).toBeNull();
    const toggle = screen.getByRole("button", { name: /No seats chosen/ });
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("heading", { name: "Your seats" })).toHaveFocus();
    fireEvent.keyDown(screen.getByRole("heading", { name: "Your seats" }), { key: "Escape" });
    expect(toggle).toHaveFocus();
    expect(toggle).toHaveAttribute("aria-expanded", "false");
  });

  it("Find seats replaces the selection with the best seats together, with Undo", () => {
    renderPicker();
    showList();
    fireEvent.click(within(row("East, Row B")).getByRole("checkbox", { name: /^Seat 1, / }));
    const find = screen.getByRole("region", { name: "Find seats" });
    fireEvent.click(within(find).getByRole("button", { name: "Find seats" }));
    expect(status()).toHaveTextContent("Found 2 seats together: North, Row A, Seats 1 and 2. They’re now your seats.");
    expect(within(row("North, Row A")).getByRole("checkbox", { name: /^Seat 2, / })).toBeChecked();
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    expect(within(row("East, Row B")).getByRole("checkbox", { name: /^Seat 1, / })).toBeChecked();
    expect(within(row("North, Row A")).getByRole("checkbox", { name: /^Seat 1, / })).not.toBeChecked();

    fireEvent.change(within(find).getByLabelText("How many"), { target: { value: "6" } });
    fireEvent.click(within(find).getByRole("button", { name: "Find seats" }));
    expect(within(find).getByText("No 6 seats together. Try fewer seats or any price.")).toBeInTheDocument();
  });
});

describe("seat page: checkout (§5.11)", () => {
  const live: SheltuhEvent = { ...event, organiserId: "org-1" };

  it("holds the chosen seats on the map version, and states the 30-minute hold first", async () => {
    createSeatedCheckout.mockReturnValue(new Promise(() => {}));
    renderPicker({ event: live, mode: "live" });
    expect(screen.getByText(/You’ll have 30 minutes; if you don’t finish, they’re released\./)).toBeInTheDocument();
    showList();
    fireEvent.click(within(row("North, Row A")).getByRole("checkbox", { name: /^Seat 2, / }));
    fireEvent.click(within(row("North, Row A")).getByRole("checkbox", { name: /^Seat 1, / }));
    fireEvent.click(screen.getByRole("button", { name: "Checkout" }));
    await waitFor(() => expect(createSeatedCheckout).toHaveBeenCalledTimes(1));
    const [eventId, input] = createSeatedCheckout.mock.calls[0];
    expect(eventId).toBe("evt-off-kilter");
    expect(input.seats).toEqual({ mapVersion: 1, seatIds: ["N-A2", "N-A1"] });
    expect(input.lineItems).toEqual([]);
    expect(screen.getByRole("button", { name: "Holding your seats…" })).toHaveAttribute("aria-disabled", "true");
  });

  it("seats taken meanwhile are removed and marked unavailable, an alert names them, and focus stays on Checkout", async () => {
    createSeatedCheckout.mockRejectedValue(
      new ApiError(409, "Some of those seats were just taken.", { seats: "Taken." }, { code: "seats_unavailable", seatIds: ["N-A1"] }),
    );
    const { container } = renderPicker({ event: live, mode: "live" });
    showList();
    fireEvent.click(within(row("North, Row A")).getByRole("checkbox", { name: /^Seat 1, / }));
    fireEvent.click(within(row("North, Row A")).getByRole("checkbox", { name: /^Seat 2, / }));
    const checkout = screen.getByRole("button", { name: "Checkout" });
    checkout.focus();
    await act(async () => {
      fireEvent.click(checkout);
    });
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(
      "Some seats were taken while you were choosing: North · Row A · Seat 1. We’ve removed them. Choose other seats, then press Checkout again.",
    );
    expect(checkout).toHaveFocus();
    expect(screen.queryByRole("button", { name: "Remove North, Row A, Seat 1" })).toBeNull();
    expect(screen.getByRole("button", { name: "Remove North, Row A, Seat 2" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("tab", { name: "Map" }));
    expect(container.querySelector('[data-seat="N-A1"]')).toHaveAttribute("data-state", "unavailable");
  });

  it("too many people checking out: a calm alert, nothing removed", async () => {
    createSeatedCheckout.mockRejectedValue(new ApiError(429, "Busy.", { seats: "Busy." }, { code: "hold_cap", seatIds: ["N-A1"] }));
    renderPicker({ event: live, mode: "live" });
    showList();
    fireEvent.click(within(row("North, Row A")).getByRole("checkbox", { name: /^Seat 1, / }));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Checkout" }));
    });
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "A lot of people are checking out for this event right now. Try again in a minute.",
    );
    expect(screen.getByRole("button", { name: "Remove North, Row A, Seat 1" })).toBeInTheDocument();
  });

  it("this visitor's own limit (429 client_rate_limited) is told apart from a busy event", async () => {
    createSeatedCheckout.mockRejectedValue(new ApiError(429, "Too many.", { seats: "Too many." }, { code: "client_rate_limited", seatIds: ["N-A1"] }));
    renderPicker({ event: live, mode: "live" });
    showList();
    fireEvent.click(within(row("North, Row A")).getByRole("checkbox", { name: /^Seat 1, / }));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Checkout" }));
    });
    expect(await screen.findByRole("alert")).toHaveTextContent("You’ve tried to hold seats a lot in a short time. Wait a few minutes and try again.");
  });

  it("preview: checkout is off and labelled as a preview", () => {
    renderPicker({ mode: "preview" });
    expect(screen.getByText("Preview · what buyers see")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Checkout is off in preview" })).toBeDisabled();
  });

  it("after the event has ended the map is read-only", () => {
    vi.setSystemTime(new Date("2026-12-01T00:00:00.000Z"));
    renderPicker();
    expect(screen.getByText(/Ticket sales for this event have ended\./)).toBeInTheDocument();
    showList();
    expect(within(row("North, Row A")).getByRole("checkbox", { name: /^Seat 1, / })).toBeDisabled();
  });
});

/** Availability as the API sends it, for the sample map. */
const availability = (unavailable: number[], version = sample.version) => ({
  eventId: event.id,
  version,
  seatCount: sample.seatCount,
  unavailable: encodeAvailability(sample.seatCount, unavailable),
});
const everySeat = Array.from({ length: sample.seatCount }, (_, i) => i);

describe("seat page: availability polling (§5.2)", () => {
  const live: SheltuhEvent = { ...event, organiserId: "org-1" };
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
    vi.setSystemTime(new Date("2026-10-21T00:00:00.000Z"));
  });

  it("pauses while checking out, so the buyer's own held seats never come back as “just taken”", async () => {
    getSeatAvailability.mockResolvedValue(availability(sample.unavailable));
    createSeatedCheckout.mockReturnValue(new Promise(() => {}));
    renderPicker({ event: live, mode: "live", poll: {} });
    await act(() => vi.advanceTimersByTimeAsync(10_000));
    expect(getSeatAvailability).toHaveBeenCalledTimes(1);
    showList();
    fireEvent.click(within(row("North, Row A")).getByRole("checkbox", { name: /^Seat 1, / }));
    // The seat is now held for this buyer: a poll would see it unavailable.
    getSeatAvailability.mockResolvedValue(availability([...sample.unavailable, 0]));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Checkout" }));
    });
    expect(createSeatedCheckout).toHaveBeenCalledTimes(1);
    await act(() => vi.advanceTimersByTimeAsync(60_000));
    expect(getSeatAvailability).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(/was just taken/)).toBeNull();
    expect(within(row("North, Row A")).getByRole("checkbox", { name: /^Seat 1, / })).toBeChecked();
  });

  it("every seat held but not sold out: no waitlist, held seats come back within 30 minutes, and polling carries on", async () => {
    getSeatAvailability.mockResolvedValue(availability(everySeat));
    renderPicker({ event: live, mode: "live", poll: {}, initialUnavailable: everySeat });
    expect(screen.getByText(/Every seat is held by people checking out right now\. Held seats come back within 30 minutes/)).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Join the waitlist" })).toBeNull();
    await act(() => vi.advanceTimersByTimeAsync(10_000));
    expect(getSeatAvailability).toHaveBeenCalledTimes(1);
    // A hold lapsed: the seats are back.
    getSeatAvailability.mockResolvedValue(availability(sample.unavailable));
    await act(() => vi.advanceTimersByTimeAsync(10_000));
    expect(getSeatAvailability).toHaveBeenCalledTimes(2);
    expect(screen.getByText("No seats chosen yet. Choose up to 10 seats.")).toBeInTheDocument();
  });

  it("every seat taken and the event sold out: the waitlist", () => {
    renderPicker({ event: { ...live, soldOut: true }, mode: "live", initialUnavailable: everySeat });
    expect(screen.getByText("Every seat is taken.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Join the waitlist" })).toHaveAttribute("href", `/events/${event.slug}#tickets`);
  });

  it("after three failed polls, says availability may be out of date in a polite live region", async () => {
    getSeatAvailability.mockRejectedValue(new Error("offline"));
    renderPicker({ event: live, mode: "live", poll: {} });
    const regions = screen.getAllByRole("status").filter((el) => !el.className.includes("sr-only"));
    expect(regions).toHaveLength(1);
    expect(regions[0]).toBeEmptyDOMElement();
    await act(() => vi.advanceTimersByTimeAsync(30_000));
    expect(regions[0]).toHaveTextContent("Availability couldn’t be updated. Seats may already be taken.");
  });
});

describe("seat page: the map replaced while open (§5.2)", () => {
  it("keeps the seats still on the new map, and removes and names those that went", () => {
    const view = renderPicker();
    showList();
    fireEvent.click(within(row("North, Row A")).getByRole("checkbox", { name: /^Seat 1, / }));
    fireEvent.click(within(row("North, Row A")).getByRole("checkbox", { name: /^Seat 2, / }));
    // Version 2 has no North A1.
    const template: SeatMapTemplate = {
      ...sample.template,
      sections: sample.template.sections.map((section) => ({
        ...section,
        rows: section.rows.map((r) => ({ ...r, seats: r.seats.filter((seat) => seat.id !== "N-A1") })),
      })),
    };
    view.rerender(
      <SeatPicker event={event} map={{ version: 2, seatCount: 59, template }} mode="demo" initialUnavailable={[]} />,
    );
    const words = "The seat map has been updated. North, Row A, Seat 1 is no longer on it and has been removed from your seats.";
    expect(status()).toHaveTextContent(words);
    expect(screen.getAllByText(words).length).toBeGreaterThan(1);
    expect(screen.queryByRole("button", { name: "Remove North, Row A, Seat 1" })).toBeNull();
    expect(screen.getByRole("button", { name: "Remove North, Row A, Seat 2" })).toBeInTheDocument();
    // The new map's availability: nothing unavailable now.
    expect(screen.getAllByRole("checkbox").filter((el) => el.hasAttribute("data-seat-id") && (el as HTMLInputElement).disabled)).toHaveLength(0);
  });
});

describe("seat page on phones: the seat bar (§5.10)", () => {
  beforeEach(() => setViewport(false));

  it("a disabled Checkout keeps the short label, with the reason in its name", () => {
    const { container } = renderPicker();
    const bar = container.querySelector("[data-seat-bar]") as HTMLElement;
    const button = within(bar).getByRole("button", { name: "Checkout unavailable in this demo" });
    expect(button).toBeDisabled();
    expect(button.textContent?.trim().startsWith("Checkout")).toBe(true);
    expect(within(bar).queryByText("Checkout unavailable in this demo")).toBeNull();
  });

  it("the sheet closes when focus leaves it and the bar, so it never covers what has focus (2.4.11)", () => {
    renderPicker();
    showList();
    const seat = within(row("North, Row A")).getByRole("checkbox", { name: /^Seat 1, / });
    fireEvent.click(seat);
    const toggle = screen.getByRole("button", { name: /1 seat · Details/ });
    fireEvent.click(toggle);
    const heading = screen.getByRole("heading", { name: "Your seats" });
    const remove = screen.getByRole("button", { name: "Remove North, Row A, Seat 1" });
    // Within the sheet and bar: stays open.
    fireEvent.blur(heading, { relatedTarget: remove });
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    // Out to the list behind it: closes.
    fireEvent.blur(remove, { relatedTarget: seat });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("heading", { name: "Your seats" })).toBeNull();
  });

  it("with the sheet closed, the inline messages show above the bar: the limit, and Find seats with Undo", () => {
    const { container } = renderPicker();
    const bar = container.querySelector("[data-seat-bar]") as HTMLElement;
    showList();
    const boxes = screen.getAllByRole("checkbox", { name: /^Seat \d+, Full price/ });
    boxes.slice(0, 11).forEach((box) => fireEvent.click(box));
    expect(within(bar).getByText("That’s 10 seats, the most for one order. Remove one to choose another.")).toBeInTheDocument();

    // Row A's Find seats (the desktop panel's form is in the DOM too, hidden by CSS).
    fireEvent.click(screen.getAllByRole("button", { name: "Find seats" })[0]);
    const dialog = screen.getByRole("dialog", { name: "Find seats" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Find seats" }));
    expect(within(bar).getByText(/^Found 2 seats together: North, Row A, Seats 1 and 2\./)).toBeInTheDocument();
    fireEvent.click(within(bar).getByRole("button", { name: "Undo" }));
    expect(within(bar).getByRole("button", { name: /10 seats · Details/ })).toBeInTheDocument();
  });
});

describe("seat page: back from Stripe releases the hold (§5.11)", () => {
  const live: SheltuhEvent = { ...event, organiserId: "org-1" };
  const ORDER = `ord_${"a".repeat(32)}`;
  const KEY = "sheltuh:pending-checkout";

  it("remembers the order for this tab before going to Stripe", async () => {
    createSeatedCheckout.mockResolvedValue({ url: "https://checkout.stripe.test/c/1", orderId: ORDER });
    // jsdom can't navigate: it reports that and carries on.
    const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
    renderPicker({ event: live, mode: "live" });
    showList();
    fireEvent.click(within(row("North, Row A")).getByRole("checkbox", { name: /^Seat 1, / }));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Checkout" }));
    });
    expect(JSON.parse(window.sessionStorage.getItem(KEY) ?? "null")).toEqual({
      orderId: ORDER,
      slug: event.slug,
      at: new Date("2026-10-21T00:00:00.000Z").getTime(),
    });
    expect(screen.getByRole("button", { name: "Holding your seats…" })).toBeInTheDocument();
    quiet.mockRestore();
  });

  it("restored from the back/forward cache: Checkout works again and the held seats are released, saying so", async () => {
    createSeatedCheckout.mockResolvedValue({ url: "https://checkout.stripe.test/c/1", orderId: ORDER });
    cancelPendingOrder.mockResolvedValue({ status: "released", eventTitle: event.title, eventSlug: event.slug });
    const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
    renderPicker({ event: live, mode: "live" });
    showList();
    fireEvent.click(within(row("North, Row A")).getByRole("checkbox", { name: /^Seat 1, / }));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Checkout" }));
    });
    expect(cancelPendingOrder).not.toHaveBeenCalled();
    await act(async () => {
      window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true }));
    });
    expect(cancelPendingOrder).toHaveBeenCalledWith(ORDER);
    expect(window.sessionStorage.getItem(KEY)).toBeNull();
    const text = "You left the payment page, so the seats held for you have been released. You weren’t charged.";
    expect(status()).toHaveTextContent(text);
    expect(screen.getAllByText(text).length).toBeGreaterThan(1);
    // Still the buyer's seats, and Checkout is back.
    expect(within(row("North, Row A")).getByRole("checkbox", { name: /^Seat 1, / })).toBeChecked();
    expect(screen.getByRole("button", { name: "Checkout" })).not.toHaveAttribute("aria-disabled");
    quiet.mockRestore();
  });

  it("loaded afresh with a stored order: releases it once; a failure is an alert saying the hold lapses by itself", async () => {
    window.sessionStorage.setItem(KEY, JSON.stringify({ orderId: ORDER, slug: event.slug, at: Date.now() - 60_000 }));
    cancelPendingOrder.mockRejectedValue(new ApiError(500, "Server error."));
    renderPicker({ event: live, mode: "live" });
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "We couldn’t release the seats held for your checkout just now. They’ll be released automatically within 35 minutes. You weren’t charged.",
    );
    expect(cancelPendingOrder).toHaveBeenCalledTimes(1);
    expect(window.sessionStorage.getItem(KEY)).toBeNull();
  });

  it("paid meanwhile, or demo mode: nothing is said or released", async () => {
    window.sessionStorage.setItem(KEY, JSON.stringify({ orderId: ORDER, slug: event.slug, at: Date.now() }));
    renderPicker();
    await act(async () => {});
    expect(cancelPendingOrder).not.toHaveBeenCalled();
    cleanup();
    cancelPendingOrder.mockResolvedValue({ status: "paid", eventTitle: event.title, eventSlug: event.slug });
    renderPicker({ event: live, mode: "live" });
    await act(async () => {});
    expect(cancelPendingOrder).toHaveBeenCalledWith(ORDER);
    expect(screen.queryByText(/You left the payment page/)).toBeNull();
  });
});
