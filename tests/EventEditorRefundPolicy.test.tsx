// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import EventEditor from "@/components/dashboard/EventEditor";
import { ApiError } from "@/lib/api/client";
import type { AdminEventRecord, EventRecord } from "@/lib/api/types";
import { REFUND_ACL_STATEMENT } from "@/lib/refund-policy";
import { fakeAuthValue, FakeAuthProvider } from "./test-utils/fakeAuth";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

const updateEventDraft = vi.fn();
const createEventDraft = vi.fn();
const submitEventForReview = vi.fn();
vi.mock("@/lib/api/events", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api/events")>();
  return {
    // The real checks (they only read the error).
    isPayoutsRequiredError: actual.isPayoutsRequiredError,
    isRefundPolicyTightenedError: actual.isRefundPolicyTightenedError,
    updateEventDraft: (...args: unknown[]) => updateEventDraft(...args),
    createEventDraft: (...args: unknown[]) => createEventDraft(...args),
    submitEventForReview: (...args: unknown[]) => submitEventForReview(...args),
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

afterEach(cleanup);
beforeEach(() => {
  for (const fn of [updateEventDraft, createEventDraft, submitEventForReview, adminUpdateEvent]) fn.mockReset();
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

const ADMIN_EVENT: AdminEventRecord = {
  ...EVENT,
  status: "published",
  ticketingLocked: true,
  organiserPlatformManaged: false,
  curation: { boost: 1, excluded: false },
};

const TIGHTENED_MESSAGE =
  "This event already has orders, so its refund policy can only become more generous: people who bought tickets keep the refunds they were offered.";

function tightened(): ApiError {
  return new ApiError(409, TIGHTENED_MESSAGE, { refundPolicy: TIGHTENED_MESSAGE }, { code: "refund_policy_tightened" });
}

function renderOrganiser(overrides: Partial<EventRecord> = {}) {
  render(
    <FakeAuthProvider value={fakeAuthValue({ email: "owner@example.com" })}>
      <EventEditor getToken={vi.fn().mockResolvedValue("token")} initial={{ ...EVENT, ...overrides }} onSaved={vi.fn()} />
    </FakeAuthProvider>,
  );
}

function renderAdmin(initial: AdminEventRecord = ADMIN_EVENT) {
  render(
    <FakeAuthProvider value={fakeAuthValue({ email: "admin@sheltuh.example", isAdmin: true })}>
      <EventEditor mode="admin" getToken={vi.fn().mockResolvedValue("token")} initial={initial} onSaved={vi.fn()} />
    </FakeAuthProvider>,
  );
}

const group = () => screen.getByRole("group", { name: "Refund policy" });
const noRefunds = () => within(group()).getByRole("radio", { name: "No refunds for change of mind" });
const daysBefore = () => within(group()).getByRole("radio", { name: "Refunds up to a number of days before the event" });
const daysInput = () => within(group()).getByLabelText("Days before the event");
const save = () => fireEvent.click(screen.getByRole("button", { name: "Save draft" }));

describe("EventEditor — refund policy (organiser)", () => {
  it("defaults to no refunds for change of mind, with the days off, and says what buyers see (the ACL line)", () => {
    renderOrganiser();
    expect(noRefunds()).toBeChecked();
    expect(daysBefore()).not.toBeChecked();
    expect(daysInput()).toBeDisabled();
    const help = document.getElementById("refund-policy-help");
    expect(help).toHaveTextContent(REFUND_ACL_STATEMENT);
    expect(help).toHaveTextContent("After you submit, only Sheltüh can change it");
    expect(group()).toHaveAttribute("aria-describedby", "refund-policy-help");
    expect(daysInput()).toHaveAttribute("min", "1");
    expect(daysInput()).toHaveAttribute("max", "30");
  });

  it("is near the tickets: after the ticket types", () => {
    renderOrganiser();
    const tickets = screen.getByRole("heading", { name: "Ticket types" });
    expect(tickets.compareDocumentPosition(group()) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("saves the default as no_change_of_mind, without days", async () => {
    updateEventDraft.mockResolvedValue(EVENT);
    renderOrganiser();
    save();
    await waitFor(() => expect(updateEventDraft).toHaveBeenCalledTimes(1));
    const [, input] = updateEventDraft.mock.calls[0];
    expect(input.refundPolicy).toBe("no_change_of_mind");
    expect(input).not.toHaveProperty("refundDays");
  });

  it("loads a days_before policy from the record, and saves it as it is", async () => {
    updateEventDraft.mockResolvedValue(EVENT);
    renderOrganiser({ refundPolicy: "days_before", refundDays: 14 });
    expect(daysBefore()).toBeChecked();
    expect(daysInput()).toBeEnabled();
    expect(daysInput()).toHaveValue(14);
    save();
    await waitFor(() => expect(updateEventDraft).toHaveBeenCalledTimes(1));
    expect(updateEventDraft.mock.calls[0][1]).toMatchObject({ refundPolicy: "days_before", refundDays: 14 });
  });

  it("choosing days enables the input; it needs a whole number from 1 to 30 before anything is saved", async () => {
    updateEventDraft.mockResolvedValue(EVENT);
    renderOrganiser();
    fireEvent.click(daysBefore());
    expect(daysInput()).toBeEnabled();

    for (const value of ["", "0", "31", "2.5"]) {
      fireEvent.change(daysInput(), { target: { value } });
      save();
      const error = await within(group()).findByText("Enter a whole number of days from 1 to 30.");
      expect(error).toHaveAttribute("id", "refundDays-error");
      expect(daysInput()).toHaveAttribute("aria-invalid", "true");
      expect(daysInput()).toHaveAttribute("aria-describedby", "refundDays-hint refundDays-error");
    }
    expect(updateEventDraft).not.toHaveBeenCalled();

    fireEvent.change(daysInput(), { target: { value: "7" } });
    // A change clears the old error.
    expect(within(group()).queryByText("Enter a whole number of days from 1 to 30.")).toBeNull();
    save();
    await waitFor(() => expect(updateEventDraft).toHaveBeenCalledTimes(1));
    expect(updateEventDraft.mock.calls[0][1]).toMatchObject({ refundPolicy: "days_before", refundDays: 7 });
  });

  it("switching back to no refunds sends no days, and keeps what was typed for switching again", async () => {
    updateEventDraft.mockResolvedValue(EVENT);
    renderOrganiser({ refundPolicy: "days_before", refundDays: 5 });
    fireEvent.click(noRefunds());
    expect(daysInput()).toBeDisabled();
    expect(daysInput()).toHaveValue(5);
    save();
    await waitFor(() => expect(updateEventDraft).toHaveBeenCalledTimes(1));
    const [, input] = updateEventDraft.mock.calls[0];
    expect(input.refundPolicy).toBe("no_change_of_mind");
    expect(input).not.toHaveProperty("refundDays");
  });

  it("shows the server's field errors by the field", async () => {
    updateEventDraft.mockRejectedValue(
      new ApiError(400, "Please fix the highlighted fields.", { refundDays: "Enter a whole number of days from 1 to 30." }),
    );
    renderOrganiser({ refundPolicy: "days_before", refundDays: 5 });
    save();
    expect(await within(group()).findByText("Enter a whole number of days from 1 to 30.")).toHaveAttribute("id", "refundDays-error");
  });

  it("a refused tightening (409): the reason by the policy, focus on it, a pointer by the buttons, and the form kept", async () => {
    updateEventDraft.mockRejectedValue(tightened());
    renderOrganiser({ refundPolicy: "days_before", refundDays: 7 });
    fireEvent.click(noRefunds());
    save();

    const error = await within(group()).findByText(TIGHTENED_MESSAGE);
    expect(error).toHaveAttribute("id", "refundPolicy-error");
    expect(group()).toHaveAttribute("aria-describedby", "refund-policy-help refundPolicy-error");
    await waitFor(() => expect(noRefunds()).toHaveFocus());
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Not saved: the refund policy can’t be made less generous now. See Refund policy.",
    );
    expect(noRefunds()).toBeChecked();
    expect(daysInput()).toHaveValue(7);

    // Choosing again clears it.
    fireEvent.click(daysBefore());
    expect(within(group()).queryByText(TIGHTENED_MESSAGE)).toBeNull();
  });

  it("an external event has no refund policy field, and saving doesn't send one", async () => {
    updateEventDraft.mockResolvedValue(EVENT);
    renderOrganiser({
      ticketingMode: "external",
      externalTicketUrl: "https://events.humanitix.com/neon",
      externalProvider: "Humanitix",
      ticketTypes: [],
      refundPolicy: "days_before",
      refundDays: 7,
    });
    expect(screen.queryByRole("group", { name: "Refund policy" })).toBeNull();
    save();
    await waitFor(() => expect(updateEventDraft).toHaveBeenCalledTimes(1));
    const [, input] = updateEventDraft.mock.calls[0];
    expect(input).not.toHaveProperty("refundPolicy");
    expect(input).not.toHaveProperty("refundDays");
  });
});

describe("EventEditor — refund policy (admin)", () => {
  const saveChanges = () => fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

  it("sends the policy with the edit, and talks about the event, not 'you'", async () => {
    adminUpdateEvent.mockResolvedValue(ADMIN_EVENT);
    renderAdmin();
    expect(document.getElementById("refund-policy-help")).toHaveTextContent(
      "Once tickets have been ordered, it can only become more generous",
    );
    fireEvent.click(daysBefore());
    fireEvent.change(daysInput(), { target: { value: "3" } });
    saveChanges();
    await waitFor(() => expect(adminUpdateEvent).toHaveBeenCalledTimes(1));
    expect(adminUpdateEvent.mock.calls[0][1]).toMatchObject({ refundPolicy: "days_before", refundDays: 3 });
  });

  it("switching to another site hides the field and sends no policy", async () => {
    adminUpdateEvent.mockResolvedValue(ADMIN_EVENT);
    renderAdmin();
    fireEvent.click(screen.getByLabelText("On another site"));
    expect(screen.queryByRole("group", { name: "Refund policy" })).toBeNull();
    fireEvent.change(screen.getByLabelText("Ticket page address"), { target: { value: "https://events.humanitix.com/neon" } });
    saveChanges();
    await waitFor(() => expect(adminUpdateEvent).toHaveBeenCalledTimes(1));
    expect(adminUpdateEvent.mock.calls[0][1]).not.toHaveProperty("refundPolicy");
  });

  it("a refused tightening is shown by the policy too", async () => {
    adminUpdateEvent.mockRejectedValue(tightened());
    renderAdmin({ ...ADMIN_EVENT, refundPolicy: "days_before", refundDays: 7 });
    fireEvent.change(daysInput(), { target: { value: "14" } });
    saveChanges();
    expect(await within(group()).findByText(TIGHTENED_MESSAGE)).toBeInTheDocument();
    await waitFor(() => expect(daysBefore()).toHaveFocus());
  });
});
