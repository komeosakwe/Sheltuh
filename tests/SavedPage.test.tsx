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
    expect(screen.getByRole("progressbar", { name: "Loading" })).toBeInTheDocument();
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
    const loading = screen.getByRole("progressbar", { name: "Loading your saved events" });
    expect(loading.closest("[aria-busy='true']")).not.toBeNull();
    expect(api.listFavourites).toHaveBeenCalledWith(expect.any(Function), { limit: 50 });
  });

  it("a load error is an alert with Try again, which reloads", async () => {
    api.listFavouriteIds.mockResolvedValue({ eventIds: [] });
    api.listFavourites.mockRejectedValueOnce(new ApiError(500, "down")).mockResolvedValue({ items: [] });
    renderSaved();
    expect(await screen.findByRole("alert")).toHaveTextContent("Couldn’t load your saved events.");
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByText(/^Nothing saved yet\./)).toBeInTheDocument();
    expect(api.listFavourites).toHaveBeenCalledTimes(2);
  });

  it("empty: one line and a link to Discover", async () => {
    live([]);
    renderSaved();
    expect(await screen.findByText(/^Nothing saved yet\./)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Discover events" })).toHaveAttribute("href", "/");
    expect(screen.queryByRole("group", { name: "Filter saved events" })).toBeNull();
  });

  it("splits coming up (tiles) from past events (rows), keeping the API's newest-saved order", async () => {
    live([fav("b", "Future B", "future"), fav("p", "Past P", "past"), fav("a", "Future A", "future")]);
    renderSaved();
    const upcoming = await screen.findByRole("region", { name: "Coming up" });
    expect(within(upcoming).getAllByRole("heading", { level: 3 }).map((h) => h.textContent)).toEqual(["Future B", "Future A"]);
    const past = screen.getByRole("region", { name: "Past events" });
    expect(within(past).getByRole("link", { name: "Past P" })).toHaveAttribute("href", "/events/p");
    expect(within(past).getByText(/· Ended$/)).toBeInTheDocument();
    // The filters count the cards coming up: both (the ended one is listed below), none this week
    // (2099), both free.
    const filters = screen.getByRole("group", { name: "Filter saved events" });
    expect(within(filters).getAllByRole("button").map((b) => b.textContent)).toEqual([
      "All\u00a0·, 2",
      "This week\u00a0·, 0",
      "Free\u00a0·, 2",
    ]);
    expect(within(filters).getByRole("button", { name: "All, 2" })).toHaveAttribute("aria-pressed", "true");
  });

  it("shows six cards at a time, then 'Show 6 more' (focus to the first new card)", async () => {
    live(Array.from({ length: 14 }, (_, i) => fav(`e${i}`, `Event ${i}`, "future")));
    renderSaved();
    const upcoming = await screen.findByRole("region", { name: "Coming up" });
    expect(within(upcoming).getAllByRole("heading", { level: 3 })).toHaveLength(6);
    fireEvent.click(screen.getByRole("button", { name: "Show 6 more" }));
    expect(within(upcoming).getAllByRole("heading", { level: 3 })).toHaveLength(12);
    expect(screen.getByRole("link", { name: "Event 6" })).toHaveFocus();
    expect(screen.getByText("6 more shown: 12 of 14 events.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Show 2 more" }));
    expect(within(upcoming).getAllByRole("heading", { level: 3 })).toHaveLength(14);
    expect(screen.getByText("2 more shown: 14 of 14 events.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Show/ })).toBeNull();
  });

  it("announces each Show 6 more, even when it adds as many as the last (the running total)", async () => {
    live(Array.from({ length: 20 }, (_, i) => fav(`e${i}`, `Event ${i}`, "future")));
    renderSaved();
    await screen.findByRole("region", { name: "Coming up" });
    fireEvent.click(screen.getByRole("button", { name: "Show 6 more" }));
    expect(screen.getByText("6 more shown: 12 of 20 events.")).toHaveAttribute("role", "status");
    fireEvent.click(screen.getByRole("button", { name: "Show 6 more" }));
    expect(screen.getByText("6 more shown: 18 of 20 events.")).toHaveAttribute("role", "status");
  });

  it("counts an event sold on another site as free when its organiser says entry is free", async () => {
    const outside: FavouriteEvent = { ...fav("x", "Free Outside", "future"), ticketingMode: "external", externalFree: true, ticketTypes: [] };
    const outsidePaid: FavouriteEvent = {
      ...fav("y", "Paid Outside", "future"),
      ticketingMode: "external",
      externalPriceFromCents: 2000,
      ticketTypes: [],
    };
    live([outside, outsidePaid]);
    renderSaved();
    const filters = await screen.findByRole("group", { name: "Filter saved events" });
    fireEvent.click(within(filters).getByRole("button", { name: "Free, 1" }));
    const upcoming = screen.getByRole("region", { name: "Coming up" });
    expect(within(upcoming).getAllByRole("heading", { level: 3 }).map((h) => h.textContent)).toEqual(["Free Outside"]);
  });

  it("shows a failed page with Try again beside Show 6 more; Try again keeps focus on a control and says when it's done", async () => {
    const first = Array.from({ length: 10 }, (_, i) => fav(`e${i}`, `Event ${i}`, "future"));
    api.listFavouriteIds.mockResolvedValue({ eventIds: [...first.map((e) => e.eventId), "late"] });
    api.listFavourites
      .mockResolvedValueOnce({ items: first, nextCursor: "cursor-2" })
      .mockRejectedValueOnce(new ApiError(0, "offline"))
      .mockResolvedValueOnce({ items: [fav("late", "Late One", "future")] });
    renderSaved();
    expect(await screen.findByText("Couldn’t load all your saved events.")).toHaveAttribute("role", "alert");
    // Both at once: the cards still to show, and the page that failed.
    expect(screen.getByRole("button", { name: "Show 4 more" })).toBeInTheDocument();
    const retry = screen.getByRole("button", { name: "Try again" });
    retry.focus();
    fireEvent.click(retry);
    // The button goes; focus moves to the filter in use rather than dropping to the page.
    expect(screen.getByRole("button", { name: /^All/ })).toHaveFocus();
    expect(await screen.findByText("All 11 saved events loaded.")).toHaveAttribute("role", "status");
    expect(screen.queryByText("Couldn’t load all your saved events.")).toBeNull();
  });

  it("filters by free and by this week", async () => {
    const soon = { ...fav("s", "Soon Paid", "future"), startsAt: new Date(Date.now() + 2 * 86_400_000).toISOString() };
    soon.endsAt = soon.startsAt;
    soon.ticketTypes = [{ id: "t", name: "GA", priceCents: 2000, feePolicy: "buyer-pays", quantityAvailable: 10 }];
    live([soon, fav("f", "Later Free", "future")]);
    renderSaved();
    const filters = await screen.findByRole("group", { name: "Filter saved events" });
    const upcoming = screen.getByRole("region", { name: "Coming up" });
    fireEvent.click(within(filters).getByRole("button", { name: "Free, 1" }));
    expect(within(upcoming).getAllByRole("heading", { level: 3 }).map((h) => h.textContent)).toEqual(["Later Free"]);
    expect(within(filters).getByRole("button", { name: "Free, 1" })).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(within(filters).getByRole("button", { name: "This week, 1" }));
    expect(within(upcoming).getAllByRole("heading", { level: 3 }).map((h) => h.textContent)).toEqual(["Soon Paid"]);
  });

  it("only past events: says nothing's coming up", async () => {
    live([fav("p", "Past P", "past")]);
    renderSaved();
    expect(await screen.findByText("Nothing coming up.")).toBeInTheDocument();
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

  it("loads the rest of the list (50 at a time) so the filters count all of it: a free event saved long ago counts", async () => {
    // 60 saves: the first page is 48 paid events, the second has the only free one.
    const paid = (i: number) => {
      const event = fav(`p${i}`, `Paid ${i}`, "future");
      event.ticketTypes = [{ id: "t", name: "GA", priceCents: 2000, feePolicy: "buyer-pays", quantityAvailable: 10 }];
      return event;
    };
    const first = Array.from({ length: 48 }, (_, i) => paid(i));
    const second = [...Array.from({ length: 11 }, (_, i) => paid(48 + i)), fav("free-old", "Free From Long Ago", "future")];
    api.listFavouriteIds.mockResolvedValue({ eventIds: [...first, ...second].map((e) => e.eventId) });
    let resolveSecond: (page: { items: FavouriteEvent[] }) => void = () => undefined;
    api.listFavourites
      .mockResolvedValueOnce({ items: first, nextCursor: "cursor-2" })
      .mockReturnValueOnce(new Promise((resolve) => (resolveSecond = resolve)));
    renderSaved();
    const filters = await screen.findByRole("group", { name: "Filter saved events" });
    // Until the whole list is in, This week and Free show no number, and Free says nothing definite.
    expect(within(filters).getByRole("button", { name: "Free" })).toBeInTheDocument();
    expect(within(filters).getByRole("button", { name: "All, 60" })).toBeInTheDocument();
    fireEvent.click(within(filters).getByRole("button", { name: "Free" }));
    expect(screen.queryByText("No free events saved.")).toBeNull();
    expect(screen.getByRole("progressbar", { name: "Loading the rest of your saved events" })).toBeInTheDocument();
    expect(api.listFavourites).toHaveBeenLastCalledWith(expect.any(Function), { cursor: "cursor-2", limit: 50 });

    resolveSecond({ items: second });
    expect(await within(filters).findByRole("button", { name: "Free, 1" })).toHaveAttribute("aria-pressed", "true");
    const upcoming = screen.getByRole("region", { name: "Coming up" });
    expect(within(upcoming).getAllByRole("heading", { level: 3 }).map((h) => h.textContent)).toEqual(["Free From Long Ago"]);
    expect(within(filters).getByRole("button", { name: "This week, 0" })).toBeInTheDocument();
    expect(screen.queryByRole("progressbar", { name: "Loading the rest of your saved events" })).toBeNull();
    expect(api.listFavourites).toHaveBeenCalledTimes(2);
  });

  it("says when the rest of the list couldn't load, and Try again carries on from there", async () => {
    live([fav("a", "Future A", "future")], "cursor-2");
    api.listFavourites
      .mockResolvedValueOnce({ items: [fav("a", "Future A", "future")], nextCursor: "cursor-2" })
      .mockRejectedValueOnce(new ApiError(0, "offline"))
      .mockResolvedValueOnce({ items: [fav("b", "Future B", "future")] });
    renderSaved();
    expect(await screen.findByText("Couldn’t load all your saved events.")).toHaveAttribute("role", "alert");
    const filters = screen.getByRole("group", { name: "Filter saved events" });
    fireEvent.click(within(filters).getByRole("button", { name: "Free" }));
    // Nothing definite while part of the list is missing.
    expect(screen.queryByText("No free events saved.")).toBeNull();
    fireEvent.click(within(filters).getByRole("button", { name: /^All/ }));
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByRole("heading", { level: 3, name: "Future B" })).toBeInTheDocument();
    expect(api.listFavourites).toHaveBeenLastCalledWith(expect.any(Function), { cursor: "cursor-2", limit: 50 });
    expect(screen.queryByText("Couldn’t load all your saved events.")).toBeNull();
    expect(within(filters).getByRole("button", { name: "Free, 2" })).toBeInTheDocument();
  });
});

describe("/saved — live, a first page with nothing on it", () => {
  it("isn't 'Nothing saved' while more pages follow: a failed next page keeps the loading's error and Try again", async () => {
    api.listFavouriteIds.mockResolvedValue({ eventIds: ["b"] });
    api.listFavourites
      .mockResolvedValueOnce({ items: [], nextCursor: "cursor-2" })
      .mockRejectedValueOnce(new ApiError(0, "offline"))
      .mockResolvedValueOnce({ items: [fav("b", "Future B", "future")] });
    renderSaved();
    expect(await screen.findByText("Couldn’t load all your saved events.")).toHaveAttribute("role", "alert");
    expect(screen.queryByText(/^Nothing saved yet\./)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByRole("heading", { level: 3, name: "Future B" })).toBeInTheDocument();
    expect(api.listFavourites).toHaveBeenLastCalledWith(expect.any(Function), { cursor: "cursor-2", limit: 50 });
    expect(screen.queryByText(/^Nothing saved yet\./)).toBeNull();
  });

  it("shows the rest's loading, not 'Nothing saved', while the next page loads", async () => {
    api.listFavouriteIds.mockResolvedValue({ eventIds: ["b"] });
    api.listFavourites.mockResolvedValueOnce({ items: [], nextCursor: "cursor-2" }).mockReturnValueOnce(new Promise(() => {}));
    renderSaved();
    expect(await screen.findByRole("progressbar", { name: "Loading the rest of your saved events" })).toBeInTheDocument();
    expect(screen.queryByText(/^Nothing saved yet\./)).toBeNull();
  });
});

describe("/saved — live, when the list changes while the rest of it loads", () => {
  it("starts the walk again after an unsave, so the event that moved up a page isn't skipped", async () => {
    // The API pages by offset (two per page here): unsaving A moves every later event up one place.
    let server = ["a", "b", "c", "d", "e"].map((id) => fav(id, `Future ${id.toUpperCase()}`, "future"));
    const pageAt = (offset: number) => ({
      items: server.slice(offset, offset + 2),
      nextCursor: offset + 2 < server.length ? String(offset + 2) : undefined,
    });
    api.listFavouriteIds.mockResolvedValue({ eventIds: server.map((e) => e.eventId) });
    api.removeFavourite.mockImplementation((id: string) => {
      server = server.filter((e) => e.eventId !== id);
      return Promise.resolve({ eventId: id, favourited: false });
    });
    // The first request for the second page is answered only after the unsave (as a slow request
    // the server handles after it): from the shorter list, so it starts at D.
    let releaseHeld: () => void = () => undefined;
    let held = true;
    api.listFavourites.mockImplementation((_token: unknown, page: { cursor?: string }) => {
      const offset = Number(page.cursor ?? 0);
      if (offset === 2 && held) {
        held = false;
        return new Promise((resolve) => (releaseHeld = () => resolve(pageAt(offset))));
      }
      return Promise.resolve(pageAt(offset));
    });
    renderSaved();
    const heart = await screen.findByRole("button", { name: "Save Future A" });
    await waitFor(() => expect(heart).toHaveAttribute("aria-pressed", "true"));
    await waitFor(() => expect(api.listFavourites).toHaveBeenCalledWith(expect.any(Function), { cursor: "2", limit: 50 }));
    fireEvent.click(heart);
    await waitFor(() => expect(api.removeFavourite).toHaveBeenCalled());
    await act(async () => {});
    releaseHeld();
    const filters = screen.getByRole("group", { name: "Filter saved events" });
    // All in: B to E, and A still in place (unsaving leaves the card until the next load).
    expect(await within(filters).findByRole("button", { name: "Free, 5" })).toBeInTheDocument();
    expect(within(filters).getByRole("button", { name: "All, 5" })).toBeInTheDocument();
    const upcoming = screen.getByRole("region", { name: "Coming up" });
    expect(within(upcoming).getAllByRole("heading", { level: 3 }).map((h) => h.textContent)).toEqual([
      "Future A",
      "Future B",
      "Future C",
      "Future D",
      "Future E",
    ]);
    // Started again from the first page after the unsave.
    expect(api.listFavourites.mock.calls.filter((call) => !(call[1] as { cursor?: string }).cursor).length).toBeGreaterThanOrEqual(2);
  });
});

describe("/saved — demo", () => {
  const demo = () => fakeAuthValue({ configured: false, status: "signed-out", email: undefined });

  it("lists this browser's saved sample events and never calls the API", async () => {
    const [a, b] = sampleEvents;
    localStorage.setItem(SAVED_STORAGE_KEY, JSON.stringify({ ids: [b.id, "unknown-id", a.id] }));
    renderSaved(demo());
    expect(await screen.findByText("Saved on this device only.")).toBeInTheDocument();
    // All counts the cards coming up: the known events that haven't ended (the unknown id has no card).
    const upcoming = [a, b].filter((event) => new Date(event.endsAt ?? event.startsAt).getTime() >= Date.now()).length;
    expect(await screen.findByRole("button", { name: `All, ${upcoming}` })).toBeInTheDocument();
    expect(screen.getAllByText(a.title).length).toBeGreaterThan(0);
    expect(screen.getAllByText(b.title).length).toBeGreaterThan(0);
    for (const fn of Object.values(api)) expect(fn).not.toHaveBeenCalled();
  });

  it("empty in demo too", async () => {
    renderSaved(demo());
    expect(await screen.findByText(/^Nothing saved yet\./)).toBeInTheDocument();
  });
});
