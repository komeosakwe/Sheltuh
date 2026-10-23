// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import AdminOrganiserPicker, { ORGANISER_PICKER_PAGE } from "@/components/admin/AdminOrganiserPicker";
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

/** The admin editor's props (the organiser's are typed apart: their onSaved gets an EventRecord). */
type AdminEditorProps = Extract<Parameters<typeof EventEditor>[0], { mode: "admin" }>;

function renderEditor(props: Partial<AdminEditorProps> = {}) {
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
    expect(adminListOrganisers).toHaveBeenCalledWith(
      { status: "approved", q: undefined, limit: ORGANISER_PICKER_PAGE },
      expect.any(Function),
    );

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

describe("AdminOrganiserPicker", () => {
  const getToken = vi.fn().mockResolvedValue("token");
  const named = (from: number, count: number, prefix = "Organiser") =>
    Array.from({ length: count }, (_, i) =>
      organiserRecord({ organiserId: `org-${from + i}`, displayName: `${prefix} ${String(from + i).padStart(3, "0")}` }),
    );
  const options = () => screen.getAllByRole("option").filter((o) => o.getAttribute("value"));
  const lastQuery = () => adminListOrganisers.mock.lastCall?.[0];

  it("loads one page of approved organisers, sorted by name, and says nothing about more when that's all", async () => {
    adminListOrganisers.mockResolvedValue({ items: [PLATFORM, OWNED] });
    render(<AdminOrganiserPicker getToken={getToken} value={null} onChange={vi.fn()} />);
    await waitFor(() => expect(options()).toHaveLength(2));
    expect(options().map((o) => o.textContent)).toEqual(["Sheltüh Presents (platform-managed)", "Static Collective"]);
    expect(adminListOrganisers).toHaveBeenCalledTimes(1);
    expect(adminListOrganisers).toHaveBeenCalledWith({ status: "approved", q: undefined, limit: ORGANISER_PICKER_PAGE }, getToken);
    expect(screen.queryByText(/type to search/)).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("");
  });

  it("past one page, says so (tied to the select) and finds an organiser beyond it on the server", async () => {
    const beyond = organiserRecord({ organiserId: "org-beyond", ownerUserId: undefined, displayName: "Zebra Nights" });
    adminListOrganisers.mockImplementation(async ({ q }: { q?: string }) =>
      q ? { items: [beyond] } : { items: named(0, ORGANISER_PICKER_PAGE), nextCursor: "c1" },
    );
    const onChange = vi.fn();
    render(<AdminOrganiserPicker getToken={getToken} value={null} onChange={onChange} />);
    const note = await screen.findByText(`Showing ${ORGANISER_PICKER_PAGE} organisers — type to search for others.`);
    expect(options()).toHaveLength(ORGANISER_PICKER_PAGE);
    expect(screen.queryByRole("option", { name: /Zebra Nights/ })).toBeNull();
    expect(screen.getByLabelText("Organiser").getAttribute("aria-describedby")).toContain(note.id);

    fireEvent.change(screen.getByLabelText("Search organisers"), { target: { value: "  zébra " } });
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("1 organiser matches."));
    expect(lastQuery()).toEqual({ status: "approved", q: "zébra", limit: ORGANISER_PICKER_PAGE });
    expect(options().map((o) => o.textContent)).toEqual(["Zebra Nights (platform-managed)"]);
    expect(screen.queryByText(/type to search/)).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Organiser"), { target: { value: "org-beyond" } });
    expect(onChange).toHaveBeenCalledWith({ organiserId: "org-beyond", displayName: "Zebra Nights", platformManaged: true });
  });

  it("waits for a pause in typing, then searches once with the latest text", async () => {
    adminListOrganisers.mockResolvedValue({ items: [OWNED] });
    render(<AdminOrganiserPicker getToken={getToken} value={null} onChange={vi.fn()} />);
    await waitFor(() => expect(adminListOrganisers).toHaveBeenCalledTimes(1));
    const filter = screen.getByLabelText("Search organisers");
    fireEvent.change(filter, { target: { value: "s" } });
    fireEvent.change(filter, { target: { value: "st" } });
    fireEvent.change(filter, { target: { value: "sta" } });
    expect(adminListOrganisers).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("1 organiser matches."));
    expect(adminListOrganisers).toHaveBeenCalledTimes(2);
    expect(lastQuery()).toMatchObject({ q: "sta" });
  });

  it("ignores a slower, older search's answer", async () => {
    let releaseOld: (value: unknown) => void = () => {};
    adminListOrganisers.mockImplementation(async ({ q }: { q?: string }) => {
      if (q === "old") return new Promise((resolve) => (releaseOld = resolve));
      if (q === "new") return { items: [OWNED] };
      return { items: [OWNED, PLATFORM] };
    });
    render(<AdminOrganiserPicker getToken={getToken} value={null} onChange={vi.fn()} />);
    await waitFor(() => expect(options()).toHaveLength(2));
    const filter = screen.getByLabelText("Search organisers");
    fireEvent.change(filter, { target: { value: "old" } });
    await waitFor(() => expect(lastQuery()).toMatchObject({ q: "old" }));
    fireEvent.change(filter, { target: { value: "new" } });
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("1 organiser matches."));
    releaseOld({ items: named(0, 3, "Stale") });
    await new Promise((r) => setTimeout(r, 20));
    expect(options().map((o) => o.textContent)).toEqual(["Static Collective"]);
  });

  it("announces many and no matches, and keeps the chosen organiser selectable", async () => {
    adminListOrganisers.mockImplementation(async ({ q }: { q?: string }) => {
      if (q === "zzz") return { items: [] };
      if (q === "organiser") return { items: named(100, ORGANISER_PICKER_PAGE), nextCursor: "c1" };
      return { items: [OWNED, PLATFORM] };
    });
    const chosen = { organiserId: "org-3", displayName: "Northside Records", platformManaged: false };
    const onChange = vi.fn();
    render(<AdminOrganiserPicker getToken={getToken} value={chosen} onChange={onChange} />);
    await waitFor(() => expect(options()).toHaveLength(3));
    const filter = screen.getByLabelText("Search organisers");

    fireEvent.change(filter, { target: { value: "zzz" } });
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("No organisers match “zzz”."));
    // The chosen organiser is still its option, so the select never goes blank.
    expect(screen.getByLabelText("Organiser")).toHaveValue("org-3");
    expect(options().map((o) => o.textContent)).toEqual(["Northside Records"]);

    fireEvent.change(filter, { target: { value: "organiser" } });
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent(`More than ${ORGANISER_PICKER_PAGE} organisers match.`));
    expect(screen.getByText(`Showing the first ${ORGANISER_PICKER_PAGE} matches — keep typing to narrow them down.`)).toBeInTheDocument();
    expect(options()).toHaveLength(ORGANISER_PICKER_PAGE + 1);

    fireEvent.change(filter, { target: { value: "" } });
    await waitFor(() => expect(options()).toHaveLength(3));
    fireEvent.change(screen.getByLabelText("Organiser"), { target: { value: "org-1" } });
    expect(onChange).toHaveBeenCalledWith({ organiserId: "org-1", displayName: "Static Collective", platformManaged: false });
  });

  it("says when organisers couldn't be loaded", async () => {
    adminListOrganisers.mockRejectedValue(new Error("Network down."));
    render(<AdminOrganiserPicker getToken={getToken} value={null} onChange={vi.fn()} />);
    expect(await screen.findByRole("alert")).toHaveTextContent("Network down.");
  });

  it("explains that admins check in a platform-managed organiser's events", async () => {
    adminListOrganisers.mockResolvedValue({ items: [OWNED] });
    render(<AdminOrganiserPicker getToken={getToken} value={null} onChange={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Create a platform-managed organiser" }));
    const group = screen.getByRole("group", { name: "New platform-managed organiser" });
    expect(group).toHaveTextContent("Sheltüh admins check tickets in at the door");
    expect(group).not.toHaveTextContent(/no check-in/i);
  });

  it("Enter in the filter doesn't submit the event form around it", async () => {
    adminListOrganisers.mockResolvedValue({ items: [OWNED] });
    const onSubmit = vi.fn((e: { preventDefault: () => void }) => e.preventDefault());
    render(
      <form onSubmit={onSubmit}>
        <AdminOrganiserPicker getToken={getToken} value={null} onChange={vi.fn()} />
      </form>,
    );
    const filter = screen.getByLabelText("Search organisers");
    await waitFor(() => expect(screen.getByLabelText("Organiser")).not.toBeDisabled());
    const enter = fireEvent.keyDown(filter, { key: "Enter" });
    expect(enter).toBe(false); // default prevented
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
