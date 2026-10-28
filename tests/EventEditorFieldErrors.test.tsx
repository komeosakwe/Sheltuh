// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import EventEditor from "@/components/dashboard/EventEditor";
import type { EventRecord } from "@/lib/api/types";
import { fakeAuthValue, FakeAuthProvider } from "./test-utils/fakeAuth";
import { showStep } from "./test-utils/editorSteps";
import { CONFIRMED_PIN_LOCATION, stubMatchMedia, unstubMatchMedia } from "./test-utils/pinMapStub";

// The suburb table, stubbed: these tests aren't about the suburb (tests/VenueSuburbField.test.tsx is).
vi.mock("@/lib/location-loader", async () => (await import("./test-utils/locationStub")).locationLoaderStub());
// The venue's "Check the pin" map (the events here have a confirmed pin: publishing needs one).
vi.mock("@/components/dashboard/VenuePinMapLeaflet", async () => (await import("./test-utils/pinMapStub")).leafletStub());

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

const updateEventDraft = vi.fn();
const publishEvent = vi.fn();
vi.mock("@/lib/api/events", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api/events")>();
  return {
    isPayoutsRequiredError: actual.isPayoutsRequiredError,
    isRefundPolicyTightenedError: actual.isRefundPolicyTightenedError,
    publishConflictCode: actual.publishConflictCode,
    updateEventDraft: (...args: unknown[]) => updateEventDraft(...args),
    createEventDraft: vi.fn(),
    publishEvent: (...args: unknown[]) => publishEvent(...args),
    uploadEventImage: vi.fn(),
    deleteEventImage: vi.fn(),
  };
});

afterEach(() => {
  cleanup();
  unstubMatchMedia();
});
beforeEach(() => {
  stubMatchMedia();
  updateEventDraft.mockReset();
  publishEvent.mockReset();
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

/** EVENT with its venue's pin confirmed: publishing needs it (`location_required` otherwise). */
const PINNED_EVENT: EventRecord = { ...EVENT, location: CONFIRMED_PIN_LOCATION };

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
    ["title", "Title", "Enter an event title.", undefined],
    ["description", "Description", "Enter a description.", undefined],
    ["venueName", "Venue name", "Enter a venue name.", undefined],
    ["venueAddress", "Venue address", "Enter a venue address.", undefined],
  ])("%s: aria-invalid, and described by its error", async (id, label, message, hint) => {
    renderEditor();
    const field = screen.getByLabelText(label);
    expect(field).not.toHaveAttribute("aria-invalid");
    if (hint) expect(field).toHaveAttribute("aria-describedby", hint);
    else expect(field).not.toHaveAttribute("aria-describedby");
    fireEvent.change(field, { target: { value: "" } });
    fireEvent.click(saveButton());
    await waitFor(() => expect(field).toHaveAttribute("aria-invalid", "true"));
    expect(field).toHaveAttribute("aria-describedby", [hint, `${id}-error`].filter(Boolean).join(" "));
    expect(document.getElementById(`${id}-error`)).toHaveTextContent(message);
    expect(field).toHaveAccessibleDescription(expect.stringContaining(message));
    expect(updateEventDraft).not.toHaveBeenCalled();
  });

  it("suburb: aria-invalid, and described by its place line and its error", async () => {
    renderEditor();
    const field = screen.getByLabelText("Suburb or town");
    expect(field).not.toHaveAttribute("aria-invalid");
    // The saved suburb's place and zone, under the field.
    expect(field).toHaveAttribute("aria-describedby", "suburb-hint");
    expect(field).toHaveAccessibleDescription(/^Collingwood, Victoria · Melbourne time \(AEDT\)$/);
    fireEvent.change(field, { target: { value: "" } });
    fireEvent.click(saveButton());
    await waitFor(() => expect(field).toHaveAttribute("aria-invalid", "true"));
    // No place line for an empty field: only the error describes it.
    expect(field).toHaveAttribute("aria-describedby", "suburb-error");
    expect(document.getElementById("suburb-error")).toHaveTextContent("Enter a suburb or town.");
    expect(field).toHaveAccessibleDescription("Enter a suburb or town.");
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

  it("Publish focuses the first field to fix too, and publishes nothing", async () => {
    renderEditor(PINNED_EVENT);
    fireEvent.change(screen.getByLabelText("Title"), { target: { value: " " } });
    showStep(3);
    fireEvent.click(screen.getByRole("button", { name: "Publish…" }));
    fireEvent.click(screen.getByRole("button", { name: "Publish now" }));
    // The Event page step is shown again, and the title focused on it.
    await waitFor(() => expect(screen.getByLabelText("Title")).toHaveFocus());
    expect(screen.getByRole("button", { name: /^Event page/ })).toHaveAttribute("aria-current", "step");
    expect(updateEventDraft).not.toHaveBeenCalled();
    expect(publishEvent).not.toHaveBeenCalled();
  });
});

describe("EventEditor — the buttons", () => {
  it("Save draft, Next, Publish… (and its question's buttons) and Add ticket type are 44px tall", () => {
    renderEditor(PINNED_EVENT);
    for (const name of ["Save draft", "Next: Tickets"]) {
      expect(screen.getByRole("button", { name })).toHaveClass("min-h-11");
    }
    showStep(2);
    expect(screen.getByRole("button", { name: "Add ticket type" })).toHaveClass("min-h-11");
    showStep(3);
    expect(screen.getByRole("button", { name: "Publish…" })).toHaveClass("min-h-11");
    expect(screen.getByRole("button", { name: "Back: Tickets" })).toHaveClass("min-h-11");
    fireEvent.click(screen.getByRole("button", { name: "Publish…" }));
    for (const name of ["Publish now", "Cancel"]) {
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

  it("Publish now is busy the same way while it publishes (Cancel too), then what happened is focused", async () => {
    updateEventDraft.mockResolvedValue(EVENT);
    let finish: (record: EventRecord) => void = () => {};
    publishEvent.mockImplementation(() => new Promise((resolve) => (finish = resolve)));
    renderEditor(PINNED_EVENT);
    showStep(3);
    fireEvent.click(screen.getByRole("button", { name: "Publish…" }));
    const submit = screen.getByRole("button", { name: "Publish now" });
    submit.focus();
    fireEvent.click(submit);
    await waitFor(() => expect(submit).toHaveTextContent("Publishing…"));
    expect(submit).toHaveAttribute("aria-disabled", "true");
    expect(submit).not.toBeDisabled();
    expect(submit).toHaveFocus();
    expect(screen.getByRole("button", { name: "Cancel" })).toHaveAttribute("aria-disabled", "true");
    finish({ ...EVENT, status: "published" });
    await waitFor(() => expect(screen.getByRole("group", { name: "Published" })).toHaveFocus());
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
