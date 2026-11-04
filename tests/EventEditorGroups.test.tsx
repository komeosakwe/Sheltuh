// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import EventEditor from "@/components/dashboard/EventEditor";
import { ApiError } from "@/lib/api/client";
import type { EventRecord } from "@/lib/api/types";
import { fakeAuthValue, FakeAuthProvider } from "./test-utils/fakeAuth";
import { showStep } from "./test-utils/editorSteps";
import { CONFIRMED_PIN_LOCATION, stubMatchMedia, unstubMatchMedia } from "./test-utils/pinMapStub";

/**
 * The editor's group tickets (docs/architecture.md, "Group tickets"): "Add a group ticket" beside "Add ticket
 * type" and "People per ticket" on every tier, both behind NEXT_PUBLIC_GROUP_TICKETS. Capacity is saved in
 * people; the quantity field is groups once a ticket admits more than one.
 */

vi.mock("@/lib/location-loader", async () => (await import("./test-utils/locationStub")).locationLoaderStub());
vi.mock("@/components/dashboard/VenuePinMapLeaflet", async () => (await import("./test-utils/pinMapStub")).leafletStub());
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

const updateEventDraft = vi.fn();
vi.mock("@/lib/api/events", async (importOriginal) => ({
  isPayoutsRequiredError: (await importOriginal<typeof import("@/lib/api/events")>()).isPayoutsRequiredError,
  isRefundPolicyTightenedError: (await importOriginal<typeof import("@/lib/api/events")>()).isRefundPolicyTightenedError,
  publishConflictCode: (await importOriginal<typeof import("@/lib/api/events")>()).publishConflictCode,
  updateEventDraft: (...args: unknown[]) => updateEventDraft(...args),
  createEventDraft: vi.fn(),
  publishEvent: vi.fn(),
  uploadEventImage: vi.fn(),
  deleteEventImage: vi.fn(),
}));

beforeEach(() => {
  stubMatchMedia();
  updateEventDraft.mockReset();
});
afterEach(() => {
  cleanup();
  unstubMatchMedia();
  vi.unstubAllEnvs();
});

const BASE: EventRecord = {
  organiserId: "org-1",
  eventId: "evt-1",
  slug: "test-event",
  title: "Test Event",
  description: "A test event.",
  category: "live-music",
  venueName: "The Venue",
  venueAddress: "1 Test St",
  suburb: "Fitzroy",
  startsAt: "2026-09-25T10:00:00.000Z",
  endsAt: "2026-09-25T13:00:00.000Z",
  organiserName: "Test Org",
  ticketTypes: [{ id: "ga", name: "General admission", priceCents: 2000, feePolicy: "buyer-pays", quantityAvailable: 50 }],
  location: CONFIRMED_PIN_LOCATION,
  status: "draft",
  moderationLog: [],
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

const GROUP = { id: "grp", name: "Group of 4", priceCents: 12000, feePolicy: "organiser-absorbs" as const, quantityAvailable: 20, admits: 4 };

function renderEditor(overrides: Partial<EventRecord> = {}) {
  render(
    <FakeAuthProvider value={fakeAuthValue({ email: "owner@example.com" })}>
      <EventEditor getToken={vi.fn().mockResolvedValue("token")} initial={{ ...BASE, ...overrides }} onSaved={vi.fn()} />
    </FakeAuthProvider>,
  );
  showStep(2);
}

const save = () => fireEvent.click(screen.getByRole("button", { name: "Save draft" }));
const sentTickets = () => updateEventDraft.mock.calls[0][1].ticketTypes as Record<string, unknown>[];

describe("EventEditor group tickets: switched off", () => {
  it("shows none of it on a single ticket, and still sends admits 1", async () => {
    updateEventDraft.mockResolvedValue(BASE);
    renderEditor();
    expect(screen.getByRole("button", { name: "Add ticket type" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Add a group ticket" })).toBeNull();
    expect(screen.queryByLabelText("People per ticket")).toBeNull();
    expect(screen.getByLabelText("Quantity available")).toHaveValue(50);
    save();
    await waitFor(() => expect(updateEventDraft).toHaveBeenCalledTimes(1));
    expect(sentTickets()[0]).toMatchObject({ id: "ga", admits: 1, quantityAvailable: 50 });
  });

  it("an existing group ticket is shown right (groups, per group), only able to go back to 1, and saved unchanged", async () => {
    updateEventDraft.mockResolvedValue(BASE);
    renderEditor({ ticketTypes: [GROUP] });
    expect(screen.queryByRole("button", { name: "Add a group ticket" })).toBeNull();
    expect(screen.getByLabelText("Groups available")).toHaveValue(5);
    expect(screen.getByText("20 people in total")).toBeInTheDocument();
    expect(screen.getByLabelText("Price per group (A$)")).toHaveValue(120);
    const people = screen.getByLabelText("People per ticket") as HTMLSelectElement;
    expect(people).toBeEnabled();
    expect(people).toHaveValue("4");
    expect(Array.from(people.options).map((o) => o.value)).toEqual(["1", "4"]);
    save();
    await waitFor(() => expect(updateEventDraft).toHaveBeenCalledTimes(1));
    expect(sentTickets()[0]).toMatchObject({ id: "grp", admits: 4, quantityAvailable: 20, priceCents: 12000 });
  });

  it("an unsold group ticket can go back to 1 while it's off, and sends admits 1", async () => {
    updateEventDraft.mockResolvedValue(BASE);
    renderEditor({ ticketTypes: [{ ...GROUP, name: "Table of four" }] });
    fireEvent.change(screen.getByLabelText("People per ticket"), { target: { value: "1" } });
    expect(screen.getByLabelText("Quantity available")).toHaveValue(20);
    // Back to a single, the field is gone (it can't become a group again while it's off).
    expect(screen.queryByLabelText("People per ticket")).toBeNull();
    save();
    await waitFor(() => expect(updateEventDraft).toHaveBeenCalledTimes(1));
    expect(sentTickets()[0]).toMatchObject({ id: "grp", admits: 1, quantityAvailable: 20 });
  });

  it("a group ticket with sales stays read-only while it's off", () => {
    renderEditor({ ticketTypes: [GROUP], ticketsSold: { grp: 4 } });
    const people = screen.getByLabelText("People per ticket");
    expect(people).toBeDisabled();
    expect(people).toHaveAccessibleDescription("Can’t change once tickets are sold.");
  });
});

describe("EventEditor group tickets: switched on", () => {
  beforeEach(() => vi.stubEnv("NEXT_PUBLIC_GROUP_TICKETS", "1"));

  it("'Add a group ticket' sits beside 'Add ticket type' and adds a 'Group of 4' to price, on sale with the rest", async () => {
    updateEventDraft.mockResolvedValue(BASE);
    renderEditor();
    const add = screen.getByRole("button", { name: "Add ticket type" });
    const addGroup = screen.getByRole("button", { name: "Add a group ticket" });
    expect(add.parentElement).toBe(addGroup.parentElement);
    fireEvent.click(addGroup);

    // The price is where focus goes next (it's what's missing).
    const prices = screen.getAllByLabelText(/^Price/);
    expect(prices[1]).toHaveAccessibleName("Price per group (A$)");
    await waitFor(() => expect(prices[1]).toHaveFocus());
    expect(screen.getAllByLabelText("Name")[1]).toHaveValue("Group of 4");
    expect(screen.getByLabelText("Groups available")).toHaveValue(5);
    expect(screen.getAllByLabelText("People per ticket")[1]).toHaveValue("4");

    fireEvent.change(prices[1], { target: { value: "120" } });
    fireEvent.change(screen.getByLabelText("Groups available"), { target: { value: "8" } });
    save();
    await waitFor(() => expect(updateEventDraft).toHaveBeenCalledTimes(1));
    expect(sentTickets()[1]).toMatchObject({
      name: "Group of 4",
      priceCents: 12000,
      admits: 4,
      quantityAvailable: 32,
      // It doesn't wait for the singles to sell out (a plain added ticket would).
      opensAfterPrevious: false,
    });
    expect(sentTickets()[0]).toMatchObject({ admits: 1, quantityAvailable: 50 });
  });

  it("a group ticket left free doesn't save: the price says why", async () => {
    renderEditor();
    fireEvent.click(screen.getByRole("button", { name: "Add a group ticket" }));
    save();
    const price = screen.getAllByLabelText(/^Price/)[1];
    await waitFor(() => expect(price).toHaveAttribute("aria-invalid", "true"));
    expect(price).toHaveAccessibleDescription("A group ticket needs a price.");
    expect(updateEventDraft).not.toHaveBeenCalled();
  });

  it("'People per ticket' on any tier: 1 to 10; above 1 the quantity is groups, kept as whole groups of the people", async () => {
    updateEventDraft.mockResolvedValue(BASE);
    renderEditor();
    const people = screen.getByLabelText("People per ticket") as HTMLSelectElement;
    expect(Array.from(people.options).map((o) => o.value)).toEqual(["1", "2", "3", "4", "5", "6", "7", "8", "9", "10"]);
    expect(people).toBeEnabled();
    expect(screen.getByLabelText("Quantity available")).toHaveValue(50);

    fireEvent.change(people, { target: { value: "4" } });
    // 50 people are 12 whole groups of 4 (48 people).
    expect(screen.getByLabelText("Groups available")).toHaveValue(12);
    expect(screen.getByText("48 people in total")).toBeInTheDocument();
    expect(screen.getByLabelText("Price per group (A$)")).toBeInTheDocument();
    expect(screen.getByLabelText("Name")).toHaveValue("General admission");
    expect(screen.getByText(/total per group of 4/)).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Groups available"), { target: { value: "10" } });
    expect(screen.getByText("40 people in total")).toBeInTheDocument();
    save();
    await waitFor(() => expect(updateEventDraft).toHaveBeenCalledTimes(1));
    expect(sentTickets()[0]).toMatchObject({ admits: 4, quantityAvailable: 40 });
  });

  it("groups are whole: typing 2.5 groups of 4 is 2 groups (8 people), not 10", async () => {
    updateEventDraft.mockResolvedValue(BASE);
    renderEditor({ ticketTypes: [GROUP] });
    fireEvent.change(screen.getByLabelText("Groups available"), { target: { value: "2.5" } });
    expect(screen.getByLabelText("Groups available")).toHaveValue(2);
    expect(screen.getByText("8 people in total")).toBeInTheDocument();
    save();
    await waitFor(() => expect(updateEventDraft).toHaveBeenCalledTimes(1));
    expect(sentTickets()[0]).toMatchObject({ admits: 4, quantityAvailable: 8 });
  });

  it("shows the API's quantity refusal by the groups field", async () => {
    updateEventDraft.mockRejectedValue(
      new ApiError(400, "Please fix the highlighted fields.", {
        "ticketTypes[0].quantityAvailable": "A ticket for 4 people needs a quantity that's a multiple of 4.",
      }),
    );
    renderEditor({ ticketTypes: [GROUP] });
    save();
    const groups = screen.getByLabelText("Groups available");
    await waitFor(() => expect(groups).toHaveAttribute("aria-invalid", "true"));
    expect(groups).toHaveAccessibleDescription("20 people in total A ticket for 4 people needs a quantity that's a multiple of 4.");
  });

  it("back to 1 person: the quantity is plain again", () => {
    renderEditor({ ticketTypes: [GROUP] });
    fireEvent.change(screen.getByLabelText("People per ticket"), { target: { value: "1" } });
    expect(screen.getByLabelText("Quantity available")).toHaveValue(20);
    expect(screen.getByLabelText("Price (A$)")).toBeInTheDocument();
    // The "Group of 4" name it made goes with it (the organiser names the ticket).
    expect(screen.getByLabelText("Name")).toHaveValue("");
  });

  it("a name the organiser chose is kept when the size changes", () => {
    renderEditor();
    fireEvent.change(screen.getByLabelText("People per ticket"), { target: { value: "3" } });
    expect(screen.getByLabelText("Name")).toHaveValue("General admission");
  });

  it("is disabled, with its reason, on a free ticket", () => {
    renderEditor({ ticketTypes: [{ ...BASE.ticketTypes[0], priceCents: 0 }] });
    const people = screen.getByLabelText("People per ticket");
    expect(people).toBeDisabled();
    expect(people).toHaveAccessibleDescription("Group tickets are paid. Set a price first.");
  });

  it("is disabled, with its reason, once the tier has sales, and the quantity is still groups", () => {
    renderEditor({ ticketTypes: [GROUP], ticketsSold: { grp: 8 } });
    const people = screen.getByLabelText("People per ticket");
    expect(people).toBeDisabled();
    expect(people).toHaveAccessibleDescription("Can’t change once tickets are sold.");
    expect(screen.getByLabelText("Groups available")).toHaveValue(5);
  });

  it("is disabled, with its reason, on an event with a seat map, which can't add a group ticket", () => {
    renderEditor({ seating: { version: 3, seatCount: 120 } });
    expect(screen.queryByRole("button", { name: "Add a group ticket" })).toBeNull();
    const people = screen.getByLabelText("People per ticket");
    expect(people).toBeDisabled();
    expect(people).toHaveAccessibleDescription("Not available with reserved seating.");
  });

  it("is disabled on a seated tier", () => {
    renderEditor({ ticketTypes: [{ ...BASE.ticketTypes[0], seated: true }] });
    expect(screen.getByLabelText("People per ticket")).toBeDisabled();
  });

  it("shows the API's refusal by the field", async () => {
    updateEventDraft.mockRejectedValue(
      new ApiError(409, "Please fix the highlighted fields.", { "ticketTypes[0].admits": "This ticket type has sales, so its size can’t change." }),
    );
    renderEditor();
    fireEvent.change(screen.getByLabelText("People per ticket"), { target: { value: "2" } });
    save();
    const people = screen.getByLabelText("People per ticket");
    await waitFor(() => expect(people).toHaveAttribute("aria-invalid", "true"));
    expect(people).toHaveAccessibleDescription("This ticket type has sales, so its size can’t change.");
  });
});
