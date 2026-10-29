// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import EventEditor from "@/components/dashboard/EventEditor";
import type { AdminEventRecord, AdminOrganiserRecord, EventRecord } from "@/lib/api/types";
import { fakeAuthValue, FakeAuthProvider } from "./test-utils/fakeAuth";
import { showStep } from "./test-utils/editorSteps";

/**
 * The editor's "Seating" choice (docs/design/seating.md §5.13): shown for
 * Sheltüh-ticketed events only, derived from the event's seat map when it has
 * one, and for a new event, where saving goes next (the seat map, or the
 * event as before).
 */

const push = vi.fn();
// The suburb table, stubbed: these tests aren't about the suburb (tests/VenueSuburbField.test.tsx is).
vi.mock("@/lib/location-loader", async () => (await import("./test-utils/locationStub")).locationLoaderStub());

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
}));

const updateEventDraft = vi.fn();
const createEventDraft = vi.fn();
vi.mock("@/lib/api/events", async (importOriginal) => ({
  // The real check (it only reads the error): the editor tells a payouts refusal apart with it.
  isPayoutsRequiredError: (await importOriginal<typeof import("@/lib/api/events")>()).isPayoutsRequiredError,
  isRefundPolicyTightenedError: (await importOriginal<typeof import("@/lib/api/events")>()).isRefundPolicyTightenedError,
  updateEventDraft: (...args: unknown[]) => updateEventDraft(...args),
  createEventDraft: (...args: unknown[]) => createEventDraft(...args),
  publishEvent: vi.fn(),
  uploadEventImage: vi.fn(),
  deleteEventImage: vi.fn(),
}));

const adminListOrganisers = vi.fn();
const adminCreateEvent = vi.fn();
const adminUpdateEvent = vi.fn();
vi.mock("@/lib/api/admin", () => ({
  adminListOrganisers: (...args: unknown[]) => adminListOrganisers(...args),
  adminCreateOrganiser: vi.fn(),
  adminCreateEvent: (...args: unknown[]) => adminCreateEvent(...args),
  adminUpdateEvent: (...args: unknown[]) => adminUpdateEvent(...args),
  adminUploadEventImage: vi.fn(),
  adminDeleteEventImage: vi.fn(),
}));

afterEach(cleanup);
beforeEach(() => {
  for (const fn of [push, updateEventDraft, createEventDraft, adminListOrganisers, adminCreateEvent, adminUpdateEvent]) fn.mockReset();
});

const GENERAL = "General admission (no assigned seats)";
const RESERVED = "Reserved seating (buyers pick seats on a map)";

const EVENT: EventRecord = {
  organiserId: "org-1",
  eventId: "evt-1",
  slug: "neon-static",
  title: "Neon Static",
  description: "Four bands.",
  category: "live-music",
  venueName: "The Tote",
  venueAddress: "71 Johnston St",
  suburb: "Collingwood",
  startsAt: "2027-03-06T09:00:00.000Z",
  endsAt: "2027-03-06T12:30:00.000Z",
  organiserName: "Static Collective",
  ticketTypes: [{ id: "ga", name: "Stalls", priceCents: 3000, feePolicy: "buyer-pays", quantityAvailable: 10 }],
  ticketingMode: "sheltuh",
  externalFree: false,
  externalProvider: null,
  ticketingLocked: false,
  status: "draft",
  moderationLog: [],
  createdAt: "2026-10-01T00:00:00.000Z",
  updatedAt: "2026-10-20T01:02:03.456Z",
};

const ADMIN_EVENT: AdminEventRecord = { ...EVENT, organiserPlatformManaged: false, curation: { boost: 1, excluded: false } };

const ORGANISER: AdminOrganiserRecord = {
  organiserId: "org-1",
  ownerUserId: "user-1",
  displayName: "Static Collective",
  contactEmail: "hello@static.example",
  description: "Gigs.",
  categories: ["live-music"],
  status: "approved",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  recentEdits: [],
};

function renderOrganiser(initial?: EventRecord, onSaved = vi.fn()) {
  render(
    <FakeAuthProvider value={fakeAuthValue({ email: "owner@example.com" })}>
      <EventEditor getToken={vi.fn().mockResolvedValue("token")} initial={initial} onSaved={onSaved} />
    </FakeAuthProvider>,
  );
  // Seating is on the Tickets step.
  showStep(2);
  return { onSaved };
}

function renderAdmin(initial?: AdminEventRecord) {
  render(
    <FakeAuthProvider value={fakeAuthValue({ email: "admin@sheltuh.example", isAdmin: true })}>
      <EventEditor mode="admin" getToken={vi.fn().mockResolvedValue("token")} initial={initial} onSaved={vi.fn()} />
    </FakeAuthProvider>,
  );
  showStep(2);
}

function seatingGroup() {
  return screen.getByRole("group", { name: "Seating" });
}

function fillNewEventWithoutTickets() {
  fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Neon Static" } });
  fireEvent.change(screen.getByLabelText("Description"), { target: { value: "Four bands." } });
  fireEvent.change(screen.getByLabelText("Venue name"), { target: { value: "The Tote" } });
  fireEvent.change(screen.getByLabelText("Venue address"), { target: { value: "71 Johnston St" } });
  fireEvent.change(screen.getByLabelText("Suburb or town"), { target: { value: "Collingwood" } });
  fireEvent.change(screen.getByLabelText("Start date"), { target: { value: "2027-03-06" } });
  fireEvent.change(screen.getByLabelText("Start time"), { target: { value: "20:00" } });
  fireEvent.change(screen.getByLabelText("End date"), { target: { value: "2027-03-06" } });
  fireEvent.change(screen.getByLabelText("End time"), { target: { value: "23:30" } });
}

function fillNewEvent() {
  fillNewEventWithoutTickets();
  fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Stalls" } });
}

async function pickOrganiser() {
  const select = screen.getByLabelText("Organiser");
  await waitFor(() => expect(select).not.toBeDisabled());
  fireEvent.change(select, { target: { value: "org-1" } });
}

describe("EventEditor seating — organiser, new event", () => {
  it("offers both choices, each explained, with general admission chosen and the save unchanged", () => {
    renderOrganiser();
    const group = seatingGroup();
    const general = within(group).getByRole("radio", { name: GENERAL });
    const reserved = within(group).getByRole("radio", { name: RESERVED });
    expect(general).toBeChecked();
    expect(reserved).not.toBeChecked();
    expect(general).toHaveAccessibleName(/General admission/);
    expect(reserved).toHaveAccessibleName(/buyers pick seats on a map/);
    expect(screen.getByRole("button", { name: "Save draft" })).toBeInTheDocument();
    expect(within(group).queryByText(/set up next/)).toBeNull();
  });

  it("with reserved seating: says the tiers come from the ticket types, and saving goes on to the seat map", async () => {
    createEventDraft.mockResolvedValue({ ...EVENT, eventId: "evt-9" });
    renderOrganiser();
    fireEvent.click(screen.getByRole("radio", { name: RESERVED }));
    expect(within(seatingGroup()).getByText(/seat map’s price tiers/)).toBeInTheDocument();
    expect(within(seatingGroup()).getByText(/Saving takes you to the seat map/)).toBeInTheDocument();

    fillNewEvent();
    fireEvent.click(screen.getByRole("button", { name: "Save draft and set up seats" }));

    await waitFor(() => expect(push).toHaveBeenCalledWith("/dashboard/evt-9/seat-map"));
    expect(push).toHaveBeenCalledTimes(1);
    // No seating field is invented: the same draft as general admission (with its refund policy, the default,
    // and the suburb's state and zone).
    const [input] = createEventDraft.mock.calls[0];
    expect(Object.keys(input).sort()).toEqual(
      [
        "category",
        "description",
        "end",
        "refundPolicy",
        "start",
        "state",
        "suburb",
        "ticketTypes",
        "timeZone",
        "title",
        "venueAddress",
        "venueName",
      ].sort(),
    );
    expect(input).toMatchObject({ suburb: "Collingwood", state: "VIC", timeZone: "Australia/Melbourne" });
    expect(input.refundPolicy).toBe("no_change_of_mind");
  });

  it("with general admission: saving goes to the event, as before", async () => {
    createEventDraft.mockResolvedValue({ ...EVENT, eventId: "evt-9" });
    renderOrganiser();
    fireEvent.click(screen.getByRole("radio", { name: RESERVED }));
    fireEvent.click(screen.getByRole("radio", { name: GENERAL }));
    fillNewEvent();
    fireEvent.click(screen.getByRole("button", { name: "Save draft" }));
    await waitFor(() => expect(push).toHaveBeenCalledWith("/dashboard/evt-9"));
  });
});

describe("EventEditor seating — organiser, existing event", () => {
  it("without a seat map: general admission; choosing reserved links to add one, and saving stays put", async () => {
    updateEventDraft.mockResolvedValue({ ...EVENT });
    const { onSaved } = renderOrganiser(EVENT);
    expect(screen.getByRole("radio", { name: GENERAL })).toBeChecked();
    expect(within(seatingGroup()).queryByRole("link")).toBeNull();

    fireEvent.click(screen.getByRole("radio", { name: RESERVED }));
    expect(within(seatingGroup()).getByRole("link", { name: "Add a seat map" })).toHaveAttribute("href", "/dashboard/evt-1/seat-map");

    fireEvent.click(screen.getByRole("button", { name: "Save draft" }));
    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
    expect(push).not.toHaveBeenCalled();
  });

  it("with a seat map: reserved, linked; choosing general admission explains where to remove it and removes nothing", async () => {
    const seated: EventRecord = { ...EVENT, seating: { version: 3, seatCount: 120 } };
    updateEventDraft.mockResolvedValue(seated);
    const { onSaved } = renderOrganiser(seated);
    expect(screen.getByRole("radio", { name: RESERVED })).toBeChecked();
    expect(within(seatingGroup()).getByRole("link", { name: "Seat map · 120 seats" })).toHaveAttribute(
      "href",
      "/dashboard/evt-1/seat-map",
    );

    fireEvent.click(screen.getByRole("radio", { name: GENERAL }));
    expect(within(seatingGroup()).getByText(/This event has a seat map \(120 seats\)/)).toBeInTheDocument();
    expect(within(seatingGroup()).getByRole("link", { name: "Open the seat map to remove it" })).toHaveAttribute(
      "href",
      "/dashboard/evt-1/seat-map",
    );

    fireEvent.click(screen.getByRole("button", { name: "Save draft" }));
    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
    expect(updateEventDraft.mock.calls[0][1]).not.toHaveProperty("seating");
    expect(push).not.toHaveBeenCalled();
  });

  it("approved before (rejected since): the choice is shown but can't be changed", () => {
    renderOrganiser({ ...EVENT, status: "rejected", ticketingLocked: true, seating: { version: 3, seatCount: 120 } });
    expect(screen.getByRole("radio", { name: RESERVED })).toBeDisabled();
    expect(screen.getByRole("radio", { name: GENERAL })).toBeDisabled();
    expect(within(seatingGroup()).getByText(/Contact Sheltüh/)).toBeInTheDocument();
    expect(within(seatingGroup()).getByRole("link", { name: "Seat map · 120 seats" })).toBeInTheDocument();
  });

  it("is hidden for an event ticketed on another site", () => {
    renderOrganiser({
      ...EVENT,
      ticketingMode: "external",
      externalTicketUrl: "https://events.humanitix.com/neon",
      externalProvider: "Humanitix",
      ticketTypes: [],
    });
    expect(screen.queryByRole("group", { name: "Seating" })).toBeNull();
    expect(screen.queryByRole("radio", { name: RESERVED })).toBeNull();
  });
});

describe("EventEditor seating — admin", () => {
  beforeEach(() => {
    adminListOrganisers.mockResolvedValue({ items: [ORGANISER] });
  });

  it("a new event with reserved seating is created, then opens the admin seat-map page", async () => {
    adminCreateEvent.mockResolvedValue({ ...ADMIN_EVENT, eventId: "evt-9" });
    renderAdmin();
    await pickOrganiser();
    fireEvent.click(screen.getByRole("radio", { name: RESERVED }));
    expect(within(seatingGroup()).getByText(/tickets sell as general admission/)).toBeInTheDocument();
    fillNewEvent();
    fireEvent.click(screen.getByRole("button", { name: "Create event and set up seats" }));
    await waitFor(() => expect(push).toHaveBeenCalledWith("/admin/events/evt-9/seat-map"));
    expect(adminCreateEvent.mock.calls[0][0]).not.toHaveProperty("seating");
  });

  it("a new general admission event opens its edit page, as before", async () => {
    adminCreateEvent.mockResolvedValue({ ...ADMIN_EVENT, eventId: "evt-9" });
    renderAdmin();
    await pickOrganiser();
    fillNewEvent();
    fireEvent.click(screen.getByRole("button", { name: "Create event" }));
    await waitFor(() => expect(push).toHaveBeenCalledWith("/admin/events/evt-9/edit"));
  });

  it("switching to another site hides the choice, and the new event opens its edit page", async () => {
    adminCreateEvent.mockResolvedValue({ ...ADMIN_EVENT, eventId: "evt-9", ticketingMode: "external" });
    renderAdmin();
    await pickOrganiser();
    fireEvent.click(screen.getByRole("radio", { name: RESERVED }));
    fireEvent.click(screen.getByLabelText("On another site"));
    expect(screen.queryByRole("group", { name: "Seating" })).toBeNull();
    fillNewEventWithoutTickets();
    fireEvent.change(screen.getByLabelText("Ticket page address"), { target: { value: "https://events.humanitix.com/neon" } });
    fireEvent.click(screen.getByRole("button", { name: "Create event" }));
    await waitFor(() => expect(push).toHaveBeenCalledWith("/admin/events/evt-9/edit"));
  });

  it("an existing event's seat map link goes to the admin seat-map page", () => {
    renderAdmin({ ...ADMIN_EVENT, status: "published", ticketingLocked: true, seating: { version: 3, seatCount: 120 } });
    expect(screen.getByRole("radio", { name: RESERVED })).toBeChecked();
    // Admins can change a seat map at any status (while there are no orders).
    expect(screen.getByRole("radio", { name: GENERAL })).toBeEnabled();
    expect(within(seatingGroup()).getByRole("link", { name: "Seat map · 120 seats" })).toHaveAttribute(
      "href",
      "/admin/events/evt-1/seat-map",
    );
  });
});
