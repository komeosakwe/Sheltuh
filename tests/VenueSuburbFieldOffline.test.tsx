// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import EventEditor from "@/components/dashboard/EventEditor";
import type { EventRecord } from "@/lib/api/types";
import type { LocationModule } from "@/lib/location-loader";
import { fakeAuthValue, FakeAuthProvider } from "./test-utils/fakeAuth";

/*
 * The editor's venue suburb when the suburb table can't load (UX review,
 * 26 Oct 2026): a saved event's own suburb still saves, and typing says the
 * suburb can't be checked, with Try again.
 */

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

const updateEventDraft = vi.fn();
const createEventDraft = vi.fn();
vi.mock("@/lib/api/events", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api/events")>();
  return {
    isPayoutsRequiredError: actual.isPayoutsRequiredError,
    isRefundPolicyTightenedError: actual.isRefundPolicyTightenedError,
    updateEventDraft: (...args: unknown[]) => updateEventDraft(...args),
    createEventDraft: (...args: unknown[]) => createEventDraft(...args),
    publishEvent: vi.fn(),
    uploadEventImage: vi.fn(),
    deleteEventImage: vi.fn(),
  };
});

// The table's chunk: failing unless a test lets it load.
const loadLocation = vi.fn<() => Promise<LocationModule>>();
vi.mock("@/lib/location-loader", () => ({
  loadLocation: () => loadLocation(),
  loadedLocation: () => null,
}));

let table: LocationModule;
beforeAll(async () => {
  table = await import("@/lib/location");
}, 30_000);

afterEach(cleanup);
beforeEach(() => {
  updateEventDraft.mockReset();
  createEventDraft.mockReset();
  loadLocation.mockReset().mockRejectedValue(new Error("Loading chunk failed"));
});

const PERTH_EVENT: EventRecord = {
  organiserId: "org-1",
  eventId: "evt-perth",
  slug: "northbridge-late-sketch",
  title: "Northbridge Late Sketch",
  description: "Life drawing with a jazz trio.",
  category: "workshop",
  venueName: "James Street Studio",
  venueAddress: "40 James Street",
  suburb: "Northbridge",
  state: "WA",
  timeZone: "Australia/Perth",
  startsAt: "2026-11-21T10:30:00.000Z",
  endsAt: "2026-11-21T13:30:00.000Z",
  organiserName: "Westside Drawing Club",
  ticketTypes: [{ id: "place", name: "Drawing place", priceCents: 3000, feePolicy: "buyer-pays", quantityAvailable: 30 }],
  ticketingMode: "sheltuh",
  status: "draft",
  moderationLog: [],
  createdAt: "2026-10-01T00:00:00.000Z",
  updatedAt: "2026-10-01T00:00:00.000Z",
};

function renderEditor(initial?: EventRecord) {
  render(
    <FakeAuthProvider value={fakeAuthValue({ email: "owner@example.com" })}>
      <EventEditor getToken={vi.fn().mockResolvedValue("token")} initial={initial} onSaved={vi.fn()} />
    </FakeAuthProvider>,
  );
}

const suburbField = () => screen.getByLabelText("Suburb or town");
const hint = () => document.getElementById("suburb-hint");

function typeSuburb(value: string) {
  fireEvent.focus(suburbField());
  fireEvent.change(suburbField(), { target: { value } });
}

function fillTheRest() {
  fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Night Market" } });
  fireEvent.change(screen.getByLabelText("Description"), { target: { value: "Stalls and music." } });
  fireEvent.change(screen.getByLabelText("Venue name"), { target: { value: "The Venue" } });
  fireEvent.change(screen.getByLabelText("Venue address"), { target: { value: "1 Test St" } });
  fireEvent.change(screen.getByLabelText("Start date"), { target: { value: "2027-03-06" } });
  fireEvent.change(screen.getByLabelText("Start time"), { target: { value: "20:00" } });
  fireEvent.change(screen.getByLabelText("End date"), { target: { value: "2027-03-06" } });
  fireEvent.change(screen.getByLabelText("End time"), { target: { value: "23:30" } });
  fireEvent.change(screen.getByLabelText("Name"), { target: { value: "General Admission" } });
}

describe("VenueSuburbField — when the suburb table can't load", () => {
  it("a saved event's own suburb, unchanged, saves without it, with its saved state and zone", async () => {
    updateEventDraft.mockResolvedValue(PERTH_EVENT);
    renderEditor(PERTH_EVENT);
    await waitFor(() => expect(loadLocation).toHaveBeenCalled());
    // The place is known (it's the event's own): the hint says so, and no failure is shown for it.
    expect(hint()).toHaveTextContent("Northbridge, Western Australia · Perth time (AWST)");
    expect(screen.queryByRole("button", { name: "Try again" })).toBeNull();

    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Northbridge Late Sketch II" } });
    const calls = loadLocation.mock.calls.length;
    fireEvent.click(screen.getByRole("button", { name: "Save draft" }));
    await waitFor(() => expect(updateEventDraft).toHaveBeenCalledTimes(1));
    expect(updateEventDraft.mock.calls[0][1]).toMatchObject({
      title: "Northbridge Late Sketch II",
      suburb: "Northbridge",
      state: "WA",
      timeZone: "Australia/Perth",
      start: { date: "2026-11-21", time: "18:30" },
    });
    // Saving it didn't need the table.
    expect(loadLocation.mock.calls.length).toBe(calls);
    expect(document.getElementById("suburb-error")).toBeNull();
  });

  it("typing a new suburb says it can't be checked yet, with Try again, which loads the table", async () => {
    renderEditor();
    typeSuburb("Perth");
    await waitFor(() =>
      expect(hint()).toHaveTextContent(
        "Couldn’t load the list of suburbs, so this can’t be checked yet. We’ll try again when you save.",
      ),
    );
    expect(hint()).toHaveAttribute("aria-live", "polite");
    loadLocation.mockResolvedValue(table);
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    await waitFor(() => expect(hint()).toHaveTextContent("Perth, Western Australia · Perth time (AWST)"));
    expect(screen.queryByRole("button", { name: "Try again" })).toBeNull();
  });

  it("saving a new suburb it couldn't check: an error by the field, focus there, and nothing sent", async () => {
    renderEditor();
    fillTheRest();
    typeSuburb("Perth");
    fireEvent.click(screen.getByRole("button", { name: /Save draft/ }));
    await waitFor(() =>
      expect(document.getElementById("suburb-error")).toHaveTextContent(
        "Couldn’t check the suburb: the list of suburbs didn’t load. Save again to try again, or reload the page if it keeps happening.",
      ),
    );
    await waitFor(() => expect(suburbField()).toHaveFocus());
    expect(createEventDraft).not.toHaveBeenCalled();

    // The next save, with the table back, goes through.
    loadLocation.mockResolvedValue(table);
    createEventDraft.mockResolvedValue({ ...PERTH_EVENT, eventId: "evt-new" });
    fireEvent.click(screen.getByRole("button", { name: /Save draft/ }));
    await waitFor(() => expect(createEventDraft).toHaveBeenCalledTimes(1));
    expect(createEventDraft.mock.calls[0][0]).toMatchObject({ suburb: "Perth", state: "WA", timeZone: "Australia/Perth" });
  });
});
