// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FavouritesProvider } from "@/components/favourites/FavouritesProvider";
import SavedPageContent from "@/components/favourites/SavedPageContent";
import { ApiError } from "@/lib/api/client";
import type { FavouriteEvent } from "@/lib/api/types";
import type { AuthContextValue } from "@/lib/auth/AuthContext";
import { SAVED_STORAGE_KEY } from "@/lib/saved-storage";
import { sampleEvents } from "@/lib/sample-events";
import { fakeAuthValue, FakeAuthProvider } from "./test-utils/fakeAuth";

vi.mock("next/navigation", () => ({
  usePathname: () => "/saved",
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

const api = { listFavouriteIds: vi.fn(), addFavourite: vi.fn(), removeFavourite: vi.fn(), listFavourites: vi.fn() };
vi.mock("@/lib/api/favourites", () => ({
  listFavouriteIds: (...a: unknown[]) => api.listFavouriteIds(...a),
  addFavourite: (...a: unknown[]) => api.addFavourite(...a),
  removeFavourite: (...a: unknown[]) => api.removeFavourite(...a),
  listFavourites: (...a: unknown[]) => api.listFavourites(...a),
}));

function fav(id: string, title: string, when: "past" | "future"): FavouriteEvent {
  const startsAt = when === "past" ? "2020-03-06T09:00:00.000Z" : "2099-03-06T09:00:00.000Z";
  return {
    organiserId: "org-1",
    eventId: id,
    slug: id,
    title,
    description: "d",
    category: "art",
    venueName: "Venue",
    venueAddress: "1 St",
    suburb: "Fitzroy",
    startsAt,
    endsAt: startsAt,
    organiserName: "Org",
    ticketTypes: [{ id: "t", name: "GA", priceCents: 0, feePolicy: "buyer-pays", quantityAvailable: 10 }],
    favouritedAt: "2026-10-01T00:00:00.000Z",
  };
}

beforeEach(() => {
  for (const fn of Object.values(api)) fn.mockReset();
  api.removeFavourite.mockResolvedValue({ eventId: "x", favourited: false });
  api.addFavourite.mockResolvedValue({ eventId: "x", favourited: true });
  localStorage.clear();
});
afterEach(cleanup);

function renderSaved(auth: AuthContextValue = fakeAuthValue()) {
  return render(
    <FakeAuthProvider value={auth}>
      <FavouritesProvider>
        <h1>Saved</h1>
        <SavedPageContent />
      </FavouritesProvider>
    </FakeAuthProvider>,
  );
}

function live(items: FavouriteEvent[], nextCursor?: string) {
  api.listFavouriteIds.mockResolvedValue({ eventIds: items.map((i) => i.eventId) });
  api.listFavourites.mockResolvedValue({ items, nextCursor });
}

describe("/saved — live", () => {
  it("auth loading: Loading…, no requests", () => {
    renderSaved(fakeAuthValue({ status: "loading" }));
    expect(screen.getByText("Loading…")).toBeInTheDocument();
    expect(api.listFavourites).not.toHaveBeenCalled();
  });

  it("signed out: asks to sign in, back to /saved", () => {
    renderSaved(fakeAuthValue({ status: "signed-out", email: undefined }));
    expect(screen.getByText("Sign in to see your saved events")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Sign in" })).toHaveAttribute("href", "/login?next=%2Fsaved");
    expect(api.listFavourites).not.toHaveBeenCalled();
  });

  it("loading the list is a busy region", () => {
    api.listFavouriteIds.mockImplementation(() => new Promise(() => {}));
    api.listFavourites.mockImplementation(() => new Promise(() => {}));
    renderSaved();
    const loading = screen.getByText("Loading your saved events…");
    expect(loading.closest("[aria-busy='true']")).not.toBeNull();
    expect(api.listFavourites).toHaveBeenCalledWith(expect.any(Function), { limit: 48 });
  });

  it("a load error is an alert with Try again, which reloads", async () => {
    api.listFavouriteIds.mockResolvedValue({ eventIds: [] });
    api.listFavourites.mockRejectedValueOnce(new ApiError(500, "down")).mockResolvedValue({ items: [] });
    renderSaved();
    expect(await screen.findByRole("alert")).toHaveTextContent("Couldn’t load your saved events.");
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByText("Nothing saved yet")).toBeInTheDocument();
    expect(api.listFavourites).toHaveBeenCalledTimes(2);
  });

  it("empty: invites browsing", async () => {
    live([]);
    renderSaved();
    expect(await screen.findByText("Nothing saved yet")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Browse events" })).toHaveAttribute("href", "/events");
  });

  it("splits coming up (tiles) from past events (rows), keeping the API's newest-saved order", async () => {
    live([fav("b", "Future B", "future"), fav("p", "Past P", "past"), fav("a", "Future A", "future")]);
    renderSaved();
    const upcoming = await screen.findByRole("region", { name: "Coming up" });
    expect(within(upcoming).getAllByRole("heading", { level: 3 }).map((h) => h.textContent)).toEqual(["Future B", "Future A"]);
    const past = screen.getByRole("region", { name: "Past events" });
    expect(within(past).getByRole("link", { name: "Past P" })).toHaveAttribute("href", "/events/p");
    expect(within(past).getByText(/· Ended$/)).toBeInTheDocument();
    expect(screen.getByText("3 saved")).toBeInTheDocument();
  });

  it("only past events: says nothing's coming up", async () => {
    live([fav("p", "Past P", "past")]);
    renderSaved();
    expect(await screen.findByText("Nothing coming up. Your past events are below.")).toBeInTheDocument();
  });

  it("shows '{n} of 500' near the cap", async () => {
    const items = [fav("a", "Future A", "future")];
    api.listFavouriteIds.mockResolvedValue({ eventIds: Array.from({ length: 460 }, (_, i) => `e${i}`) });
    api.listFavourites.mockResolvedValue({ items, nextCursor: "c" });
    renderSaved();
    expect(await screen.findByText("460 of 500 saved")).toBeInTheDocument();
  });

  it("unsaving a coming-up tile leaves it in place", async () => {
    live([fav("a", "Future A", "future")]);
    renderSaved();
    const heart = await screen.findByRole("button", { name: "Save Future A" });
    await waitFor(() => expect(heart).toHaveAttribute("aria-pressed", "true"));
    fireEvent.click(heart);
    await act(async () => {});
    expect(screen.getByRole("heading", { level: 3, name: "Future A" })).toBeInTheDocument();
    expect(heart).toHaveAttribute("aria-pressed", "false");
  });

  it("removing a past row deletes it and moves focus to the next row's Remove, then the heading", async () => {
    live([fav("p1", "Past One", "past"), fav("p2", "Past Two", "past")]);
    renderSaved();
    const first = await screen.findByRole("button", { name: "Remove Past One" });
    await waitFor(() => expect(first).not.toHaveAttribute("aria-disabled"));
    fireEvent.click(first);
    await waitFor(() => expect(screen.queryByRole("link", { name: "Past One" })).toBeNull());
    const second = screen.getByRole("button", { name: "Remove Past Two" });
    expect(second).toHaveFocus();
    expect(api.removeFavourite).toHaveBeenCalledWith("p1", expect.any(Function));
    fireEvent.click(second);
    await waitFor(() => expect(screen.queryByRole("link", { name: "Past Two" })).toBeNull());
    expect(screen.getByRole("heading", { name: "Past events" })).toHaveFocus();
  });

  it("a failed past removal keeps the row, says so, and re-enables Remove", async () => {
    live([fav("p1", "Past One", "past")]);
    api.removeFavourite.mockRejectedValueOnce(new ApiError(500, "down"));
    renderSaved();
    const remove = await screen.findByRole("button", { name: "Remove Past One" });
    await waitFor(() => expect(remove).not.toHaveAttribute("aria-disabled"));
    fireEvent.click(remove);
    expect(await screen.findByText("Couldn’t remove it. Try again.")).toHaveAttribute("role", "alert");
    expect(screen.getByRole("link", { name: "Past One" })).toBeInTheDocument();
    expect(remove).not.toHaveAttribute("aria-disabled");
    // The provider's bar isn't used for these rows.
    expect(document.querySelector("[data-favourites-notice]")).toBeNull();
  });

  it("Load more appends the next page (48 at a time) and shows its own error", async () => {
    live([fav("a", "Future A", "future")], "cursor-2");
    renderSaved();
    const more = await screen.findByRole("button", { name: "Load more" });
    api.listFavourites.mockRejectedValueOnce(new ApiError(0, "offline"));
    fireEvent.click(more);
    expect(await screen.findByText("Couldn’t load more. Try again.")).toBeInTheDocument();
    api.listFavourites.mockResolvedValueOnce({ items: [fav("b", "Future B", "future")] });
    fireEvent.click(screen.getByRole("button", { name: "Load more" }));
    expect(await screen.findByRole("heading", { level: 3, name: "Future B" })).toBeInTheDocument();
    expect(api.listFavourites).toHaveBeenLastCalledWith(expect.any(Function), { cursor: "cursor-2", limit: 48 });
    expect(screen.queryByRole("button", { name: "Load more" })).toBeNull();
  });
});

describe("/saved — demo", () => {
  const demo = () => fakeAuthValue({ configured: false, status: "signed-out", email: undefined });

  it("lists this browser's saved sample events and never calls the API", async () => {
    const [a, b] = sampleEvents;
    localStorage.setItem(SAVED_STORAGE_KEY, JSON.stringify({ ids: [b.id, "unknown-id", a.id] }));
    renderSaved(demo());
    expect(await screen.findByText("Saved on this device only. Nothing leaves your browser.")).toBeInTheDocument();
    expect(await screen.findByText("3 saved")).toBeInTheDocument();
    expect(screen.getAllByText(a.title).length).toBeGreaterThan(0);
    expect(screen.getAllByText(b.title).length).toBeGreaterThan(0);
    for (const fn of Object.values(api)) expect(fn).not.toHaveBeenCalled();
  });

  it("empty in demo too", async () => {
    renderSaved(demo());
    expect(await screen.findByText("Nothing saved yet")).toBeInTheDocument();
  });
});
