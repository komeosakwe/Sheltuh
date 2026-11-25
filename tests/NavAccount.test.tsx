// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Nav from "@/components/Nav";
import { NavAccountProvider } from "@/components/nav/useNavAccount";
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
      <NavAccountProvider>
        <Nav />
      </NavAccountProvider>
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
  it("shows who's signed in (a 48px round avatar, the 20px name, View profile) as a link to the member page, named '{name}, view profile'", () => {
    const { drawer } = renderNav();
    const identity = within(drawer).getByRole("link", { name: "Latte, view profile", hidden: true });
    expect(identity).toHaveAttribute("href", "/members/p-latte");
    expect(identity).toHaveTextContent("LatteView profile");
    expect(identity).toHaveClass("min-h-16", "gap-4", "pb-4");
    // No photo on this profile: the board's cream circle, no initials, decorative.
    const avatar = identity.querySelector("span[aria-hidden='true']");
    expect(avatar).toHaveClass("size-12");
    const circle = avatar?.querySelector("[data-avatar-placeholder]");
    expect(circle).toHaveClass("rounded-full", "bg-avatar-placeholder");
    expect(circle).toHaveTextContent("");
    expect(within(identity).getByText("Latte")).toHaveClass("text-xl", "font-semibold", "truncate");
    expect(within(identity).getByText("View profile")).toHaveClass("text-sm", "font-medium", "text-muted");
  });

  it("links the identity to where the profile is edited while it's hidden from members, and shows the email while it loads", () => {
    profileState = { status: "ready", profile: { ...LATTE, profileVisible: false } };
    const first = renderNav();
    expect(within(first.drawer).getByRole("link", { name: "Latte, view profile", hidden: true })).toHaveAttribute(
      "href",
      "/profile",
    );
    cleanup();
    profileState = { status: "loading" };
    const { drawer } = renderNav();
    const identity = within(drawer).getByRole("link", { name: "latte@example.com, view profile", hidden: true });
    expect(identity.querySelector("[data-avatar-placeholder]")).toHaveClass("size-12", "rounded-full", "bg-avatar-placeholder");
  });

  it("lists My tickets, Saved and Messages for a member (no Your events), with no counts, as the board draws them", () => {
    // 12 saved and 3 unread: the "Menu drawer / Mobile" board shows the same member's rows without numbers.
    const { drawer } = renderNav();
    expect(names(drawer)).toEqual([
      ["Discover", "/"],
      ["Nearby", "/map"],
      ["Community", "/community"],
      ["Latte, view profile", "/members/p-latte"],
      ["My tickets", "/help#where-are-my-tickets"],
      ["Saved", "/saved"],
      ["Messages", "/messages"],
      ["For organisers", "/organisers/apply"],
    ]);
    expect(drawer.querySelector("[data-menu-count], [data-unread-badge]")).toBeNull();
  });

  it("keeps the waiting count on an admin's Admin row (a row the board doesn't draw)", () => {
    const { drawer } = renderNav(fakeAuthValue({ email: "latte@example.com", isAdmin: true }));
    expect(within(drawer).getByRole("link", { name: /^Admin/, hidden: true })).toHaveAttribute("href", "/admin");
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

  it("keeps Tab inside the bar and the drawer while open: past the last button to the logo, and back, staying open", () => {
    const { drawer } = renderNav(fakeAuthValue({ status: "signed-out" }));
    const hidePopover = vi.fn();
    drawer.hidePopover = hidePopover;
    fireToggle(drawer, "open");
    const organisers = within(drawer).getByRole("link", { name: "For organisers", hidden: true });
    const logos = screen.getAllByRole("link", { name: "Sheltüh home", hidden: true });
    const barLogo = logos.find((logo) => logo.closest("[data-compact-header]"));
    if (!barLogo) throw new Error("bar logo not rendered");
    organisers.focus();
    fireEvent.keyDown(organisers, { key: "Tab" });
    expect(barLogo).toHaveFocus();
    // Focus moving from the drawer to the bar's logo doesn't close the drawer.
    expect(hidePopover).not.toHaveBeenCalled();
    fireEvent.keyDown(barLogo, { key: "Tab", shiftKey: true });
    expect(organisers).toHaveFocus();
    // In between, Tab is the browser's.
    const discover = within(drawer).getByRole("link", { name: "Discover", hidden: true });
    discover.focus();
    expect(fireEvent.keyDown(discover, { key: "Tab" })).toBe(true);
    expect(hidePopover).not.toHaveBeenCalled();
    // Focus leaving for the page still closes it.
    const outside = document.body.appendChild(document.createElement("button"));
    try {
      outside.focus();
      expect(hidePopover).toHaveBeenCalledTimes(1);
    } finally {
      outside.remove();
    }
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
    // No count on Menu (the boards draw none), even with 3 unread.
    expect(screen.getByRole("button", { name: "Menu" })).toHaveFocus();
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
    // The board's Log out: its label; #d03e00 (--signal-text) in Light, which passes 4.5:1 (owner, 19 Nov 2026), and the
    // board's #ff4800 (--signal) in Dark.
    const logOut = within(nav).getByRole("button", { name: "Log out", hidden: true });
    expect(logOut).toHaveClass("text-signal-text", "dark:text-signal");
    // 40px rows of 16px semibold, as drawn.
    for (const row of [...within(nav).getAllByRole("link", { hidden: true }), logOut]) {
      expect(row).toHaveClass("min-h-10", "text-base", "font-semibold", "hover:bg-menu-hover");
      expect(row).not.toHaveClass("min-h-11");
    }
    // The counts are the board's 24 × 16 pills: Messages orange, Saved in the panel's other fill.
    expect(panel.querySelector("[data-unread-badge]")).toHaveClass("bg-signal", "h-4", "min-w-6", "rounded-full");
    expect(panel.querySelector("[data-menu-count]")).toHaveClass("h-4", "min-w-6", "rounded-full", "bg-menu-hover", "group-hover:bg-menu");
    // The hairlines run edge to edge across the panel.
    for (const divider of panel.querySelectorAll("nav > div[aria-hidden='true']")) expect(divider).toHaveClass("-mx-2", "h-px");
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
    // No photo: the board's cream circle, not initials.
    expect(panel.querySelector("[data-avatar-placeholder]")).toHaveClass("rounded-full", "bg-avatar-placeholder");
    expect(panel.querySelector("[data-avatar-placeholder]")).toHaveTextContent("");
    cleanup();
    profileState = { status: "ready", profile: null };
    const bare = requirePanel(renderNav().panel);
    expect(within(bare).getByText("latte@example.com")).toHaveClass("body-m");
    expect(within(bare).getByRole("link", { name: "Profile", hidden: true })).toHaveAttribute("href", "/profile");
  });

  it("sends a suspended member to /profile, not their member page (it's a 404 while they're suspended)", () => {
    profileState = { status: "ready", profile: { ...LATTE, suspended: true } };
    const { drawer, panel } = renderNav();
    expect(within(requirePanel(panel)).getByRole("link", { name: "Profile", hidden: true })).toHaveAttribute("href", "/profile");
    expect(within(drawer).getByRole("link", { name: "Latte, view profile", hidden: true })).toHaveAttribute("href", "/profile");
  });

  it("marks Profile and the avatar current on /profile", () => {
    pathname = "/profile";
    profileState = { status: "ready", profile: null };
    const { drawer, panel } = renderNav();
    const row = within(requirePanel(panel)).getByRole("link", { name: "Profile", hidden: true });
    expect(row).toHaveAttribute("aria-current", "page");
    expect(row.querySelector(".umlaut")).toHaveAttribute("data-current", "");
    expect(screen.getByRole("button", { name: "Account" })).toHaveAttribute("data-current", "");
    expect(within(drawer).getByRole("link", { name: "latte@example.com, view profile", hidden: true })).toHaveAttribute(
      "aria-current",
      "page",
    );
  });

  it("is a disclosure: the avatar's aria-expanded follows the panel, and it keeps the page's theme inside the ink header, 8px under it", () => {
    const { panel: maybePanel } = renderNav();
    const panel = requirePanel(maybePanel);
    const avatar = screen.getByRole("button", { name: "Account" });
    expect(avatar).toHaveAttribute("aria-expanded", "false");
    fireToggle(panel, "open");
    expect(avatar).toHaveAttribute("aria-expanded", "true");
    fireToggle(panel, "closed");
    expect(avatar).toHaveAttribute("aria-expanded", "false");
    // The page theme: the header is ink (owner, 22 Nov 2026), so the panel puts the page's tokens back
    // (data-surface="page"). As the board's two frames, white with a 1px hairline and no shadow in Light,
    // #1c1b17 with a 1px white stroke in Dark; 280px, radius 16.
    expect(panel.closest("[data-surface]")).toBe(panel);
    expect(panel).toHaveAttribute("data-surface", "page");
    expect(panel.parentElement?.closest("[data-surface]")?.tagName).toBe("HEADER");
    expect(panel).toHaveClass("w-70", "bg-menu", "border", "border-surface-border", "dark:border-foreground", "rounded-card", "p-2");
    expect(panel).not.toHaveClass("border-control", "border-foreground");
    expect(panel.className).not.toMatch(/shadow/);
    // 100px header + 8; right edge on the avatar's (the row's 32 / 66px right padding); 92 + 8 once scrolled at XL.
    expect(panel).toHaveClass("top-27", "right-8", "xl:right-16.5", "xl:group-data-scrolled/header:top-25");
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
