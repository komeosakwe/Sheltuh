// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import EventEditor from "@/components/dashboard/EventEditor";
import { ApiError } from "@/lib/api/client";
import type { EventRecord, ModerationLogEntry, PublishEventConflictCode } from "@/lib/api/types";
import {
  PUBLISH_REVIEW_GENERAL,
  PUBLISH_REVIEW_REASON_TEXT,
  publishReviewReason,
  removedBefore,
} from "@/lib/organiser-events";
import { fakeAuthValue, FakeAuthProvider } from "./test-utils/fakeAuth";
import { CONFIRMED_PIN_LOCATION, stubMatchMedia, unstubMatchMedia } from "./test-utils/pinMapStub";

// The suburb table, stubbed: these tests aren't about the suburb (tests/VenueSuburbField.test.tsx is).
vi.mock("@/lib/location-loader", async () => (await import("./test-utils/locationStub")).locationLoaderStub());
// The venue's "Check the pin" map (these events have a confirmed pin: publishing needs one).
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
    // The real check: the editor tells the 409s apart with it.
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
  updateEventDraft.mockImplementation(async () => ({ ...EVENT }));
});

const EVENT: EventRecord = {
  organiserId: "org-1",
  eventId: "evt-1",
  slug: "night-market",
  title: "Night Market",
  description: "Stalls and music.",
  category: "live-music",
  venueName: "The Venue",
  venueAddress: "1 Test St",
  suburb: "Fitzroy",
  location: CONFIRMED_PIN_LOCATION,
  startsAt: "2027-03-06T09:00:00.000Z",
  endsAt: "2027-03-06T12:30:00.000Z",
  organiserName: "Test Org",
  ticketTypes: [{ id: "ga", name: "Entry", priceCents: 0, feePolicy: "buyer-pays", quantityAvailable: 50 }],
  status: "draft",
  moderationLog: [],
  createdAt: "2026-10-01T00:00:00.000Z",
  updatedAt: "2026-10-20T00:00:00.000Z",
};

const log = (...actions: ModerationLogEntry["action"][]): ModerationLogEntry[] =>
  actions.map((action, i) => ({ action, by: "sheltuh", at: `2026-10-2${i}T00:00:00.000Z` }));

const UNPUBLISHED: EventRecord = {
  ...EVENT,
  ticketingLocked: true,
  rejectionReason: "The photo isn't of this event.",
  moderationLog: log("submitted", "approved", "unpublished"),
};
const REJECTED: EventRecord = {
  ...EVENT,
  status: "rejected",
  rejectionReason: "Add the set times.",
  moderationLog: log("submitted", "rejected"),
};

function renderEditor(initial: EventRecord = EVENT, extra: { eventReviewRequired?: boolean } = {}) {
  const onSaved = vi.fn();
  render(
    <FakeAuthProvider value={fakeAuthValue({ email: "owner@example.com" })}>
      <EventEditor
        getToken={vi.fn().mockResolvedValue("token")}
        initial={initial}
        onSaved={onSaved}
        eventReviewRequired={extra.eventReviewRequired}
      />
    </FakeAuthProvider>,
  );
  return { onSaved };
}

const publishButton = () => screen.getByRole("button", { name: "Publish…" });

describe("removedBefore / publishReviewReason (lib/organiser-events.ts)", () => {
  it("the newest of approved/rejected/unpublished decides; other entries don't count", () => {
    expect(removedBefore(EVENT)).toBeNull();
    expect(removedBefore(REJECTED)).toBe("rejected_before");
    expect(removedBefore(UNPUBLISHED)).toBe("unpublished_before");
    expect(removedBefore({ status: "draft", moderationLog: log("rejected", "submitted", "approved", "edited") })).toBeNull();
    // Sent for review again after an unpublish: still the unpublish (a submission isn't a decision).
    expect(removedBefore({ status: "pending_review", moderationLog: log("approved", "unpublished", "submitted") })).toBe(
      "unpublished_before",
    );
  });

  it("then the organiser's switch, a seat map, and a ticket link on a site we don't know", () => {
    expect(publishReviewReason(EVENT, false)).toBeNull();
    expect(publishReviewReason(EVENT, true)).toBe("review_required");
    expect(publishReviewReason(UNPUBLISHED, true)).toBe("unpublished_before");
    expect(publishReviewReason({ ...EVENT, seating: { version: 1, seatCount: 40 } }, false)).toBe("seated");
    const external = { ...EVENT, ticketingMode: "external" as const, ticketTypes: [] };
    expect(publishReviewReason({ ...external, externalTicketUrl: "https://tickets.example.org/neon" }, false)).toBe(
      "ticket_site",
    );
    expect(publishReviewReason({ ...external, externalTicketUrl: "https://events.humanitix.com/neon" }, false)).toBeNull();
  });
});

describe("EventEditor — Publish… asks first", () => {
  it("says it goes live now, followers are emailed, and it can't be edited here; Cancel is focused", async () => {
    renderEditor();
    fireEvent.click(publishButton());
    const question = screen.getByRole("group", { name: "Publish this event now?" });
    expect(question).toHaveTextContent("It goes live on Sheltüh straight away");
    expect(question).toHaveTextContent("Your followers are emailed about it. Emails can’t be unsent.");
    expect(question).toHaveTextContent("You can’t edit it here afterwards.");
    await waitFor(() => expect(within(question).getByRole("button", { name: "Cancel" })).toHaveFocus());
    // The confirm button is described by what happens.
    expect(within(question).getByRole("button", { name: "Publish now" })).toHaveAccessibleDescription(
      /goes live on Sheltüh straight away/,
    );
    expect(screen.queryByRole("button", { name: "Publish…" })).toBeNull();
    expect(publishEvent).not.toHaveBeenCalled();
    expect(updateEventDraft).not.toHaveBeenCalled();
  });

  it("Cancel, or Escape, closes it and puts focus back on Publish…", async () => {
    renderEditor();
    fireEvent.click(publishButton());
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(publishButton()).toHaveFocus());

    fireEvent.click(publishButton());
    await waitFor(() => expect(screen.getByRole("button", { name: "Cancel" })).toHaveFocus());
    fireEvent.keyDown(screen.getByRole("button", { name: "Cancel" }), { key: "Escape" });
    await waitFor(() => expect(publishButton()).toHaveFocus());
    expect(screen.queryByRole("group", { name: "Publish this event now?" })).toBeNull();
    expect(publishEvent).not.toHaveBeenCalled();
  });

  it.each([
    ["their events are reviewed", EVENT, true, PUBLISH_REVIEW_REASON_TEXT.review_required],
    ["a seat map", { ...EVENT, seating: { version: 1, seatCount: 40 } }, false, PUBLISH_REVIEW_REASON_TEXT.seated],
    [
      "a ticket site we don't know",
      { ...EVENT, ticketingMode: "external" as const, ticketTypes: [], externalTicketUrl: "https://tickets.example.org/neon" },
      false,
      PUBLISH_REVIEW_REASON_TEXT.ticket_site,
    ],
  ])("known to go to review (%s): the question says so and why, and its button says Send for review", (_name, initial, reviewed, text) => {
    renderEditor(initial, { eventReviewRequired: reviewed });
    fireEvent.click(publishButton());
    const question = screen.getByRole("group", { name: "Send this event for review?" });
    expect(question).toHaveTextContent(text);
    expect(question).toHaveTextContent("It goes live once it’s approved, and your followers are emailed then.");
    expect(within(question).getByRole("button", { name: "Send for review" })).toBeInTheDocument();
  });
});

describe("EventEditor — what publishing did", () => {
  it("published: says it's live, links to its page, and is focused in place of the form", async () => {
    publishEvent.mockResolvedValue({ ...EVENT, status: "published" });
    const { onSaved } = renderEditor();
    fireEvent.click(publishButton());
    fireEvent.click(screen.getByRole("button", { name: "Publish now" }));

    const outcome = await screen.findByRole("group", { name: "Published" });
    await waitFor(() => expect(outcome).toHaveFocus());
    expect(outcome).toHaveAccessibleDescription("It’s live on Sheltüh now, and your followers are being emailed about it.");
    expect(within(outcome).getByRole("link", { name: "View your event page" })).toHaveAttribute("href", "/events/night-market");
    expect(within(outcome).getByRole("link", { name: "contact Sheltüh" })).toHaveAttribute(
      "href",
      expect.stringMatching(/^mailto:/),
    );
    expect(screen.queryByLabelText("Title")).toBeNull();
    expect(publishEvent).toHaveBeenCalledWith("evt-1", expect.any(Function));
    expect(onSaved).toHaveBeenLastCalledWith(expect.objectContaining({ status: "published" }));
  });

  it("sent for review with no reason known here (the daily limit): the general reason", async () => {
    publishEvent.mockResolvedValue({ ...EVENT, status: "pending_review", moderationLog: log("submitted") });
    renderEditor();
    fireEvent.click(publishButton());
    fireEvent.click(screen.getByRole("button", { name: "Publish now" }));

    const outcome = await screen.findByRole("group", { name: "Sent for review" });
    await waitFor(() => expect(outcome).toHaveFocus());
    expect(outcome).toHaveAccessibleDescription(PUBLISH_REVIEW_GENERAL);
    expect(outcome).toHaveTextContent("You can’t edit it while it’s waiting.");
    expect(within(outcome).queryByRole("link")).toBeNull();
  });

  it("sent for review for a seat map: says why", async () => {
    const seated = { ...EVENT, seating: { version: 1, seatCount: 40 } };
    updateEventDraft.mockResolvedValue(seated);
    publishEvent.mockResolvedValue({ ...seated, status: "pending_review" });
    renderEditor(seated);
    fireEvent.click(publishButton());
    fireEvent.click(screen.getByRole("button", { name: "Send for review" }));
    const outcome = await screen.findByRole("group", { name: "Sent for review" });
    expect(outcome).toHaveAccessibleDescription(PUBLISH_REVIEW_REASON_TEXT.seated);
  });

  it("their switch was turned off meanwhile: whatever the question said, it says what really happened", async () => {
    publishEvent.mockResolvedValue({ ...EVENT, status: "published" });
    renderEditor(EVENT, { eventReviewRequired: true });
    fireEvent.click(publishButton());
    fireEvent.click(screen.getByRole("button", { name: "Send for review" }));
    expect(await screen.findByRole("group", { name: "Published" })).toBeInTheDocument();
  });
});

describe("EventEditor — rejected or unpublished before: Send for review", () => {
  it("a rejected event shows the reviewer's note, and Send for review sends it straight away (no question)", async () => {
    updateEventDraft.mockResolvedValue(REJECTED);
    publishEvent.mockResolvedValue({ ...REJECTED, status: "pending_review", rejectionReason: undefined, moderationLog: log("submitted", "rejected", "submitted") });
    renderEditor(REJECTED);
    expect(screen.getByText("Not approved — reviewer note:")).toBeInTheDocument();
    expect(screen.getByText("Add the set times.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Publish…" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Send for review" }));
    const outcome = await screen.findByRole("group", { name: "Sent for review" });
    expect(outcome).toHaveAccessibleDescription(PUBLISH_REVIEW_REASON_TEXT.rejected_before);
    expect(updateEventDraft.mock.invocationCallOrder[0]).toBeLessThan(publishEvent.mock.invocationCallOrder[0]);
  });

  it("an unpublished draft shows Sheltüh's note and that it'll be checked again", async () => {
    updateEventDraft.mockResolvedValue(UNPUBLISHED);
    publishEvent.mockResolvedValue({
      ...UNPUBLISHED,
      status: "pending_review",
      rejectionReason: undefined,
      moderationLog: log("submitted", "approved", "unpublished", "submitted"),
    });
    renderEditor(UNPUBLISHED);
    expect(screen.getByText("Taken off Sheltüh — note from Sheltüh:")).toBeInTheDocument();
    expect(screen.getByText("The photo isn't of this event.")).toBeInTheDocument();
    expect(screen.getByText(/When you send it for review again, a person at Sheltüh checks it/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Send for review" }));
    const outcome = await screen.findByRole("group", { name: "Sent for review" });
    expect(outcome).toHaveAccessibleDescription(PUBLISH_REVIEW_REASON_TEXT.unpublished_before);
  });

  it("a draft that was never removed has no note", () => {
    renderEditor();
    expect(screen.queryByText(/note from Sheltüh|reviewer note/)).toBeNull();
  });
});

describe("EventEditor — a publish refused (409)", () => {
  const conflict = (code: PublishEventConflictCode) => new ApiError(409, `Server says ${code}.`, undefined, { error: "x", code });

  it.each([
    ["event_ended", "This event has already ended, so it can’t be published.", false],
    ["in_review", "This event is already waiting for review", true],
    ["event_changed", "This event’s ticket link changed while it was being published. Your changes were saved", true],
    // location_required focuses the venue instead: tests/EventEditorLocation.test.tsx.
  ] as const)("%s: says why, focused, the question closed (and offers a reload when that's the way on)", async (code, text, reload) => {
    publishEvent.mockRejectedValue(conflict(code));
    const { onSaved } = renderEditor();
    fireEvent.click(publishButton());
    fireEvent.click(screen.getByRole("button", { name: "Publish now" }));

    const refusal = await screen.findByRole("group", { name: new RegExp(`^${text}`) });
    await waitFor(() => expect(refusal).toHaveFocus());
    expect(screen.queryByRole("button", { name: "Publish now" })).toBeNull();
    expect(screen.getByRole("button", { name: "Publish…" })).toBeInTheDocument();
    expect(within(refusal).queryByRole("button", { name: "Reload page" }) !== null).toBe(reload);
    // Not shown twice (the focus move reads it), and the form is kept.
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByLabelText("Title")).toHaveValue("Night Market");
    expect(onSaved).not.toHaveBeenCalledWith(expect.objectContaining({ status: "published" }));
  });

  it("trying again clears the refusal", async () => {
    publishEvent.mockRejectedValueOnce(conflict("event_ended")).mockResolvedValueOnce({ ...EVENT, status: "published" });
    renderEditor();
    fireEvent.click(publishButton());
    fireEvent.click(screen.getByRole("button", { name: "Publish now" }));
    await screen.findByRole("group", { name: /already ended/ });
    fireEvent.click(publishButton());
    expect(screen.queryByRole("group", { name: /already ended/ })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Publish now" }));
    expect(await screen.findByRole("group", { name: "Published" })).toBeInTheDocument();
  });

  it("anything else (a network failure) is an alert, and the question stays open to try again", async () => {
    publishEvent.mockRejectedValue(new Error("Couldn't reach Sheltüh."));
    renderEditor();
    fireEvent.click(publishButton());
    fireEvent.click(screen.getByRole("button", { name: "Publish now" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Couldn't reach Sheltüh.");
    expect(screen.getByRole("button", { name: "Publish now" })).not.toHaveAttribute("aria-disabled");
  });
});
