// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import SeatPicker from "@/components/seating/SeatPicker";
import { ApiError } from "@/lib/api/client";
import { SAMPLE_SEAT_MAPS } from "@/lib/sample-seat-maps";
import { sampleEvents } from "@/lib/sample-events";
import type { SheltuhEvent } from "@/lib/types";

const { createSeatedCheckout } = vi.hoisted(() => ({ createSeatedCheckout: vi.fn() }));
vi.mock("@/lib/api/seating", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api/seating")>()),
  createSeatedCheckout,
  getSeatAvailability: vi.fn(() => new Promise(() => {})),
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
  });

  it("keeps the tab for the session, and the arrow keys move between the tabs", () => {
    renderPicker();
    const mapTab = screen.getByRole("tab", { name: "Map" });
    expect(mapTab).toHaveAttribute("aria-selected", "true");
    mapTab.focus();
    fireEvent.keyDown(mapTab, { key: "ArrowRight" });
    expect(screen.getByRole("tab", { name: "List" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tab", { name: "List" })).toHaveFocus();
    expect(window.sessionStorage.getItem("sheltuh:seat-tab")).toBe("list");
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
    const totals = within(card).getByText("Total").closest("dl") as HTMLElement;
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
