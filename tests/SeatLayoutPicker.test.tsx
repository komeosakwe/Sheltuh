// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import SeatMapEditor from "@/components/seating/editor/SeatMapEditor";
import { SAMPLE_SEAT_MAPS } from "@/lib/sample-seat-maps";
import { sampleEvents } from "@/lib/sample-events";
import { flattenSeats, validateSeatMapTemplate, type SeatMapTemplate } from "@/lib/seating/template";
import type { SheltuhEvent, TicketType } from "@/lib/types";

vi.mock("next/navigation", () => ({
  usePathname: () => "/",
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("@/lib/api/going", () => ({ getGoingSummary: vi.fn(() => new Promise(() => {})) }));

const seated = sampleEvents.find((e) => e.id === "evt-off-kilter") as SheltuhEvent;
/** The organiser's draft: the sample's two tiers, neither seated yet (no map). */
const event: SheltuhEvent = { ...seated, organiserId: "org-1", seating: undefined, ticketTypes: seated.ticketTypes.map((t) => ({ ...t, seated: undefined })) };
const sampleRecord = { eventId: event.id, version: 1, seatCount: 60, template: SAMPLE_SEAT_MAPS["evt-off-kilter"].template };

beforeEach(() => {
  HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement) {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close = function close(this: HTMLDialogElement) {
    this.removeAttribute("open");
  };
});
afterEach(cleanup);

const picker = () => screen.queryByRole("region", { name: "Start from a layout" });
const layoutsButton = () => screen.getByRole("button", { name: "Layouts" });

describe("Start from a layout (seat-map editor, §5.13)", () => {
  it("an empty map opens with the picker: one tap fills it, then Save sends a valid map", async () => {
    const onSave = vi.fn(async (template: SeatMapTemplate) => ({ eventId: event.id, version: 2, seatCount: flattenSeats(template).length, template }));
    render(<SeatMapEditor event={event} initial={null} status="Draft" locked={false} onSave={onSave} />);
    const region = picker();
    expect(region).not.toBeNull();
    expect(layoutsButton()).toHaveAttribute("aria-expanded", "true");
    // Each card names the layout, describes it and says how many seats it makes.
    const small = within(region as HTMLElement).getByRole("button", { name: "Small room" });
    expect(small).toHaveAccessibleDescription(/A few short rows.*96 seats · 2 wheelchair spaces/);
    expect(small.querySelector("svg")).toHaveAttribute("aria-hidden", "true");

    // Defaults to the first tier; choose Concession and about 40 seats.
    const tier = screen.getByLabelText("Price tier for these seats");
    expect(tier).toHaveValue("off-kilter-full");
    fireEvent.change(tier, { target: { value: "off-kilter-concession" } });
    fireEvent.change(screen.getByLabelText("About how many seats"), { target: { value: "40" } });
    expect(small).toHaveAccessibleDescription(/40 seats · 2 wheelchair spaces/);
    fireEvent.click(small);

    expect(screen.getByText("40 seats · 1 tier")).toBeInTheDocument();
    expect(picker()).toBeNull();
    expect(layoutsButton()).toHaveAttribute("aria-expanded", "false");
    expect(layoutsButton()).toHaveFocus();
    expect(screen.getByText(/Small room: 40 seats\. Save to keep it, or undo\./)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Select Seats" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    const sent = onSave.mock.calls[0][0];
    expect(validateSeatMapTemplate(sent, { ticketTypeIds: ["off-kilter-full", "off-kilter-concession"] }).ok).toBe(true);
    const seats = flattenSeats(sent);
    expect(seats).toHaveLength(40);
    expect(seats.every((s) => s.ticketTypeId === "off-kilter-concession")).toBe(true);
    expect(seats.filter((s) => s.kind === "wheelchair")).toHaveLength(2);
    expect(await screen.findByText("Seat map saved: 40 seats.")).toBeInTheDocument();
  });

  it("a map with seats: picking asks to replace it; Cancel keeps it, Replace swaps it, Undo brings it back", () => {
    render(<SeatMapEditor event={event} initial={sampleRecord} status="Draft" locked={false} onSave={vi.fn()} />);
    expect(picker()).toBeNull();
    expect(layoutsButton()).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(layoutsButton());
    expect(picker()).toHaveTextContent("It replaces the seats on the map now (you can undo).");

    const curved = screen.getByRole("button", { name: "Curved rows" });
    curved.focus();
    fireEvent.click(curved);
    let dialog = screen.getByRole("dialog", { name: "Replace the seat map?" });
    expect(dialog).toHaveTextContent(/Curved rows \(150 seats\) takes the place of the 60 seats on the map now\. You can undo this before saving\./);
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByText("60 seats · 2 tiers")).toBeInTheDocument();
    expect(curved).toHaveFocus();

    curved.focus();
    fireEvent.click(curved);
    dialog = screen.getByRole("dialog", { name: "Replace the seat map?" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Replace map" }));
    expect(screen.getByText("150 seats · 1 tier")).toBeInTheDocument();
    expect(screen.getByText("· Unsaved changes")).toBeInTheDocument();
    expect(picker()).toBeNull();
    // The card that opened the dialog is gone with the picker: focus goes to Layouts.
    expect(layoutsButton()).toHaveFocus();
    expect(screen.queryByRole("button", { name: "Select North" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    expect(screen.getByText("60 seats · 2 tiers")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Select North" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Redo" }));
    expect(screen.getByText("150 seats · 1 tier")).toBeInTheDocument();
  });

  it("a number it can't read: says so, and leaves the map alone", () => {
    render(<SeatMapEditor event={event} initial={null} status="Draft" locked={false} onSave={vi.fn()} />);
    const input = screen.getByLabelText("About how many seats");
    fireEvent.change(input, { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "Rows facing a stage" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Enter about how many seats, as a number (10 to 2,000).");
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(input).toHaveAccessibleDescription(/Enter about how many seats/);
    expect(input).toHaveFocus();
    expect(screen.getByText("0 seats · 0 tiers")).toBeInTheDocument();
    // Typing clears the error; very large numbers are fine (each layout keeps to its own size).
    fireEvent.change(input, { target: { value: "1,000,000" } });
    expect(screen.queryByRole("alert")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Theatre with a centre aisle" }));
    expect(screen.getByText("1984 seats · 1 tier")).toBeInTheDocument();
  });

  it("starts on the first seated tier, and only the first five tiers can be chosen", () => {
    const tiers: TicketType[] = Array.from({ length: 6 }, (_, i) => ({
      id: `t${i + 1}`,
      name: `Tier ${i + 1}`,
      priceCents: 1000 + i * 100,
      feePolicy: "buyer-pays",
      quantityAvailable: 10,
      ...(i === 2 ? { seated: true as const } : {}),
    }));
    render(<SeatMapEditor event={{ ...event, ticketTypes: tiers }} initial={null} status="Draft" locked={false} onSave={vi.fn()} />);
    const select = screen.getByLabelText("Price tier for these seats");
    expect(select).toHaveValue("t3");
    const options = within(select).getAllByRole("option");
    expect(options.map((o) => (o as HTMLOptionElement).disabled)).toEqual([false, false, false, false, false, true]);
  });

  it("an event with no ticket types yet: says to add one, offers no layouts", () => {
    render(<SeatMapEditor event={{ ...event, ticketTypes: [] }} initial={null} status="Draft" locked={false} onSave={vi.fn()} />);
    expect(picker()).toHaveTextContent("Add a ticket type to the event first: seats are sold as its tickets.");
    expect(screen.queryByRole("button", { name: "Small room" })).toBeNull();
  });

  it("a locked map (approved, in review, or an admin's read-only view) has no picker and no Layouts button", () => {
    for (const initial of [sampleRecord, null]) {
      const { unmount } = render(<SeatMapEditor event={event} initial={initial} status="Approved · locked" locked onSave={vi.fn()} />);
      expect(picker()).toBeNull();
      expect(screen.queryByRole("button", { name: "Layouts" })).toBeNull();
      expect(screen.queryByRole("button", { name: "Small room" })).toBeNull();
      unmount();
    }
  });

  it("Preview as buyer hides the picker and its button", () => {
    render(<SeatMapEditor event={event} initial={null} status="Draft" locked={false} onSave={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Rows facing a stage" }));
    fireEvent.click(screen.getByRole("button", { name: "Preview as buyer" }));
    expect(screen.queryByRole("button", { name: "Layouts" })).toBeNull();
    expect(picker()).toBeNull();
  });
});
