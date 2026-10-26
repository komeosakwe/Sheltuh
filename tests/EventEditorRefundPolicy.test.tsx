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
  it("defaults to no refunds for change of mind, and says what buyers see (the ACL line)", () => {
    renderOrganiser();
    expect(noRefunds()).toBeChecked();
    expect(daysBefore()).not.toBeChecked();
    // Never disabled: using it chooses its option.
    expect(daysInput()).toBeEnabled();
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
    expect(daysBefore()).not.toBeChecked();
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

    await waitFor(() => expect(document.getElementById("refundPolicy-error")).toHaveTextContent(TIGHTENED_MESSAGE));
    // What it is now, from the saved policy, and what it can become.
    expect(document.getElementById("refundPolicy-error")).toHaveTextContent("It’s currently 7 days: choose 7 or fewer, or keep it.");
    // The fieldset keeps its help; each radio is described by the error.
    expect(group()).toHaveAttribute("aria-describedby", "refund-policy-help");
    expect(noRefunds().getAttribute("aria-describedby")?.split(" ")).toContain("refundPolicy-error");
    expect(daysBefore()).toHaveAttribute("aria-describedby", "refundPolicy-error");
    expect(noRefunds()).toHaveAccessibleDescription(expect.stringContaining(TIGHTENED_MESSAGE));
    // From days to no refunds: the choice is what to change, so it's focused.
    await waitFor(() => expect(noRefunds()).toHaveFocus());
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Not saved: the refund policy can’t be made less generous now. See Refund policy.",
    );
    expect(noRefunds()).toBeChecked();
    expect(daysInput()).toHaveValue(7);

    // Choosing again clears it.
    fireEvent.click(daysBefore());
    expect(within(group()).queryByText(TIGHTENED_MESSAGE)).toBeNull();
    expect(daysBefore()).not.toHaveAttribute("aria-describedby");
  });

  it("the days input chooses its option when focused or typed in, and a click anywhere on its card does too", () => {
    renderOrganiser();
    fireEvent.focus(daysInput());
    expect(daysBefore()).toBeChecked();

    fireEvent.click(noRefunds());
    expect(noRefunds()).toBeChecked();
    fireEvent.change(daysInput(), { target: { value: "4" } });
    expect(daysBefore()).toBeChecked();
    expect(daysInput()).toHaveValue(4);

    fireEvent.click(noRefunds());
    const card = daysBefore().closest("label")?.parentElement;
    if (!card) throw new Error("No card around the days option.");
    fireEvent.click(within(card).getByText("A whole number from 1 to 30.", { exact: false }));
    expect(daysBefore()).toBeChecked();
  });

  it("says a bigger number closes refunds earlier", () => {
    renderOrganiser();
    expect(daysInput()).toHaveAccessibleDescription(expect.stringContaining("A bigger number closes refunds earlier."));
  });

  it("each card says what it means (the first has its own help line), and they don't stretch to match", () => {
    renderOrganiser();
    expect(noRefunds()).toHaveAccessibleDescription("Buyers can’t get their money back for changing their mind.");
    const grid = noRefunds().closest("label")?.parentElement;
    expect(grid).toHaveClass("sm:grid-cols-2", "sm:items-start");
  });

  it("previews what buyers will see once the days are valid, dated from the start", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-26T00:00:00.000Z"));
    try {
      // Starts Sat 6 Mar 2027, 8:00 pm in Melbourne (AEDT).
      renderOrganiser({ refundPolicy: "days_before", refundDays: 7 });
      const preview = document.getElementById("refundDays-preview");
      expect(preview).toHaveTextContent("Buyers will see: Refunds available until Sat 27 Feb 2027, 8:00 pm (7 days before the event).");
      expect(daysInput().getAttribute("aria-describedby")?.split(" ")).toContain("refundDays-preview");

      // Live: it follows the days, and goes while they're not valid.
      fireEvent.change(daysInput(), { target: { value: "1" } });
      expect(document.getElementById("refundDays-preview")).toHaveTextContent("until Fri 5 Mar 2027, 8:00 pm (1 day before the event).");
      fireEvent.change(daysInput(), { target: { value: "40" } });
      expect(document.getElementById("refundDays-preview")).toBeNull();
      expect(daysInput().getAttribute("aria-describedby")).not.toContain("refundDays-preview");
    } finally {
      vi.useRealTimers();
    }
  });

  it("previews the plain summary while the start isn't set", () => {
    render(
      <FakeAuthProvider value={fakeAuthValue({ email: "owner@example.com" })}>
        <EventEditor getToken={vi.fn().mockResolvedValue("token")} onSaved={vi.fn()} />
      </FakeAuthProvider>,
    );
    fireEvent.change(daysInput(), { target: { value: "3" } });
    expect(document.getElementById("refundDays-preview")).toHaveTextContent(
      "Buyers will see: Refunds available up to 3 days before the event.",
    );
  });

  it("no preview for no refunds", () => {
    renderOrganiser();
    expect(document.getElementById("refundDays-preview")).toBeNull();
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

  it("a refused tightening is shown by the policy too: from days to more days, the days are focused", async () => {
    adminUpdateEvent.mockRejectedValue(tightened());
    renderAdmin({ ...ADMIN_EVENT, refundPolicy: "days_before", refundDays: 7 });
    fireEvent.change(daysInput(), { target: { value: "14" } });
    saveChanges();
    expect(await within(group()).findByText(TIGHTENED_MESSAGE)).toBeInTheDocument();
    expect(within(group()).getByText("It’s currently 7 days: choose 7 or fewer, or keep it.")).toBeInTheDocument();
    await waitFor(() => expect(daysInput()).toHaveFocus());
  });

  it("from no refunds, a refused save (stale terms) focuses the chosen option and says nothing about days", async () => {
    adminUpdateEvent.mockRejectedValue(tightened());
    renderAdmin({ ...ADMIN_EVENT, refundPolicy: "no_change_of_mind" });
    fireEvent.click(daysBefore());
    fireEvent.change(daysInput(), { target: { value: "3" } });
    saveChanges();
    expect(await within(group()).findByText(TIGHTENED_MESSAGE)).toBeInTheDocument();
    expect(within(group()).queryByText(/It’s currently/)).toBeNull();
    await waitFor(() => expect(daysBefore()).toHaveFocus());
  });
});
