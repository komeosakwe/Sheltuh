// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import EventEditor from "@/components/dashboard/EventEditor";
import type { EventRecord } from "@/lib/api/types";
import { fakeAuthValue, FakeAuthProvider } from "./test-utils/fakeAuth";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

const updateEventDraft = vi.fn();
const submitEventForReview = vi.fn();
vi.mock("@/lib/api/events", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api/events")>();
  return {
    isPayoutsRequiredError: actual.isPayoutsRequiredError,
    isRefundPolicyTightenedError: actual.isRefundPolicyTightenedError,
    updateEventDraft: (...args: unknown[]) => updateEventDraft(...args),
    createEventDraft: vi.fn(),
    submitEventForReview: (...args: unknown[]) => submitEventForReview(...args),
    uploadEventImage: vi.fn(),
    deleteEventImage: vi.fn(),
  };
});

afterEach(cleanup);
beforeEach(() => {
  updateEventDraft.mockReset();
  submitEventForReview.mockReset();
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

function renderEditor(initial: EventRecord | undefined = EVENT) {
  render(
    <FakeAuthProvider value={fakeAuthValue({ email: "owner@example.com" })}>
      <EventEditor getToken={vi.fn().mockResolvedValue("token")} initial={initial} onSaved={vi.fn()} />
    </FakeAuthProvider>,
  );
}

const saveButton = () => screen.getByRole("button", { name: /^Save draft|^Saving/ });

describe("EventEditor — field errors are tied to their fields", () => {
  it.each([
    ["title", "Title", "Enter an event title."],
    ["description", "Description", "Enter a description."],
    ["venueName", "Venue name", "Enter a venue name."],
    ["venueAddress", "Venue address", "Enter a venue address."],
    ["suburb", "Suburb", "Enter a suburb."],
  ])("%s: aria-invalid, and described by its error", async (id, label, message) => {
    renderEditor();
    const field = screen.getByLabelText(label);
    expect(field).not.toHaveAttribute("aria-invalid");
    expect(field).not.toHaveAttribute("aria-describedby");
    fireEvent.change(field, { target: { value: "" } });
    fireEvent.click(saveButton());
    await waitFor(() => expect(field).toHaveAttribute("aria-invalid", "true"));
    expect(field).toHaveAttribute("aria-describedby", `${id}-error`);
    expect(document.getElementById(`${id}-error`)).toHaveTextContent(message);
    expect(field).toHaveAccessibleDescription(message);
    expect(updateEventDraft).not.toHaveBeenCalled();
  });

  it("the start and end inputs: each pair is invalid with its own error", async () => {
    renderEditor();
    fireEvent.change(screen.getByLabelText("Start time"), { target: { value: "" } });
    fireEvent.change(screen.getByLabelText("End date"), { target: { value: "" } });
    fireEvent.click(saveButton());
    await waitFor(() => expect(screen.getByLabelText("Start date")).toHaveAttribute("aria-invalid", "true"));
    expect(screen.getByLabelText("Start time")).toHaveAccessibleDescription("Enter a start date and time.");
    expect(screen.getByLabelText("End date")).toHaveAccessibleDescription("Enter an end date and time.");
    expect(screen.getByLabelText("End time")).toHaveAttribute("aria-invalid", "true");
  });

  it("each ticket type's name, price and quantity", async () => {
    renderEditor();
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "" } });
    fireEvent.change(screen.getByLabelText("Price (A$)"), { target: { value: "0.5" } });
    fireEvent.change(screen.getByLabelText("Quantity available"), { target: { value: "0" } });
    fireEvent.click(saveButton());
    await waitFor(() => expect(screen.getByLabelText("Name")).toHaveAttribute("aria-invalid", "true"));
    expect(screen.getByLabelText("Name")).toHaveAccessibleDescription("Enter a ticket name.");
    expect(screen.getByLabelText("Price (A$)")).toHaveAccessibleDescription(/A paid ticket must cost at least/);
    expect(screen.getByLabelText("Quantity available")).toHaveAccessibleDescription("Enter how many are available.");
  });

  it("a save that doesn't validate focuses the first field to fix and says so by the buttons", async () => {
    renderEditor();
    fireEvent.change(screen.getByLabelText("Venue name"), { target: { value: "" } });
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "" } });
    fireEvent.click(saveButton());
    await waitFor(() => expect(screen.getByLabelText("Venue name")).toHaveFocus());
    expect(screen.getByRole("status")).toHaveTextContent("Not saved: 2 fields need fixing. The first one is focused.");

    // Fixed in order: the next save focuses what's left.
    fireEvent.change(screen.getByLabelText("Venue name"), { target: { value: "The Tote" } });
    fireEvent.click(saveButton());
    await waitFor(() => expect(screen.getByLabelText("Name")).toHaveFocus());
    expect(screen.getByRole("status")).toHaveTextContent("Not saved: 1 field needs fixing.");
  });

  it("Submit for review focuses the first field to fix too, and submits nothing", async () => {
    renderEditor();
    fireEvent.change(screen.getByLabelText("Title"), { target: { value: " " } });
    fireEvent.click(screen.getByRole("button", { name: "Submit for review" }));
    await waitFor(() => expect(screen.getByLabelText("Title")).toHaveFocus());
    expect(updateEventDraft).not.toHaveBeenCalled();
    expect(submitEventForReview).not.toHaveBeenCalled();
  });
});

describe("EventEditor — the buttons", () => {
  it("Save draft, Submit for review and Add ticket type are 44px tall", () => {
    renderEditor();
    for (const name of ["Save draft", "Submit for review", "Add ticket type"]) {
      expect(screen.getByRole("button", { name })).toHaveClass("min-h-11");
    }
  });

  it("Save stays focusable while it saves (busy, aria-disabled; never disabled) and ignores another press", async () => {
    let finish: (record: EventRecord) => void = () => {};
    updateEventDraft.mockImplementation(() => new Promise((resolve) => (finish = resolve)));
    renderEditor();
    const save = screen.getByRole("button", { name: "Save draft" });
    save.focus();
    fireEvent.click(save);
    await waitFor(() => expect(save).toHaveTextContent("Saving…"));
    expect(save).toHaveAttribute("aria-disabled", "true");
    expect(save).not.toBeDisabled();
    expect(save).toHaveFocus();
    fireEvent.click(save);
    expect(updateEventDraft).toHaveBeenCalledTimes(1);
    finish(EVENT);
    await waitFor(() => expect(save).not.toHaveAttribute("aria-disabled"));
  });

  it("Submit for review is busy the same way while it submits", async () => {
    updateEventDraft.mockResolvedValue(EVENT);
    let finish: (record: EventRecord) => void = () => {};
    submitEventForReview.mockImplementation(() => new Promise((resolve) => (finish = resolve)));
    renderEditor();
    const submit = screen.getByRole("button", { name: "Submit for review" });
    submit.focus();
    fireEvent.click(submit);
    await waitFor(() => expect(submit).toHaveTextContent("Submitting…"));
    expect(submit).toHaveAttribute("aria-disabled", "true");
    expect(submit).not.toBeDisabled();
    expect(submit).toHaveFocus();
    finish({ ...EVENT, status: "pending_review" });
    await waitFor(() => expect(submit).not.toHaveAttribute("aria-disabled"));
  });
});

describe("EventEditor — locked while waiting for review", () => {
  it("says Waiting for review, as the dashboard does", () => {
    renderEditor({ ...EVENT, status: "pending_review" });
    expect(screen.getByRole("heading", { level: 2, name: "Waiting for review" })).toBeInTheDocument();
    expect(screen.getByText("This event can’t be edited while it’s waiting for review.")).toBeInTheDocument();
    expect(screen.queryByText(/Pending review/i)).toBeNull();
  });

  it("and Published once it's live", () => {
    renderEditor({ ...EVENT, status: "published" });
    expect(screen.getByRole("heading", { level: 2, name: "Published" })).toBeInTheDocument();
    expect(screen.getByText("This event can’t be edited while it’s published.")).toBeInTheDocument();
  });
});
