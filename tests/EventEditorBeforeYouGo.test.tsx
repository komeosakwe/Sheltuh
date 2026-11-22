// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import EventEditor, { BEFORE_YOU_GO_HINT } from "@/components/dashboard/EventEditor";
import { ApiError } from "@/lib/api/client";
import type { AdminEventRecord, EventRecord } from "@/lib/api/types";
import { BEFORE_YOU_GO_TOO_MANY, beforeYouGoHalfFilled, beforeYouGoNoLinks } from "@/lib/before-you-go";
import { fakeAuthValue, FakeAuthProvider } from "./test-utils/fakeAuth";
import { currentStep, showStep } from "./test-utils/editorSteps";
import { stubMatchMedia, unstubMatchMedia } from "./test-utils/pinMapStub";

// The suburb table, stubbed: these tests aren't about the suburb (tests/VenueSuburbField.test.tsx is).
vi.mock("@/lib/location-loader", async () => (await import("./test-utils/locationStub")).locationLoaderStub());
vi.mock("@/components/dashboard/VenuePinMapLeaflet", async () => (await import("./test-utils/pinMapStub")).leafletStub());

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
    publishConflictCode: actual.publishConflictCode,
    updateEventDraft: (...args: unknown[]) => updateEventDraft(...args),
    createEventDraft: (...args: unknown[]) => createEventDraft(...args),
    publishEvent: vi.fn(),
    uploadEventImage: vi.fn(),
    deleteEventImage: vi.fn(),
  };
});

const adminUpdateEvent = vi.fn();
vi.mock("@/lib/api/admin", () => ({
  adminListOrganisers: vi.fn(),
  adminCreateOrganiser: vi.fn(),
  adminCreateEvent: vi.fn(),
  adminUpdateEvent: (...args: unknown[]) => adminUpdateEvent(...args),
  adminUploadEventImage: vi.fn(),
  adminDeleteEventImage: vi.fn(),
}));

afterEach(() => {
  cleanup();
  unstubMatchMedia();
});
beforeEach(() => {
  stubMatchMedia();
  updateEventDraft.mockReset();
  createEventDraft.mockReset();
  adminUpdateEvent.mockReset();
});

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
  ticketTypes: [{ id: "ga", name: "General admission", priceCents: 3000, feePolicy: "buyer-pays", quantityAvailable: 10 }],
  ticketingMode: "sheltuh",
  status: "draft",
  moderationLog: [],
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

// TEMPORARY (until the rows UI): the textarea holds "Label: value" lines (components/dashboard/editor/before-you-go-text.ts).
const ROWS = [
  { label: "Entry", value: "7:30 pm – 10:30 pm" },
  { label: "Age", value: "18+ · Photo ID required" },
];
const TEXT = "Entry: 7:30 pm – 10:30 pm\nAge: 18+ · Photo ID required";

/** The organiser's editor: on `initial` (a saved draft), or with `null` on a new event. */
function renderEditor(initial: EventRecord | null = EVENT) {
  render(
    <FakeAuthProvider value={fakeAuthValue({ email: "owner@example.com" })}>
      <EventEditor getToken={vi.fn().mockResolvedValue("token")} initial={initial ?? undefined} onSaved={vi.fn()} />
    </FakeAuthProvider>,
  );
}

// By its label: found on any step (the other steps' panels are hidden, so a role query wouldn't find it there).
const field = () => screen.getByLabelText("Before you go (optional)");
const save = () => fireEvent.click(screen.getByRole("button", { name: /^Save draft/ }));

async function sentInput(): Promise<Record<string, unknown>> {
  await waitFor(() => expect(updateEventDraft).toHaveBeenCalledTimes(1));
  return updateEventDraft.mock.calls[0][1] as Record<string, unknown>;
}

describe("EventEditor — Before you go", () => {
  it("is an optional textarea in Event details, labelled, with its hint as its description and the reference rows", () => {
    renderEditor();
    const box = field();
    expect(box.tagName).toBe("TEXTAREA");
    expect(box).toHaveValue("");
    expect(box).toHaveAccessibleDescription(BEFORE_YOU_GO_HINT);
    expect(box).toHaveAttribute("placeholder", expect.stringContaining("Entry: 7:30 pm – 10:30 pm"));
    expect(box).not.toHaveAttribute("aria-invalid");
    // In the Event details card, after the description.
    const details = screen.getByRole("heading", { name: "Event details" }).closest("section");
    expect(details).not.toBeNull();
    if (details) expect(within(details as HTMLElement).getByLabelText("Before you go (optional)")).toBe(box);
    const description = screen.getByLabelText("Description");
    expect(description.compareDocumentPosition(box) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("sends what's typed as beforeYouGo rows, cleaned as the API stores them", async () => {
    updateEventDraft.mockResolvedValue({ ...EVENT, beforeYouGo: ROWS });
    renderEditor();
    fireEvent.change(field(), { target: { value: `${TEXT}   \n\n\n Extras :  🎟️ Bring your ticket ` } });
    save();
    expect((await sentInput()).beforeYouGo).toEqual([...ROWS, { label: "Extras", value: "🎟️ Bring your ticket" }]);
  });

  it("shows saved rows, sends them back unchanged, and sends null once they're cleared", async () => {
    updateEventDraft.mockResolvedValue({ ...EVENT, beforeYouGo: ROWS });
    renderEditor({ ...EVENT, beforeYouGo: ROWS });
    expect(field()).toHaveValue(TEXT);
    save();
    expect((await sentInput()).beforeYouGo).toEqual(ROWS);

    updateEventDraft.mockClear();
    updateEventDraft.mockResolvedValue({ ...EVENT });
    fireEvent.change(field(), { target: { value: "  \n " } });
    save();
    const input = await sentInput();
    expect(input).toHaveProperty("beforeYouGo", null);
  });

  it("a new event sends its rows with the draft", async () => {
    createEventDraft.mockResolvedValue({ ...EVENT, eventId: "evt-new", beforeYouGo: ROWS });
    renderEditor(null);
    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Neon Static" } });
    fireEvent.change(screen.getByLabelText("Description"), { target: { value: "Four bands." } });
    fireEvent.change(field(), { target: { value: TEXT } });
    fireEvent.change(screen.getByLabelText("Venue name"), { target: { value: "The Tote" } });
    fireEvent.change(screen.getByLabelText("Venue address"), { target: { value: "71 Johnston St" } });
    fireEvent.change(screen.getByLabelText("Suburb or town"), { target: { value: "Collingwood" } });
    fireEvent.change(screen.getByLabelText("Start date"), { target: { value: "2027-03-06" } });
    fireEvent.change(screen.getByLabelText("Start time"), { target: { value: "20:00" } });
    fireEvent.change(screen.getByLabelText("End date"), { target: { value: "2027-03-06" } });
    fireEvent.change(screen.getByLabelText("End time"), { target: { value: "23:30" } });
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "General admission" } });
    save();
    await waitFor(() => expect(createEventDraft).toHaveBeenCalledTimes(1));
    expect(createEventDraft.mock.calls[0][0]).toMatchObject({ beforeYouGo: ROWS });
  });

  it.each([
    ["six rows", "A: 1\nB: 2\nC: 3\nD: 4\nE: 5\nF: 6", BEFORE_YOU_GO_TOO_MANY],
    ["a link", "Tickets: sheltuh.com.au/neon", beforeYouGoNoLinks(1, "value")],
    ["a row without a label", "Entry: 7 pm\nBring ID", beforeYouGoHalfFilled(2)],
  ])("refuses %s by the field, before sending: invalid, described by the error, focused, in the summary", async (_name, text, message) => {
    renderEditor();
    showStep(2);
    fireEvent.change(field(), { target: { value: text } });
    save();
    await waitFor(() => expect(field()).toHaveAttribute("aria-invalid", "true"));
    expect(updateEventDraft).not.toHaveBeenCalled();
    expect(field()).toHaveAccessibleDescription(`${message} ${BEFORE_YOU_GO_HINT}`);
    // Back on the Event page step, with the field focused (its error is read with it).
    expect(currentStep()).toBe(1);
    await waitFor(() => expect(field()).toHaveFocus());
    // In the error summary, as "Before you go: …" (a button that jumps to the field).
    expect(screen.getByRole("button", { name: `Before you go: ${message}` })).toBeInTheDocument();

    // Editing it clears the error.
    fireEvent.change(field(), { target: { value: "Entry: 7 pm" } });
    expect(field()).not.toHaveAttribute("aria-invalid");
    expect(field()).toHaveAccessibleDescription(BEFORE_YOU_GO_HINT);
  });

  it("shows the API's fieldErrors.beforeYouGo by the field (the source of truth), focused", async () => {
    const message = "Row 1's value can't include email addresses.";
    updateEventDraft.mockRejectedValue(
      new ApiError(400, "Validation failed", { beforeYouGo: message }),
    );
    renderEditor();
    fireEvent.change(field(), { target: { value: "Entry: 7 pm" } });
    showStep(3);
    save();
    await waitFor(() => expect(field()).toHaveAttribute("aria-invalid", "true"));
    expect(updateEventDraft.mock.calls[0][1]).toMatchObject({ beforeYouGo: [{ label: "Entry", value: "7 pm" }] });
    expect(field()).toHaveAccessibleDescription(`${message} ${BEFORE_YOU_GO_HINT}`);
    expect(currentStep()).toBe(1);
    await waitFor(() => expect(field()).toHaveFocus());
  });
});

describe("EventEditor (admin) — Before you go", () => {
  const ADMIN_EVENT: AdminEventRecord = {
    ...EVENT,
    status: "published",
    externalFree: false,
    externalProvider: null,
    ticketingLocked: true,
    updatedAt: "2026-10-20T01:02:03.456Z",
    organiserPlatformManaged: false,
    curation: { boost: 1, excluded: false },
    beforeYouGo: ROWS,
  };

  it("edits the same field and sends it with the admin's save; clearing sends null", async () => {
    adminUpdateEvent.mockResolvedValue({ ...ADMIN_EVENT, beforeYouGo: undefined });
    render(
      <FakeAuthProvider value={fakeAuthValue({ email: "admin@sheltuh.example", isAdmin: true })}>
        <EventEditor mode="admin" getToken={vi.fn().mockResolvedValue("token")} initial={ADMIN_EVENT} onSaved={vi.fn()} />
      </FakeAuthProvider>,
    );
    expect(field()).toHaveValue(TEXT);
    fireEvent.change(field(), { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(adminUpdateEvent).toHaveBeenCalledTimes(1));
    expect(adminUpdateEvent.mock.calls[0][1]).toHaveProperty("beforeYouGo", null);
  });
});
