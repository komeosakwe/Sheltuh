// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { draftErrors, type DraftCheckInput } from "@/components/dashboard/editor/draft";
import EventEditor from "@/components/dashboard/EventEditor";
import type { EventRecord } from "@/lib/api/types";
import { currentStep, showStep } from "./test-utils/editorSteps";
import { fakeAuthValue, FakeAuthProvider } from "./test-utils/fakeAuth";
import { CONFIRMED_PIN_LOCATION, stubMatchMedia, unstubMatchMedia } from "./test-utils/pinMapStub";

/**
 * The event editor's steps (docs/design/event-editor.md §5): one form shown in three views, a grouped error
 * summary, the "Before you publish" checklist, ticket descriptions, and the live preview's sheet.
 */
vi.mock("@/lib/location-loader", async () => (await import("./test-utils/locationStub")).locationLoaderStub());
vi.mock("@/components/dashboard/VenuePinMapLeaflet", async () => (await import("./test-utils/pinMapStub")).leafletStub());
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

const updateEventDraft = vi.fn();
vi.mock("@/lib/api/events", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api/events")>();
  return {
    isPayoutsRequiredError: actual.isPayoutsRequiredError,
    isRefundPolicyTightenedError: actual.isRefundPolicyTightenedError,
    publishConflictCode: actual.publishConflictCode,
    updateEventDraft: (...args: unknown[]) => updateEventDraft(...args),
    createEventDraft: vi.fn(),
    publishEvent: vi.fn(),
    uploadEventImage: vi.fn(),
    deleteEventImage: vi.fn(),
  };
});

// jsdom has no modal dialogs: give <dialog> what a browser would (the preview's sheet).
beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement) {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close = function close(this: HTMLDialogElement) {
    this.removeAttribute("open");
    this.dispatchEvent(new Event("close"));
  };
});
beforeEach(() => {
  stubMatchMedia();
  updateEventDraft.mockReset();
});
afterEach(() => {
  cleanup();
  unstubMatchMedia();
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
  location: CONFIRMED_PIN_LOCATION,
  ticketTypes: [{ id: "ga", name: "General admission", priceCents: 3000, feePolicy: "buyer-pays", quantityAvailable: 10 }],
  ticketingMode: "sheltuh",
  status: "draft",
  moderationLog: [],
  createdAt: "2026-10-01T00:00:00.000Z",
  updatedAt: "2026-10-20T01:02:03.456Z",
};

/** `null`: a new event. */
function renderEditor(initial: EventRecord | null = EVENT) {
  render(
    <FakeAuthProvider value={fakeAuthValue({ email: "owner@example.com" })}>
      <EventEditor getToken={vi.fn().mockResolvedValue("token")} initial={initial ?? undefined} onSaved={vi.fn()} />
    </FakeAuthProvider>,
  );
}

const save = () => fireEvent.click(screen.getByRole("button", { name: /^Save draft/ }));
const panel = (n: number) => document.querySelector<HTMLElement>(`[data-step-panel='${n}']`);

describe("the steps", () => {
  it("opens on Event page; only that step's cards are shown, and the others stay mounted", () => {
    renderEditor();
    expect(currentStep()).toBe(1);
    expect(panel(1)).toBeVisible();
    expect(panel(2)).not.toBeVisible();
    expect(panel(3)).not.toBeVisible();
    // Mounted, though hidden: their fields are in the document.
    expect(screen.getByLabelText("Quantity available")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Add ticket type" })).toBeNull();
  });

  it("Next and Back only move between steps: what was typed stays, and nothing is saved", () => {
    renderEditor();
    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "A new title" } });
    fireEvent.click(screen.getByRole("button", { name: "Next: Tickets" }));
    expect(currentStep()).toBe(2);
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Early bird" } });
    fireEvent.click(screen.getByRole("button", { name: "Next: Publish" }));
    expect(currentStep()).toBe(3);
    expect(screen.queryByRole("button", { name: /^Next/ })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Back: Tickets" }));
    fireEvent.click(screen.getByRole("button", { name: "Back: Event page" }));
    expect(screen.getByLabelText("Title")).toHaveValue("A new title");
    expect(screen.getByLabelText("Name")).toHaveValue("Early bird");
    expect(updateEventDraft).not.toHaveBeenCalled();
  });

  it("moves focus to the new step's title, which announces it", () => {
    renderEditor();
    showStep(2);
    expect(screen.getByRole("heading", { level: 2, name: "Add tickets" })).toHaveFocus();
  });

  it("the nav says which step is current, and which are complete", () => {
    renderEditor();
    const nav = screen.getByRole("navigation", { name: "Event steps" });
    expect(within(nav).getByRole("button", { name: "Event page, current step" })).toHaveAttribute("aria-current", "step");
    expect(within(nav).getByRole("button", { name: "Tickets, complete" })).toBeInTheDocument();
    // The pin isn't set on this one: the Event page step is incomplete when it isn't the current one.
    cleanup();
    renderEditor({ ...EVENT, location: undefined });
    showStep(2);
    expect(within(screen.getByRole("navigation", { name: "Event steps" })).getByRole("button", { name: "Event page" })).toBeInTheDocument();
  });
});

describe("a save that doesn't validate", () => {
  it("shows the first bad field's step and focuses it (a Tickets error while on the Publish step)", async () => {
    renderEditor();
    fireEvent.change(screen.getByLabelText("Price (A$)"), { target: { value: "0.5" } });
    showStep(3);
    save();
    await waitFor(() => expect(screen.getByLabelText("Price (A$)")).toHaveFocus());
    expect(currentStep()).toBe(2);
    expect(updateEventDraft).not.toHaveBeenCalled();
  });

  it("with errors on two steps: the first step's field is focused, the summary groups both, and the nav counts them", async () => {
    renderEditor();
    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "" } });
    fireEvent.change(screen.getByLabelText("Price (A$)"), { target: { value: "0.5" } });
    showStep(2);
    save();
    await waitFor(() => expect(screen.getByLabelText("Title")).toHaveFocus());
    expect(currentStep()).toBe(1);
    expect(screen.getByText("Not saved: 2 fields need fixing. The first one is focused.")).toHaveAttribute("role", "status");

    const summary = screen.getByRole("region", { name: "2 fields need fixing" });
    // Not an alert, and focus isn't taken: the field already is.
    expect(summary).not.toHaveAttribute("role", "alert");
    expect(within(summary).getByText("Event page")).toBeInTheDocument();
    expect(within(summary).getByText("Tickets")).toBeInTheDocument();
    expect(within(summary).getByRole("button", { name: "Title: Enter an event title." })).toBeInTheDocument();

    const nav = screen.getByRole("navigation", { name: "Event steps" });
    // One badge on each of Event page and Tickets: the number is for the eye, and each button's name says it in words.
    expect(nav.querySelectorAll("[data-step-errors]")).toHaveLength(2);
    for (const badge of nav.querySelectorAll("[data-step-errors]")) expect(badge).toHaveAttribute("aria-hidden", "true");
    expect(within(nav).getByRole("button", { name: "Event page, current step, 1 field needs fixing" })).toBeInTheDocument();
    expect(within(nav).getByRole("button", { name: "Tickets, 1 field needs fixing" })).toBeInTheDocument();
    // The summary's title is a heading.
    expect(within(summary).getByRole("heading", { level: 3, name: "2 fields need fixing" })).toBeInTheDocument();
  });

  it("each summary link shows its step and focuses its field", async () => {
    renderEditor();
    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "" } });
    fireEvent.change(screen.getByLabelText("Price (A$)"), { target: { value: "0.5" } });
    save();
    await waitFor(() => expect(screen.getByLabelText("Title")).toHaveFocus());
    const summary = screen.getByRole("region", { name: "2 fields need fixing" });

    fireEvent.click(within(summary).getByRole("button", { name: /^Ticket 1 price: A paid ticket must cost at least/ }));
    await waitFor(() => expect(screen.getByLabelText("Price (A$)")).toHaveFocus());
    expect(currentStep()).toBe(2);

    fireEvent.click(within(summary).getByRole("button", { name: "Title: Enter an event title." }));
    await waitFor(() => expect(screen.getByLabelText("Title")).toHaveFocus());
    expect(currentStep()).toBe(1);
  });

  it("the summary goes once the form saves", async () => {
    updateEventDraft.mockResolvedValue(EVENT);
    renderEditor();
    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "" } });
    save();
    await screen.findByRole("region", { name: "1 field needs fixing" });
    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Back" } });
    save();
    await waitFor(() => expect(updateEventDraft).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.queryByRole("region", { name: /needs? fixing/ })).toBeNull());
  });

  it("the server's field errors show their step too, and are listed", async () => {
    const { ApiError } = await import("@/lib/api/client");
    updateEventDraft.mockRejectedValue(new ApiError(400, "Check the highlighted fields.", { "ticket-0-qty": "Enter how many are available." }));
    renderEditor();
    save();
    await waitFor(() => expect(screen.getByLabelText("Quantity available")).toHaveFocus());
    expect(currentStep()).toBe(2);
    expect(screen.getByRole("button", { name: "Ticket 1 quantity: Enter how many are available." })).toBeInTheDocument();
  });
});

describe("Before you publish", () => {
  const row = (key: string) => {
    const element = document.querySelector<HTMLElement>(`[data-check='${key}']`);
    if (!element) throw new Error(`No checklist row ${key}`);
    return element;
  };

  it("a complete draft: everything done, the photo and clip optional (and the clip's row only when clips are on)", () => {
    renderEditor();
    showStep(3);
    for (const key of ["title", "description", "venue", "pin", "when", "tickets", "refund"]) {
      expect(row(key)).toHaveAttribute("data-state", "done");
    }
    expect(row("photo")).toHaveAttribute("data-state", "optional");
    expect(row("photo")).toHaveTextContent("Optional: generated artwork is used");
    expect(document.querySelector("[data-check='clip']")).toBeNull();
    expect(within(row("title")).queryByRole("button")).toBeNull();
  });

  it("a new, empty event: what's missing is said in words, with a way to it", () => {
    renderEditor(null);
    showStep(3);
    expect(row("title")).toHaveAttribute("data-state", "todo");
    expect(row("title")).toHaveTextContent("Add a title");
    expect(row("pin")).toHaveTextContent("Add the venue location and confirm the pin first.");
    expect(row("when")).toHaveTextContent("Add the start and end");
    // What's wrong with the tickets, in the form's own words.
    expect(row("tickets")).toHaveTextContent("Enter a ticket name.");
    expect(screen.getByText("Some events are checked by Sheltüh before going live.")).toBeInTheDocument();
    // The Publish card for a new event: nothing to press yet.
    expect(screen.getByText("Save the draft first. Publishing opens once it is saved.")).toBeInTheDocument();
  });

  it("follows the form, and 'Go to' shows the step and focuses the control", () => {
    renderEditor(null);
    showStep(3);
    fireEvent.click(within(row("title")).getByRole("button", { name: /^Go to Title/ }));
    expect(screen.getByLabelText("Title")).toHaveFocus();
    expect(currentStep()).toBe(1);

    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Night Market" } });
    showStep(3);
    expect(row("title")).toHaveAttribute("data-state", "done");
    fireEvent.click(within(row("tickets")).getByRole("button", { name: /^Go to Tickets/ }));
    expect(screen.getByLabelText("Name")).toHaveFocus();
    expect(currentStep()).toBe(2);
  });

  it("Date and time isn't done for an event that has ended, or that ends before it starts", () => {
    renderEditor({ ...EVENT, startsAt: "2020-03-06T09:00:00.000Z", endsAt: "2020-03-06T12:30:00.000Z" });
    showStep(3);
    expect(row("when")).toHaveAttribute("data-state", "todo");
    expect(row("when")).toHaveTextContent("This event has already ended");
    expect(within(row("when")).getByRole("button", { name: /^Go to Date and time/ })).toBeInTheDocument();

    cleanup();
    renderEditor({ ...EVENT, startsAt: "2099-03-06T12:30:00.000Z", endsAt: "2099-03-06T09:00:00.000Z" });
    showStep(3);
    expect(row("when")).toHaveAttribute("data-state", "todo");
    expect(row("when")).toHaveTextContent("The end must be after the start");

    cleanup();
    renderEditor({ ...EVENT, startsAt: "2099-03-06T09:00:00.000Z", endsAt: "2099-03-06T12:30:00.000Z" });
    showStep(3);
    expect(row("when")).toHaveAttribute("data-state", "done");
  });

  it("advises only: a draft with gaps still saves what it can (the save's own checks decide)", async () => {
    renderEditor(null);
    showStep(3);
    expect(screen.getByRole("button", { name: /^Save draft/ })).not.toHaveAttribute("aria-disabled", "true");
    save();
    await screen.findByRole("region", { name: /fields? need(s)? fixing/ });
  });
});

describe("ticket descriptions", () => {
  it("is optional, has a limit, and is sent trimmed with the ticket", async () => {
    updateEventDraft.mockResolvedValue(EVENT);
    renderEditor();
    showStep(2);
    const field = screen.getByLabelText("Description (optional)");
    expect(field).toHaveAttribute("maxlength", "300");
    expect(field).toHaveValue("");
    fireEvent.change(field, { target: { value: "  Standing room, all four bands.  " } });
    expect(screen.getByText("34/300")).toBeInTheDocument();
    save();
    await waitFor(() => expect(updateEventDraft).toHaveBeenCalledTimes(1));
    expect(updateEventDraft.mock.calls[0][1].ticketTypes[0]).toEqual({
      id: "ga",
      name: "General admission",
      description: "Standing room, all four bands.",
      priceCents: 3000,
      feePolicy: "buyer-pays",
      quantityAvailable: 10,
    });
  });

  it("round-trips: a saved description is shown for editing, and clearing it sends none", async () => {
    updateEventDraft.mockResolvedValue(EVENT);
    renderEditor({ ...EVENT, ticketTypes: [{ ...EVENT.ticketTypes[0], description: "Includes a drink." }] });
    showStep(2);
    const field = screen.getByLabelText("Description (optional)");
    expect(field).toHaveValue("Includes a drink.");
    fireEvent.change(field, { target: { value: "   " } });
    save();
    await waitFor(() => expect(updateEventDraft).toHaveBeenCalledTimes(1));
    expect("description" in updateEventDraft.mock.calls[0][1].ticketTypes[0]).toBe(false);
  });
});

describe("landmarks and headings", () => {
  it("a card isn't a landmark of its own; the venue's group (a focus target) and the legends' headings are", () => {
    renderEditor();
    expect(screen.queryByRole("region", { name: "Event details" })).toBeNull();
    expect(screen.queryByRole("region", { name: "Date and time" })).toBeNull();
    expect(screen.getByRole("heading", { level: 3, name: "Event details" })).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "Venue" })).toBeInTheDocument();
    showStep(2);
    expect(screen.getByRole("heading", { level: 3, name: "Seating" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 3, name: "Refund policy" })).toBeInTheDocument();
    // The legends still name their groups.
    expect(screen.getByRole("group", { name: "Seating" })).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "Refund policy" })).toBeInTheDocument();
  });
});

describe("the preview", () => {
  it("the panel (from 1280px): the frame is hidden from assistive tech, and Hide/Show is one stable button with no stale aria-controls", () => {
    window.matchMedia = ((query: string) => ({
      matches: query === "(min-width: 80rem)",
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    })) as unknown as typeof window.matchMedia;
    renderEditor();
    const panel = screen.getByRole("complementary", { name: "Event page preview" });
    const frame = panel.querySelector("#event-preview-frame");
    expect(frame).toHaveAttribute("aria-hidden", "true");
    expect(frame?.querySelector("iframe")).not.toBeNull();
    // The caption says what it is, and is outside the hidden frame.
    expect(frame?.parentElement).toHaveTextContent("Phone, 320px wide. Not clickable.");
    const hide = within(panel).getByRole("button", { name: "Hide preview" });
    expect(hide).not.toHaveAttribute("aria-expanded");
    expect(hide).toHaveAttribute("aria-controls", "event-preview-frame");
    fireEvent.click(hide);
    const show = within(panel).getByRole("button", { name: "Show preview" });
    expect(show).not.toHaveAttribute("aria-expanded");
    expect(show).not.toHaveAttribute("aria-controls");
    expect(panel.querySelector("iframe")).toBeNull();
  });

  it("opens in a sheet from the Preview button (below 1280px), with the page in a phone-width frame, and closes", () => {
    renderEditor();
    fireEvent.click(screen.getByRole("button", { name: "Preview" }));
    const dialog = screen.getByRole("dialog", { name: "Preview" });
    const frame = within(dialog).getByTitle("Event page preview");
    expect(frame.tagName).toBe("IFRAME");
    expect(frame).toHaveAttribute("tabindex", "-1");
    // A same-document srcdoc frame: no route, nothing to load from the network.
    expect(frame).toHaveAttribute("srcdoc");
    expect(frame).not.toHaveAttribute("src");
    fireEvent.click(within(dialog).getByRole("button", { name: "Close" }));
    expect(screen.queryByTitle("Event page preview")).toBeNull();
  });
});

describe("draftErrors (what a save checks, shared with the step markers and the checklist)", () => {
  const OK: DraftCheckInput = {
    title: "T",
    description: "D",
    venueName: "V",
    venueAddress: "A",
    place: { kind: "found", place: { name: "Fitzroy", state: "VIC", timeZone: "Australia/Melbourne" } },
    start: { date: "2027-01-01", time: "10:00" },
    end: { date: "2027-01-01", time: "12:00" },
    organiserMissing: false,
    isAdmin: false,
    platformManaged: false,
    ticketingMode: "sheltuh",
    externalTicketUrl: "",
    ticketTypes: [{ id: "a", name: "GA", priceCents: 2000, feePolicy: "buyer-pays", quantityAvailable: 5 }],
    refundPolicy: "no_change_of_mind",
    refundDays: Number.NaN,
  };

  it("none for a complete form", () => {
    expect(draftErrors(OK)).toEqual({});
  });

  it("the same messages by the same keys as before", () => {
    const errors = draftErrors({
      ...OK,
      title: " ",
      description: "",
      venueName: "",
      venueAddress: "",
      place: { kind: "empty" },
      start: { date: "", time: "" },
      end: { date: "2027-01-01", time: "" },
      organiserMissing: true,
      ticketTypes: [
        { id: "a", name: "", priceCents: 50, feePolicy: "buyer-pays", quantityAvailable: 0 },
        { id: "b", name: "B", priceCents: -1, feePolicy: "buyer-pays", quantityAvailable: 1.5 },
      ],
      refundPolicy: "days_before",
      refundDays: 99,
    });
    expect(errors).toEqual({
      title: "Enter an event title.",
      description: "Enter a description.",
      venueName: "Enter a venue name.",
      venueAddress: "Enter a venue address.",
      suburb: "Enter a suburb or town.",
      start: "Enter a start date and time.",
      end: "Enter an end date and time.",
      organiserId: "Choose an organiser.",
      "ticket-0-name": "Enter a ticket name.",
      "ticket-0-price": "A paid ticket must cost at least A$1 (or make it free).",
      "ticket-0-qty": "Enter how many are available.",
      "ticket-1-price": "Enter a valid price.",
      "ticket-1-qty": "Enter how many are available.",
      refundDays: "Enter a whole number of days from 1 to 30.",
    });
  });

  it("an external event needs no tickets or refund days; an admin's needs its link", () => {
    expect(draftErrors({ ...OK, ticketingMode: "external", ticketTypes: [], refundPolicy: "days_before" })).toEqual({});
    expect(draftErrors({ ...OK, isAdmin: true, ticketingMode: "external", ticketTypes: [] })).toEqual({
      externalTicketUrl: "Enter the address of the page where tickets are sold.",
    });
  });
});
