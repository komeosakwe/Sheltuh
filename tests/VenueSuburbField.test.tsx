// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import EventEditor from "@/components/dashboard/EventEditor";
import { ApiError } from "@/lib/api/client";
import type { EventRecord } from "@/lib/api/types";
import { fakeAuthValue, FakeAuthProvider } from "./test-utils/fakeAuth";

/*
 * The editor's venue suburb (owner plan S8): "Suburb or town", resolved
 * against the ABS suburb table (the real one, loaded on demand) to a state
 * and a time zone, which the editor sends with the suburb.
 */

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

const updateEventDraft = vi.fn();
const createEventDraft = vi.fn();
vi.mock("@/lib/api/events", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api/events")>();
  return {
    isPayoutsRequiredError: actual.isPayoutsRequiredError,
    isRefundPolicyTightenedError: actual.isRefundPolicyTightenedError,
    updateEventDraft: (...args: unknown[]) => updateEventDraft(...args),
    createEventDraft: (...args: unknown[]) => createEventDraft(...args),
    submitEventForReview: vi.fn(),
    uploadEventImage: vi.fn(),
    deleteEventImage: vi.fn(),
  };
});

afterEach(cleanup);
beforeEach(() => {
  updateEventDraft.mockReset();
  createEventDraft.mockReset();
});

const PERTH_EVENT: EventRecord = {
  organiserId: "org-1",
  eventId: "evt-perth",
  slug: "northbridge-late-sketch",
  title: "Northbridge Late Sketch",
  description: "Life drawing with a jazz trio.",
  category: "workshop",
  venueName: "James Street Studio",
  venueAddress: "40 James Street",
  suburb: "Northbridge",
  state: "WA",
  timeZone: "Australia/Perth",
  // 10:30Z is 6:30 pm AWST; 13:30Z 9:30 pm.
  startsAt: "2026-11-21T10:30:00.000Z",
  endsAt: "2026-11-21T13:30:00.000Z",
  organiserName: "Westside Drawing Club",
  ticketTypes: [{ id: "place", name: "Drawing place", priceCents: 3000, feePolicy: "buyer-pays", quantityAvailable: 30 }],
  ticketingMode: "sheltuh",
  status: "draft",
  moderationLog: [],
  createdAt: "2026-10-01T00:00:00.000Z",
  updatedAt: "2026-10-01T00:00:00.000Z",
};

function renderEditor(initial?: EventRecord) {
  render(
    <FakeAuthProvider value={fakeAuthValue({ email: "owner@example.com" })}>
      <EventEditor getToken={vi.fn().mockResolvedValue("token")} initial={initial} onSaved={vi.fn()} />
    </FakeAuthProvider>,
  );
}

const suburbField = () => screen.getByLabelText("Suburb or town");
const hint = () => document.getElementById("suburb-hint");

function typeSuburb(value: string) {
  fireEvent.focus(suburbField());
  fireEvent.change(suburbField(), { target: { value } });
}

/** A new event's other required fields (its default ticket is free, valid once named). */
function fillTheRest() {
  fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Night Market" } });
  fireEvent.change(screen.getByLabelText("Description"), { target: { value: "Stalls and music." } });
  fireEvent.change(screen.getByLabelText("Venue name"), { target: { value: "The Venue" } });
  fireEvent.change(screen.getByLabelText("Venue address"), { target: { value: "1 Test St" } });
  fireEvent.change(screen.getByLabelText("Start date"), { target: { value: "2027-03-06" } });
  fireEvent.change(screen.getByLabelText("Start time"), { target: { value: "20:00" } });
  fireEvent.change(screen.getByLabelText("End date"), { target: { value: "2027-03-06" } });
  fireEvent.change(screen.getByLabelText("End time"), { target: { value: "23:30" } });
  fireEvent.change(screen.getByLabelText("Name"), { target: { value: "General Admission" } });
}

describe("VenueSuburbField — resolving the suburb", () => {
  it("names the place and its zone under the field, politely, and the date legends follow", async () => {
    renderEditor();
    // Nothing typed: the times are local to wherever the venue turns out to be.
    expect(screen.getByText("Starts (local time)")).toBeInTheDocument();
    expect(screen.getByText("Ends (local time)")).toBeInTheDocument();
    expect(hint()).toHaveAttribute("aria-live", "polite");

    typeSuburb("Collingwood");
    await waitFor(() => expect(hint()).toHaveTextContent(/^Collingwood, Victoria · Melbourne time \((AEDT|AEST)\)$/));
    expect(screen.getByText("Starts (Melbourne time)")).toBeInTheDocument();
    expect(suburbField()).toHaveAccessibleDescription(hint()?.textContent ?? "");
    // One zone in Victoria: no choice.
    expect(screen.queryByLabelText("Time zone")).toBeNull();
  });

  it("a bare shared name is the Victorian one (owner decision D7); a state picks the other", async () => {
    renderEditor();
    typeSuburb("Richmond");
    await waitFor(() => expect(hint()).toHaveTextContent(/^Richmond, Victoria · Melbourne time/));
    typeSuburb("Richmond, NSW");
    await waitFor(() => expect(hint()).toHaveTextContent(/^Richmond, New South Wales · Sydney time \(AE[DS]T\)$/));
    expect(screen.getByText("Starts (Sydney time)")).toBeInTheDocument();
  });

  it("suggests suburbs as “Suburb, STATE”, both Richmonds told apart", async () => {
    renderEditor();
    typeSuburb("Richmond");
    await waitFor(() => expect(hint()).not.toBeEmptyDOMElement());
    const list = document.getElementById(suburbField().getAttribute("list") ?? "");
    const values = Array.from(list?.querySelectorAll("option") ?? []).map((option) => option.value);
    expect(values).toEqual(expect.arrayContaining(["Richmond, VIC", "Richmond, NSW"]));
    expect(values.every((value) => /, (NSW|VIC|QLD|SA|WA|TAS|NT|ACT|OT)$/.test(value))).toBe(true);
  });

  it("offers a zone in New South Wales (Broken Hill keeps South Australia's time), and sends the one chosen", async () => {
    createEventDraft.mockResolvedValue({ ...PERTH_EVENT, eventId: "evt-new" });
    renderEditor();
    fillTheRest();
    typeSuburb("Broken Hill");
    const zone = await screen.findByLabelText("Time zone");
    expect(zone).toHaveValue("Australia/Broken_Hill");
    expect(within(zone).getAllByRole("option").map((option) => option.getAttribute("value"))).toEqual([
      "Australia/Sydney",
      "Australia/Broken_Hill",
      "Australia/Lord_Howe",
    ]);
    expect(screen.getByText("Starts (Broken Hill time)")).toBeInTheDocument();

    fireEvent.change(zone, { target: { value: "Australia/Sydney" } });
    expect(screen.getByText("Starts (Sydney time)")).toBeInTheDocument();
    // The typed times stay as they were.
    expect(screen.getByLabelText("Start time")).toHaveValue("20:00");

    fireEvent.click(screen.getByRole("button", { name: /Save draft/ }));
    await waitFor(() => expect(createEventDraft).toHaveBeenCalledTimes(1));
    expect(createEventDraft.mock.calls[0][0]).toMatchObject({
      suburb: "Broken Hill",
      state: "NSW",
      timeZone: "Australia/Sydney",
      start: { date: "2027-03-06", time: "20:00" },
    });
  });

  it("sends a new Perth event's suburb, state and zone together, with the wall-clock times as typed", async () => {
    createEventDraft.mockResolvedValue({ ...PERTH_EVENT, eventId: "evt-new" });
    renderEditor();
    fillTheRest();
    typeSuburb("Collingwood");
    await waitFor(() => expect(screen.getByText("Starts (Melbourne time)")).toBeInTheDocument());
    // Changing the suburb keeps the typed times: they're read in the new zone.
    typeSuburb("Perth");
    await waitFor(() => expect(screen.getByText("Starts (Perth time)")).toBeInTheDocument());
    expect(hint()).toHaveTextContent("Perth, Western Australia · Perth time (AWST)");
    expect(screen.getByLabelText("Start time")).toHaveValue("20:00");
    expect(screen.queryByLabelText("Time zone")).not.toBeNull(); // WA has Eucla's zone too

    fireEvent.click(screen.getByRole("button", { name: /Save draft/ }));
    await waitFor(() => expect(createEventDraft).toHaveBeenCalledTimes(1));
    expect(createEventDraft.mock.calls[0][0]).toMatchObject({
      suburb: "Perth",
      state: "WA",
      timeZone: "Australia/Perth",
      start: { date: "2027-03-06", time: "20:00" },
      end: { date: "2027-03-06", time: "23:30" },
    });
  });

  it("round-trips a saved Perth event: Perth times in, the same Perth times and place out", async () => {
    process.env.TZ = "America/New_York";
    updateEventDraft.mockResolvedValue(PERTH_EVENT);
    renderEditor(PERTH_EVENT);
    // Known before the table loads: it's the event's own suburb.
    expect(screen.getByText("Starts (Perth time)")).toBeInTheDocument();
    expect(screen.getByLabelText("Start time")).toHaveValue("18:30");
    expect(screen.getByLabelText("End time")).toHaveValue("21:30");
    expect(suburbField()).toHaveValue("Northbridge");

    fireEvent.click(screen.getByRole("button", { name: "Save draft" }));
    await waitFor(() => expect(updateEventDraft).toHaveBeenCalledTimes(1));
    expect(updateEventDraft.mock.calls[0][1]).toMatchObject({
      suburb: "Northbridge",
      state: "WA",
      timeZone: "Australia/Perth",
      start: { date: "2026-11-21", time: "18:30" },
      end: { date: "2026-11-21", time: "21:30" },
    });
    delete process.env.TZ;
  });

  it("an unknown suburb: an error by the field with a near spelling, focus there, and nothing sent", async () => {
    renderEditor();
    fillTheRest();
    typeSuburb("Fremantel");
    fireEvent.click(screen.getByRole("button", { name: /Save draft/ }));
    await waitFor(() => expect(suburbField()).toHaveAttribute("aria-invalid", "true"));
    const error = document.getElementById("suburb-error");
    expect(error).toHaveTextContent("We couldn’t find that suburb or town. Did you mean Fremantle, WA?");
    expect(suburbField().getAttribute("aria-describedby")?.split(" ")).toContain("suburb-error");
    await waitFor(() => expect(suburbField()).toHaveFocus());
    expect(screen.getByText("Starts (local time)")).toBeInTheDocument();
    expect(createEventDraft).not.toHaveBeenCalled();
  });

  it("shows the API's place and time errors by their fields", async () => {
    updateEventDraft.mockRejectedValue(
      new ApiError(400, "Check the event's details.", {
        timeZone: "Choose a time zone used in WA.",
        start: "That time doesn't exist in Perth: the clocks skip it.",
      }),
    );
    renderEditor(PERTH_EVENT);
    fireEvent.click(screen.getByRole("button", { name: "Save draft" }));
    await waitFor(() => expect(screen.getByLabelText("Time zone")).toHaveAccessibleDescription("Choose a time zone used in WA."));
    expect(screen.getByLabelText("Start time")).toHaveAccessibleDescription(
      "That time doesn't exist in Perth: the clocks skip it.",
    );
    cleanup();

    updateEventDraft.mockRejectedValue(
      new ApiError(400, "Check the event's details.", { suburb: "We couldn't find that suburb in WA." }),
    );
    renderEditor(PERTH_EVENT);
    fireEvent.click(screen.getByRole("button", { name: "Save draft" }));
    await waitFor(() => expect(suburbField()).toHaveAttribute("aria-invalid", "true"));
    expect(document.getElementById("suburb-error")).toHaveTextContent("We couldn't find that suburb in WA.");
  });
});
