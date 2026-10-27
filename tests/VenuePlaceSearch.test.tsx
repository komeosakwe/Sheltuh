// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import VenuePlaceSearch, {
  PLACE_SEARCH_DEBOUNCE_MS,
  type PickedPlace,
} from "@/components/dashboard/VenuePlaceSearch";
import { ApiError } from "@/lib/api/client";
import type { PlaceDetails, PlaceSuggestion } from "@/lib/api/places";

/**
 * Finding the venue on Google Maps (components/dashboard/VenuePlaceSearch.tsx):
 * the APG combobox over POST /api/places/autocomplete, then the picked
 * place's address. The API wrappers are stood in for; the 503 check is the
 * real one.
 */

// Live mode: the search is there (in demo mode it goes straight to the pin).
vi.mock("@/lib/api/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api/client")>()),
  isApiConfigured: true,
}));

const api = vi.hoisted(() => ({
  autocompletePlaces: vi.fn(),
  getPlaceDetails: vi.fn(),
  tokens: 0,
}));
vi.mock("@/lib/api/places", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api/places")>();
  return {
    ...actual,
    autocompletePlaces: (...args: unknown[]) => api.autocompletePlaces(...args),
    getPlaceDetails: (...args: unknown[]) => api.getPlaceDetails(...args),
    newPlacesSessionToken: () => `session-${++api.tokens}`,
  };
});

const suggestion = (n: number): PlaceSuggestion => ({
  placeId: `ChIJplace0000000000${n}`,
  primaryText: `Venue ${n}`,
  secondaryText: `${n} Johnston St, Collingwood VIC`,
});
const SIX = [1, 2, 3, 4, 5, 6].map(suggestion);
const DETAILS: PlaceDetails = {
  placeId: "ChIJplace00000000002",
  formattedAddress: "2 Johnston St, Collingwood VIC 3066",
  streetAddress: "2 Johnston St",
  locality: "Collingwood",
  state: "VIC",
  postcode: "3066",
  googleMapsUrl: "https://maps.google.com/?cid=2",
};
const unavailable = () =>
  new ApiError(503, "Google Maps can't be reached.", undefined, { error: "x", code: "places_unavailable" });

const getToken = vi.fn().mockResolvedValue("token");

beforeEach(() => {
  vi.useFakeTimers();
  api.autocompletePlaces.mockReset().mockResolvedValue({ suggestions: SIX });
  api.getPlaceDetails.mockReset().mockResolvedValue(DETAILS);
  api.tokens = 0;
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function renderSearch(props: { error?: string } = {}) {
  const onPick = vi.fn<(picked: PickedPlace) => void>();
  const onManual = vi.fn<(why: "chosen" | "unavailable") => void>();
  const onSubmit = vi.fn((event: { preventDefault: () => void }) => event.preventDefault());
  render(
    <form onSubmit={onSubmit}>
      <VenuePlaceSearch getToken={getToken} onPick={onPick} onManual={onManual} error={props.error} errorId="loc-error" />
    </form>,
  );
  return { onPick, onManual, onSubmit, box: screen.getByRole("combobox", { name: "Find the venue on Google Maps" }) };
}

/** Types `text`, then lets the debounce run out and the answer arrive. */
async function typeAndWait(box: HTMLElement, text: string) {
  fireEvent.focus(box);
  fireEvent.change(box, { target: { value: text } });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(PLACE_SEARCH_DEBOUNCE_MS);
  });
}

describe("VenuePlaceSearch — the combobox", () => {
  it("is a labelled combobox controlling a listbox, collapsed until there are suggestions", async () => {
    const { box } = renderSearch();
    expect(box).toHaveAttribute("aria-autocomplete", "list");
    expect(box).toHaveAttribute("aria-expanded", "false");
    const list = document.getElementById(box.getAttribute("aria-controls") ?? "");
    expect(list).toHaveAttribute("role", "listbox");
    expect(screen.queryByRole("listbox")).toBeNull(); // hidden while collapsed

    await typeAndWait(box, "Venue");
    expect(box).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("listbox", { name: "Places on Google Maps" })).toBe(list);
  });

  it("shows at most 5 suggestions, with Google's attribution beside them, and says how many", async () => {
    const { box } = renderSearch();
    await typeAndWait(box, "Venue");
    const options = within(screen.getByRole("listbox")).getAllByRole("option");
    expect(options).toHaveLength(5);
    expect(options[0]).toHaveTextContent("Venue 1");
    expect(options[0]).toHaveTextContent("1 Johnston St, Collingwood VIC");
    expect(screen.getByText("Powered by Google")).toBeVisible();
    expect(box).toHaveAccessibleDescription(/5 places found/);
  });

  it("arrows move through the suggestions (wrapping), Enter picks one; Escape closes, then clears", async () => {
    const { box, onPick, onSubmit } = renderSearch();
    await typeAndWait(box, "Venue");
    const options = screen.getAllByRole("option");

    fireEvent.keyDown(box, { key: "ArrowDown" });
    expect(box).toHaveAttribute("aria-activedescendant", options[0].id);
    expect(options[0]).toHaveAttribute("aria-selected", "true");
    fireEvent.keyDown(box, { key: "ArrowUp" });
    expect(box).toHaveAttribute("aria-activedescendant", options[4].id);
    fireEvent.keyDown(box, { key: "ArrowDown" });
    fireEvent.keyDown(box, { key: "ArrowDown" });
    expect(box).toHaveAttribute("aria-activedescendant", options[1].id);
    expect(options[0]).toHaveAttribute("aria-selected", "false");

    fireEvent.keyDown(box, { key: "Escape" });
    expect(box).toHaveAttribute("aria-expanded", "false");
    expect(box).not.toHaveAttribute("aria-activedescendant");
    expect(box).toHaveValue("Venue");
    fireEvent.keyDown(box, { key: "Escape" });
    expect(box).toHaveValue("");

    await typeAndWait(box, "Venue");
    fireEvent.keyDown(box, { key: "ArrowDown" });
    fireEvent.keyDown(box, { key: "ArrowDown" });
    await act(async () => {
      fireEvent.keyDown(box, { key: "Enter" });
    });
    // The same session's token goes with the details request, which ends the session.
    const sessionToken = api.autocompletePlaces.mock.calls[0][1];
    expect(api.getPlaceDetails).toHaveBeenCalledWith("ChIJplace00000000002", sessionToken, getToken, expect.any(AbortSignal));
    expect(onPick).toHaveBeenCalledWith({ suggestion: suggestion(2), details: DETAILS });
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("a click picks a suggestion too; the next search is a new session", async () => {
    const { box, onPick } = renderSearch();
    await typeAndWait(box, "Venue");
    await act(async () => {
      fireEvent.click(screen.getAllByRole("option")[0]);
    });
    expect(onPick).toHaveBeenCalledWith({ suggestion: suggestion(1), details: DETAILS });
    await typeAndWait(box, "Venue 2");
    expect(api.autocompletePlaces.mock.calls[1][1]).not.toBe(api.autocompletePlaces.mock.calls[0][1]);
  });

  it("Enter never submits the form, with or without a suggestion chosen", async () => {
    const { box, onSubmit } = renderSearch();
    fireEvent.change(box, { target: { value: "Ve" } });
    const enter = new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true });
    box.dispatchEvent(enter);
    expect(enter.defaultPrevented).toBe(true);
    expect(onSubmit).not.toHaveBeenCalled();
  });
});

describe("VenuePlaceSearch — searching", () => {
  it("waits 300 ms after typing stops, and asks nothing under 3 characters", async () => {
    const { box } = renderSearch();
    fireEvent.change(box, { target: { value: "Ve" } });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(api.autocompletePlaces).not.toHaveBeenCalled();

    fireEvent.change(box, { target: { value: "Ven" } });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(200);
    });
    fireEvent.change(box, { target: { value: "Venu" } });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(PLACE_SEARCH_DEBOUNCE_MS - 1);
    });
    expect(api.autocompletePlaces).not.toHaveBeenCalled();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(api.autocompletePlaces).toHaveBeenCalledTimes(1);
    expect(api.autocompletePlaces).toHaveBeenCalledWith("Venu", "session-1", getToken, expect.any(AbortSignal));
  });

  it("typing on cancels the search still running, and its late answer is never shown", async () => {
    let answerFirst: (value: { suggestions: PlaceSuggestion[] }) => void = () => {};
    api.autocompletePlaces
      .mockImplementationOnce(() => new Promise((resolve) => (answerFirst = resolve)))
      .mockResolvedValueOnce({ suggestions: [suggestion(9)] });
    const { box } = renderSearch();
    await typeAndWait(box, "Venue");
    const firstSignal: AbortSignal = api.autocompletePlaces.mock.calls[0][3];
    expect(firstSignal.aborted).toBe(false);

    fireEvent.change(box, { target: { value: "Venue 9" } });
    expect(firstSignal.aborted).toBe(true);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(PLACE_SEARCH_DEBOUNCE_MS);
    });
    await act(async () => {
      answerFirst({ suggestions: SIX });
    });
    expect(screen.getAllByRole("option")).toHaveLength(1);
    expect(screen.getByRole("option")).toHaveTextContent("Venue 9");
  });

  it("says when nothing was found", async () => {
    api.autocompletePlaces.mockResolvedValue({ suggestions: [] });
    const { box } = renderSearch();
    await typeAndWait(box, "Nowhere at all");
    expect(box).toHaveAttribute("aria-expanded", "false");
    expect(box).toHaveAccessibleDescription(/No places found on Google Maps/);
  });

  it("another failure (too many searches) is said by the field, and the manual way stays", async () => {
    api.autocompletePlaces.mockRejectedValue(new ApiError(429, "Too many searches this hour."));
    const { box, onManual } = renderSearch();
    await typeAndWait(box, "Venue");
    expect(box).toHaveAccessibleDescription(/Couldn’t search Google Maps: Too many searches this hour\./);
    expect(onManual).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Can’t find it on Google Maps?" })).toBeInTheDocument();
  });

  it("the field's error is read with it", () => {
    const { box } = renderSearch({ error: "Add the venue location and confirm the pin first." });
    expect(box).toHaveAttribute("aria-invalid", "true");
    expect(box).toHaveAccessibleDescription(/Add the venue location and confirm the pin first\./);
  });
});

describe("VenuePlaceSearch — the pin instead", () => {
  it("“Can’t find it on Google Maps?” switches to the pin", () => {
    const { onManual } = renderSearch();
    fireEvent.click(screen.getByRole("button", { name: "Can’t find it on Google Maps?" }));
    expect(onManual).toHaveBeenCalledWith("chosen");
  });

  it("a 503 places_unavailable from the search switches to the pin", async () => {
    api.autocompletePlaces.mockRejectedValue(unavailable());
    const { box, onManual } = renderSearch();
    await typeAndWait(box, "Venue");
    expect(onManual).toHaveBeenCalledWith("unavailable");
  });

  it("a 503 places_unavailable fetching the picked place's address switches to the pin too", async () => {
    api.getPlaceDetails.mockRejectedValue(unavailable());
    const { box, onManual, onPick } = renderSearch();
    await typeAndWait(box, "Venue");
    await act(async () => {
      fireEvent.click(screen.getAllByRole("option")[0]);
    });
    expect(onManual).toHaveBeenCalledWith("unavailable");
    expect(onPick).not.toHaveBeenCalled();
  });

  it("another failure fetching the address is said, and nothing is picked", async () => {
    api.getPlaceDetails.mockRejectedValue(new ApiError(400, "That place isn't in Australia."));
    const { box, onPick } = renderSearch();
    await typeAndWait(box, "Venue");
    await act(async () => {
      fireEvent.click(screen.getAllByRole("option")[0]);
    });
    expect(box).toHaveAccessibleDescription(/Couldn’t get that place’s address: That place isn't in Australia\./);
    expect(onPick).not.toHaveBeenCalled();
  });
});
