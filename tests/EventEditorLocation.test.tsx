// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import EventEditor from "@/components/dashboard/EventEditor";
import { PLACE_UNLINKED_NOTE } from "@/components/dashboard/VenueLocationField";
import { MOVE_PIN_FIRST, PIN_ZOOM_EXACT } from "@/components/dashboard/VenuePinMap";
import { ApiError } from "@/lib/api/client";
import type { PlaceDetails, PlaceSuggestion } from "@/lib/api/places";
import type { AdminEventRecord, EventRecord } from "@/lib/api/types";
import { fakeAuthValue, FakeAuthProvider } from "./test-utils/fakeAuth";
import { CONFIRMED_PIN_LOCATION, pinMapDrag, stubMatchMedia, unstubMatchMedia } from "./test-utils/pinMapStub";

/**
 * The editor's venue location (owner decisions A-D1 to A-D3, 27 Oct 2026):
 * a Google place picked (its name, address and suburb filling the fields
 * the organiser hasn't typed in), then "Check the pin", required to publish;
 * or a pin alone. The suburb table is tests/test-utils/locationStub.ts
 * (Fitzroy -37.8, 144.98; Collingwood -37.8, 144.99; Brunswick -37.77, 144.96).
 */

vi.mock("@/lib/location-loader", async () => (await import("./test-utils/locationStub")).locationLoaderStub());
vi.mock("@/components/dashboard/VenuePinMapLeaflet", async () => (await import("./test-utils/pinMapStub")).leafletStub());
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("@/lib/api/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api/client")>()),
  isApiConfigured: true,
}));

const api = vi.hoisted(() => ({
  autocompletePlaces: vi.fn(),
  getPlaceDetails: vi.fn(),
  updateEventDraft: vi.fn(),
  createEventDraft: vi.fn(),
  publishEvent: vi.fn(),
  adminUpdateEvent: vi.fn(),
}));
vi.mock("@/lib/api/places", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api/places")>()),
  autocompletePlaces: (...args: unknown[]) => api.autocompletePlaces(...args),
  getPlaceDetails: (...args: unknown[]) => api.getPlaceDetails(...args),
}));
vi.mock("@/lib/api/events", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api/events")>();
  return {
    isPayoutsRequiredError: actual.isPayoutsRequiredError,
    isRefundPolicyTightenedError: actual.isRefundPolicyTightenedError,
    publishConflictCode: actual.publishConflictCode,
    updateEventDraft: (...args: unknown[]) => api.updateEventDraft(...args),
    createEventDraft: (...args: unknown[]) => api.createEventDraft(...args),
    publishEvent: (...args: unknown[]) => api.publishEvent(...args),
    uploadEventImage: vi.fn(),
    deleteEventImage: vi.fn(),
  };
});
vi.mock("@/lib/api/admin", () => ({
  adminListOrganisers: vi.fn(),
  adminCreateOrganiser: vi.fn(),
  adminCreateEvent: vi.fn(),
  adminUpdateEvent: (...args: unknown[]) => api.adminUpdateEvent(...args),
  adminUploadEventImage: vi.fn(),
  adminDeleteEventImage: vi.fn(),
}));

const PLACE_ID = "ChIJtote00000000000000";
const TOTE: PlaceSuggestion = { placeId: PLACE_ID, primaryText: "The Tote Hotel", secondaryText: "71 Johnston St, Collingwood VIC" };
const TOTE_DETAILS: PlaceDetails = {
  placeId: PLACE_ID,
  formattedAddress: "71 Johnston St, Collingwood VIC 3066",
  streetAddress: "71 Johnston St",
  locality: "Collingwood",
  state: "VIC",
  postcode: "3066",
  googleMapsUrl: "https://maps.google.com/?cid=1",
};
const FITZROY_CENTRE = { lat: -37.8, lng: 144.98 };
const COLLINGWOOD_CENTRE = { lat: -37.8, lng: 144.99 };

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
  state: "VIC",
  timeZone: "Australia/Melbourne",
  startsAt: "2027-03-06T09:00:00.000Z",
  endsAt: "2027-03-06T12:30:00.000Z",
  organiserName: "Test Org",
  ticketTypes: [{ id: "ga", name: "Entry", priceCents: 0, feePolicy: "buyer-pays", quantityAvailable: 50 }],
  status: "draft",
  moderationLog: [],
  createdAt: "2026-10-01T00:00:00.000Z",
  updatedAt: "2026-10-20T00:00:00.000Z",
};

beforeEach(() => {
  stubMatchMedia();
  for (const fn of Object.values(api)) fn.mockReset();
  api.autocompletePlaces.mockResolvedValue({ suggestions: [TOTE] });
  api.getPlaceDetails.mockResolvedValue(TOTE_DETAILS);
  api.updateEventDraft.mockImplementation(async () => ({ ...EVENT }));
  pinMapDrag.to = { lat: -37.801, lng: 144.981 };
});
afterEach(() => {
  cleanup();
  unstubMatchMedia();
});

/** `null`: a new event. */
function renderEditor(initial: EventRecord | null = EVENT) {
  const onSaved = vi.fn();
  render(
    <FakeAuthProvider value={fakeAuthValue({ email: "owner@example.com" })}>
      <EventEditor getToken={vi.fn().mockResolvedValue("token")} initial={initial ?? undefined} onSaved={onSaved} />
    </FakeAuthProvider>,
  );
  return { onSaved };
}

const searchBox = () => screen.getByRole("combobox", { name: "Find the venue on Google Maps" });
const venueSection = () => screen.getByRole("group", { name: "Venue" });
const pinStatus = () => document.querySelector("[data-pin-step] [aria-live]") as HTMLElement;
const pinHeading = () => screen.getByRole("heading", { name: "Check the pin" });
const linkedBlock = () => document.querySelector("[data-linked-place]") as HTMLElement;
const rightSpot = () => screen.getByRole("button", { name: "This is the right spot" });

/** Moves the inline map (to pinMapDrag.to), then "This is the right spot": the pin is confirmed there. */
async function moveAndConfirm() {
  fireEvent.click(await screen.findByRole("button", { name: "Drag to" }));
  fireEvent.click(rightSpot());
}

/** Searches, and picks The Tote: linked once its address has come back. */
async function pickTheTote() {
  fireEvent.focus(searchBox());
  fireEvent.change(searchBox(), { target: { value: "The Tote" } });
  fireEvent.click(await screen.findByRole("option", { name: /The Tote Hotel/ }));
  await screen.findByText("Linked to Google Maps:");
}

async function save() {
  fireEvent.click(screen.getByRole("button", { name: "Save draft" }));
  await waitFor(() => expect(api.updateEventDraft).toHaveBeenCalledTimes(1));
  return api.updateEventDraft.mock.calls[0][1] as Record<string, unknown>;
}

describe("EventEditor — picking a Google place", () => {
  it("fills the venue's name, street address and suburb on a new event, and shows the link and the pin step", async () => {
    renderEditor(null);
    await pickTheTote();

    expect(screen.getByLabelText("Venue name")).toHaveValue("The Tote Hotel");
    expect(screen.getByLabelText("Venue address")).toHaveValue("71 Johnston St");
    expect(screen.getByLabelText("Suburb or town")).toHaveValue("Collingwood, VIC");
    expect(api.getPlaceDetails).toHaveBeenCalledWith(PLACE_ID, expect.any(String), expect.any(Function), expect.any(AbortSignal));

    const linked = document.querySelector(`[data-linked-place="${PLACE_ID}"]`) as HTMLElement;
    expect(linked).toHaveTextContent("Linked to Google Maps: The Tote Hotel, 71 Johnston St, Collingwood VIC");
    // The accessible name starts with the visible words (label in name).
    const check = within(linked).getByRole("link", {
      name: "Check on Google Maps: The Tote Hotel, 71 Johnston St, Collingwood VIC (opens in a new tab)",
    });
    expect(check).toHaveAttribute(
      "href",
      `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent("The Tote Hotel, 71 Johnston St")}&query_place_id=${PLACE_ID}`,
    );
    expect(check).toHaveAttribute("target", "_blank");
    expect(within(linked).getByRole("button", { name: /^Change/ })).toBeInTheDocument();

    // Focus moved from the search (gone) to what replaced it.
    await waitFor(() => expect(linked).toHaveFocus());
    expect(linked).toHaveAccessibleName("Linked to Google Maps: The Tote Hotel, 71 Johnston St, Collingwood VIC");

    // The pin step: required, seeded at the suburb's centre (never Google's coordinates), and public.
    expect(pinHeading()).toBeInTheDocument();
    expect(screen.getByText("This pin is shown publicly on your event page and map.")).toBeInTheDocument();
    expect(pinStatus()).toHaveTextContent("Not confirmed yet");
    const map = await screen.findByTestId("leaflet");
    expect(map).toHaveAttribute("data-lat", String(COLLINGWOOD_CENTRE.lat));
    expect(map).toHaveAttribute("data-lng", String(COLLINGWOOD_CENTRE.lng));
  });

  it("never fills over what the organiser typed; a later pick replaces only what a pick filled", async () => {
    renderEditor(null);
    fireEvent.change(screen.getByLabelText("Venue name"), { target: { value: "The Tote (front bar)" } });
    await pickTheTote();
    expect(screen.getByLabelText("Venue name")).toHaveValue("The Tote (front bar)");
    expect(screen.getByLabelText("Venue address")).toHaveValue("71 Johnston St");

    // Change, and pick another place: the filled address follows it, the typed name stays.
    api.autocompletePlaces.mockResolvedValue({
      suggestions: [{ placeId: "ChIJcorner0000000000", primaryText: "Corner Hotel", secondaryText: "57 Swan St, Richmond VIC" }],
    });
    api.getPlaceDetails.mockResolvedValue({
      ...TOTE_DETAILS,
      placeId: "ChIJcorner0000000000",
      streetAddress: "57 Swan St",
      locality: "Brunswick",
    });
    fireEvent.click(screen.getByRole("button", { name: /^Change/ }));
    fireEvent.focus(searchBox());
    fireEvent.change(searchBox(), { target: { value: "Corner" } });
    fireEvent.click(await screen.findByRole("option", { name: /Corner Hotel/ }));
    await screen.findByText(/Corner Hotel, 57 Swan St/);
    expect(screen.getByLabelText("Venue name")).toHaveValue("The Tote (front bar)");
    expect(screen.getByLabelText("Venue address")).toHaveValue("57 Swan St");
    expect(screen.getByLabelText("Suburb or town")).toHaveValue("Brunswick, VIC");
  });

  it("a saved event's own fields stay as they are", async () => {
    renderEditor();
    await pickTheTote();
    expect(screen.getByLabelText("Venue name")).toHaveValue("The Venue");
    expect(screen.getByLabelText("Venue address")).toHaveValue("1 Test St");
    expect(screen.getByLabelText("Suburb or town")).toHaveValue("Fitzroy");
  });
});

describe("EventEditor — checking the pin (desktop)", () => {
  it("the suburb's centre, unmoved, isn't a pin: it needs a move or a zoom to street level first", async () => {
    renderEditor();
    await pickTheTote();
    const map = await screen.findByTestId("leaflet");
    expect(map).toHaveAttribute("data-lat", String(FITZROY_CENTRE.lat));

    fireEvent.click(rightSpot());
    expect(pinStatus()).toHaveTextContent(MOVE_PIN_FIRST);
    expect(rightSpot()).toHaveAccessibleDescription(MOVE_PIN_FIRST);
    expect(document.querySelector("[data-pin-step]")).toHaveAttribute("data-pin-confirmed", "false");

    // Zoomed in to street level: confirmed where it is.
    fireEvent.click(screen.getByRole("button", { name: "Zoom in" }));
    expect(pinStatus()).not.toHaveTextContent(MOVE_PIN_FIRST);
    fireEvent.click(rightSpot());
    expect(pinStatus()).toHaveTextContent("Pin confirmed.");
    expect(document.querySelector("[data-pin-step]")).toHaveAttribute("data-pin-confirmed", "true");

    const input = await save();
    expect(input.location).toEqual({ source: "places", placeId: PLACE_ID, pin: FITZROY_CENTRE });
  });

  it("moving the map before confirming doesn't count; confirming takes where it was moved, and moving after updates it", async () => {
    renderEditor();
    await pickTheTote();
    fireEvent.click(await screen.findByRole("button", { name: "Drag to" }));
    expect(pinStatus()).toHaveTextContent("Not confirmed yet");

    fireEvent.click(screen.getByRole("button", { name: "This is the right spot" }));
    pinMapDrag.to = { lat: -37.8015, lng: 144.9815 };
    fireEvent.click(screen.getByRole("button", { name: "Drag to" }));

    const input = await save();
    expect(input.location).toEqual({ source: "places", placeId: PLACE_ID, pin: { lat: -37.8015, lng: 144.9815 } });
  });

  it("a draft saves without a pin: the place alone", async () => {
    renderEditor();
    await pickTheTote();
    fireEvent.click(await screen.findByRole("button", { name: "Drag to" }));
    const input = await save();
    expect(input.location).toEqual({ source: "places", placeId: PLACE_ID });
  });

  it("a saved pin can be confirmed again as it is", async () => {
    renderEditor({ ...EVENT, location: CONFIRMED_PIN_LOCATION });
    await screen.findByTestId("leaflet");
    fireEvent.click(rightSpot());
    expect(pinStatus()).toHaveTextContent("Pin confirmed.");
    expect(pinStatus()).not.toHaveTextContent(MOVE_PIN_FIRST);
  });

  it("another suburb starts the map again at its centre, and the pin needs confirming again", async () => {
    // A pin alone (a linked Google place is unlinked by another suburb: "the suburb changing under a
    // linked place" below).
    renderEditor();
    fireEvent.click(screen.getByRole("button", { name: "Can’t find it on Google Maps?" }));
    await moveAndConfirm();
    expect(pinStatus()).toHaveTextContent("Pin confirmed.");

    fireEvent.change(screen.getByLabelText("Suburb or town"), { target: { value: "Collingwood" } });
    await waitFor(() => expect(screen.getByTestId("leaflet")).toHaveAttribute("data-lng", String(COLLINGWOOD_CENTRE.lng)));
    expect(pinStatus()).toHaveTextContent("Not confirmed yet");

    // Back to Fitzroy: its confirmed pin is back.
    fireEvent.change(screen.getByLabelText("Suburb or town"), { target: { value: "Fitzroy" } });
    await waitFor(() => expect(pinStatus()).toHaveTextContent("Pin confirmed."));
  });
});

describe("EventEditor — the suburb changing under a linked place", () => {
  const suburbField = () => screen.getByLabelText("Suburb or town");
  const unlinkedNote = () => screen.getByText(PLACE_UNLINKED_NOTE);

  it("unlinks a saved place: the typed name and address stay, back to the search saying why, and the save drops the old place", async () => {
    const linked: EventRecord = { ...EVENT, location: { source: "places", placeId: PLACE_ID, pin: FITZROY_CENTRE } };
    renderEditor(linked);
    expect(linkedBlock()).toHaveAttribute("data-linked-place", PLACE_ID);

    suburbField().focus();
    fireEvent.change(suburbField(), { target: { value: "Collingwood" } });
    await waitFor(() => expect(linkedBlock()).toBeNull());
    expect(screen.queryByText("Linked to Google Maps:")).toBeNull();
    expect(searchBox()).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Can’t find it on Google Maps?" })).toBeInTheDocument();
    // Said in the live region that was already there; focus stays in the suburb field being typed in.
    expect(unlinkedNote()).toHaveAttribute("aria-live", "polite");
    expect(suburbField()).toHaveFocus();
    // Nothing to keep: the old place is for the old suburb.
    expect(screen.queryByRole("button", { name: /^Keep / })).toBeNull();
    // What the organiser typed stays.
    expect(screen.getByLabelText("Venue name")).toHaveValue("The Venue");
    expect(screen.getByLabelText("Venue address")).toHaveValue("1 Test St");
    // The pin step goes with the place: find the venue again, or drop a pin.
    expect(document.querySelector("[data-pin-step]")).toBeNull();

    const input = await save();
    expect(input.location).toBeNull();
    expect(input.suburb).toBe("Collingwood");

    // Back to the first suburb: the place stays unlinked (it has to be found again).
    fireEvent.change(suburbField(), { target: { value: "Fitzroy" } });
    await waitFor(() => expect(searchBox()).toBeInTheDocument());
    expect(linkedBlock()).toBeNull();
  });

  it("a place in another state is unlinked too: the payload never has the old place id with the new state", async () => {
    const linked: EventRecord = { ...EVENT, location: { source: "places", placeId: PLACE_ID, pin: FITZROY_CENTRE } };
    renderEditor(linked);
    fireEvent.change(suburbField(), { target: { value: "Perth" } });
    await waitFor(() => expect(linkedBlock()).toBeNull());

    // Publishing needs the venue found again, or a pin.
    fireEvent.click(screen.getByRole("button", { name: "Publish…" }));
    await waitFor(() => expect(venueSection()).toHaveFocus());
    expect(venueSection()).toHaveAccessibleDescription("Add the venue location and confirm the pin first.");
    expect(api.publishEvent).not.toHaveBeenCalled();

    const input = await save();
    expect(input.state).toBe("WA");
    expect(input.location).toBeNull();
  });

  it("a place just picked stays linked to the suburb the pick filled in; another suburb then unlinks it, and a pin can be dropped instead", async () => {
    renderEditor(null);
    await pickTheTote();
    expect(suburbField()).toHaveValue("Collingwood, VIC");
    expect(linkedBlock()).toHaveAttribute("data-linked-place", PLACE_ID);
    expect(screen.queryByText(PLACE_UNLINKED_NOTE)).toBeNull();

    fireEvent.change(suburbField(), { target: { value: "Brunswick" } });
    await waitFor(() => expect(linkedBlock()).toBeNull());
    expect(unlinkedNote()).toBeInTheDocument();
    // The name and address the pick filled in stay.
    expect(screen.getByLabelText("Venue name")).toHaveValue("The Tote Hotel");
    expect(screen.getByLabelText("Venue address")).toHaveValue("71 Johnston St");

    // Drop a pin: the note gives way to the pin's own.
    fireEvent.click(screen.getByRole("button", { name: "Can’t find it on Google Maps?" }));
    expect(screen.queryByText(PLACE_UNLINKED_NOTE)).toBeNull();
    await moveAndConfirm();
    expect(pinStatus()).toHaveTextContent("Pin confirmed.");
    expect(screen.getByText(/Not on Google Maps: put the pin on the venue below/)).toBeInTheDocument();
  });

  it("finding the venue again links the new place, for the new suburb", async () => {
    const linked: EventRecord = { ...EVENT, location: { source: "places", placeId: "ChIJold000000000000000", pin: FITZROY_CENTRE } };
    renderEditor(linked);
    fireEvent.change(suburbField(), { target: { value: "Collingwood" } });
    await waitFor(() => expect(linkedBlock()).toBeNull());
    await pickTheTote();
    expect(screen.queryByText(PLACE_UNLINKED_NOTE)).toBeNull();
    expect(linkedBlock()).toHaveAttribute("data-linked-place", PLACE_ID);
    expect((await save()).location).toEqual({ source: "places", placeId: PLACE_ID });
  });

  it("after Change, the place kept is dropped too (no Keep), and the save drops it", async () => {
    const linked: EventRecord = { ...EVENT, location: { source: "places", placeId: PLACE_ID, pin: FITZROY_CENTRE } };
    renderEditor(linked);
    fireEvent.click(screen.getByRole("button", { name: /^Change/ }));
    expect(screen.getByRole("button", { name: "Keep The Venue" })).toBeInTheDocument();
    fireEvent.change(suburbField(), { target: { value: "Collingwood" } });
    await waitFor(() => expect(screen.queryByRole("button", { name: "Keep The Venue" })).toBeNull());
    expect(unlinkedNote()).toBeInTheDocument();
    expect((await save()).location).toBeNull();
  });

  it("a dropped pin kept after “Find it on Google Maps instead” isn't a place: it stays (for its own suburb)", async () => {
    renderEditor({ ...EVENT, location: CONFIRMED_PIN_LOCATION });
    fireEvent.click(screen.getByRole("button", { name: "Find it on Google Maps instead" }));
    fireEvent.change(suburbField(), { target: { value: "Collingwood" } });
    fireEvent.change(suburbField(), { target: { value: "Fitzroy" } });
    expect(screen.queryByText(PLACE_UNLINKED_NOTE)).toBeNull();
    expect(screen.getByRole("button", { name: "Keep the pin you dropped" })).toBeInTheDocument();
    expect("location" in (await save())).toBe(false);
  });
});

describe("EventEditor — checking the pin (phone)", () => {
  beforeEach(() => {
    stubMatchMedia(true);
    HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement) {
      this.setAttribute("open", "");
    };
    HTMLDialogElement.prototype.close = function close(this: HTMLDialogElement) {
      this.removeAttribute("open");
    };
  });

  it("Done in the map's dialog confirms the pin; there's no separate confirm button", async () => {
    renderEditor();
    await pickTheTote();
    expect(pinStatus()).toHaveTextContent("Not checked yet");
    expect(screen.queryByRole("button", { name: "This is the right spot" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Check the pin" }));
    fireEvent.click(await screen.findByRole("button", { name: "Drag to" }));
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(pinStatus()).toHaveTextContent("Pin confirmed.");

    const input = await save();
    expect(input.location).toEqual({ source: "places", placeId: PLACE_ID, pin: pinMapDrag.to });
  });
});

describe("EventEditor — a pin alone", () => {
  it("“Can’t find it on Google Maps?”: the pin step, focused, and a manual pin once it's confirmed", async () => {
    renderEditor();
    fireEvent.click(screen.getByRole("button", { name: "Can’t find it on Google Maps?" }));
    expect(screen.queryByRole("combobox", { name: "Find the venue on Google Maps" })).toBeNull();
    expect(screen.getByText(/Not on Google Maps: put the pin on the venue below/)).toBeInTheDocument();
    await waitFor(() => expect(pinHeading()).toHaveFocus());
    await moveAndConfirm();
    const input = await save();
    expect(input.location).toEqual({ source: "manual_pin", pin: pinMapDrag.to });
  });

  it("without a suburb the pin step asks for one; an unknown suburb, to check it", async () => {
    renderEditor(null);
    fireEvent.click(screen.getByRole("button", { name: "Can’t find it on Google Maps?" }));
    expect(pinStatus()).toHaveTextContent("Enter the venue’s suburb or town first");
    fireEvent.change(screen.getByLabelText("Suburb or town"), { target: { value: "Nowhereville" } });
    await waitFor(() => expect(pinStatus()).toHaveTextContent("Check the venue’s suburb or town above"));
  });

  it("the search answering 503 places_unavailable: the pin instead, saying why", async () => {
    api.autocompletePlaces.mockRejectedValue(
      new ApiError(503, "Unavailable.", undefined, { error: "Unavailable.", code: "places_unavailable" }),
    );
    renderEditor();
    fireEvent.focus(searchBox());
    fireEvent.change(searchBox(), { target: { value: "The Tote" } });
    const note = await screen.findByText(/Google Maps can’t be searched right now, so drop a pin/);
    // Said (a live region that was already there), and focus goes on to the pin, from the search that's gone.
    expect(note).toHaveAttribute("aria-live", "polite");
    await waitFor(() => expect(pinHeading()).toHaveFocus());
    expect(screen.queryByRole("combobox", { name: "Find the venue on Google Maps" })).toBeNull();
    // Searching again would only fail again.
    expect(screen.queryByRole("button", { name: "Find it on Google Maps instead" })).toBeNull();
    expect(await screen.findByRole("button", { name: "This is the right spot" })).toBeInTheDocument();
  });

  it("without a session token (crypto.randomUUID missing: plain-HTTP dev), the pin instead", async () => {
    const randomUUID = vi.spyOn(crypto, "randomUUID").mockImplementation(() => {
      throw new TypeError("crypto.randomUUID is not a function");
    });
    try {
      renderEditor();
      fireEvent.focus(searchBox());
      fireEvent.change(searchBox(), { target: { value: "The Tote" } });
      expect(await screen.findByText(/Google Maps can’t be searched right now, so drop a pin/)).toBeInTheDocument();
      expect(api.autocompletePlaces).not.toHaveBeenCalled();
    } finally {
      randomUUID.mockRestore();
    }
  });
});

describe("EventEditor — what's sent for a saved event's location", () => {
  it("nothing for an event without one, left without one", async () => {
    renderEditor();
    expect("location" in (await save())).toBe(false);
  });

  it("nothing when it's unchanged (a confirmed manual pin)", async () => {
    renderEditor({ ...EVENT, location: CONFIRMED_PIN_LOCATION });
    // Opened on the saved pin, at street level.
    expect(await screen.findByTestId("leaflet")).toHaveAttribute("data-zoom", String(PIN_ZOOM_EXACT));
    expect(pinStatus()).toHaveTextContent("Pin confirmed.");
    expect("location" in (await save())).toBe(false);
  });

  it("nothing when a linked place with its pin is unchanged, nor after Change with no new place picked", async () => {
    const linked: EventRecord = { ...EVENT, location: { source: "places", placeId: PLACE_ID, pin: FITZROY_CENTRE } };
    api.updateEventDraft.mockResolvedValue(linked);
    renderEditor(linked);
    expect(screen.getByText("Linked to Google Maps:")).toBeInTheDocument();
    expect("location" in (await save())).toBe(false);

    // Change opens the search (focused), but the saved place and pin stay until another place is picked.
    api.updateEventDraft.mockClear();
    fireEvent.click(screen.getByRole("button", { name: /^Change/ }));
    await waitFor(() => expect(searchBox()).toHaveFocus());
    expect("location" in (await save())).toBe(false);

    // Keep: back to the linked place (focused), as it was.
    fireEvent.click(screen.getByRole("button", { name: "Keep The Venue" }));
    await waitFor(() => expect(linkedBlock()).toHaveFocus());
    expect(linkedBlock()).toHaveAttribute("data-linked-place", PLACE_ID);
    expect(pinStatus()).toHaveTextContent("Pin confirmed.");
  });

  it("“Find it on Google Maps instead” keeps the dropped pin until a place is picked; Keep goes back to it", async () => {
    renderEditor({ ...EVENT, location: CONFIRMED_PIN_LOCATION });
    fireEvent.click(screen.getByRole("button", { name: "Find it on Google Maps instead" }));
    await waitFor(() => expect(searchBox()).toHaveFocus());
    expect("location" in (await save())).toBe(false);

    fireEvent.click(screen.getByRole("button", { name: "Keep the pin you dropped" }));
    await waitFor(() => expect(pinHeading()).toHaveFocus());
    expect(pinStatus()).toHaveTextContent("Pin confirmed.");
  });

  it("after Change, picking another place replaces the saved one (its pin to check again)", async () => {
    const linked: EventRecord = { ...EVENT, location: { source: "places", placeId: "ChIJold000000000000000", pin: FITZROY_CENTRE } };
    renderEditor(linked);
    fireEvent.click(screen.getByRole("button", { name: /^Change/ }));
    await pickTheTote();
    expect((await save()).location).toEqual({ source: "places", placeId: PLACE_ID });
  });
});

describe("EventEditor — publishing needs a confirmed pin", () => {
  it("Publish… with no pin: says so by the venue and the buttons, focuses the venue, and saves or publishes nothing", async () => {
    renderEditor();
    fireEvent.click(screen.getByRole("button", { name: "Publish…" }));

    expect(screen.queryByRole("group", { name: "Publish this event now?" })).toBeNull();
    await waitFor(() => expect(venueSection()).toHaveFocus());
    expect(venueSection()).toHaveAccessibleDescription("Add the venue location and confirm the pin first.");
    expect(searchBox()).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByRole("group", { name: "Add the venue location and confirm the pin first." })).toBeInTheDocument();
    expect(api.updateEventDraft).not.toHaveBeenCalled();
    expect(api.publishEvent).not.toHaveBeenCalled();
  });

  it("a place picked but its pin not confirmed isn't enough either; once confirmed, it publishes", async () => {
    api.publishEvent.mockResolvedValue({ ...EVENT, status: "published" });
    renderEditor();
    await pickTheTote();
    fireEvent.click(screen.getByRole("button", { name: "Publish…" }));
    await waitFor(() => expect(venueSection()).toHaveFocus());
    expect(api.publishEvent).not.toHaveBeenCalled();

    await moveAndConfirm();
    fireEvent.click(screen.getByRole("button", { name: "Publish…" }));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Publish now" }));
    });
    await waitFor(() => expect(api.publishEvent).toHaveBeenCalledTimes(1));
    expect(api.updateEventDraft.mock.calls[0][1].location).toEqual({ source: "places", placeId: PLACE_ID, pin: pinMapDrag.to });
  });

  it("Change, then Publish… with no new place: the saved pin still counts, and the save keeps it", async () => {
    const linked: EventRecord = { ...EVENT, location: { source: "places", placeId: PLACE_ID, pin: FITZROY_CENTRE } };
    api.updateEventDraft.mockResolvedValue(linked);
    api.publishEvent.mockResolvedValue({ ...linked, status: "published" });
    renderEditor(linked);
    fireEvent.click(screen.getByRole("button", { name: /^Change/ }));
    fireEvent.click(screen.getByRole("button", { name: "Publish…" }));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Publish now" }));
    });
    await waitFor(() => expect(api.publishEvent).toHaveBeenCalledTimes(1));
    expect("location" in api.updateEventDraft.mock.calls[0][1]).toBe(false);
  });

  it("Send for review (rejected before) is checked the same way", async () => {
    renderEditor({
      ...EVENT,
      status: "rejected",
      rejectionReason: "Add the set times.",
      moderationLog: [{ action: "rejected", by: "sheltuh", at: "2026-10-20T00:00:00.000Z" }],
    });
    fireEvent.click(screen.getByRole("button", { name: "Send for review" }));
    await waitFor(() => expect(venueSection()).toHaveFocus());
    expect(api.updateEventDraft).not.toHaveBeenCalled();
    expect(api.publishEvent).not.toHaveBeenCalled();
  });

  it("the API refusing it (409 location_required): said by the venue, which is focused", async () => {
    api.publishEvent.mockRejectedValue(
      new ApiError(409, "Add the venue's location first.", { location: "Add the venue's location first." }, {
        error: "x",
        code: "location_required",
      }),
    );
    renderEditor({ ...EVENT, location: CONFIRMED_PIN_LOCATION });
    fireEvent.click(screen.getByRole("button", { name: "Publish…" }));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Publish now" }));
    });
    await waitFor(() => expect(venueSection()).toHaveFocus());
    expect(screen.getByRole("group", { name: "Add the venue location and confirm the pin first." })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Publish now" })).toBeNull();
  });
});

describe("EventEditor — the API's location errors", () => {
  it("fieldErrors.location is shown by the venue, which is focused", async () => {
    const message = "The pin is more than 10 km outside Fitzroy, VIC. Move it onto the venue, or check the suburb.";
    api.updateEventDraft.mockRejectedValue(new ApiError(400, "Check the highlighted fields.", { location: message }));
    renderEditor({ ...EVENT, location: CONFIRMED_PIN_LOCATION });
    fireEvent.click(screen.getByRole("button", { name: "Save draft" }));
    await waitFor(() => expect(venueSection()).toHaveFocus());
    expect(venueSection()).toHaveAccessibleDescription(message);
  });

  it("fieldErrors.suburb (the place is in another state) is shown by the suburb", async () => {
    const message = "That place is in New South Wales, not Victoria. Check the suburb.";
    api.updateEventDraft.mockRejectedValue(new ApiError(400, "Check the highlighted fields.", { suburb: message }));
    renderEditor();
    await pickTheTote();
    fireEvent.click(screen.getByRole("button", { name: "Save draft" }));
    await waitFor(() => expect(screen.getByLabelText("Suburb or town")).toHaveFocus());
    expect(screen.getByLabelText("Suburb or town")).toHaveAccessibleDescription(expect.stringContaining(message));
  });

  it("503 places_unavailable on saving a new place: the pin instead, the confirmed pin kept", async () => {
    const message = "Google Maps couldn't be reached to check the place. Try again, or drop a pin instead.";
    api.updateEventDraft
      .mockRejectedValueOnce(
        new ApiError(503, message, { location: message }, { error: message, code: "places_unavailable", fieldErrors: { location: message } }),
      )
      .mockResolvedValueOnce({ ...EVENT });
    renderEditor();
    await pickTheTote();
    await moveAndConfirm();
    fireEvent.click(screen.getByRole("button", { name: "Save draft" }));

    expect(await screen.findByText(/Google Maps can’t be searched right now, so drop a pin/)).toBeInTheDocument();
    expect(screen.queryByText("Linked to Google Maps:")).toBeNull();
    expect(venueSection()).toHaveAccessibleDescription(message);
    expect(pinStatus()).toHaveTextContent("Pin confirmed.");

    fireEvent.click(screen.getByRole("button", { name: "Save draft" }));
    await waitFor(() => expect(api.updateEventDraft).toHaveBeenCalledTimes(2));
    expect(api.updateEventDraft.mock.calls[1][1].location).toEqual({ source: "manual_pin", pin: pinMapDrag.to });
  });
});

describe("EventEditor (admin) — the same venue location", () => {
  it("an admin picks a place and confirms the pin; it's sent with the save", async () => {
    const record: AdminEventRecord = { ...EVENT, organiserPlatformManaged: false, curation: { boost: 1, excluded: false } };
    api.adminUpdateEvent.mockResolvedValue(record);
    render(
      <FakeAuthProvider value={fakeAuthValue({ email: "admin@sheltuh.example", isAdmin: true })}>
        <EventEditor mode="admin" getToken={vi.fn().mockResolvedValue("token")} initial={record} onSaved={vi.fn()} />
      </FakeAuthProvider>,
    );
    await pickTheTote();
    await moveAndConfirm();
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(api.adminUpdateEvent).toHaveBeenCalledTimes(1));
    expect(api.adminUpdateEvent.mock.calls[0][1].location).toEqual({ source: "places", placeId: PLACE_ID, pin: pinMapDrag.to });
  });
});
