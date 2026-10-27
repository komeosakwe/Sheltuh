// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import EventEditor from "@/components/dashboard/EventEditor";
import { PAYOUTS_NEEDED_TO_PUBLISH, PAYOUTS_PUBLISH_HINT } from "@/components/dashboard/PayoutsRequired";
import { ApiError } from "@/lib/api/client";
import { PAYOUTS_REQUIRED_CODE } from "@/lib/api/events";
import type { AdminEventRecord, AdminOrganiserRecord, EventRecord } from "@/lib/api/types";
import { sellsPaidTicketsOnSheltuh } from "@/lib/ticketing";
import { fakeAuthValue, FakeAuthProvider } from "./test-utils/fakeAuth";

const push = vi.fn();
// The suburb table, stubbed: these tests aren't about the suburb (tests/VenueSuburbField.test.tsx is).
vi.mock("@/lib/location-loader", async () => (await import("./test-utils/locationStub")).locationLoaderStub());

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
}));

const updateEventDraft = vi.fn();
const createEventDraft = vi.fn();
const publishEvent = vi.fn();
vi.mock("@/lib/api/events", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api/events")>();
  return {
    PAYOUTS_REQUIRED_CODE: actual.PAYOUTS_REQUIRED_CODE,
    isPayoutsRequiredError: actual.isPayoutsRequiredError,
    isRefundPolicyTightenedError: actual.isRefundPolicyTightenedError,
    publishConflictCode: actual.publishConflictCode,
    updateEventDraft: (...args: unknown[]) => updateEventDraft(...args),
    createEventDraft: (...args: unknown[]) => createEventDraft(...args),
    publishEvent: (...args: unknown[]) => publishEvent(...args),
    uploadEventImage: vi.fn(),
    deleteEventImage: vi.fn(),
  };
});

const adminListOrganisers = vi.fn();
const adminCreateEvent = vi.fn();
const adminUpdateEvent = vi.fn();
vi.mock("@/lib/api/admin", () => ({
  adminListOrganisers: (...args: unknown[]) => adminListOrganisers(...args),
  adminCreateOrganiser: vi.fn(),
  adminCreateEvent: (...args: unknown[]) => adminCreateEvent(...args),
  adminUpdateEvent: (...args: unknown[]) => adminUpdateEvent(...args),
  adminUploadEventImage: vi.fn(),
  adminDeleteEventImage: vi.fn(),
}));

afterEach(cleanup);
beforeEach(() => {
  for (const fn of [push, updateEventDraft, createEventDraft, publishEvent, adminListOrganisers, adminCreateEvent,
    adminUpdateEvent]) fn.mockReset();
});

/** What the API answers an organiser's publish of a paid event before their payouts are set up. */
const SUBMIT_REFUSED_MESSAGE = "Set up payouts before publishing an event with paid tickets. Free events can be published now.";
const submitRefused = () =>
  new ApiError(409, SUBMIT_REFUSED_MESSAGE, undefined, { error: SUBMIT_REFUSED_MESSAGE, code: PAYOUTS_REQUIRED_CODE });

const ADMIN_REFUSED_MESSAGE =
  "This organiser hasn't set up payouts, so this event can't have paid tickets while it's submitted or published. Make its tickets free, or wait until they've connected Stripe.";
const adminRefused = () =>
  new ApiError(409, ADMIN_REFUSED_MESSAGE, { ticketTypes: ADMIN_REFUSED_MESSAGE }, {
    error: ADMIN_REFUSED_MESSAGE,
    code: PAYOUTS_REQUIRED_CODE,
    fieldErrors: { ticketTypes: ADMIN_REFUSED_MESSAGE },
  });

const PAID_DRAFT: EventRecord = {
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
  status: "draft",
  moderationLog: [],
  createdAt: "2026-10-01T00:00:00.000Z",
  updatedAt: "2026-10-20T00:00:00.000Z",
};

const FREE_TICKETS = [{ id: "ga", name: "Entry", priceCents: 0, feePolicy: "buyer-pays" as const, quantityAvailable: 10 }];

function renderOrganiser(initial: EventRecord | undefined, payoutsEnabled: boolean | undefined, onSaved = vi.fn()) {
  render(
    <FakeAuthProvider value={fakeAuthValue({ email: "owner@example.com" })}>
      <EventEditor
        getToken={vi.fn().mockResolvedValue("token")}
        initial={initial}
        payoutsEnabled={payoutsEnabled}
        onSaved={onSaved}
      />
    </FakeAuthProvider>,
  );
  return { onSaved };
}

const notice = () => screen.queryByText(PAYOUTS_NEEDED_TO_PUBLISH);
const submitButton = () => screen.getByRole("button", { name: "Publish…" });
/** Publish…, then the question's Publish now. */
const publish = () => {
  fireEvent.click(submitButton());
  fireEvent.click(screen.getByRole("button", { name: "Publish now" }));
};

describe("sellsPaidTicketsOnSheltuh", () => {
  it("is true only for a Sheltüh-ticketed event (a missing mode is Sheltüh) with a ticket above 0", () => {
    expect(sellsPaidTicketsOnSheltuh({ ticketTypes: [{ priceCents: 0 }, { priceCents: 100 }] })).toBe(true);
    expect(sellsPaidTicketsOnSheltuh({ ticketingMode: "sheltuh", ticketTypes: [{ priceCents: 100 }] })).toBe(true);
    expect(sellsPaidTicketsOnSheltuh({ ticketingMode: "sheltuh", ticketTypes: [{ priceCents: 0 }] })).toBe(false);
    expect(sellsPaidTicketsOnSheltuh({ ticketingMode: "sheltuh", ticketTypes: [] })).toBe(false);
    expect(sellsPaidTicketsOnSheltuh({ ticketingMode: "external", ticketTypes: [{ priceCents: 100 }] })).toBe(false);
  });
});

describe("EventEditor (organiser) — payouts before publishing paid tickets", () => {
  it("paid tickets, payouts off: says so by the tickets and by Publish…, linking to payouts; both buttons stay enabled", () => {
    renderOrganiser(PAID_DRAFT, false);
    expect(notice()).toBeInTheDocument();
    const links = screen.getAllByRole("link", { name: "Set up payouts" });
    expect(links).toHaveLength(2);
    for (const link of links) expect(link).toHaveAttribute("href", "/dashboard/payouts");
    expect(screen.getByRole("button", { name: "Save draft" })).not.toHaveAttribute("aria-disabled", "true");
    expect(submitButton()).not.toHaveAttribute("aria-disabled", "true");
    expect(submitButton()).toHaveAccessibleDescription(new RegExp(PAYOUTS_PUBLISH_HINT.slice(0, 40)));
    // Leaving for payouts leaves the editor: both say to save first.
    expect(screen.getAllByText("(save your changes first)")).toHaveLength(2);
    expect(document.getElementById("publish-payouts-hint")).toHaveTextContent("(save your changes first)");
    // The question's Publish now says so too.
    fireEvent.click(submitButton());
    expect(screen.getByRole("button", { name: "Publish now" })).toHaveAccessibleDescription(
      new RegExp(PAYOUTS_PUBLISH_HINT.slice(0, 40)),
    );
  });

  it("free tickets: nothing to say", () => {
    renderOrganiser({ ...PAID_DRAFT, ticketTypes: FREE_TICKETS }, false);
    expect(notice()).toBeNull();
    expect(screen.queryByRole("link", { name: "Set up payouts" })).toBeNull();
    expect(submitButton()).not.toHaveAttribute("aria-describedby");
  });

  it("follows the prices as they're edited", () => {
    renderOrganiser({ ...PAID_DRAFT, ticketTypes: FREE_TICKETS }, false);
    fireEvent.change(screen.getByLabelText("Price (A$)"), { target: { value: "25" } });
    expect(notice()).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Price (A$)"), { target: { value: "0" } });
    expect(notice()).toBeNull();
  });

  it("external ticketing never needs payouts", () => {
    renderOrganiser(
      { ...PAID_DRAFT, ticketingMode: "external", externalTicketUrl: "https://events.humanitix.com/neon", ticketTypes: [] },
      false,
    );
    expect(notice()).toBeNull();
    expect(submitButton()).not.toHaveAttribute("aria-describedby");
  });

  it("payouts on, or not known yet: nothing to say", () => {
    renderOrganiser(PAID_DRAFT, true);
    expect(notice()).toBeNull();
    cleanup();
    renderOrganiser(PAID_DRAFT, undefined);
    expect(notice()).toBeNull();
  });

  it("a new event says so by the tickets (there's no Publish yet)", () => {
    renderOrganiser(undefined, false);
    expect(notice()).toBeNull();
    fireEvent.change(screen.getByLabelText("Price (A$)"), { target: { value: "20" } });
    expect(notice()).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Publish…" })).toBeNull();
    expect(screen.getAllByRole("link", { name: "Set up payouts" })).toHaveLength(1);
  });

  it("a draft with paid tickets still saves", async () => {
    updateEventDraft.mockResolvedValue(PAID_DRAFT);
    const { onSaved } = renderOrganiser(PAID_DRAFT, false);
    fireEvent.click(screen.getByRole("button", { name: "Save draft" }));
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith(PAID_DRAFT));
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("a refused publish shows the server's reason with the link, and focus moves to it (which announces it)", async () => {
    updateEventDraft.mockResolvedValue(PAID_DRAFT);
    publishEvent.mockRejectedValue(submitRefused());
    const { onSaved } = renderOrganiser(PAID_DRAFT, false);
    publish();

    // A group named by the message, focused: arriving there reads it. No role="alert" as well (read twice).
    const box = await screen.findByRole("group", { name: SUBMIT_REFUSED_MESSAGE });
    expect(box).toHaveTextContent(SUBMIT_REFUSED_MESSAGE);
    await waitFor(() => expect(box).toHaveFocus());
    expect(screen.queryByRole("alert")).toBeNull();
    // Publishing saved the changes first: no "save first" here.
    expect(box).not.toHaveTextContent("save your changes first");
    expect(within(box).getByRole("link", { name: "Set up payouts" })).toHaveAttribute("href", "/dashboard/payouts");
    // The question is over; Publish… now names the refusal (the hint it replaces isn't shown twice).
    expect(screen.queryByRole("button", { name: "Publish now" })).toBeNull();
    expect(submitButton()).toHaveAccessibleDescription(new RegExp(SUBMIT_REFUSED_MESSAGE.slice(0, 40)));
    expect(screen.queryByText(PAYOUTS_PUBLISH_HINT)).toBeNull();
    // The edits were saved first; nothing says it was published.
    expect(updateEventDraft).toHaveBeenCalledTimes(1);
    expect(onSaved).not.toHaveBeenCalledWith(expect.objectContaining({ status: "published" }));
    expect(submitButton()).not.toHaveAttribute("aria-disabled", "true");
  });

  it("refused although the page thought payouts were on: the notice shows from then on", async () => {
    updateEventDraft.mockResolvedValue(PAID_DRAFT);
    publishEvent.mockRejectedValue(submitRefused());
    renderOrganiser(PAID_DRAFT, true);
    expect(notice()).toBeNull();
    publish();
    await screen.findByRole("group", { name: SUBMIT_REFUSED_MESSAGE });
    expect(notice()).toBeInTheDocument();
  });

  it("trying again clears the refusal; a publish that goes through is passed on", async () => {
    updateEventDraft.mockResolvedValue(PAID_DRAFT);
    publishEvent.mockRejectedValueOnce(submitRefused()).mockResolvedValueOnce({ ...PAID_DRAFT, status: "published" });
    const { onSaved } = renderOrganiser(PAID_DRAFT, false);
    publish();
    await screen.findByRole("group", { name: SUBMIT_REFUSED_MESSAGE });
    publish();
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith(expect.objectContaining({ status: "published" })));
    expect(screen.queryByText(SUBMIT_REFUSED_MESSAGE)).toBeNull();
  });

  it("any other 409 is shown as before, without the payouts link", async () => {
    updateEventDraft.mockResolvedValue(PAID_DRAFT);
    publishEvent.mockRejectedValue(new ApiError(409, "Only a draft or rejected event can be published."));
    renderOrganiser(PAID_DRAFT, true);
    publish();
    expect(await screen.findByRole("alert")).toHaveTextContent("Only a draft or rejected event can be published.");
    expect(screen.queryByRole("link", { name: "Set up payouts" })).toBeNull();
  });
});

const ADMIN_EVENT: AdminEventRecord = {
  ...PAID_DRAFT,
  ticketingMode: "sheltuh",
  externalFree: false,
  externalProvider: null,
  ticketingLocked: false,
  organiserPlatformManaged: false,
  curation: { boost: 1, excluded: false },
};

const OWNED_ORGANISER: AdminOrganiserRecord = {
  organiserId: "org-1",
  ownerUserId: "user-1",
  displayName: "Static Collective",
  contactEmail: "hello@static.example",
  description: "Gigs.",
  categories: ["live-music"],
  status: "approved",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  recentEdits: [],
  payoutsEnabled: false,
};

function renderAdmin(initial?: AdminEventRecord) {
  render(
    <FakeAuthProvider value={fakeAuthValue({ email: "admin@sheltuh.example", isAdmin: true })}>
      <EventEditor mode="admin" getToken={vi.fn().mockResolvedValue("token")} initial={initial} onSaved={vi.fn()} />
    </FakeAuthProvider>,
  );
}

describe("EventEditor (admin) — publishing paid tickets for an organiser without payouts", () => {
  it("no up-front notice: the admin record doesn't carry the organiser's payouts", () => {
    renderAdmin(ADMIN_EVENT);
    expect(notice()).toBeNull();
  });

  it("a refused publish shows the reason on the tickets and by the button, and keeps the form", async () => {
    adminUpdateEvent.mockRejectedValue(adminRefused());
    renderAdmin(ADMIN_EVENT);
    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Neon Static II" } });
    fireEvent.click(screen.getByLabelText("Publish when saved"));
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(ADMIN_REFUSED_MESSAGE);
    // By the ticket types (fieldErrors.ticketTypes).
    const ticketsError = document.getElementById("ticketTypes-error");
    expect(ticketsError).toHaveTextContent(ADMIN_REFUSED_MESSAGE);
    expect(screen.getByRole("heading", { name: "Ticket types" }).parentElement?.parentElement).toContainElement(ticketsError);
    // Not the organiser's link: an admin can't set up someone else's payouts.
    expect(screen.queryByRole("link", { name: "Set up payouts" })).toBeNull();
    expect(screen.getByLabelText("Title")).toHaveValue("Neon Static II");
    expect(screen.getByLabelText("Publish when saved")).toBeChecked();
  });

  it("a refused create-and-publish shows it the same way, and nothing is navigated to", async () => {
    adminListOrganisers.mockResolvedValue({ items: [OWNED_ORGANISER] });
    adminCreateEvent.mockRejectedValue(adminRefused());
    renderAdmin();
    const select = screen.getByLabelText("Organiser");
    await waitFor(() => expect(select).not.toBeDisabled());
    fireEvent.change(select, { target: { value: OWNED_ORGANISER.organiserId } });
    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Neon Static" } });
    fireEvent.change(screen.getByLabelText("Description"), { target: { value: "Four bands." } });
    fireEvent.change(screen.getByLabelText("Venue name"), { target: { value: "The Tote" } });
    fireEvent.change(screen.getByLabelText("Venue address"), { target: { value: "71 Johnston St" } });
    fireEvent.change(screen.getByLabelText("Suburb or town"), { target: { value: "Collingwood" } });
    fireEvent.change(screen.getByLabelText("Start date"), { target: { value: "2027-03-06" } });
    fireEvent.change(screen.getByLabelText("Start time"), { target: { value: "20:00" } });
    fireEvent.change(screen.getByLabelText("End date"), { target: { value: "2027-03-06" } });
    fireEvent.change(screen.getByLabelText("End time"), { target: { value: "23:30" } });
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "General admission" } });
    fireEvent.change(screen.getByLabelText("Price (A$)"), { target: { value: "30" } });
    fireEvent.click(screen.getByLabelText("Publish straight away"));
    fireEvent.click(screen.getByRole("button", { name: "Create event" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(ADMIN_REFUSED_MESSAGE);
    expect(document.getElementById("ticketTypes-error")).toHaveTextContent(ADMIN_REFUSED_MESSAGE);
    expect(adminCreateEvent).toHaveBeenCalledWith(expect.objectContaining({ publish: true }), expect.any(Function));
    expect(push).not.toHaveBeenCalled();
    // Still a new event: the organiser can be changed, and Create is offered again.
    expect(screen.getByRole("button", { name: "Create event" })).not.toHaveAttribute("aria-disabled", "true");
  });
});
