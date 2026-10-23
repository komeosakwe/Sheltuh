// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FavouritesProvider } from "@/components/favourites/FavouritesProvider";
import SaveButton, { type SaveButtonVariant } from "@/components/favourites/SaveButton";
import { ApiError } from "@/lib/api/client";
import { MAX_FAVOURITES } from "@/lib/api/types";
import { SessionExpiredError, type AuthContextValue } from "@/lib/auth/AuthContext";
import { SAVED_STORAGE_KEY } from "@/lib/saved-storage";
import { fakeAuthValue, FakeAuthProvider } from "./test-utils/fakeAuth";

let pathname = "/events";
vi.mock("next/navigation", () => ({
  usePathname: () => pathname,
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

const api = {
  listFavouriteIds: vi.fn(),
  addFavourite: vi.fn(),
  removeFavourite: vi.fn(),
  listFavourites: vi.fn(),
};
vi.mock("@/lib/api/favourites", () => ({
  listFavouriteIds: (...a: unknown[]) => api.listFavouriteIds(...a),
  addFavourite: (...a: unknown[]) => api.addFavourite(...a),
  removeFavourite: (...a: unknown[]) => api.removeFavourite(...a),
  listFavourites: (...a: unknown[]) => api.listFavourites(...a),
}));

const EVENT = { id: "evt-1", title: "Night Market", slug: "night-market" };

beforeEach(() => {
  pathname = "/events";
  for (const fn of Object.values(api)) fn.mockReset();
  api.addFavourite.mockResolvedValue({ eventId: "evt-1", favourited: true });
  api.removeFavourite.mockResolvedValue({ eventId: "evt-1", favourited: false });
  localStorage.clear();
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const demo = () => fakeAuthValue({ configured: false, status: "signed-out", email: undefined, accessToken: undefined });
const signedOut = () => fakeAuthValue({ status: "signed-out", email: undefined, accessToken: undefined });

function renderHeart(auth: AuthContextValue = fakeAuthValue(), variant: SaveButtonVariant = "overlay") {
  return render(
    <FakeAuthProvider value={auth}>
      <FavouritesProvider>
        <SaveButton event={EVENT} variant={variant} />
      </FavouritesProvider>
    </FakeAuthProvider>,
  );
}

const heart = () => screen.getByRole("button", { name: "Save Night Market" });
const liveRegion = () => document.querySelector("[data-favourites-status]");
const bar = () => document.querySelector<HTMLElement>("[data-favourites-notice]");

async function readyHeart(ids: string[] = [], auth?: AuthContextValue, variant?: SaveButtonVariant) {
  api.listFavouriteIds.mockResolvedValue({ eventIds: ids });
  renderHeart(auth, variant);
  await waitFor(() => expect(heart()).not.toHaveAttribute("aria-disabled"));
  return heart();
}

describe("SaveButton — live", () => {
  it("is a toggle with a fixed name and aria-pressed, filled from one ids request", async () => {
    const button = await readyHeart(["evt-1"]);
    expect(button).toHaveAttribute("aria-pressed", "true");
    expect(button.querySelector("svg")).toHaveAttribute("fill", "currentColor");
    expect(api.listFavouriteIds).toHaveBeenCalledTimes(1);
  });

  it("is aria-disabled (not faded) and ignores taps while the ids load", async () => {
    api.listFavouriteIds.mockImplementation(() => new Promise(() => {}));
    renderHeart();
    expect(heart()).toHaveAttribute("aria-disabled", "true");
    expect(heart()).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(heart());
    expect(api.addFavourite).not.toHaveBeenCalled();
  });

  it("is aria-disabled while auth resolves, and makes no request", () => {
    renderHeart(fakeAuthValue({ status: "loading" }));
    expect(heart()).toHaveAttribute("aria-disabled", "true");
    expect(api.listFavouriteIds).not.toHaveBeenCalled();
  });

  it("saves optimistically, sends PUT and announces it", async () => {
    let resolve!: () => void;
    api.addFavourite.mockImplementation(() => new Promise<void>((r) => (resolve = r)));
    const button = await readyHeart();
    fireEvent.click(button);
    expect(button).toHaveAttribute("aria-pressed", "true");
    expect(api.addFavourite).toHaveBeenCalledWith("evt-1", expect.any(Function));
    await waitFor(() => expect(liveRegion()).toHaveTextContent("Saved Night Market."));
    await act(async () => resolve());
    expect(button).toHaveAttribute("aria-pressed", "true");
    expect(bar()).toBeNull(); // a normal tap needs no bar: the fill is the feedback
  });

  it("removes with DELETE and announces it", async () => {
    const button = await readyHeart(["evt-1"]);
    fireEvent.click(button);
    expect(button).toHaveAttribute("aria-pressed", "false");
    expect(api.removeFavourite).toHaveBeenCalledWith("evt-1", expect.any(Function));
    await waitFor(() => expect(liveRegion()).toHaveTextContent("Removed Night Market from saved."));
  });

  it("rolls back a failed save and offers Try again, which resends", async () => {
    api.addFavourite.mockRejectedValueOnce(new ApiError(0, "Couldn't reach the server."));
    const button = await readyHeart();
    fireEvent.click(button);
    await waitFor(() => expect(button).toHaveAttribute("aria-pressed", "false"));
    expect(bar()).toHaveTextContent("Couldn't save Night Market. Check your connection and try again.");
    expect(bar()).toHaveClass("border-danger");
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(button).toHaveAttribute("aria-pressed", "true");
    await waitFor(() => expect(api.addFavourite).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(bar()).toBeNull());
  });

  it("rolls back a failed removal with its own words", async () => {
    api.removeFavourite.mockRejectedValueOnce(new ApiError(500, "boom"));
    const button = await readyHeart(["evt-1"]);
    fireEvent.click(button);
    await waitFor(() => expect(button).toHaveAttribute("aria-pressed", "true"));
    expect(bar()).toHaveTextContent("Couldn't remove Night Market from saved. Check your connection and try again.");
  });

  it("404: the event is no longer listed (no Try again)", async () => {
    api.addFavourite.mockRejectedValueOnce(new ApiError(404, "Event not found."));
    const button = await readyHeart();
    fireEvent.click(button);
    await waitFor(() => expect(bar()).toHaveTextContent("Couldn't save Night Market. It's no longer listed."));
    expect(button).toHaveAttribute("aria-pressed", "false");
    expect(screen.queryByRole("button", { name: "Try again" })).toBeNull();
  });

  it("409 from the server is the 500 cap", async () => {
    api.addFavourite.mockRejectedValueOnce(new ApiError(409, "Too many."));
    const button = await readyHeart();
    fireEvent.click(button);
    await waitFor(() => expect(bar()).toHaveTextContent("You've saved 500 events, the most you can."));
    expect(button).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByRole("link", { name: "Manage saved" })).toHaveAttribute("href", "/saved");
  });

  it.each([
    ["a 401", new ApiError(401, "Sign in.")],
    ["an expired session", new SessionExpiredError()],
  ])("%s asks to sign in again, back to this page", async (_label, error) => {
    pathname = "/events/night-market";
    api.addFavourite.mockRejectedValueOnce(error);
    fireEvent.click(await readyHeart());
    await waitFor(() => expect(bar()).toHaveTextContent("Your session has ended. Sign in to keep saving."));
    expect(screen.getByRole("link", { name: "Sign in" })).toHaveAttribute(
      "href",
      "/login?next=%2Fevents%2Fnight-market",
    );
  });

  it("removing something already gone (404) counts as removed, quietly", async () => {
    api.removeFavourite.mockRejectedValueOnce(new ApiError(404, "Event not found."));
    const button = await readyHeart(["evt-1"]);
    fireEvent.click(button);
    await act(async () => {});
    expect(button).toHaveAttribute("aria-pressed", "false");
    expect(bar()).toBeNull();
  });

  it(`at ${MAX_FAVOURITES} saved, a new save doesn't flip and the cap message shows at once`, async () => {
    const ids = Array.from({ length: MAX_FAVOURITES }, (_, i) => `other-${i}`);
    const button = await readyHeart(ids);
    fireEvent.click(button);
    expect(button).toHaveAttribute("aria-pressed", "false");
    expect(api.addFavourite).not.toHaveBeenCalled();
    expect(bar()).toHaveTextContent("You've saved 500 events");
  });

  it("when the ids couldn't load, a tap explains and Try again reloads them", async () => {
    api.listFavouriteIds.mockRejectedValueOnce(new ApiError(500, "down")).mockResolvedValue({ eventIds: ["evt-1"] });
    renderHeart();
    await waitFor(() => expect(heart()).not.toHaveAttribute("aria-disabled"));
    fireEvent.click(heart());
    expect(api.addFavourite).not.toHaveBeenCalled();
    expect(bar()).toHaveTextContent("Couldn't load your saved events.");
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    await waitFor(() => expect(heart()).toHaveAttribute("aria-pressed", "true"));
  });

  it("Dismiss closes the bar; it never takes focus", async () => {
    api.addFavourite.mockRejectedValueOnce(new ApiError(0, "offline"));
    const button = await readyHeart();
    button.focus();
    fireEvent.click(button);
    await waitFor(() => expect(bar()).not.toBeNull());
    expect(button).toHaveFocus();
    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(bar()).toBeNull();
  });

  it("the event page's action keeps its visible 'Save' label inside the name, as a quiet unbordered 44px control", async () => {
    const button = await readyHeart([], undefined, "action");
    expect(button).toHaveTextContent("Save");
    expect(button).toHaveAccessibleName("Save Night Market");
    expect(button).toHaveClass("min-h-11", "bg-surface");
    // No border class (hover:bg-surface-border is a fill) and not the boxed .btn.
    expect(button.className.split(/\s+/)).not.toContain("border");
    expect(button.className).not.toMatch(/(?:^|\s)btn(?:-|\s|$)/);
  });
});

describe("SaveButton — focus on a photo (overlay)", () => {
  it("rings the 36px mark, black on a white gap, instead of the outline that can vanish into dark art; never orange", async () => {
    const button = await readyHeart();
    const mark = button.firstElementChild as HTMLElement;
    expect(button).toHaveClass("group/save", "focus-visible:outline-none");
    expect(mark).toHaveClass(
      "size-9",
      "group-focus-visible/save:ring-2",
      "group-focus-visible/save:ring-ink",
      "group-focus-visible/save:ring-offset-2",
      "group-focus-visible/save:ring-offset-paper",
    );
    expect(`${button.className} ${mark.className}`).not.toMatch(/signal|orange/);
  });

  it("does the same when it's the sign-in link (signed out)", () => {
    renderHeart(signedOut());
    const link = screen.getByRole("link", { name: "Sign in to save Night Market" });
    expect(link).toHaveClass("focus-visible:outline-none");
    expect(link.firstElementChild).toHaveClass("group-focus-visible/save:ring-ink", "group-focus-visible/save:ring-offset-paper");
  });

  it("other variants keep the page's own outline", async () => {
    const button = await readyHeart([], undefined, "plain");
    expect(button.className).not.toMatch(/outline-none/);
  });
});

describe("SaveButton — signed out (live)", () => {
  it("is a link to sign in that comes back to the event and saves it", () => {
    renderHeart(signedOut());
    const link = screen.getByRole("link", { name: "Sign in to save Night Market" });
    expect(link).toHaveAttribute("href", "/login?next=%2Fevents%2Fnight-market%3Fsave%3D1");
    expect(screen.queryByRole("button")).toBeNull();
    expect(api.listFavouriteIds).not.toHaveBeenCalled();
  });
});

describe("SaveButton — demo mode", () => {
  it("keeps the list in localStorage and never calls the API", async () => {
    renderHeart(demo());
    await waitFor(() => expect(heart()).not.toHaveAttribute("aria-disabled"));
    fireEvent.click(heart());
    await waitFor(() => expect(localStorage.getItem(SAVED_STORAGE_KEY)).toBe('{"ids":["evt-1"]}'));
    expect(heart()).toHaveAttribute("aria-pressed", "true");
    for (const fn of Object.values(api)) expect(fn).not.toHaveBeenCalled();
  });

  it("reads saved ids after mount", async () => {
    localStorage.setItem(SAVED_STORAGE_KEY, JSON.stringify({ ids: ["evt-1"] }));
    renderHeart(demo());
    await waitFor(() => expect(heart()).toHaveAttribute("aria-pressed", "true"));
  });

  it("follows another tab's changes", async () => {
    renderHeart(demo());
    await waitFor(() => expect(heart()).not.toHaveAttribute("aria-disabled"));
    act(() => {
      window.dispatchEvent(new StorageEvent("storage", { key: SAVED_STORAGE_KEY, newValue: '{"ids":["evt-1"]}' }));
    });
    expect(heart()).toHaveAttribute("aria-pressed", "true");
  });

  it("works in memory, with no error, when storage is blocked", async () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("SecurityError");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("QuotaExceededError");
    });
    renderHeart(demo());
    await waitFor(() => expect(heart()).not.toHaveAttribute("aria-disabled"));
    fireEvent.click(heart());
    await act(async () => {});
    expect(heart()).toHaveAttribute("aria-pressed", "true");
    expect(bar()).toBeNull();
  });
});

describe("SaveButton — no provider", () => {
  it("renders nothing (isolated cards and previews)", () => {
    const { container } = render(<SaveButton event={EVENT} variant="overlay" />);
    expect(container).toBeEmptyDOMElement();
  });
});
