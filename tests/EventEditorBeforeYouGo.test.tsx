// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import EventEditor from "@/components/dashboard/EventEditor";
import { BEFORE_YOU_GO_HINT } from "@/components/dashboard/editor/BeforeYouGoFields";
import { ApiError } from "@/lib/api/client";
import type { AdminEventRecord, EventRecord } from "@/lib/api/types";
import { beforeYouGoHalfFilled, beforeYouGoNoEmails, beforeYouGoNoLinks } from "@/lib/before-you-go";
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

const ROWS = [
  { label: "Entry", value: "7:30 pm – 10:30 pm" },
  { label: "Age", value: "18+ · Photo ID required" },
];

/** The organiser's editor: on `initial` (a saved draft), or with `null` on a new event. */
function renderEditor(initial: EventRecord | null = EVENT) {
  render(
    <FakeAuthProvider value={fakeAuthValue({ email: "owner@example.com" })}>
      <EventEditor getToken={vi.fn().mockResolvedValue("token")} initial={initial ?? undefined} onSaved={vi.fn()} />
    </FakeAuthProvider>,
  );
}

// By id: found on any step (the other steps' panels are hidden, so a role query wouldn't find them there).
function input(row: number, part: "label" | "value"): HTMLInputElement {
  const element = document.getElementById(`beforeYouGo-${row}-${part}`);
  if (!(element instanceof HTMLInputElement)) throw new Error(`no row ${row} ${part}`);
  return element;
}
const rowCount = () => document.querySelectorAll("[data-before-you-go-row]").length;
const type = (row: number, part: "label" | "value", value: string) => fireEvent.change(input(row, part), { target: { value } });
const group = () => screen.getByRole("group", { name: "Before you go (optional)" });
const save = () => fireEvent.click(screen.getByRole("button", { name: /^Save draft/ }));

async function sentInput(): Promise<Record<string, unknown>> {
  await waitFor(() => expect(updateEventDraft).toHaveBeenCalledTimes(1));
  return updateEventDraft.mock.calls[0][1] as Record<string, unknown>;
}

describe("EventEditor — Before you go", () => {
  it("is an optional group of rows in Event details, after the description, with its hint, starting with three empty rows", () => {
    renderEditor();
    expect(group()).toHaveAccessibleDescription(BEFORE_YOU_GO_HINT);
    expect(BEFORE_YOU_GO_HINT).toBe("What people should know before they arrive. Up to 5 short rows. No links.");
    const details = screen.getByRole("heading", { name: "Event details" }).closest("section");
    expect(details).not.toBeNull();
    if (details) expect(within(details as HTMLElement).getByRole("group", { name: "Before you go (optional)" })).toBe(group());
    expect(screen.getByLabelText("Description").compareDocumentPosition(group()) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    // Three empty rows, the owner's reference as their placeholders; each row a group with a labelled Label and Value.
    expect(rowCount()).toBe(3);
    expect([0, 1, 2].map((i) => input(i, "label").placeholder)).toEqual(["Entry", "Age", "Extras"]);
    expect([0, 1, 2].map((i) => input(i, "value").placeholder)).toEqual([
      "7:30 pm – 10:30 pm",
      "18+ · Photo ID required",
      "Free earplugs at the bar",
    ]);
    const row2 = within(group()).getByRole("group", { name: "Row 2" });
    expect(within(row2).getByLabelText("Label")).toBe(input(1, "label"));
    expect(within(row2).getByLabelText("Value")).toBe(input(1, "value"));
    expect(within(row2).getByRole("button", { name: "Remove row 2" })).toBeInTheDocument();
    for (const i of [0, 1, 2]) {
      expect(input(i, "label")).toHaveValue("");
      // No native maxlength (it counts UTF-16 units, not the code points the limits are in): checked on save.
      expect(input(i, "label")).not.toHaveAttribute("maxlength");
      expect(input(i, "value")).not.toHaveAttribute("maxlength");
      expect(input(i, "label")).not.toHaveAttribute("aria-invalid");
    }
  });

  it("adds rows up to 5 (focusing the new label), then hides Add a row; Remove takes a row out and moves focus", () => {
    renderEditor();
    fireEvent.click(screen.getByRole("button", { name: "Add a row" }));
    expect(rowCount()).toBe(4);
    expect(input(3, "label")).toHaveFocus();
    expect(input(3, "label")).not.toHaveAttribute("placeholder");
    fireEvent.click(screen.getByRole("button", { name: "Add a row" }));
    expect(rowCount()).toBe(5);
    expect(screen.queryByRole("button", { name: "Add a row" })).toBeNull();

    type(1, "label", "Age");
    fireEvent.click(screen.getByRole("button", { name: "Remove row 2" }));
    expect(rowCount()).toBe(4);
    // The row below takes its place (and its focus); the typed row is gone.
    expect(input(1, "label")).toHaveFocus();
    expect(input(1, "label")).toHaveValue("");
    expect(screen.getByRole("button", { name: "Add a row" })).toBeInTheDocument();

    // The last row's Remove: focus goes to the row above. With none left, to Add a row.
    fireEvent.click(screen.getByRole("button", { name: "Remove row 4" }));
    expect(input(2, "label")).toHaveFocus();
    for (const n of [3, 2, 1]) fireEvent.click(screen.getByRole("button", { name: `Remove row ${n}` }));
    expect(rowCount()).toBe(0);
    expect(screen.getByRole("button", { name: "Add a row" })).toHaveFocus();
  });

  it("sends the rows as on screen, an empty one included, so the API's \"Row N\" is the row shown", async () => {
    updateEventDraft.mockResolvedValue({ ...EVENT, beforeYouGo: ROWS });
    renderEditor();
    type(0, "label", " Entry ");
    type(0, "value", "7:30 pm –  10:30 pm ");
    // Row 2 left empty: sent in its place (the API cleans the rows and drops it), so a refusal the API alone
    // makes of the row below names it "Row 3", as on screen.
    type(2, "label", "Extras");
    type(2, "value", " 🎟️ Bring your ticket");
    save();
    expect((await sentInput()).beforeYouGo).toEqual([
      { label: " Entry ", value: "7:30 pm –  10:30 pm " },
      { label: "", value: "" },
      { label: "Extras", value: " 🎟️ Bring your ticket" },
    ]);
  });

  it("takes a label of 20 code points with an emoji (21 UTF-16 units), and refuses 21 code points on save", async () => {
    const label = `\u{1F600}${"A".repeat(19)}`;
    expect(label.length).toBe(21);
    updateEventDraft.mockResolvedValue({ ...EVENT, beforeYouGo: [{ label, value: "7 pm" }] });
    renderEditor();
    type(0, "label", `${label}B`);
    type(0, "value", "7 pm");
    save();
    await waitFor(() => expect(input(0, "label")).toHaveAttribute("aria-invalid", "true"));
    expect(input(0, "label")).toHaveAccessibleDescription("Row 1's label must be 20 characters or fewer.");
    expect(updateEventDraft).not.toHaveBeenCalled();

    type(0, "label", label);
    expect(input(0, "label")).toHaveValue(label);
    save();
    expect((await sentInput()).beforeYouGo).toEqual([{ label, value: "7 pm" }, { label: "", value: "" }, { label: "", value: "" }]);
  });

  it("shows saved rows (a colon in a label included), sends them back unchanged, and sends null once they're cleared", async () => {
    const saved = [{ label: "Entry: VIP", value: "From 7 pm: side door" }, ...ROWS];
    updateEventDraft.mockResolvedValue({ ...EVENT, beforeYouGo: saved });
    renderEditor({ ...EVENT, beforeYouGo: saved });
    expect(rowCount()).toBe(3);
    expect(input(0, "label")).toHaveValue("Entry: VIP");
    expect(input(0, "value")).toHaveValue("From 7 pm: side door");
    save();
    expect((await sentInput()).beforeYouGo).toEqual(saved);

    updateEventDraft.mockClear();
    updateEventDraft.mockResolvedValue({ ...EVENT });
    for (const i of [0, 1, 2]) {
      type(i, "label", "");
      type(i, "value", " ");
    }
    save();
    expect(await sentInput()).toHaveProperty("beforeYouGo", null);
  });

  it("a new event sends its rows with the draft", async () => {
    createEventDraft.mockResolvedValue({ ...EVENT, eventId: "evt-new", beforeYouGo: ROWS });
    renderEditor(null);
    expect(rowCount()).toBe(3);
    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Neon Static" } });
    fireEvent.change(screen.getByLabelText("Description"), { target: { value: "Four bands." } });
    type(0, "label", ROWS[0].label);
    type(0, "value", ROWS[0].value);
    type(1, "label", ROWS[1].label);
    type(1, "value", ROWS[1].value);
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
    // The third row, left empty, sent in its place.
    expect(createEventDraft.mock.calls[0][0]).toMatchObject({ beforeYouGo: [...ROWS, { label: "", value: "" }] });
  });

  it("refuses bad rows by their inputs, before sending: invalid, described by the error, the first focused, one summary entry", async () => {
    renderEditor();
    showStep(2);
    type(1, "label", "Tickets");
    type(1, "value", "sheltuh.com.au/neon");
    // Row 3: a value without a label (the label is what's missing, so it's the one marked).
    type(2, "value", "Bring ID");
    save();
    await waitFor(() => expect(input(1, "value")).toHaveAttribute("aria-invalid", "true"));
    expect(updateEventDraft).not.toHaveBeenCalled();
    expect(input(1, "value")).toHaveAccessibleDescription(beforeYouGoNoLinks(2, "value"));
    expect(input(2, "label")).toHaveAttribute("aria-invalid", "true");
    expect(input(2, "label")).toHaveAccessibleDescription(beforeYouGoHalfFilled(3));
    for (const fine of [input(0, "label"), input(0, "value"), input(1, "label"), input(2, "value")]) {
      expect(fine).not.toHaveAttribute("aria-invalid");
    }
    // Back on the Event page step, with the first bad input focused (its error is read with it).
    expect(currentStep()).toBe(1);
    await waitFor(() => expect(input(1, "value")).toHaveFocus());
    // One entry in the error summary, "Before you go: <the first error>", that jumps to the first bad input.
    const entry = screen.getByRole("button", { name: `Before you go: ${beforeYouGoNoLinks(2, "value")}` });
    input(0, "label").focus();
    fireEvent.click(entry);
    expect(input(1, "value")).toHaveFocus();

    // Fixing one input clears its error; the summary moves on to the next, and goes once none is left.
    type(1, "value", "At the door");
    expect(input(1, "value")).not.toHaveAttribute("aria-invalid");
    fireEvent.click(screen.getByRole("button", { name: `Before you go: ${beforeYouGoHalfFilled(3)}` }));
    expect(input(2, "label")).toHaveFocus();
    type(2, "label", "Extras");
    expect(input(2, "label")).not.toHaveAttribute("aria-invalid");
    expect(screen.queryByRole("button", { name: /^Before you go:/ })).toBeNull();
  });

  it("renumbers the errors shown when a row above them is removed", async () => {
    renderEditor();
    type(0, "label", "Entry");
    type(0, "value", "7 pm");
    type(2, "label", "Links");
    type(2, "value", "sheltuh.com.au");
    save();
    await waitFor(() => expect(input(2, "value")).toHaveAccessibleDescription(beforeYouGoNoLinks(3, "value")));
    fireEvent.click(screen.getByRole("button", { name: "Remove row 1" }));
    expect(input(1, "value")).toHaveAttribute("aria-invalid", "true");
    expect(input(1, "value")).toHaveAccessibleDescription(beforeYouGoNoLinks(2, "value"));
    expect(screen.getByRole("button", { name: `Before you go: ${beforeYouGoNoLinks(2, "value")}` })).toBeInTheDocument();
    // Removing the bad row itself clears it all.
    fireEvent.click(screen.getByRole("button", { name: "Remove row 2" }));
    expect(screen.queryByRole("button", { name: /^Before you go:/ })).toBeNull();
    expect(document.querySelector("[aria-invalid='true'][id^='beforeYouGo-']")).toBeNull();
  });

  it("shows the API's fieldErrors.beforeYouGo under the hint (the source of truth), with the first input focused", async () => {
    const message = beforeYouGoNoEmails(1, "value");
    updateEventDraft.mockRejectedValue(new ApiError(400, "Validation failed", { beforeYouGo: message }));
    renderEditor();
    type(0, "label", "Entry");
    type(0, "value", "7 pm");
    showStep(3);
    save();
    await waitFor(() => expect(screen.getByText(message, { selector: "#beforeYouGo-error" })).toBeInTheDocument());
    expect(updateEventDraft.mock.calls[0][1]).toMatchObject({
      beforeYouGo: [{ label: "Entry", value: "7 pm" }, { label: "", value: "" }, { label: "", value: "" }],
    });
    expect(group()).toHaveAccessibleDescription(`${BEFORE_YOU_GO_HINT} ${message}`);
    expect(currentStep()).toBe(1);
    await waitFor(() => expect(input(0, "label")).toHaveFocus());
    expect(input(0, "label")).toHaveAccessibleDescription(message);
    // The first input is invalid while the API's error shows (it's the one described by it); the group isn't.
    expect(input(0, "label")).toHaveAttribute("aria-invalid", "true");
    for (const other of [input(0, "value"), input(1, "label"), input(1, "value")]) expect(other).not.toHaveAttribute("aria-invalid");
    expect(group()).not.toHaveAttribute("aria-invalid");
    // Editing a row clears it, and the first input is valid again.
    type(0, "value", "8 pm");
    expect(screen.queryByText(message, { selector: "#beforeYouGo-error" })).toBeNull();
    expect(input(0, "label")).not.toHaveAttribute("aria-invalid");
    expect(input(0, "label")).not.toHaveAccessibleDescription(message);
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

  it("edits the same rows and sends them with the admin's save; removing them all sends null", async () => {
    adminUpdateEvent.mockResolvedValue({ ...ADMIN_EVENT, beforeYouGo: undefined });
    render(
      <FakeAuthProvider value={fakeAuthValue({ email: "admin@sheltuh.example", isAdmin: true })}>
        <EventEditor mode="admin" getToken={vi.fn().mockResolvedValue("token")} initial={ADMIN_EVENT} onSaved={vi.fn()} />
      </FakeAuthProvider>,
    );
    expect(input(0, "label")).toHaveValue("Entry");
    expect(input(1, "value")).toHaveValue("18+ · Photo ID required");
    fireEvent.click(screen.getByRole("button", { name: "Remove row 2" }));
    fireEvent.click(screen.getByRole("button", { name: "Remove row 1" }));
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(adminUpdateEvent).toHaveBeenCalledTimes(1));
    expect(adminUpdateEvent.mock.calls[0][1]).toHaveProperty("beforeYouGo", null);
  });
});
