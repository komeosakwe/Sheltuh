// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import EventEditor from "@/components/dashboard/EventEditor";
import type { EventRecord } from "@/lib/api/types";
import { SessionExpiredError } from "@/lib/auth/session-token";
import { callsTokenFirst, fakeAuthValue, FakeAuthProvider, switchableSession } from "./test-utils/fakeAuth";
import { CONFIRMED_PIN_LOCATION, stubMatchMedia, unstubMatchMedia } from "./test-utils/pinMapStub";

// The suburb table, stubbed: these tests aren't about the suburb (tests/VenueSuburbField.test.tsx is).
vi.mock("@/lib/location-loader", async () => (await import("./test-utils/locationStub")).locationLoaderStub());
// The venue's "Check the pin" map, for the events with a pin (they can be published).
vi.mock("@/components/dashboard/VenuePinMapLeaflet", async () => (await import("./test-utils/pinMapStub")).leafletStub());

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

const updateEventDraft = vi.fn();
const createEventDraft = vi.fn();
const publishEvent = vi.fn();
vi.mock("@/lib/api/events", async (importOriginal) => ({
  // The real check (it only reads the error): the editor tells a payouts refusal apart with it.
  isPayoutsRequiredError: (await importOriginal<typeof import("@/lib/api/events")>()).isPayoutsRequiredError,
  isRefundPolicyTightenedError: (await importOriginal<typeof import("@/lib/api/events")>()).isRefundPolicyTightenedError,
  publishConflictCode: (await importOriginal<typeof import("@/lib/api/events")>()).publishConflictCode,
  updateEventDraft: (...args: unknown[]) => updateEventDraft(...args),
  createEventDraft: (...args: unknown[]) => createEventDraft(...args),
  publishEvent: (...args: unknown[]) => publishEvent(...args),
  // Passed to the photo step on every save; never called here (no photo change).
  uploadEventImage: vi.fn(),
  deleteEventImage: vi.fn(),
}));

afterEach(() => {
  cleanup();
  unstubMatchMedia();
});
beforeEach(() => {
  stubMatchMedia();
  updateEventDraft.mockReset();
  createEventDraft.mockReset();
  publishEvent.mockReset();
});

const BASE_EVENT: EventRecord = {
  organiserId: "org-1",
  eventId: "evt-1",
  slug: "test-event",
  title: "Test Event",
  description: "A test event.",
  category: "live-music",
  venueName: "The Venue",
  venueAddress: "1 Test St",
  suburb: "Fitzroy",
  // 2026-09-25T10:00:00Z = 8:00pm AEST on the same UTC date.
  startsAt: "2026-09-25T10:00:00.000Z",
  endsAt: "2026-09-25T13:00:00.000Z",
  organiserName: "Test Org",
  ticketTypes: [
    { id: "new-1", name: "General Admission", priceCents: 2000, feePolicy: "buyer-pays", quantityAvailable: 50 },
  ],
  status: "draft",
  moderationLog: [],
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

/** BASE_EVENT with its venue's pin confirmed: publishing needs it (`location_required` otherwise). */
const PINNED_EVENT: EventRecord = { ...BASE_EVENT, location: CONFIRMED_PIN_LOCATION };

function renderEditor(overrides: Partial<EventRecord> = {}, onSaved = vi.fn()) {
  const getToken = vi.fn().mockResolvedValue("token");
  render(
    <FakeAuthProvider value={fakeAuthValue({ email: "owner@example.com" })}>
      <EventEditor getToken={getToken} initial={{ ...BASE_EVENT, ...overrides }} onSaved={onSaved} />
    </FakeAuthProvider>,
  );
  return { onSaved };
}

describe("EventEditor — ticket id collisions after reopening a draft", () => {
  it("gives a newly added ticket a fresh id, distinct from an existing 'new-1' loaded from the draft, and saves", async () => {
    updateEventDraft.mockResolvedValue({ ...BASE_EVENT });
    renderEditor();

    fireEvent.click(screen.getByRole("button", { name: "Add ticket type" }));

    const nameInputs = screen.getAllByLabelText("Name");
    expect(nameInputs).toHaveLength(2);
    fireEvent.change(nameInputs[1], { target: { value: "VIP" } });

    fireEvent.click(screen.getByRole("button", { name: "Save draft" }));

    await waitFor(() => expect(updateEventDraft).toHaveBeenCalledTimes(1));
    const [, input] = updateEventDraft.mock.calls[0];
    const ids: string[] = input.ticketTypes.map((t: { id: string }) => t.id);
    expect(ids).toHaveLength(2);
    expect(new Set(ids).size).toBe(2); // no collision
    expect(ids).toContain("new-1"); // the existing ticket's id is preserved
    expect(ids.find((id) => id !== "new-1")).not.toBe("new-1");
  });
});

describe("EventEditor — Melbourne-local date/time inputs, independent of the browser's own timezone", () => {
  const originalTz = process.env.TZ;
  afterEach(() => {
    process.env.TZ = originalTz;
  });

  it("renders start/end inputs in Melbourne time when the runtime's local timezone is UTC", async () => {
    process.env.TZ = "UTC";
    renderEditor();
    expect(screen.getByLabelText("Start date")).toHaveValue("2026-09-25");
    expect(screen.getByLabelText("Start time")).toHaveValue("20:00");
  });

  it("renders start/end inputs in Melbourne time when the runtime's local timezone is a non-Melbourne zone (America/New_York)", async () => {
    process.env.TZ = "America/New_York";
    renderEditor();
    expect(screen.getByLabelText("Start date")).toHaveValue("2026-09-25");
    expect(screen.getByLabelText("Start time")).toHaveValue("20:00");
  });

  it("saves an unmodified event with the same Melbourne date/time it was loaded with, regardless of the runtime timezone", async () => {
    process.env.TZ = "America/New_York";
    updateEventDraft.mockResolvedValue({ ...BASE_EVENT });
    renderEditor();

    fireEvent.click(screen.getByRole("button", { name: "Save draft" }));

    await waitFor(() => expect(updateEventDraft).toHaveBeenCalledTimes(1));
    const [, input] = updateEventDraft.mock.calls[0];
    expect(input.start).toEqual({ date: "2026-09-25", time: "20:00" });
    expect(input.end).toEqual({ date: "2026-09-25", time: "23:00" });
  });
});

describe("EventEditor — an event outside Victoria: inputs in its own zone (owner plan S5)", () => {
  const originalTz = process.env.TZ;
  afterEach(() => {
    process.env.TZ = originalTz;
  });

  it("fills a Perth event's date and time in Perth time, says so in the legends, and saves the same wall-clock times with its place", async () => {
    process.env.TZ = "America/New_York";
    // 10:00Z is 6:00 pm AWST, 13:00Z 9:00 pm AWST (8:00 pm and 11:00 pm in Melbourne).
    updateEventDraft.mockResolvedValue({ ...BASE_EVENT, suburb: "Perth", state: "WA", timeZone: "Australia/Perth" });
    renderEditor({ suburb: "Perth", state: "WA", timeZone: "Australia/Perth" });
    expect(screen.getByLabelText("Start date")).toHaveValue("2026-09-25");
    expect(screen.getByLabelText("Start time")).toHaveValue("18:00");
    expect(screen.getByLabelText("End time")).toHaveValue("21:00");
    expect(screen.getByText("Starts (Perth time)")).toBeInTheDocument();
    expect(screen.getByText("Ends (Perth time)")).toBeInTheDocument();
    expect(screen.queryByText(/Melbourne time/)).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Save draft" }));
    await waitFor(() => expect(updateEventDraft).toHaveBeenCalledTimes(1));
    const [, input] = updateEventDraft.mock.calls[0];
    // Sent with its place (owner plan S8), read in that zone by the API: the event doesn't move.
    expect(input.start).toEqual({ date: "2026-09-25", time: "18:00" });
    expect(input.end).toEqual({ date: "2026-09-25", time: "21:00" });
    expect(input).toMatchObject({ suburb: "Perth", state: "WA", timeZone: "Australia/Perth" });
  });

  it("a late Perth start is on Perth's date (11:30 pm Thursday, though Friday in Melbourne)", () => {
    renderEditor({ state: "WA", timeZone: "Australia/Perth", startsAt: "2026-09-24T15:30:00.000Z" });
    expect(screen.getByLabelText("Start date")).toHaveValue("2026-09-24");
    expect(screen.getByLabelText("Start time")).toHaveValue("23:30");
  });

  it("an ACT event's legends say Canberra time; a Victorian one's still say Melbourne time", () => {
    renderEditor({ suburb: "Braddon", state: "ACT", timeZone: "Australia/Sydney" });
    expect(screen.getByText("Starts (Canberra time)")).toBeInTheDocument();
    cleanup();
    renderEditor({ state: "VIC", timeZone: "Australia/Melbourne" });
    expect(screen.getByText("Starts (Melbourne time)")).toBeInTheDocument();
    expect(screen.getByText("Ends (Melbourne time)")).toBeInTheDocument();
  });
});

describe("EventEditor — session-expiry recovery preserves the form", () => {
  it("keeps every typed field after an expired-session save, and succeeds once signed back in as the same account", async () => {
    const sessionError = new SessionExpiredError();
    updateEventDraft.mockRejectedValueOnce(sessionError).mockResolvedValueOnce({ ...BASE_EVENT, title: "Updated title" });
    const signIn = vi.fn().mockResolvedValue(undefined);
    const onSaved = vi.fn();

    render(
      <FakeAuthProvider value={fakeAuthValue({ email: "owner@example.com", signIn })}>
        <EventEditor getToken={vi.fn().mockResolvedValue("token")} initial={BASE_EVENT} onSaved={onSaved} />
      </FakeAuthProvider>,
    );

    // Change a field so we can prove it survives the expiry + recovery round-trip.
    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Updated title" } });
    fireEvent.click(screen.getByRole("button", { name: "Save draft" }));

    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(sessionError.message));
    // The field edited above is still there — the expired save never cleared it.
    expect(screen.getByLabelText("Title")).toHaveValue("Updated title");

    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "hunter2" } });
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));

    await waitFor(() => expect(signIn).toHaveBeenCalledWith("owner@example.com", "hunter2"));
    // Recovery never navigated away — the field is still there after sign-in.
    expect(screen.getByLabelText("Title")).toHaveValue("Updated title");
    // Said politely, with focus on the button to try again (the sign-in form has gone).
    expect(screen.getByRole("status")).toHaveTextContent("Signed in again. Your changes are still here — save when you’re ready.");
    expect(screen.getByRole("button", { name: "Save draft" })).toHaveFocus();

    fireEvent.click(screen.getByRole("button", { name: "Save draft" }));

    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
    expect(updateEventDraft).toHaveBeenCalledTimes(2);
  });
});

describe("EventEditor — never saves as another account", () => {
  it("someone else signed in by now (another tab): opens the recovery, locked to the draft's owner, and saves nothing", async () => {
    const auth = (overrides: Parameters<typeof fakeAuthValue>[0]) => fakeAuthValue({ getAccessToken: vi.fn().mockResolvedValue("t"), ...overrides });
    const getToken = vi.fn().mockResolvedValue("token");
    const view = render(
      <FakeAuthProvider value={auth({ userId: "user-owner", email: "owner@example.com" })}>
        <EventEditor getToken={getToken} initial={BASE_EVENT} onSaved={vi.fn()} />
      </FakeAuthProvider>,
    );
    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Updated title" } });
    view.rerender(
      <FakeAuthProvider value={auth({ userId: "user-other", email: "other@example.com" })}>
        <EventEditor getToken={getToken} initial={BASE_EVENT} onSaved={vi.fn()} />
      </FakeAuthProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Save draft" }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(new SessionExpiredError().message));
    expect(updateEventDraft).not.toHaveBeenCalled();
    expect(screen.getByLabelText("Email")).toHaveValue("owner@example.com");
    expect(screen.getByText(/^You're signed in as a different account/)).toBeInTheDocument();
    expect(screen.getByLabelText("Title")).toHaveValue("Updated title");
  });
});

/** Publish…, then the question's Publish now. */
function publish() {
  fireEvent.click(screen.getByRole("button", { name: "Publish…" }));
  fireEvent.click(screen.getByRole("button", { name: "Publish now" }));
}

describe("EventEditor — publishing", () => {
  it("saves unsaved edits first, so what goes live is what's on screen", async () => {
    updateEventDraft.mockResolvedValue({ ...BASE_EVENT, title: "Edited title" });
    publishEvent.mockResolvedValue({ ...BASE_EVENT, title: "Edited title", status: "published" });
    const { onSaved } = renderEditor({ location: CONFIRMED_PIN_LOCATION });

    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Edited title" } });
    publish();

    await waitFor(() => expect(publishEvent).toHaveBeenCalledTimes(1));
    expect(updateEventDraft).toHaveBeenCalledTimes(1);
    expect(updateEventDraft.mock.calls[0][1].title).toBe("Edited title");
    expect(updateEventDraft.mock.invocationCallOrder[0]).toBeLessThan(publishEvent.mock.invocationCallOrder[0]);
    expect(onSaved).toHaveBeenCalledWith(expect.objectContaining({ status: "published" }));
  });

  it("publishes nothing while the form has errors (the question closes, the field is focused)", async () => {
    renderEditor({ location: CONFIRMED_PIN_LOCATION });
    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "" } });
    publish();

    await waitFor(() => expect(screen.getByText("Enter an event title.")).toBeInTheDocument());
    await waitFor(() => expect(screen.getByLabelText("Title")).toHaveFocus());
    expect(screen.queryByRole("button", { name: "Publish now" })).toBeNull();
    expect(updateEventDraft).not.toHaveBeenCalled();
    expect(publishEvent).not.toHaveBeenCalled();
  });

  it("won't save a paid ticket under A$1.00", async () => {
    renderEditor();
    fireEvent.change(screen.getByLabelText("Price (A$)"), { target: { value: "0.5" } });
    fireEvent.click(screen.getByRole("button", { name: "Save draft" }));

    await waitFor(() => expect(screen.getByText(/at least A\$1/)).toBeInTheDocument());
    expect(updateEventDraft).not.toHaveBeenCalled();
  });
});

const OWNER = { userId: "user-owner", email: "owner@example.com" };
const OTHER = { userId: "user-other", email: "other@example.com" };

/** Fills a new event's required fields (its default ticket is a free one, already valid once named). */
function fillNewEvent() {
  fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Night Market" } });
  fireEvent.change(screen.getByLabelText("Description"), { target: { value: "Stalls and music." } });
  fireEvent.change(screen.getByLabelText("Venue name"), { target: { value: "The Venue" } });
  fireEvent.change(screen.getByLabelText("Venue address"), { target: { value: "1 Test St" } });
  fireEvent.change(screen.getByLabelText("Suburb or town"), { target: { value: "Fitzroy" } });
  fireEvent.change(screen.getByLabelText("Start date"), { target: { value: "2027-03-06" } });
  fireEvent.change(screen.getByLabelText("Start time"), { target: { value: "20:00" } });
  fireEvent.change(screen.getByLabelText("End date"), { target: { value: "2027-03-06" } });
  fireEvent.change(screen.getByLabelText("End time"), { target: { value: "23:30" } });
  fireEvent.change(screen.getByLabelText("Name"), { target: { value: "General Admission" } });
}

/** The editor (an existing draft, or a new event) as OWNER; `become` changes who React says is signed in. */
function renderAs(initial: EventRecord | undefined, session = switchableSession(OWNER), onSaved = vi.fn()) {
  const tree = (account: typeof OWNER) => (
    <FakeAuthProvider value={fakeAuthValue({ status: "signed-in", ...account, ...session.auth })}>
      <EventEditor getToken={vi.fn().mockResolvedValue("page-token")} initial={initial} onSaved={onSaved} />
    </FakeAuthProvider>
  );
  const view = render(tree(OWNER));
  return { onSaved, become: (account: typeof OWNER) => view.rerender(tree(account)) };
}

async function expectRecoveryForOwner() {
  await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(new SessionExpiredError().message));
  expect(screen.getByLabelText("Email")).toHaveValue("owner@example.com");
}

describe("EventEditor — the other-account check on every action", () => {
  it("Publish: someone else signed in by now: nothing is saved or published", async () => {
    const { become } = renderAs(PINNED_EVENT);
    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Edited title" } });
    become(OTHER);
    publish();
    await expectRecoveryForOwner();
    expect(updateEventDraft).not.toHaveBeenCalled();
    expect(publishEvent).not.toHaveBeenCalled();
    expect(screen.getByLabelText("Title")).toHaveValue("Edited title");
  });

  it("a new event: someone else signed in by now: it isn't created", async () => {
    const { become } = renderAs(undefined);
    fillNewEvent();
    become(OTHER);
    fireEvent.click(screen.getByRole("button", { name: "Save draft" }));
    await expectRecoveryForOwner();
    expect(createEventDraft).not.toHaveBeenCalled();
    expect(screen.getByLabelText("Title")).toHaveValue("Night Market");
  });
});

describe("EventEditor — an account change mid-save (after the check, before the request) is refused", () => {
  it("Save draft: the request's token is the owner's or none", async () => {
    const session = switchableSession(OWNER);
    updateEventDraft.mockImplementation(callsTokenFirst(BASE_EVENT));
    const { onSaved } = renderAs(BASE_EVENT, session);
    fireEvent.click(screen.getByRole("button", { name: "Save draft" }));
    // The check has passed (React still says OWNER); another tab signs in as OTHER before the request.
    session.become(OTHER);
    await expectRecoveryForOwner();
    expect(session.auth.getAccessTokenFor).toHaveBeenCalledWith(OWNER);
    expect(onSaved).not.toHaveBeenCalled();
  });

  it("Publish: changed after the save, before the publish: never published as them", async () => {
    const session = switchableSession(OWNER);
    updateEventDraft.mockImplementation(async (...args: unknown[]) => {
      const saved = await callsTokenFirst(BASE_EVENT)(...args);
      session.become(OTHER);
      return saved;
    });
    publishEvent.mockImplementation(callsTokenFirst({ ...BASE_EVENT, status: "published" }));
    const { onSaved } = renderAs(PINNED_EVENT, session);
    publish();
    await expectRecoveryForOwner();
    expect(publishEvent).toHaveBeenCalledTimes(1);
    expect(onSaved).not.toHaveBeenCalledWith(expect.objectContaining({ status: "published" }));
  });

  it("a new event: never created as them", async () => {
    const session = switchableSession(OWNER);
    createEventDraft.mockImplementation(callsTokenFirst({ ...BASE_EVENT, eventId: "evt-new" }));
    renderAs(undefined, session);
    fillNewEvent();
    fireEvent.click(screen.getByRole("button", { name: "Save draft" }));
    session.become(OTHER);
    await expectRecoveryForOwner();
    expect(screen.getByLabelText("Title")).toHaveValue("Night Market");
  });

  it("with no change, the save goes through with the owner's token", async () => {
    const session = switchableSession(OWNER);
    updateEventDraft.mockImplementation(callsTokenFirst(BASE_EVENT));
    const { onSaved } = renderAs(BASE_EVENT, session);
    fireEvent.click(screen.getByRole("button", { name: "Save draft" }));
    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
    await expect(updateEventDraft.mock.calls[0][2]()).resolves.toBe("user-owner-token");
  });
});

describe("EventEditor — explains the booking-fee choice", () => {
  it("says what the buyer pays and what the organiser receives for each choice, and is tied to the select", () => {
    renderEditor({
      ticketTypes: [{ id: "tt-1", name: "GA", priceCents: 3000, quantityAvailable: 10, feePolicy: "buyer-pays" }],
    } as Partial<EventRecord>);
    const select = screen.getByLabelText("Who pays the booking fee?");
    const help = document.getElementById(select.getAttribute("aria-describedby") ?? "");
    expect(help).not.toBeNull();
    const text = help?.textContent ?? "";
    // A$30 ticket: fee 6% + A$0.50 = A$2.30.
    expect(text).toContain("A$2.30 on this ticket");
    expect(text).toContain("The buyer pays A$32.30 and you receive the full A$30");
    expect(text).toContain("the buyer pays just A$30 and the fee comes out of it, so you receive A$27.70");
  });
});
