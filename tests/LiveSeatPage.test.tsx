// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import LiveSeatPage from "@/components/seating/LiveSeatPage";
import { ApiError } from "@/lib/api/client";
import type { PublicEvent } from "@/lib/api/public-events";
import { SAMPLE_SEAT_MAPS } from "@/lib/sample-seat-maps";
import { sampleEvents } from "@/lib/sample-events";
import { encodeAvailability } from "@/lib/seating/availability";
import type { SheltuhEvent } from "@/lib/types";

const { getPublicEventBySlug, getSeatMap, getSeatAvailability, createSeatedCheckout } = vi.hoisted(() => ({
  getPublicEventBySlug: vi.fn(),
  getSeatMap: vi.fn(),
  getSeatAvailability: vi.fn(),
  createSeatedCheckout: vi.fn(),
}));
vi.mock("@/lib/api/public-events", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api/public-events")>()),
  getPublicEventBySlug,
}));
vi.mock("@/lib/api/seating", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api/seating")>()),
  getSeatMap,
  getSeatAvailability,
  createSeatedCheckout,
}));

const event = sampleEvents.find((e) => e.id === "evt-off-kilter") as SheltuhEvent;
const sample = SAMPLE_SEAT_MAPS["evt-off-kilter"];

function asPublic(title: string, version: number): PublicEvent {
  return {
    organiserId: "org-1",
    eventId: event.id,
    slug: event.slug,
    title,
    description: event.description,
    category: event.category,
    venueName: event.venueName,
    venueAddress: event.venueAddress,
    suburb: event.suburb,
    startsAt: "2026-11-01T09:00:00.000Z",
    endsAt: "2026-11-01T11:00:00.000Z",
    organiserName: event.organiserName,
    imageUrl: event.imageUrl,
    ticketTypes: event.ticketTypes,
    soldOut: false,
    ticketingMode: "sheltuh",
    externalFree: false,
    externalProvider: null,
    seating: { version },
  };
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-21T00:00:00.000Z"));
  window.sessionStorage.clear();
  window.sessionStorage.setItem("sheltuh:seat-tab", "list");
  for (const fn of [getPublicEventBySlug, getSeatMap, getSeatAvailability, createSeatedCheckout]) fn.mockReset();
  getSeatMap.mockImplementation(async (_id: string, version?: number) => ({
    eventId: event.id,
    version: version ?? 2,
    seatCount: sample.seatCount,
    template: sample.template,
  }));
  getSeatAvailability.mockResolvedValue({
    eventId: event.id,
    version: 1,
    seatCount: sample.seatCount,
    unavailable: encodeAvailability(sample.seatCount, sample.unavailable),
  });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("live seat page: a map replaced while open (docs/design/seating.md §5.2)", () => {
  it("reloads the event by slug as well as the map, in place, keeping the buyer's seats", async () => {
    getPublicEventBySlug.mockResolvedValueOnce(asPublic("Off-Kilter", 1)).mockResolvedValueOnce(asPublic("Off-Kilter (new run)", 2));
    createSeatedCheckout.mockRejectedValue(
      new ApiError(409, "The seat map has changed.", { seats: "Changed." }, { code: "seat_map_changed" }),
    );
    render(<LiveSeatPage slug={event.slug} />);
    const rowA = await screen.findByRole("group", { name: "North, Row A" });
    fireEvent.click(within(rowA).getByRole("checkbox", { name: /^Seat 1, / }));
    await act(async () => {
      fireEvent.click(screen.getAllByRole("button", { name: "Checkout" })[0]);
    });
    await waitFor(() => expect(getPublicEventBySlug).toHaveBeenCalledTimes(2));
    expect(getPublicEventBySlug).toHaveBeenLastCalledWith(event.slug);
    await waitFor(() => expect(document.title).toBe("Choose seats — Off-Kilter (new run) — Sheltüh"));
    // No remount: the seat chosen before is still chosen.
    expect(within(screen.getByRole("group", { name: "North, Row A" })).getByRole("checkbox", { name: /^Seat 1, / })).toBeChecked();
  });
});
