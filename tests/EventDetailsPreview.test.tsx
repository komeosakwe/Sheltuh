// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { draftToPreviewEvent, type PreviewDraft } from "@/components/dashboard/editor/preview-event";
import EventDetailsView from "@/components/EventDetailsView";
import { sampleEvents } from "@/lib/sample-events";
import type { SheltuhEvent } from "@/lib/types";

/**
 * The event editor's live preview mode (docs/design/event-editor.md §5.10): EventDetailsView's `preview` prop is the
 * page with none of its live behaviour, and a muted stand-in for what the draft doesn't have yet.
 */
vi.mock("@/lib/api/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api/client")>()),
  isApiConfigured: true,
}));
const recordOutboundClick = vi.fn();
const recordEventView = vi.fn();
vi.mock("@/lib/api/analytics", () => ({
  recordOutboundClick: (...a: unknown[]) => recordOutboundClick(...a),
  recordEventView: (...a: unknown[]) => recordEventView(...a),
}));
const going = { getGoingSummary: vi.fn(), getMyGoingStatus: vi.fn(), listGoingAttendees: vi.fn() };
vi.mock("@/lib/api/going", () => ({
  getGoingSummary: (...a: unknown[]) => going.getGoingSummary(...a),
  getMyGoingStatus: (...a: unknown[]) => going.getMyGoingStatus(...a),
  listGoingAttendees: (...a: unknown[]) => going.listGoingAttendees(...a),
  setGoing: vi.fn(),
  unsetGoing: vi.fn(),
}));

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-09-01T00:00:00.000Z"));
  recordOutboundClick.mockReset();
  recordEventView.mockReset();
  for (const fn of Object.values(going)) fn.mockReset();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const DRAFT: PreviewDraft = {
  title: "Neon Static",
  description: "Four bands.",
  category: "live-music",
  suburb: "Collingwood",
  state: "VIC",
  timeZone: "Australia/Melbourne",
  venueName: "The Tote",
  venueAddress: "71 Johnston St",
  pin: { lat: -37.8, lng: 144.98 },
  start: { date: "2026-10-10", time: "20:00" },
  end: { date: "2026-10-10", time: "23:00" },
  organiserName: "Static Collective",
  ticketTypes: [{ id: "ga", name: "General admission", priceCents: 3000, feePolicy: "buyer-pays", quantityAvailable: 50 }],
  ticketingMode: "sheltuh",
  externalFree: false,
  refundPolicy: "no_change_of_mind",
  refundDays: Number.NaN,
};

function previewOf(draft: PreviewDraft) {
  const { event, missing } = draftToPreviewEvent(draft);
  return render(<EventDetailsView event={event} demo={false} preview={{ missing }} />);
}

describe("draftToPreviewEvent", () => {
  it("maps the draft in the event page's shape: instants in the event's zone, all-inclusive tickets, no seating", () => {
    const { event, missing } = draftToPreviewEvent(DRAFT);
    expect(event.startsAt).toBe("2026-10-10T09:00:00.000Z"); // 8:00 pm AEDT
    expect(event.endsAt).toBe("2026-10-10T12:00:00.000Z");
    expect(event.coordinates).toEqual({ lat: -37.8, lng: 144.98 });
    expect(event.ticketTypes).toEqual([
      { id: "ga", name: "General admission", priceCents: 3000, feePolicy: "buyer-pays", quantityAvailable: 50 },
    ]);
    expect(event.seating).toBeUndefined();
    expect(missing).toEqual({ title: false, description: false, when: false, where: false });
  });

  it("flags what's missing, and a half-typed date isn't a date", () => {
    const { missing } = draftToPreviewEvent({
      ...DRAFT,
      title: " ",
      description: "",
      venueName: "",
      venueAddress: "",
      start: { date: "2026-10-10", time: "" },
    });
    expect(missing).toEqual({ title: true, description: true, when: true, where: true });
  });

  it("carries a ticket's description (trimmed), and leaves it out when blank", () => {
    const { event } = draftToPreviewEvent({
      ...DRAFT,
      ticketTypes: [
        { id: "a", name: "A", description: "  Includes a drink  ", priceCents: 0, feePolicy: "buyer-pays", quantityAvailable: 5 },
        { id: "b", name: "B", description: "   ", priceCents: 0, feePolicy: "buyer-pays", quantityAvailable: 5 },
      ],
    });
    expect(event.ticketTypes[0].description).toBe("Includes a drink");
    expect("description" in event.ticketTypes[1]).toBe(false);
  });

  it("an external draft has no ticket types, and no refund terms", () => {
    const { event } = draftToPreviewEvent({
      ...DRAFT,
      ticketingMode: "external",
      externalTicketUrl: "https://events.humanitix.com/x",
    });
    expect(event.ticketTypes).toEqual([]);
    expect(event.refundPolicy).toBeUndefined();
  });
});

describe("EventDetailsView preview", () => {
  it("shows the draft, with the ticket's all-inclusive price and description", () => {
    previewOf({
      ...DRAFT,
      ticketTypes: [{ ...DRAFT.ticketTypes[0], description: "Standing, all bands." }],
    });
    expect(screen.getByRole("heading", { level: 1, name: "Neon Static" })).toBeInTheDocument();
    expect(screen.getByText("Standing, all bands.")).toBeInTheDocument();
    expect(screen.getAllByText(/A\$32\.30/).length).toBeGreaterThan(0);
  });

  it("has none of the live page's behaviour: no view, no Who's Going, no back link, no report line, no map, no sticky bar", () => {
    const { container } = previewOf(DRAFT);
    expect(recordEventView).not.toHaveBeenCalled();
    expect(going.getGoingSummary).not.toHaveBeenCalled();
    expect(going.getMyGoingStatus).not.toHaveBeenCalled();
    expect(screen.queryByRole("link", { name: /Back to all events/ })).toBeNull();
    expect(screen.queryByText(/Report this event/)).toBeNull();
    expect(screen.queryByText(/Who.s Going/i)).toBeNull();
    expect(container.querySelector("[data-event-location]")).not.toBeNull();
    expect(container.querySelector("[data-event-map]")).toBeNull();
    const bar = container.querySelector("[data-buy-bar]");
    expect(bar).not.toBeNull();
    expect(bar).toHaveClass("static");
    expect(bar).not.toHaveClass("sticky");
  });

  it("the live page, without the prop, still has them", () => {
    const { container } = render(<EventDetailsView event={sampleEvents[0] as SheltuhEvent} demo />);
    expect(screen.getByRole("link", { name: /Back to all events/ })).toBeInTheDocument();
    expect(screen.getByText(/Report this event/)).toBeInTheDocument();
    expect(container.querySelector("[data-buy-bar]")).toHaveClass("sticky");
    expect(container.querySelector("[data-event-map]")).not.toBeNull();
  });

  it("says what's missing in the page's own places, in muted text", () => {
    previewOf({
      ...DRAFT,
      title: "",
      description: "",
      venueName: "",
      venueAddress: "",
      start: { date: "", time: "" },
      end: { date: "", time: "" },
      ticketTypes: [],
    });
    expect(screen.getByRole("heading", { level: 1, name: "Untitled event" })).toBeInTheDocument();
    for (const text of ["Add a description", "Date and time to be added", "Venue to be added"]) {
      expect(screen.getByText(text)).toHaveClass("text-muted");
    }
    expect(screen.getByText("Tickets coming soon.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Add to calendar/ })).toBeNull();
  });

  it("an external ticket link counts no click", () => {
    previewOf({ ...DRAFT, ticketingMode: "external", externalTicketUrl: "https://events.humanitix.com/neon-static" });
    const link = screen.getAllByRole("link", { name: /Get tickets/ })[0];
    fireEvent.click(link);
    fireEvent.mouseUp(link, { button: 1 });
    expect(recordOutboundClick).not.toHaveBeenCalled();
  });
});
