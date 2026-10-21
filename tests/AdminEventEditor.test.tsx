// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import EventEditor from "@/components/dashboard/EventEditor";
import { ApiError } from "@/lib/api/client";
import type { AdminEventRecord, AdminOrganiserRecord, EventRecord } from "@/lib/api/types";
import { fakeAuthValue, FakeAuthProvider } from "./test-utils/fakeAuth";

const push = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
}));

const updateEventDraft = vi.fn();
const createEventDraft = vi.fn();
const submitEventForReview = vi.fn();
vi.mock("@/lib/api/events", () => ({
  updateEventDraft: (...args: unknown[]) => updateEventDraft(...args),
  createEventDraft: (...args: unknown[]) => createEventDraft(...args),
  submitEventForReview: (...args: unknown[]) => submitEventForReview(...args),
}));

const adminListOrganisers = vi.fn();
const adminCreateOrganiser = vi.fn();
const adminCreateEvent = vi.fn();
const adminUpdateEvent = vi.fn();
vi.mock("@/lib/api/admin", () => ({
  adminListOrganisers: (...args: unknown[]) => adminListOrganisers(...args),
  adminCreateOrganiser: (...args: unknown[]) => adminCreateOrganiser(...args),
  adminCreateEvent: (...args: unknown[]) => adminCreateEvent(...args),
  adminUpdateEvent: (...args: unknown[]) => adminUpdateEvent(...args),
  adminUploadEventImage: vi.fn(),
  adminDeleteEventImage: vi.fn(),
}));

afterEach(cleanup);
beforeEach(() => {
  for (const fn of [push, updateEventDraft, createEventDraft, submitEventForReview, adminListOrganisers,
    adminCreateOrganiser, adminCreateEvent, adminUpdateEvent]) fn.mockReset();
});

function organiserRecord(overrides: Partial<AdminOrganiserRecord>): AdminOrganiserRecord {
  return {
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
    ...overrides,
  };
}

const OWNED = organiserRecord({});
const PLATFORM = organiserRecord({ organiserId: "org-2", ownerUserId: undefined, displayName: "Sheltüh Presents" });

const EVENT: AdminEventRecord = {
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
  ticketTypes: [{ id: "ga", name: "General admission", priceCents: 3000, feePolicy: "buyer-pays", quantityAvailable: 10 }],
  ticketingMode: "sheltuh",
  externalFree: false,
  externalProvider: null,
  ticketingLocked: true,
  status: "published",
  moderationLog: [],
  createdAt: "2026-10-01T00:00:00.000Z",
  updatedAt: "2026-10-20T01:02:03.456Z",
  organiserPlatformManaged: false,
};

function renderEditor(props: Partial<Parameters<typeof EventEditor>[0]> = {}) {
  render(
    <FakeAuthProvider value={fakeAuthValue({ email: "admin@sheltuh.example", isAdmin: true })}>
      <EventEditor mode="admin" getToken={vi.fn().mockResolvedValue("token")} onSaved={vi.fn()} {...props} />
    </FakeAuthProvider>,
  );
}

function fillEventFields() {
  fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Neon Static" } });
  fireEvent.change(screen.getByLabelText("Description"), { target: { value: "Four bands." } });
  fireEvent.change(screen.getByLabelText("Venue name"), { target: { value: "The Tote" } });
  fireEvent.change(screen.getByLabelText("Venue address"), { target: { value: "71 Johnston St" } });
  fireEvent.change(screen.getByLabelText("Suburb"), { target: { value: "Collingwood" } });
  fireEvent.change(screen.getByLabelText("Start date"), { target: { value: "2027-03-06" } });
  fireEvent.change(screen.getByLabelText("Start time"), { target: { value: "20:00" } });
  fireEvent.change(screen.getByLabelText("End date"), { target: { value: "2027-03-06" } });
  fireEvent.change(screen.getByLabelText("End time"), { target: { value: "23:30" } });
}

async function pickOrganiser(organiserId: string) {
  const select = screen.getByLabelText("Organiser");
  await waitFor(() => expect(select).not.toBeDisabled());
  fireEvent.change(select, { target: { value: organiserId } });
}

describe("EventEditor (admin) — a new event", () => {
  beforeEach(() => {
    adminListOrganisers.mockResolvedValue({ items: [OWNED, PLATFORM] });
  });

  it("lists approved organisers, marking platform-managed ones, and creates and publishes for the one picked", async () => {
    adminCreateEvent.mockResolvedValue({ ...EVENT, eventId: "evt-new" });
    renderEditor();
    await waitFor(() => expect(screen.getByRole("option", { name: "Sheltüh Presents (platform-managed)" })).toBeInTheDocument());
    expect(adminListOrganisers).toHaveBeenCalledWith("approved", expect.any(Function), undefined);

    await pickOrganiser("org-1");
    fillEventFields();
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "General admission" } });
    fireEvent.change(screen.getByLabelText("Price (A$)"), { target: { value: "30" } });
    fireEvent.click(screen.getByLabelText("Publish straight away"));
    fireEvent.click(screen.getByRole("button", { name: "Create event" }));

    await waitFor(() => expect(adminCreateEvent).toHaveBeenCalledTimes(1));
    const [input] = adminCreateEvent.mock.calls[0];
    expect(input).toMatchObject({
      organiserId: "org-1",
      publish: true,
      title: "Neon Static",
      ticketingMode: "sheltuh",
      externalTicketUrl: null,
      externalFree: false,
      start: { date: "2027-03-06", time: "20:00" },
    });
    expect(input.ticketTypes[0]).toMatchObject({ priceCents: 3000 });
    await waitFor(() => expect(push).toHaveBeenCalledWith("/admin/events/evt-new/edit"));
    // The organiser-only routes are never used.
    expect(createEventDraft).not.toHaveBeenCalled();
  });

  it("asks for an organiser before saving", async () => {
    renderEditor();
    fillEventFields();
    fireEvent.click(screen.getByRole("button", { name: "Create event" }));
    await waitFor(() => expect(screen.getByText("Choose an organiser.")).toBeInTheDocument());
    expect(adminCreateEvent).not.toHaveBeenCalled();
  });

  it("only allows free tickets or external ticketing for a platform-managed organiser", async () => {
    adminCreateEvent.mockResolvedValue({ ...EVENT, eventId: "evt-new" });
    renderEditor();
    await pickOrganiser("org-2");
    expect(screen.getByText(/can only offer free tickets here, or link to another site/)).toBeInTheDocument();
    fillEventFields();
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Entry" } });
    fireEvent.change(screen.getByLabelText("Price (A$)"), { target: { value: "10" } });
    fireEvent.click(screen.getByRole("button", { name: "Create event" }));
    await waitFor(() =>
      expect(screen.getAllByText(/A platform-managed organiser can only offer free tickets here/).length).toBeGreaterThan(1),
    );
    expect(adminCreateEvent).not.toHaveBeenCalled();

    // Selling on another site instead: no ticket types, the link is sent.
    fireEvent.click(screen.getByLabelText("On another site"));
    expect(screen.queryByLabelText("Price (A$)")).toBeNull();
    fireEvent.change(screen.getByLabelText("Ticket page address"), { target: { value: "https://events.humanitix.com/neon" } });
    fireEvent.click(screen.getByLabelText("Entry is free"));
    fireEvent.click(screen.getByRole("button", { name: "Create event" }));
    await waitFor(() => expect(adminCreateEvent).toHaveBeenCalledTimes(1));
    expect(adminCreateEvent.mock.calls[0][0]).toMatchObject({
      organiserId: "org-2",
      ticketingMode: "external",
      externalTicketUrl: "https://events.humanitix.com/neon",
      externalFree: true,
      ticketTypes: [],
      publish: false,
    });
  });

  it("refuses a link shortener before sending anything", async () => {
    renderEditor();
    await pickOrganiser("org-1");
    fillEventFields();
    fireEvent.click(screen.getByLabelText("On another site"));
    fireEvent.change(screen.getByLabelText("Ticket page address"), { target: { value: "https://bit.ly/abc" } });
    fireEvent.click(screen.getByRole("button", { name: "Create event" }));
    await waitFor(() => expect(screen.getByLabelText("Ticket page address")).toHaveAttribute("aria-invalid", "true"));
    expect(adminCreateEvent).not.toHaveBeenCalled();
  });

  it("creates a platform-managed organiser inline and selects it", async () => {
    adminCreateOrganiser
      .mockRejectedValueOnce(new ApiError(400, "Please fix the highlighted fields.", { contactEmail: "Enter a valid email address." }))
      .mockResolvedValueOnce(organiserRecord({ organiserId: "org-3", ownerUserId: undefined, displayName: "Laneway Nights" }));
    renderEditor();
    await pickOrganiser("org-1");
    fireEvent.click(screen.getByRole("button", { name: "Create a platform-managed organiser" }));
    const group = screen.getByRole("group", { name: "New platform-managed organiser" });
    fireEvent.change(within(group).getByLabelText("Name"), { target: { value: "Laneway Nights" } });
    fireEvent.change(within(group).getByLabelText("Contact email"), { target: { value: "bad" } });
    fireEvent.change(within(group).getByLabelText("Description"), { target: { value: "Laneway gigs." } });
    fireEvent.click(within(group).getByLabelText("Live music"));
    fireEvent.click(within(group).getByRole("button", { name: "Create organiser" }));
    await waitFor(() => expect(within(group).getByText("Enter a valid email address.")).toBeInTheDocument());

    fireEvent.change(within(group).getByLabelText("Contact email"), { target: { value: "hi@laneway.example" } });
    fireEvent.click(within(group).getByRole("button", { name: "Create organiser" }));
    await waitFor(() => expect(screen.getByLabelText("Organiser")).toHaveValue("org-3"));
    expect(adminCreateOrganiser).toHaveBeenLastCalledWith(
      {
        displayName: "Laneway Nights",
        contactEmail: "hi@laneway.example",
        description: "Laneway gigs.",
        categories: ["live-music"],
        websiteUrl: null,
      },
      expect.any(Function),
    );
    expect(screen.queryByRole("group", { name: "New platform-managed organiser" })).toBeNull();
    expect(screen.getByText(/can only offer free tickets here/)).toBeInTheDocument();
  });
});

describe("EventEditor (admin) — editing", () => {
  it("edits a published event (no lock, no review step) against the version it loaded, then the saved one", async () => {
    const saved = { ...EVENT, title: "Encore", updatedAt: "2026-10-21T00:00:00.000Z" };
    adminUpdateEvent.mockResolvedValueOnce(saved).mockResolvedValueOnce({ ...saved, updatedAt: "2026-10-21T00:00:01.000Z" });
    const onSaved = vi.fn();
    renderEditor({ initial: EVENT, onSaved });
    expect(screen.queryByText(/can.t be edited/)).toBeNull();
    expect(screen.queryByRole("button", { name: "Submit for review" })).toBeNull();
    expect(screen.queryByLabelText("Publish when saved")).toBeNull();
    expect(screen.getByText(/your changes go live as soon as you save/)).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Encore" } });
    fireEvent.change(screen.getByLabelText(/Note for the event.s log/), { target: { value: "Venue asked." } });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith(saved));
    expect(adminUpdateEvent.mock.calls[0][0]).toBe("evt-1");
    expect(adminUpdateEvent.mock.calls[0][1]).toMatchObject({
      title: "Encore",
      ticketingMode: "sheltuh",
      expectedUpdatedAt: EVENT.updatedAt,
      publish: false,
      reason: "Venue asked.",
    });

    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(adminUpdateEvent).toHaveBeenCalledTimes(2));
    expect(adminUpdateEvent.mock.calls[1][1]).toMatchObject({ expectedUpdatedAt: saved.updatedAt, reason: null });
    expect(updateEventDraft).not.toHaveBeenCalled();
  });

  it("publishes a draft when asked", async () => {
    adminUpdateEvent.mockResolvedValue({ ...EVENT, status: "published" });
    renderEditor({ initial: { ...EVENT, status: "draft", ticketingLocked: false } });
    fireEvent.click(screen.getByLabelText("Publish when saved"));
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(adminUpdateEvent).toHaveBeenCalledTimes(1));
    expect(adminUpdateEvent.mock.calls[0][1].publish).toBe(true);
  });

  it("explains a conflict and offers to reload, keeping what was typed", async () => {
    adminUpdateEvent.mockRejectedValue(
      new ApiError(409, "Someone else changed this event.", { expectedUpdatedAt: "Someone else changed this event." }),
    );
    const onReload = vi.fn();
    renderEditor({ initial: EVENT, onReload });
    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "My edit" } });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Someone else changed this event since you opened it.");
    expect(alert).toHaveTextContent("Your changes haven’t been saved.");
    expect(screen.getByLabelText("Title")).toHaveValue("My edit");
    fireEvent.click(within(alert).getByRole("button", { name: "Reload latest version" }));
    expect(onReload).toHaveBeenCalledTimes(1);
  });

  it("shows the server's reason error when changing an approved event's ticketing", async () => {
    adminUpdateEvent.mockRejectedValue(
      new ApiError(400, "Please fix the highlighted fields.", { reason: "Give a reason for changing where an approved event's tickets are sold." }),
    );
    renderEditor({ initial: EVENT });
    fireEvent.click(screen.getByLabelText("On another site"));
    fireEvent.change(screen.getByLabelText("Ticket page address"), { target: { value: "https://events.humanitix.com/neon" } });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(screen.getByText(/Give a reason for changing/)).toBeInTheDocument());
    expect(adminUpdateEvent.mock.calls[0][1]).toMatchObject({ ticketingMode: "external", ticketTypes: [] });
  });

  it("names a platform-managed event's organiser and keeps its tickets free", async () => {
    renderEditor({ initial: { ...EVENT, organiserName: "Sheltüh Presents", organiserPlatformManaged: true } });
    expect(screen.getByText(/Sheltüh Presents \(platform-managed\)/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() =>
      expect(screen.getAllByText(/A platform-managed organiser can only offer free tickets here/).length).toBeGreaterThan(1),
    );
    expect(adminUpdateEvent).not.toHaveBeenCalled();
  });
});

describe("EventEditor (organiser) — an external event", () => {
  it("saves it with its ticketing unchanged and no ticket types", async () => {
    const external: EventRecord = {
      ...EVENT,
      status: "draft",
      ticketTypes: [],
      ticketingMode: "external",
      externalTicketUrl: "https://events.humanitix.com/neon",
      externalProvider: "Humanitix",
      externalFree: true,
    };
    updateEventDraft.mockResolvedValue(external);
    render(
      <FakeAuthProvider value={fakeAuthValue({ email: "owner@example.com" })}>
        <EventEditor getToken={vi.fn().mockResolvedValue("token")} initial={external} onSaved={vi.fn()} />
      </FakeAuthProvider>,
    );
    expect(screen.getByText("Tickets are sold on Humanitix")).toBeInTheDocument();
    expect(screen.queryByLabelText("Price (A$)")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Save draft" }));
    await waitFor(() => expect(updateEventDraft).toHaveBeenCalledTimes(1));
    expect(updateEventDraft.mock.calls[0][1]).toMatchObject({
      ticketTypes: [],
      ticketingMode: "external",
      externalTicketUrl: "https://events.humanitix.com/neon",
      externalFree: true,
    });
  });
});
