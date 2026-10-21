// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { Suspense } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FavouritesProvider } from "@/components/favourites/FavouritesProvider";
import SaveOnReturn, { pathWithoutSave } from "@/components/favourites/SaveOnReturn";
import type { AuthContextValue } from "@/lib/auth/AuthContext";
import { fakeAuthValue, FakeAuthProvider } from "./test-utils/fakeAuth";

let pathname = "/events/night-market";
let search = "save=1";
const replace = vi.fn();
vi.mock("next/navigation", () => ({
  usePathname: () => pathname,
  useRouter: () => ({ replace, push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(search),
}));

const api = { listFavouriteIds: vi.fn(), addFavourite: vi.fn(), removeFavourite: vi.fn(), listFavourites: vi.fn() };
vi.mock("@/lib/api/favourites", () => ({
  listFavouriteIds: (...a: unknown[]) => api.listFavouriteIds(...a),
  addFavourite: (...a: unknown[]) => api.addFavourite(...a),
  removeFavourite: (...a: unknown[]) => api.removeFavourite(...a),
  listFavourites: (...a: unknown[]) => api.listFavourites(...a),
}));

const EVENT = { id: "evt-1", title: "Night Market", slug: "night-market" };

beforeEach(() => {
  pathname = "/events/night-market";
  search = "save=1";
  replace.mockReset();
  for (const fn of Object.values(api)) fn.mockReset();
  api.listFavouriteIds.mockResolvedValue({ eventIds: [] });
  api.addFavourite.mockResolvedValue({ eventId: "evt-1", favourited: true });
  api.removeFavourite.mockResolvedValue({ eventId: "evt-1", favourited: false });
});
afterEach(cleanup);

function renderReturn(auth: AuthContextValue = fakeAuthValue()) {
  return render(
    <FakeAuthProvider value={auth}>
      <FavouritesProvider>
        <Suspense fallback={null}>
          <SaveOnReturn event={EVENT} />
        </Suspense>
      </FavouritesProvider>
    </FakeAuthProvider>,
  );
}

const bar = () => document.querySelector<HTMLElement>("[data-favourites-notice]");

describe("SaveOnReturn (?save=1 after signing in)", () => {
  it("saves this page's own event once, shows Saved with Undo, and drops save from the URL", async () => {
    search = "save=1&ref=ab3def7h";
    renderReturn();
    await waitFor(() => expect(api.addFavourite).toHaveBeenCalledTimes(1));
    expect(api.addFavourite).toHaveBeenCalledWith("evt-1", expect.any(Function));
    expect(replace).toHaveBeenCalledWith("/events/night-market?ref=ab3def7h", { scroll: false });
    await waitFor(() => expect(bar()).toHaveTextContent("Saved Night Market."));
    expect(screen.getByRole("link", { name: "View saved" })).toHaveAttribute("href", "/saved");
    screen.getByRole("button", { name: "Undo" }).click();
    await waitFor(() => expect(api.removeFavourite).toHaveBeenCalledWith("evt-1", expect.any(Function)));
  });

  it("already saved: no request, but still confirms", async () => {
    api.listFavouriteIds.mockResolvedValue({ eventIds: ["evt-1"] });
    renderReturn();
    await waitFor(() => expect(bar()).toHaveTextContent("Saved Night Market."));
    expect(api.addFavourite).not.toHaveBeenCalled();
  });

  it("does nothing while signed out", async () => {
    renderReturn(fakeAuthValue({ status: "signed-out", email: undefined }));
    await new Promise((r) => setTimeout(r, 0));
    expect(api.addFavourite).not.toHaveBeenCalled();
    expect(replace).not.toHaveBeenCalled();
  });

  it("does nothing without save=1", async () => {
    search = "";
    renderReturn();
    await waitFor(() => expect(api.listFavouriteIds).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 0));
    expect(api.addFavourite).not.toHaveBeenCalled();
  });

  it("only acts on the event's own page", async () => {
    pathname = "/events/someone-elses-event";
    renderReturn();
    await waitFor(() => expect(api.listFavouriteIds).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 0));
    expect(api.addFavourite).not.toHaveBeenCalled();
  });

  it("demo mode ignores it (hearts there never go to sign in)", async () => {
    renderReturn(fakeAuthValue({ configured: false, status: "signed-out" }));
    await new Promise((r) => setTimeout(r, 0));
    expect(api.addFavourite).not.toHaveBeenCalled();
    expect(replace).not.toHaveBeenCalled();
  });
});

describe("pathWithoutSave", () => {
  it("keeps other params and returns only a same-site path", () => {
    expect(pathWithoutSave("/events/x", new URLSearchParams("save=1"))).toBe("/events/x");
    expect(pathWithoutSave("/events/x", new URLSearchParams("save=1&ref=ab3def7h"))).toBe("/events/x?ref=ab3def7h");
    expect(pathWithoutSave("//evil.example", new URLSearchParams("save=1"))).toBeNull();
  });
});
