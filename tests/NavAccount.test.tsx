// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Nav from "@/components/Nav";
import type { ProfileRecord } from "@/lib/api/types";
import type { AuthContextValue } from "@/lib/auth/AuthContext";
import type { ProfileState } from "@/lib/auth/useProfile";
import { fakeAuthValue, FakeAuthProvider } from "./test-utils/fakeAuth";

/**
 * The signed-in account in the header (navigation-search.md §5.2, the avatar menu) and the phone
 * drawer (§5.3): who's signed in, the rows and their counts, and the keyboard. The profile,
 * organiser record and counts are stubbed at their hooks; Nav loads them once for both.
 */

let pathname = "/events";
const push = vi.fn();
vi.mock("next/navigation", () => ({
  usePathname: () => pathname,
  useRouter: () => ({ push }),
}));

let profileState: ProfileState = { status: "loading" };
vi.mock("@/lib/auth/useProfile", () => ({
  useProfile: () => ({ state: profileState, setProfile: vi.fn(), reload: vi.fn() }),
}));

let organiser: { loading: boolean; organiser: object | null; error: string | null } = {
  loading: false,
  organiser: null,
  error: null,
};
vi.mock("@/lib/auth/useOrganiser", () => ({
  useOrganiser: () => ({ ...organiser, refreshing: false, refetch: vi.fn(), authStatus: "signed-in" }),
}));

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
  profileVisible: true,
};

beforeEach(() => {
  pathname = "/events";
  profileState = { status: "ready", profile: LATTE };
  organiser = { loading: false, organiser: null, error: null };
  unread = 3;
  saved = { status: "ready", count: 12 };
  push.mockReset();
});

afterEach(() => {
  cleanup();
});

function renderNav(auth: AuthContextValue = fakeAuthValue({ email: "latte@example.com" })) {
  const result = render(
    <FakeAuthProvider value={auth}>
      <Nav />
    </FakeAuthProvider>,
  );
  const drawer = result.container.querySelector<HTMLElement>("#site-menu");
  if (!drawer) throw new Error("site menu not rendered");
  const panel = result.container.querySelector<HTMLElement>("#account-menu");
  return { ...result, drawer, panel };
}

function requirePanel(panel: HTMLElement | null): HTMLElement {
  if (!panel) throw new Error("avatar menu not rendered");
  return panel;
}

/** jsdom has no Popover API: fire the `toggle` event a browser would. */
function fireToggle(element: HTMLElement, newState: "open" | "closed") {
  act(() => {
    element.dispatchEvent(Object.assign(new Event("toggle"), { newState, oldState: newState === "open" ? "closed" : "open" }));
  });
}

/** A link's name as read: its aria-label, else its text without the decorative (aria-hidden) parts. */
function nameOf(link: HTMLElement): string {
  const label = link.getAttribute("aria-label");
  if (label) return label;
  const copy = link.cloneNode(true) as HTMLElement;
  for (const hidden of copy.querySelectorAll("[aria-hidden='true']")) hidden.remove();
  return copy.textContent ?? "";
}

function names(container: HTMLElement) {
  return within(container)
    .getAllByRole("link", { hidden: true })
    .map((link) => [nameOf(link), link.getAttribute("href")]);
}

describe("phone drawer, signed in", () => {
  it("shows who's signed in (a 48px round avatar, the name, View profile) as a link to the member page, named '{name}, view profile'", () => {
    const { drawer } = renderNav();
    const identity = within(drawer).getByRole("link", { name: "Latte, view profile", hidden: true });
    expect(identity).toHaveAttribute("href", "/members/p-latte");
    expect(identity).toHaveTextContent("LatteView profile");
    expect(identity).toHaveClass("min-h-16", "gap-4", "pb-4");
    // The initials in the round avatar (no photo on this profile), decorative.
    const avatar = identity.querySelector("span[aria-hidden='true']");
    expect(avatar).toHaveClass("size-12");
    expect(avatar?.querySelector(".rounded-full")).toHaveTextContent("L");
    expect(within(identity).getByText("View profile")).toHaveClass("meta", "text-muted");
  });

  it("links the identity to where the profile is edited while it's hidden from members, and shows the email while it loads", () => {
    profileState = { status: "ready", profile: { ...LATTE, profileVisible: false } };
    const first = renderNav();
    expect(within(first.drawer).getByRole("link", { name: "Latte, view profile", hidden: true })).toHaveAttribute(
      "href",
      "/account#member-profile",
    );
    cleanup();
    profileState = { status: "loading" };
    const { drawer } = renderNav();
    const identity = within(drawer).getByRole("link", { name: "latte@example.com, view profile", hidden: true });
    expect(identity.querySelector("[data-avatar-placeholder]")).toHaveClass("size-12", "rounded-full", "bg-surface");
  });

  it("lists My tickets, Saved and Messages for a member (no Your events), with the counts in the links' names", () => {
    const { drawer } = renderNav();
    expect(names(drawer)).toEqual([
      ["Discover", "/"],
      ["Nearby", "/map"],
      ["Community", "/community"],
      ["Latte, view profile", "/members/p-latte"],
      ["My tickets", "/help#where-are-my-tickets"],
      ["Saved, 12 saved", "/saved"],
      ["Messages, 3 unread", "/messages"],
      ["For organisers", "/organisers/apply"],
    ]);
    // The numbers themselves are decorative: the names carry them.
    expect(drawer.querySelector("[data-menu-count]")).toHaveAttribute("aria-hidden", "true");
    expect(drawer.querySelector("[data-unread-badge]")).toHaveAttribute("aria-hidden", "true");
  });

  it("shows no count that isn't known: Saved before its list has loaded, or when it's empty", () => {
    saved = { status: "loading", count: 0 };
    unread = null;
    const { drawer } = renderNav();
    expect(within(drawer).getByRole("link", { name: "Saved", hidden: true })).toBeInTheDocument();
    expect(within(drawer).getByRole("link", { name: "Messages", hidden: true })).toBeInTheDocument();
    expect(drawer.querySelector("[data-menu-count]")).toBeNull();
  });

  it("adds Your events for an organiser (or applicant)", () => {
    organiser = { loading: false, organiser: { status: "approved" }, error: null };
    const { drawer } = renderNav();
    expect(within(drawer).getByRole("link", { name: "Your events", hidden: true })).toHaveAttribute("href", "/dashboard");
  });

  it("marks the current page's row (Saved on /saved)", () => {
    pathname = "/saved";
    const { drawer } = renderNav();
    expect(within(drawer).getByRole("link", { name: /^Saved/, hidden: true })).toHaveAttribute("aria-current", "page");
    expect(within(drawer).getByRole("link", { name: "Discover", hidden: true })).not.toHaveAttribute("aria-current");
  });
});

describe("phone drawer, keyboard", () => {
  it("hides the bar's Search while open, so the bar shows only the wordmark and Close", () => {
    const { drawer, container } = renderNav(fakeAuthValue({ status: "signed-out" }));
    const bar = container.querySelector<HTMLElement>("[data-compact-header]");
    if (!bar) throw new Error("compact bar not rendered");
    expect(within(bar).getByRole("link", { name: "Search" })).toBeInTheDocument();
    fireToggle(drawer, "open");
    expect(within(bar).queryByRole("link", { name: "Search" })).toBeNull();
    expect(within(bar).getByRole("button", { name: /^Close/ })).toBeInTheDocument();
    fireToggle(drawer, "closed");
    expect(within(bar).getByRole("link", { name: "Search" })).toBeInTheDocument();
  });

  it("keeps Tab inside the bar and the drawer while open: past the last button to the logo, and back", () => {
    const { drawer } = renderNav(fakeAuthValue({ status: "signed-out" }));
    fireToggle(drawer, "open");
    const organisers = within(drawer).getByRole("link", { name: "For organisers", hidden: true });
    const logos = screen.getAllByRole("link", { name: "Sheltüh home", hidden: true });
    const barLogo = logos.find((logo) => logo.closest("[data-compact-header]"));
    if (!barLogo) throw new Error("bar logo not rendered");
    organisers.focus();
    fireEvent.keyDown(organisers, { key: "Tab" });
    expect(barLogo).toHaveFocus();
    fireEvent.keyDown(barLogo, { key: "Tab", shiftKey: true });
    expect(organisers).toHaveFocus();
    // In between, Tab is the browser's.
    const discover = within(drawer).getByRole("link", { name: "Discover", hidden: true });
    discover.focus();
    expect(fireEvent.keyDown(discover, { key: "Tab" })).toBe(true);
  });

  it("closes on Escape with focus back on Menu", () => {
    const { drawer } = renderNav(fakeAuthValue({ status: "signed-out" }));
    const hidePopover = vi.fn();
    drawer.hidePopover = hidePopover;
    fireToggle(drawer, "open");
    const nearby = within(drawer).getByRole("link", { name: "Nearby", hidden: true });
    nearby.focus();
    fireEvent.keyDown(nearby, { key: "Escape" });
    expect(hidePopover).toHaveBeenCalled();
    fireToggle(drawer, "closed");
    // The unread count is in Menu's name too.
    expect(screen.getByRole("button", { name: "Menu, 3 unread messages" })).toHaveFocus();
  });
});

describe("avatar menu (from lg)", () => {
  it("lists Profile, My tickets, Saved, Messages and Settings, then Log out, in nav 'Account', with the counts in the names", () => {
    const panel = requirePanel(renderNav().panel);
    expect(panel).toHaveAttribute("popover", "auto");
    const nav = within(panel).getByRole("navigation", { name: "Account", hidden: true });
    expect(names(nav)).toEqual([
      ["Profile", "/members/p-latte"],
      ["My tickets", "/help#where-are-my-tickets"],
      ["Saved, 12 saved", "/saved"],
      ["Messages, 3 unread", "/messages"],
      ["Settings", "/account"],
    ]);
    const logOut = within(nav).getByRole("button", { name: "Log out", hidden: true });
    expect(logOut).toHaveClass("text-signal-text");
    // 44px rows.
    for (const row of [...within(nav).getAllByRole("link", { hidden: true }), logOut]) expect(row).toHaveClass("min-h-11");
    // The Messages badge is the header chip's orange one.
    expect(panel.querySelector("[data-unread-badge]")).toHaveClass("bg-signal");
  });

  it("adds Your events for organisers and Admin (with what's waiting) for admins", () => {
    organiser = { loading: false, organiser: { status: "approved" }, error: null };
    const panel = requirePanel(renderNav(fakeAuthValue({ email: "latte@example.com", isAdmin: true })).panel);
    expect(within(panel).getByRole("link", { name: "Your events", hidden: true })).toHaveAttribute("href", "/dashboard");
    expect(within(panel).getByRole("link", { name: "Admin", hidden: true })).toHaveAttribute("href", "/admin");
  });

  it("shows who's signed in: the name over the email (no @handle exists); the email alone without a profile", () => {
    const panel = requirePanel(renderNav().panel);
    expect(within(panel).getByText("Latte")).toHaveClass("body-m", "font-semibold", "truncate");
    expect(within(panel).getByText("latte@example.com")).toHaveClass("meta", "text-muted");
    cleanup();
    profileState = { status: "ready", profile: null };
    const bare = requirePanel(renderNav().panel);
    expect(within(bare).getByText("latte@example.com")).toHaveClass("body-m");
    expect(within(bare).getByRole("link", { name: "Profile", hidden: true })).toHaveAttribute("href", "/account#member-profile");
  });

  it("is a disclosure: the avatar's aria-expanded follows the panel, and it sits in the page-themed row, 8px under the header", () => {
    const { panel: maybePanel } = renderNav();
    const panel = requirePanel(maybePanel);
    const avatar = screen.getByRole("button", { name: "Account" });
    expect(avatar).toHaveAttribute("aria-expanded", "false");
    fireToggle(panel, "open");
    expect(avatar).toHaveAttribute("aria-expanded", "true");
    fireToggle(panel, "closed");
    expect(avatar).toHaveAttribute("aria-expanded", "false");
    // White in Light, black in Dark: no ink scope around it.
    expect(panel.closest("[data-surface]")).toBeNull();
    expect(panel).toHaveClass("w-68", "bg-card", "border-control", "border-foreground", "rounded-control", "p-2");
    // 72px header + 8; right edge on the avatar's (the row's 32 / 64px padding); 64 + 8 once scrolled at XL.
    expect(panel).toHaveClass("top-20", "right-8", "xl:right-16", "xl:group-data-scrolled/header:top-18");
  });

  it("closes on Escape with focus back on the avatar", () => {
    const panel = requirePanel(renderNav().panel);
    const hidePopover = vi.fn();
    panel.hidePopover = hidePopover;
    fireToggle(panel, "open");
    const saved = within(panel).getByRole("link", { name: "Saved, 12 saved", hidden: true });
    saved.focus();
    fireEvent.keyDown(saved, { key: "Escape" });
    expect(hidePopover).toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Account" })).toHaveFocus();
  });

  it("closes when focus leaves it for the page, but not for the avatar", () => {
    const panel = requirePanel(renderNav().panel);
    const hidePopover = vi.fn();
    panel.hidePopover = hidePopover;
    const profile = within(panel).getByRole("link", { name: "Profile", hidden: true });
    fireEvent.focusOut(profile, { relatedTarget: within(panel).getByRole("link", { name: "My tickets", hidden: true }) });
    fireEvent.focusOut(profile, { relatedTarget: screen.getByRole("button", { name: "Account" }) });
    expect(hidePopover).not.toHaveBeenCalled();
    const outside = document.createElement("button");
    document.body.append(outside);
    fireEvent.focusOut(profile, { relatedTarget: outside });
    expect(hidePopover).toHaveBeenCalledTimes(1);
    outside.remove();
  });

  it("moves between rows with the arrow keys, Home and End; Arrow Down on the avatar opens it and enters", () => {
    const panel = requirePanel(renderNav().panel);
    const showPopover = vi.fn();
    panel.showPopover = showPopover;
    const avatar = screen.getByRole("button", { name: "Account" });
    avatar.focus();
    fireEvent.keyDown(avatar, { key: "ArrowDown" });
    expect(showPopover).toHaveBeenCalled();
    const profile = within(panel).getByRole("link", { name: "Profile", hidden: true });
    expect(profile).toHaveFocus();
    fireEvent.keyDown(profile, { key: "ArrowDown" });
    expect(within(panel).getByRole("link", { name: "My tickets", hidden: true })).toHaveFocus();
    fireEvent.keyDown(document.activeElement as HTMLElement, { key: "End" });
    expect(within(panel).getByRole("button", { name: "Log out", hidden: true })).toHaveFocus();
    fireEvent.keyDown(document.activeElement as HTMLElement, { key: "ArrowDown" });
    expect(profile).toHaveFocus();
    fireEvent.keyDown(profile, { key: "ArrowUp" });
    expect(within(panel).getByRole("button", { name: "Log out", hidden: true })).toHaveFocus();
    fireEvent.keyDown(document.activeElement as HTMLElement, { key: "Home" });
    expect(profile).toHaveFocus();
  });

  it("closes after a row is chosen, and Log out signs out and goes home", () => {
    const auth = fakeAuthValue({ email: "latte@example.com" });
    const panel = requirePanel(renderNav(auth).panel);
    const hidePopover = vi.fn();
    panel.hidePopover = hidePopover;
    const settings = within(panel).getByRole("link", { name: "Settings", hidden: true });
    settings.addEventListener("click", (event) => event.preventDefault());
    fireEvent.click(settings);
    expect(hidePopover).toHaveBeenCalledTimes(1);
    fireEvent.click(within(panel).getByRole("button", { name: "Log out", hidden: true }));
    expect(auth.signOut).toHaveBeenCalled();
    expect(push).toHaveBeenCalledWith("/");
  });

  it("marks the current page's row with aria-current and the dots on its label", () => {
    pathname = "/saved";
    const panel = requirePanel(renderNav().panel);
    const row = within(panel).getByRole("link", { name: "Saved, 12 saved", hidden: true });
    expect(row).toHaveAttribute("aria-current", "page");
    expect(row.querySelector(".umlaut")).toHaveAttribute("data-current", "");
    expect(screen.getByRole("button", { name: "Account" })).toHaveAttribute("data-current", "");
  });

  it("never exists signed out or in the demo", () => {
    for (const auth of [fakeAuthValue({ status: "signed-out" }), fakeAuthValue({ status: "signed-out", configured: false })]) {
      const { panel } = renderNav(auth);
      expect(panel).toBeNull();
      expect(screen.queryByRole("button", { name: "Account" })).toBeNull();
      cleanup();
    }
  });
});
