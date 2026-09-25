// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import EventEditor from "@/components/dashboard/EventEditor";
import type { EventRecord } from "@/lib/api/types";
import { SessionExpiredError } from "@/lib/auth/session-token";
import { fakeAuthValue, FakeAuthProvider } from "./test-utils/fakeAuth";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

const updateEventDraft = vi.fn();
const createEventDraft = vi.fn();
const submitEventForReview = vi.fn();
vi.mock("@/lib/api/events", () => ({
  updateEventDraft: (...args: unknown[]) => updateEventDraft(...args),
  createEventDraft: (...args: unknown[]) => createEventDraft(...args),
  submitEventForReview: (...args: unknown[]) => submitEventForReview(...args),
}));

afterEach(cleanup);
beforeEach(() => {
  updateEventDraft.mockReset();
  createEventDraft.mockReset();
  submitEventForReview.mockReset();
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
  suburb: "Testville",
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

    fireEvent.click(screen.getByRole("button", { name: "Save draft" }));

    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
    expect(updateEventDraft).toHaveBeenCalledTimes(2);
  });
});
