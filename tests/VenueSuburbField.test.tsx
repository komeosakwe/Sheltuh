// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import EventEditor from "@/components/dashboard/EventEditor";
import { ApiError } from "@/lib/api/client";
import { loadLocation } from "@/lib/location-loader";
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
    publishEvent: vi.fn(),
    uploadEventImage: vi.fn(),
    deleteEventImage: vi.fn(),
  };
});

// The suburb table (~15k rows) decodes once per file: here, rather than inside the first test's timeout.
beforeAll(async () => {
  await loadLocation();
}, 30_000);

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

    // A name no other state has, so the line is just the place and its zone.
    typeSuburb("Footscray");
    await waitFor(() => expect(hint()).toHaveTextContent(/^Footscray, Victoria · Melbourne time \((AEDT|AEST)\)$/));
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
    // The error, then why there's a choice at all.
    await waitFor(() =>
      expect(screen.getByLabelText("Time zone")).toHaveAccessibleDescription(
        "Choose a time zone used in WA. Most of Western Australia is on Perth time. Change this only if the venue keeps Eucla time.",
      ),
    );
    expect(screen.getByLabelText("Start time")).toHaveAccessibleDescription(
      "That time doesn't exist in Perth: the clocks skip it.",
    );
    // Focus goes to the first field refused: the zone, by its choice (the one carrying the message).
    await waitFor(() => expect(screen.getByLabelText("Time zone")).toHaveFocus());
    cleanup();

    updateEventDraft.mockRejectedValue(
      new ApiError(400, "Check the event's details.", { suburb: "We couldn't find that suburb in WA." }),
    );
    renderEditor(PERTH_EVENT);
    fireEvent.click(screen.getByRole("button", { name: "Save draft" }));
    await waitFor(() => expect(suburbField()).toHaveAttribute("aria-invalid", "true"));
    expect(document.getElementById("suburb-error")).toHaveTextContent("We couldn't find that suburb in WA.");
    await waitFor(() => expect(suburbField()).toHaveFocus());
    cleanup();

    // In Victoria there's no zone choice: a zone error goes by the suburb, and focus with it.
    const melbourne: EventRecord = { ...PERTH_EVENT, suburb: "Fitzroy", state: "VIC", timeZone: "Australia/Melbourne" };
    updateEventDraft.mockRejectedValue(new ApiError(400, "Check the event's details.", { timeZone: "Choose a time zone used in VIC." }));
    renderEditor(melbourne);
    fireEvent.click(screen.getByRole("button", { name: "Save draft" }));
    await waitFor(() => expect(suburbField()).toHaveAccessibleDescription(/Choose a time zone used in VIC\.$/));
    expect(screen.queryByLabelText("Time zone")).toBeNull();
    await waitFor(() => expect(suburbField()).toHaveFocus());
  });

  it("an error goes as soon as the suburb is changed, and a near spelling is a button that fills it in", async () => {
    createEventDraft.mockResolvedValue({ ...PERTH_EVENT, eventId: "evt-new" });
    renderEditor();
    fillTheRest();
    typeSuburb("Fremantel");
    fireEvent.click(screen.getByRole("button", { name: /Save draft/ }));
    await waitFor(() => expect(suburbField()).toHaveAttribute("aria-invalid", "true"));
    const use = screen.getByRole("button", { name: "Use Fremantle, WA" });
    fireEvent.click(use);
    expect(suburbField()).toHaveValue("Fremantle, WA");
    expect(suburbField()).toHaveFocus();
    // The error went with the change: never beside the line saying the place is found.
    expect(suburbField()).not.toHaveAttribute("aria-invalid");
    expect(document.getElementById("suburb-error")).toBeNull();
    expect(screen.queryByRole("button", { name: /^Use / })).toBeNull();
    await waitFor(() => expect(hint()).toHaveTextContent(/^Fremantle, Western Australia · Perth time \(AWST\)$/));
    expect(suburbField().getAttribute("aria-describedby")).toBe("suburb-hint");

    // Typing clears it too (UX review: the stale error contradicted the hint).
    typeSuburb("Fremantel");
    fireEvent.click(screen.getByRole("button", { name: /Save draft/ }));
    await waitFor(() => expect(suburbField()).toHaveAttribute("aria-invalid", "true"));
    typeSuburb("Fremantle");
    expect(suburbField()).not.toHaveAttribute("aria-invalid");
    expect(document.getElementById("suburb-error")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /Save draft/ }));
    await waitFor(() => expect(createEventDraft).toHaveBeenCalledTimes(1));
    expect(createEventDraft.mock.calls[0][0]).toMatchObject({ suburb: "Fremantle", state: "WA", timeZone: "Australia/Perth" });
  });

  it("says where else a bare shared name is (D7 picks Victoria's), and not once the state is given", async () => {
    renderEditor();
    typeSuburb("Newtown");
    await waitFor(() =>
      expect(hint()).toHaveTextContent(
        /^Newtown, Victoria · Melbourne time \(AE[DS]T\) Also in NSW, QLD\. Add the state \(“Newtown, NSW”\) or pick it from the list\.$/,
      ),
    );
    typeSuburb("Newtown, NSW");
    await waitFor(() => expect(hint()).toHaveTextContent(/^Newtown, New South Wales · Sydney time \(AE[DS]T\)$/));
  });

  it("a capital's CBD or City is that capital; CBD or City alone asks which city, and nothing is sent", async () => {
    renderEditor();
    fillTheRest();
    typeSuburb("Sydney CBD");
    await waitFor(() => expect(hint()).toHaveTextContent(/^Sydney, New South Wales · Sydney time/));
    typeSuburb("Perth City");
    await waitFor(() => expect(hint()).toHaveTextContent(/^Perth, Western Australia · Perth time/));
    typeSuburb("Brisbane CBD");
    await waitFor(() => expect(hint()).toHaveTextContent(/^Brisbane City, Queensland · Brisbane time/));
    typeSuburb("CBD, NSW");
    await waitFor(() => expect(hint()).toHaveTextContent(/^Sydney, New South Wales/));

    for (const bare of ["CBD", "City"]) {
      typeSuburb(bare);
      // Never silently Melbourne's.
      await waitFor(() => expect(hint()).toBeEmptyDOMElement());
      expect(screen.getByText("Starts (local time)")).toBeInTheDocument();
      fireEvent.click(screen.getByRole("button", { name: /Save draft/ }));
      await waitFor(() =>
        expect(document.getElementById("suburb-error")).toHaveTextContent(
          "Which city’s centre? Add the city or its state (“Sydney CBD”, “CBD, NSW”). Did you mean Melbourne, VIC?",
        ),
      );
      expect(screen.getByRole("button", { name: "Use Melbourne, VIC" })).toBeInTheDocument();
    }
    expect(createEventDraft).not.toHaveBeenCalled();
    // The ACT's suburb called City, with its state, is found.
    typeSuburb("City, ACT");
    await waitFor(() => expect(hint()).toHaveTextContent(/^City, Australian Capital Territory · Canberra time/));
  });

  it("a saved event's suburb keeps its saved state once the table loads (an older bare \"Newtown\" in NSW)", async () => {
    const newtown: EventRecord = { ...PERTH_EVENT, suburb: "Newtown", state: "NSW", timeZone: "Australia/Sydney" };
    updateEventDraft.mockResolvedValue(newtown);
    renderEditor(newtown);
    await waitFor(() => expect(hint()).toHaveTextContent(/^Newtown, New South Wales · Sydney time/));
    // It's the event's own place: no "Also in" for it.
    expect(hint()).not.toHaveTextContent(/Also in/);
    fireEvent.click(screen.getByRole("button", { name: "Save draft" }));
    await waitFor(() => expect(updateEventDraft).toHaveBeenCalledTimes(1));
    expect(updateEventDraft.mock.calls[0][1]).toMatchObject({ suburb: "Newtown NSW", state: "NSW", timeZone: "Australia/Sydney" });
  });

  it("names the zones by their cities, in a row of their own, with why there's a choice", async () => {
    renderEditor();
    typeSuburb("Broken Hill");
    const zone = await screen.findByLabelText("Time zone");
    expect(within(zone).getAllByRole("option").map((option) => option.textContent)).toEqual([
      "Sydney time",
      "Broken Hill time",
      "Lord Howe Island time",
    ]);
    expect(zone).toHaveAccessibleDescription(
      "Most of New South Wales is on Sydney time. Change this only if the venue keeps Broken Hill time or Lord Howe Island time.",
    );
    // Its row spans the venue's three columns.
    expect(zone.closest(".sm\\:col-span-3")).not.toBeNull();
  });

  it("says when a change of zone moves the times (their wall-clock values stay)", async () => {
    renderEditor(PERTH_EVENT);
    const note = () => document.querySelector("[data-zone-note]");
    expect(note()).toHaveAttribute("aria-live", "polite");
    expect(note()).toBeEmptyDOMElement();
    typeSuburb("Fitzroy");
    await waitFor(() => expect(note()).toHaveTextContent("Times are now Melbourne time (were Perth time)."));
    expect(screen.getByLabelText("Start time")).toHaveValue("18:30");
    typeSuburb("Broken Hill");
    await waitFor(() => expect(note()).toHaveTextContent("Times are now Broken Hill time (were Melbourne time)."));
    fireEvent.change(screen.getByLabelText("Time zone"), { target: { value: "Australia/Sydney" } });
    expect(note()).toHaveTextContent("Times are now Sydney time (were Broken Hill time).");
  });

  it("a new event with no times yet: no note when the place is first found", async () => {
    renderEditor();
    typeSuburb("Perth");
    await waitFor(() => expect(screen.getByText("Starts (Perth time)")).toBeInTheDocument());
    expect(document.querySelector("[data-zone-note]")).toBeEmptyDOMElement();
  });
});
