// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import OrganiserApplyPage from "@/app/organisers/apply/page";
import { NavAccountProvider } from "@/components/nav/useNavAccount";
import type { OrganiserStatus } from "@/lib/api/types";
import type { AuthContextValue } from "@/lib/auth/AuthContext";
import { FakeAuthProvider, fakeAuthValue } from "./test-utils/fakeAuth";

/**
 * /organisers/apply for an approved organiser, inside the root layout's NavAccountProvider (as
 * every page is): "Opening your dashboard…" instead of the page while the record loads for an
 * account this browser last showed the organiser frame, then on to /dashboard. The hint is only a
 * hint: the record decides, and nobody signed out ever loses the page.
 */

const routerReplace = vi.fn();
const routerPrefetch = vi.fn();
vi.mock("next/navigation", () => ({
  usePathname: () => "/organisers/apply",
  useRouter: () => ({ replace: routerReplace, prefetch: routerPrefetch, push: vi.fn() }),
}));

type Load = { loading: boolean; organiser: { status: OrganiserStatus } | null; error: string | null };
// One record for the whole page, as the nav's and the panel's own loads of it would agree; unless
// `panelLoad` is set, for the panel's own (ApplyPageContent's) when the two disagree.
let load: Load;
let panelLoad: Load | null = null;
vi.mock("@/lib/auth/useOrganiser", () => ({
  useOrganiser: () => {
    const fromPanel = panelLoad !== null && /ApplyPageContent/.test(new Error().stack ?? "");
    return { ...(fromPanel && panelLoad ? panelLoad : load), refreshing: false, refetch: vi.fn(), authStatus: "signed-in" };
  },
}));

const USER_ID = "user-org";
const HINT_KEY = "sheltuh:organiser-frame";

beforeEach(() => {
  load = { loading: true, organiser: null, error: null };
  panelLoad = null;
});

afterEach(() => {
  cleanup();
  localStorage.clear();
  routerReplace.mockClear();
  routerPrefetch.mockClear();
});

function page(auth: AuthContextValue) {
  return (
    <FakeAuthProvider value={auth}>
      <NavAccountProvider>
        <OrganiserApplyPage />
      </NavAccountProvider>
    </FakeAuthProvider>
  );
}

const signedIn = () => fakeAuthValue({ userId: USER_ID });
const opening = () => screen.queryByRole("progressbar", { name: "Opening your dashboard" });
const hero = () => screen.queryByRole("heading", { level: 1, name: "Your event. Your community." });

describe("/organisers/apply for an organiser this browser knows", () => {
  it("shows Opening your dashboard… instead of the page while the record loads, then goes on to /dashboard", () => {
    localStorage.setItem(HINT_KEY, USER_ID);
    const { container, rerender } = render(page(signedIn()));
    expect(opening()).toBeInTheDocument();
    // Its own heading (visually hidden) and a polite status saying what's happening.
    expect(screen.getByRole("heading", { level: 1, name: "Opening your dashboard" })).toHaveClass("sr-only");
    expect(screen.getByRole("status")).toHaveTextContent("Opening your dashboard…");
    // The page is there, hidden, so a stale hint costs nothing.
    expect(hero()).toBeNull();
    expect(container.querySelector("[hidden] h1")).toHaveTextContent("Your event. Your community.");
    expect(screen.queryByRole("link", { name: "Go to your dashboard" })).toBeNull();
    expect(routerReplace).not.toHaveBeenCalled();
    expect(routerPrefetch).toHaveBeenCalledWith("/dashboard");

    load = { loading: false, organiser: { status: "approved" }, error: null };
    rerender(page(signedIn()));
    expect(opening()).toBeInTheDocument();
    expect(hero()).toBeNull();
    expect(routerReplace).toHaveBeenCalledTimes(1);
    expect(routerReplace).toHaveBeenCalledWith("/dashboard");
    // A way on if the redirect is slow or blocked.
    expect(screen.getByRole("link", { name: "Go to your dashboard" })).toHaveAttribute("href", "/dashboard");
  });

  it("an approved organiser without the hint also gets the loader once the record says so, and is sent on", () => {
    const { rerender } = render(page(signedIn()));
    expect(opening()).toBeNull();
    expect(hero()).toBeVisible();
    load = { loading: false, organiser: { status: "approved" }, error: null };
    rerender(page(signedIn()));
    expect(opening()).toBeInTheDocument();
    expect(hero()).toBeNull();
    expect(routerReplace).toHaveBeenCalledWith("/dashboard");
  });

  it("the hint is only a hint: a record that isn't approved shows the page, and stays put", () => {
    localStorage.setItem(HINT_KEY, USER_ID);
    const { rerender } = render(page(signedIn()));
    expect(opening()).toBeInTheDocument();
    load = { loading: false, organiser: { status: "pending" }, error: null };
    rerender(page(signedIn()));
    expect(opening()).toBeNull();
    expect(hero()).toBeVisible();
    expect(screen.getByRole("heading", { level: 2, name: "Application pending" })).toBeVisible();
    expect(routerReplace).not.toHaveBeenCalled();
  });

  it("a record that fails to load shows the page with its error, not an endless loader", () => {
    localStorage.setItem(HINT_KEY, USER_ID);
    load = { loading: false, organiser: null, error: "Couldn't load your organiser status." };
    render(page(signedIn()));
    expect(opening()).toBeNull();
    expect(hero()).toBeVisible();
    expect(screen.getByRole("alert")).toHaveTextContent("Couldn't load your organiser status.");
  });

  it("never hides the page from someone signed out, still signing in, or with another account's hint", () => {
    localStorage.setItem(HINT_KEY, USER_ID);
    for (const auth of [
      fakeAuthValue({ status: "signed-out", email: undefined, accessToken: undefined, userId: undefined }),
      fakeAuthValue({ status: "loading", userId: undefined }),
      fakeAuthValue({ userId: "user-other" }),
    ]) {
      render(page(auth));
      expect(opening()).toBeNull();
      expect(hero()).toBeVisible();
      cleanup();
    }
    expect(routerReplace).not.toHaveBeenCalled();
  });

  describe("when the nav's record and the panel's own disagree", () => {
    it("the panel's load failing while the nav's still loads (hinted): the page, with its error and Try again", () => {
      localStorage.setItem(HINT_KEY, USER_ID);
      panelLoad = { loading: false, organiser: null, error: "Couldn't load your organiser status." };
      render(page(signedIn()));
      expect(opening()).toBeNull();
      expect(hero()).toBeVisible();
      expect(screen.getByRole("alert")).toHaveTextContent("Couldn't load your organiser status.");
      expect(screen.getByRole("button", { name: "Try again" })).toBeVisible();
      expect(routerReplace).not.toHaveBeenCalled();
    });

    it("the nav's says approved while the panel's still loads: sent on by the nav's, once, still covered", () => {
      load = { loading: false, organiser: { status: "approved" }, error: null };
      panelLoad = { loading: true, organiser: null, error: null };
      const { rerender } = render(page(signedIn()));
      expect(opening()).toBeInTheDocument();
      expect(hero()).toBeNull();
      expect(routerReplace).toHaveBeenCalledTimes(1);
      expect(routerReplace).toHaveBeenCalledWith("/dashboard");
      // The panel's then agrees: no second redirect.
      panelLoad = { loading: false, organiser: { status: "approved" }, error: null };
      rerender(page(signedIn()));
      expect(routerReplace).toHaveBeenCalledTimes(1);
    });

    it("the nav's says approved but the panel's fails: still sent on, never a flash of the page", () => {
      load = { loading: false, organiser: { status: "approved" }, error: null };
      panelLoad = { loading: false, organiser: null, error: "Couldn't load your organiser status." };
      render(page(signedIn()));
      expect(opening()).toBeInTheDocument();
      expect(hero()).toBeNull();
      expect(routerReplace).toHaveBeenCalledTimes(1);
    });

    it("the panel's says approved while the nav's still loads (hinted): the panel sends them on, once", () => {
      localStorage.setItem(HINT_KEY, USER_ID);
      panelLoad = { loading: false, organiser: { status: "approved" }, error: null };
      const { rerender } = render(page(signedIn()));
      expect(opening()).toBeInTheDocument();
      expect(routerReplace).toHaveBeenCalledTimes(1);
      load = { loading: false, organiser: { status: "approved" }, error: null };
      rerender(page(signedIn()));
      expect(routerReplace).toHaveBeenCalledTimes(1);
    });
  });
});
