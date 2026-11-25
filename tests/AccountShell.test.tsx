// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import AccountShell from "@/components/account/AccountShell";
import AccountTabs from "@/components/account/AccountTabs";
import Nav from "@/components/Nav";
import { NavAccountProvider } from "@/components/nav/useNavAccount";
import type { AccountNavItem } from "@/components/account/useAccountNav";
import type { AccountSummary, ProfileRecord } from "@/lib/api/types";
import type { AuthContextValue } from "@/lib/auth/AuthContext";
import type { ProfileState } from "@/lib/auth/useProfile";
import { fakeAuthValue, FakeAuthProvider } from "./test-utils/fakeAuth";

/**
 * The account area's frame (Latte's 1120 frames): the desktop sidebar and the tablet / mobile
 * Account tabs row. Both are navs of links with aria-current on the page you're on (not ARIA tabs),
 * in the order Profile · My tickets · Saved · Messages · Settings, with the counts read as part of
 * each link's name. The counts' sources are stubbed at their hooks and GET /api/me.
 */

let pathname = "/saved";
const push = vi.fn();
vi.mock("next/navigation", () => ({
  usePathname: () => pathname,
  useRouter: () => ({ push }),
}));

vi.mock("@/lib/api/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api/client")>()),
  isApiConfigured: true,
}));

const getMe = vi.fn<() => Promise<AccountSummary>>();
vi.mock("@/lib/api/me", () => ({ getMe: () => getMe() }));

let profileState: ProfileState = { status: "loading" };
/** How many of each loader are mounted (each one fetches): the header and the shell share one. */
const mounted = { profile: 0, organiser: 0 };
vi.mock("@/lib/auth/useProfile", async () => {
  const { useEffect } = await import("react");
  return {
    useProfile: () => {
      useEffect(() => {
        mounted.profile += 1;
        return () => void (mounted.profile -= 1);
      }, []);
      return { state: profileState, setProfile: vi.fn(), reload: vi.fn() };
    },
  };
});
vi.mock("@/lib/auth/useOrganiser", async () => {
  const { useEffect } = await import("react");
  return {
    useOrganiser: () => {
      useEffect(() => {
        mounted.organiser += 1;
        return () => void (mounted.organiser -= 1);
      }, []);
      return { loading: false, organiser: null, error: null, refreshing: false, refetch: vi.fn(), authStatus: "signed-in" };
    },
  };
});

let unread: number | null = null;
vi.mock("@/components/messages/UnreadProvider", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/components/messages/UnreadProvider")>()),
  useUnread: () => ({ count: unread }),
}));

let saved: { status: string; count: number } | undefined;
vi.mock("@/components/favourites/FavouritesProvider", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/components/favourites/FavouritesProvider")>()),
  useFavourites: () => saved,
}));

const LATTE: ProfileRecord = {
  displayName: "Latte",
  suspended: false,
  createdAt: "2026-11-01T00:00:00Z",
  updatedAt: "2026-11-01T00:00:00Z",
  profileId: "p-latte",
  profileVisible: false,
};

beforeEach(() => {
  pathname = "/saved";
  profileState = { status: "ready", profile: LATTE };
  unread = 3;
  saved = { status: "ready", count: 12 };
  getMe.mockReset().mockResolvedValue({ username: "latte", upcomingCount: 2 });
  push.mockReset();
});

afterEach(() => {
  cleanup();
});

async function renderShell(auth: AuthContextValue = fakeAuthValue({ email: "latte@email.com" })) {
  const result = render(
    <FakeAuthProvider value={auth}>
      <NavAccountProvider>
        <AccountShell>
          <h1>Page</h1>
        </AccountShell>
      </NavAccountProvider>
    </FakeAuthProvider>,
  );
  const tabs = result.container.querySelector<HTMLElement>("[data-account-tabs]");
  const sidebar = result.container.querySelector<HTMLElement>("[data-account-sidebar]");
  if (!tabs || !sidebar) throw new Error("shell not rendered");
  // GET /api/me resolves: My tickets gets its count.
  await waitFor(() => expect(within(tabs).getByRole("link", { name: /^My tickets/ })).toHaveAccessibleName(/2 upcoming/));
  return { ...result, tabs, sidebar };
}

const linkNames = (nav: HTMLElement) => within(nav).getAllByRole("link").map((link) => link.textContent);

describe("AccountShell", () => {
  it("renders the page inside the frame", async () => {
    await renderShell();
    expect(screen.getByRole("heading", { level: 1, name: "Page" })).toBeInTheDocument();
  });

  it("names the five places in order, with their counts read as part of each link", async () => {
    const { tabs } = await renderShell();
    expect(tabs).toHaveAccessibleName("Account");
    const links = within(tabs).getAllByRole("link");
    expect(links.map((link) => link.getAttribute("data-account-tab"))).toEqual([
      "profile",
      "tickets",
      "saved",
      "messages",
      "settings",
    ]);
    expect(links[0]).toHaveAccessibleName("Profile");
    expect(links[1]).toHaveAccessibleName("My tickets, 2 upcoming events");
    expect(links[2]).toHaveAccessibleName("Saved, 12 events");
    expect(links[3]).toHaveAccessibleName("Messages, 3 unread");
    expect(links[4]).toHaveAccessibleName("Settings");
    // The visible pills: grey counts, the unread one orange.
    const pills = Array.from(tabs.querySelectorAll("[data-account-count]"));
    expect(pills.map((pill) => pill.textContent)).toEqual(["2", "12", "3"]);
    expect(pills.every((pill) => pill.getAttribute("aria-hidden") === "true")).toBe(true);
    expect(pills[2]).toHaveClass("bg-signal");
    expect(pills[0]).toHaveClass("bg-surface");
  });

  it("goes to the pages (Profile to /profile while the profile is hidden), and to the interim My tickets page", async () => {
    const { tabs, sidebar } = await renderShell();
    for (const nav of [tabs, sidebar]) {
      const hrefs = within(nav)
        .getAllByRole("link")
        .map((link) => link.getAttribute("href"));
      expect(hrefs).toEqual(["/profile", "/help#where-are-my-tickets", "/saved", "/messages", "/account"]);
    }
  });

  it.each([
    ["/profile", "profile"],
    ["/saved", "saved"],
    ["/messages", "messages"],
    ["/messages/c-1", "messages"],
    ["/messages/blocked", "messages"],
    ["/account", "settings"],
  ])("marks %s's place with aria-current in both navs", async (path, key) => {
    pathname = path;
    const { tabs, sidebar } = await renderShell();
    const currentTab = tabs.querySelectorAll('[aria-current="page"]');
    expect(currentTab).toHaveLength(1);
    expect(currentTab[0]).toHaveAttribute("data-account-tab", key);
    expect(currentTab[0]).toHaveClass("border-foreground", "text-foreground");
    const currentItem = sidebar.querySelectorAll('[aria-current="page"]');
    expect(currentItem).toHaveLength(1);
    expect(currentItem[0]).toHaveAttribute("data-account-nav", key);
    expect(currentItem[0]).toHaveClass("text-signal");
  });

  it.each(["/tickets/accept", "/tickets/received/0b5c2f8e-7d6a-4c1b-9e3f-2a1d4c5b6e7f"])(
    "under My tickets (%s): its place, as aria-current=\"location\" (the link goes elsewhere)",
    async (path) => {
      pathname = path;
      const { tabs, sidebar } = await renderShell();
      expect(tabs.querySelectorAll("[aria-current]")).toHaveLength(1);
      expect(tabs.querySelector('[aria-current="location"]')).toHaveAttribute("data-account-tab", "tickets");
      expect(sidebar.querySelector('[aria-current="location"]')).toHaveAttribute("data-account-nav", "tickets");
      expect(sidebar.querySelector('[aria-current="page"]')).toBeNull();
    },
  );

  it("goes to the member page once other members can open it, and on /profile marks Profile as the location", async () => {
    profileState = { status: "ready", profile: { ...LATTE, profileVisible: true } };
    pathname = "/profile";
    const { tabs, sidebar } = await renderShell();
    expect(within(tabs).getByRole("link", { name: "Profile" })).toHaveAttribute("href", "/members/p-latte");
    expect(tabs.querySelectorAll("[aria-current]")).toHaveLength(1);
    expect(tabs.querySelector('[aria-current="location"]')).toHaveAttribute("data-account-tab", "profile");
    expect(sidebar.querySelector('[aria-current="location"]')).toHaveAttribute("data-account-nav", "profile");
    expect(sidebar.querySelector('[aria-current="page"]')).toBeNull();
  });

  it("keeps a suspended member's Profile on /profile (their member page is a 404 while suspended)", async () => {
    profileState = { status: "ready", profile: { ...LATTE, profileVisible: true, suspended: true } };
    const { tabs, sidebar } = await renderShell();
    for (const nav of [tabs, sidebar]) {
      expect(within(nav).getByRole("link", { name: "Profile" })).toHaveAttribute("href", "/profile");
    }
  });

  it("shows no pill for a count that's unknown or zero", async () => {
    unread = 0;
    saved = undefined;
    getMe.mockResolvedValue({ upcomingCount: 0 });
    const { container } = render(
      <FakeAuthProvider value={fakeAuthValue({ email: "latte@email.com" })}>
        <NavAccountProvider>
          <AccountShell>
            <p>Page</p>
          </AccountShell>
        </NavAccountProvider>
      </FakeAuthProvider>,
    );
    await waitFor(() => expect(getMe).toHaveBeenCalled());
    await act(async () => {});
    expect(container.querySelectorAll("[data-account-count]")).toHaveLength(0);
    const tabs = container.querySelector<HTMLElement>("[data-account-tabs]");
    if (!tabs) throw new Error("tabs not rendered");
    expect(within(tabs).getByRole("link", { name: "Messages" })).toBeInTheDocument();
    expect(within(tabs).getByRole("link", { name: "My tickets" })).toBeInTheDocument();
  });

  it("shows who's signed in in the sidebar, and logs out from it", async () => {
    const auth = fakeAuthValue({ email: "latte@email.com" });
    const { sidebar } = await renderShell(auth);
    expect(sidebar).toHaveAttribute("data-surface", "ink");
    expect(within(sidebar).getByText("Latte")).toBeInTheDocument();
    expect(within(sidebar).getByText("@latte · 2 upcoming")).toBeInTheDocument();
    expect(linkNames(within(sidebar).getByRole("navigation"))).toEqual([
      "Profile",
      "My tickets, 2 upcoming events2",
      "Saved, 12 events12",
      "Messages, 3 unread3",
      "Settings",
    ]);
    expect(within(sidebar).getByRole("link", { name: "Messages, 3 unread" })).toHaveAttribute("href", "/messages");
    fireEvent.click(within(sidebar).getByRole("button", { name: "Log out" }));
    expect(auth.signOut).toHaveBeenCalled();
    expect(push).toHaveBeenCalledWith("/");
  });

  it("shares the header's account: the profile and organiser record load once for both", async () => {
    render(
      <FakeAuthProvider value={fakeAuthValue({ email: "latte@email.com" })}>
        <NavAccountProvider>
          <Nav />
          <AccountShell>
            <p>Page</p>
          </AccountShell>
        </NavAccountProvider>
      </FakeAuthProvider>,
    );
    await waitFor(() => expect(getMe).toHaveBeenCalled());
    expect(screen.getAllByText("Latte").length).toBeGreaterThan(1);
    expect(mounted).toEqual({ profile: 1, organiser: 1 });
  });

  it("has no Log out and no identity lines when signed out", async () => {
    getMe.mockRejectedValue(new Error("signed out"));
    render(
      <FakeAuthProvider value={fakeAuthValue({ status: "signed-out", email: undefined })}>
        <NavAccountProvider>
          <AccountShell>
            <p>Page</p>
          </AccountShell>
        </NavAccountProvider>
      </FakeAuthProvider>,
    );
    const sidebar = document.querySelector<HTMLElement>("[data-account-sidebar]");
    if (!sidebar) throw new Error("sidebar not rendered");
    expect(within(sidebar).queryByRole("button", { name: "Log out" })).toBeNull();
    expect(within(sidebar).queryByText(/upcoming/)).toBeNull();
    expect(getMe).not.toHaveBeenCalled();
  });
});

describe("AccountTabs", () => {
  const items: AccountNavItem[] = [
    { key: "profile", label: "Profile", href: "/p", count: null, current: false },
    { key: "messages", label: "Messages", href: "/messages", count: 120, alert: true, countText: ", 120 unread", current: true },
  ];

  it("caps a pill at 99+ and keeps the full count in the link's name", () => {
    render(<AccountTabs items={items} />);
    const link = screen.getByRole("link", { name: "Messages, 120 unread" });
    expect(link).toHaveAttribute("aria-current", "page");
    expect(link.querySelector("[data-account-count]")).toHaveTextContent("99+");
    expect(screen.getByRole("link", { name: "Profile" })).not.toHaveAttribute("aria-current");
  });

  it("is a plain list of links, not ARIA tabs", () => {
    render(<AccountTabs items={items} />);
    expect(screen.queryByRole("tablist")).toBeNull();
    expect(screen.queryByRole("tab")).toBeNull();
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
  });
});
