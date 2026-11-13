// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import Nav from "@/components/Nav";
import type { AuthContextValue } from "@/lib/auth/AuthContext";
import { fakeAuthValue, FakeAuthProvider } from "./test-utils/fakeAuth";

let pathname = "/";
vi.mock("next/navigation", () => ({
  usePathname: () => pathname,
  useRouter: () => ({ push: vi.fn() }),
}));

afterEach(() => {
  cleanup();
  pathname = "/";
});

function renderNav(auth: AuthContextValue) {
  const result = render(
    <FakeAuthProvider value={auth}>
      <Nav />
    </FakeAuthProvider>,
  );
  const menu = result.container.querySelector<HTMLElement>("#site-menu");
  if (!menu) throw new Error("site menu not rendered");
  return { ...result, menu };
}

/** jsdom has no Popover API: fire the `toggle` event a browser would. */
function fireToggle(menu: HTMLElement, newState: "open" | "closed") {
  act(() => {
    menu.dispatchEvent(Object.assign(new Event("toggle"), { newState, oldState: newState === "open" ? "closed" : "open" }));
  });
}

/** The closed popover is display:none, so its links are looked up with `hidden: true`. */
function linkHrefs(container: HTMLElement) {
  return within(container)
    .getAllByRole("link", { hidden: true })
    .map((link) => [link.getAttribute("aria-label") ?? link.textContent, link.getAttribute("href")]);
}

/** The phone and tablet bar (logo, search icon, Menu). */
function compactBar(container: HTMLElement) {
  const bar = container.querySelector<HTMLElement>("[data-compact-header]");
  if (!bar) throw new Error("compact bar not rendered");
  return bar;
}

const PLACES = [
  ["Discover", "/"],
  ["Nearby", "/map"],
  ["Community", "/community"],
];

describe("Nav — phone menu", () => {
  it("is a popover invoked by the Menu button, next to a Search link (off the home)", () => {
    pathname = "/events";
    const { menu, container } = renderNav(fakeAuthValue({ status: "signed-out", configured: true }));
    expect(menu).toHaveAttribute("popover", "auto");
    const button = screen.getByRole("button", { name: "Menu" });
    expect(button).toHaveAttribute("popovertarget", "site-menu");
    expect(within(compactBar(container)).getByRole("link", { name: "Search" })).toHaveAttribute("href", "/search");
  });

  it("offers the three places, then Sign in and For organisers as buttons, when signed out", () => {
    const { menu } = renderNav(fakeAuthValue({ status: "signed-out", configured: true }));
    expect(linkHrefs(menu)).toEqual([...PLACES, ["Sign in", "/login"], ["For organisers", "/organisers/apply"]]);
    // The rules' Mobile spec: "Sign in / For organisers at bottom as buttons".
    expect(within(menu).getByRole("link", { name: "Sign in", hidden: true })).toHaveClass("btn", "btn-lg", "w-full");
    expect(within(menu).getByRole("link", { name: "For organisers", hidden: true })).toHaveClass("btn", "btn-outline", "btn-lg", "w-full");
  });

  it("sets the three places in Display/M with the umlaut", () => {
    const { menu } = renderNav(fakeAuthValue({ status: "signed-out" }));
    for (const [name] of PLACES) {
      expect(within(menu).getByRole("link", { name, hidden: true })).toHaveClass("display-m", "umlaut", "umlaut-lg");
    }
  });

  it("offers Sign in in demo mode (accounts not configured)", () => {
    const { menu } = renderNav(fakeAuthValue({ status: "signed-out", configured: false }));
    expect(within(menu).getByRole("link", { name: "Sign in", hidden: true })).toHaveAttribute("href", "/login");
  });

  it("offers Admin, Messages, Saved, Your events and Account to a signed-in admin (Sign out is on /account)", () => {
    const { menu } = renderNav(fakeAuthValue({ isAdmin: true }));
    expect(linkHrefs(menu)).toEqual([
      ...PLACES,
      ["Admin", "/admin"],
      ["Messages", "/messages"],
      ["Saved", "/saved"],
      ["Your events", "/dashboard"],
      ["Account", "/account"],
      ["For organisers", "/organisers/apply"],
    ]);
    expect(within(menu).queryByRole("button", { name: "Sign out", hidden: true })).toBeNull();
  });

  it("hides Admin from a signed-in organiser", () => {
    const { menu } = renderNav(fakeAuthValue({ isAdmin: false }));
    expect(within(menu).queryByRole("link", { name: "Admin", hidden: true })).not.toBeInTheDocument();
    expect(within(menu).getByRole("link", { name: "Your events", hidden: true })).toBeInTheDocument();
  });

  it("shows the loading placeholder while auth resolves", () => {
    const { menu } = renderNav(fakeAuthValue({ status: "loading" }));
    expect(within(menu).getByText("…")).toBeInTheDocument();
    expect(within(menu).queryByRole("link", { name: "Sign in", hidden: true })).not.toBeInTheDocument();
  });

  it("marks the current page in the menu: Nearby on /map", () => {
    pathname = "/map";
    const { menu } = renderNav(fakeAuthValue({ status: "signed-out" }));
    expect(within(menu).getByRole("link", { name: "Nearby", hidden: true })).toHaveAttribute("aria-current", "page");
    expect(within(menu).getByRole("link", { name: "Discover", hidden: true })).not.toHaveAttribute("aria-current");
    expect(within(menu).getByRole("link", { name: "Community", hidden: true })).not.toHaveAttribute("aria-current");
  });

  // Community is its own page (redesign PR 3), no longer the home's #find-your-people.
  it("marks Community as the current page on /community, in the menu and the desktop row", () => {
    pathname = "/community";
    const { menu } = renderNav(fakeAuthValue({ status: "signed-out" }));
    expect(within(menu).getByRole("link", { name: "Community", hidden: true })).toHaveAttribute("aria-current", "page");
    expect(within(menu).getByRole("link", { name: "Discover", hidden: true })).not.toHaveAttribute("aria-current");
    const row = screen.getByRole("navigation", { name: "Primary" });
    const community = within(row).getByRole("link", { name: "Community" });
    expect(community).toHaveAttribute("href", "/community");
    expect(community).toHaveAttribute("aria-current", "page");
    // No in-page jump target any more: nothing links to the home's section.
    expect(document.querySelector("a[href*='#find-your-people']")).toBeNull();
  });

  it("marks Discover as the current section on an event's page (and What's on)", () => {
    for (const path of ["/events/neon-static", "/events"]) {
      pathname = path;
      const { menu } = renderNav(fakeAuthValue({ status: "signed-out" }));
      expect(within(menu).getByRole("link", { name: "Discover", hidden: true })).toHaveAttribute("aria-current", "true");
      expect(within(menu).getByRole("link", { name: "Nearby", hidden: true })).not.toHaveAttribute("aria-current");
      cleanup();
    }
  });

  it("relabels the button and focuses the first link when opened, and resets on close", () => {
    const { menu } = renderNav(fakeAuthValue({ status: "signed-out" }));
    fireToggle(menu, "open");
    expect(screen.getByRole("button", { name: "Close" })).toBeInTheDocument();
    expect(within(menu).getByRole("link", { name: "Discover", hidden: true })).toHaveFocus();
    fireToggle(menu, "closed");
    expect(screen.getByRole("button", { name: "Menu" })).toBeInTheDocument();
  });

  it("makes the page's main and footer inert while open, and live again on close", () => {
    const main = document.createElement("main");
    const footer = document.createElement("footer");
    document.body.append(main, footer);
    const { menu } = renderNav(fakeAuthValue({ status: "signed-out" }));
    const header = screen.getByRole("banner");

    fireToggle(menu, "open");
    expect(main).toHaveAttribute("inert");
    expect(footer).toHaveAttribute("inert");
    // The header holds the menu and its Close button: never inert.
    expect(header).not.toHaveAttribute("inert");
    expect(menu.closest("[inert]")).toBeNull();

    fireToggle(menu, "closed");
    expect(main).not.toHaveAttribute("inert");
    expect(footer).not.toHaveAttribute("inert");
    main.remove();
    footer.remove();
  });

  it("never leaves the page inert after it unmounts with the menu open", () => {
    const main = document.createElement("main");
    const footer = document.createElement("footer");
    document.body.append(main, footer);
    const { menu, unmount } = renderNav(fakeAuthValue({ status: "signed-out" }));
    fireToggle(menu, "open");
    expect(main).toHaveAttribute("inert");
    unmount();
    expect(main).not.toHaveAttribute("inert");
    expect(footer).not.toHaveAttribute("inert");
    main.remove();
    footer.remove();
  });

  it("closes after an action inside the menu (a link to the page already showing included)", () => {
    const { menu } = renderNav(fakeAuthValue());
    const hidePopover = vi.fn();
    menu.hidePopover = hidePopover;
    for (const name of ["Account", "Community"]) {
      hidePopover.mockClear();
      const link = within(menu).getByRole("link", { name, hidden: true });
      // Keep jsdom from attempting the navigation; the click still bubbles to the menu.
      link.addEventListener("click", (event) => event.preventDefault());
      fireEvent.click(link);
      expect(hidePopover).toHaveBeenCalled();
    }
  });

  it("closes the menu and scrolls to the top when the logo is clicked on the home", () => {
    const { menu } = renderNav(fakeAuthValue());
    const hidePopover = vi.fn();
    menu.hidePopover = hidePopover;
    const scrollTo = vi.fn();
    window.scrollTo = scrollTo as unknown as typeof window.scrollTo;
    for (const logo of screen.getAllByRole("link", { name: "Sheltüh home", hidden: true })) {
      hidePopover.mockClear();
      scrollTo.mockClear();
      fireEvent.click(logo);
      expect(hidePopover).toHaveBeenCalled();
      expect(scrollTo).toHaveBeenCalledWith(expect.objectContaining({ top: 0 }));
    }
  });

  it("has no theme switch: it's in the footer only (the rules' Navigation board)", () => {
    const { container } = renderNav(fakeAuthValue({ status: "signed-out", configured: true }));
    expect(screen.queryByRole("group", { name: "Theme", hidden: true })).toBeNull();
    expect(container.querySelector("[data-theme-switch]")).toBeNull();
  });

  it("closes when keyboard focus leaves the menu for the page", () => {
    const { menu } = renderNav(fakeAuthValue({ status: "signed-out" }));
    const hidePopover = vi.fn();
    menu.hidePopover = hidePopover;
    const discover = within(menu).getByRole("link", { name: "Discover", hidden: true });
    const nearby = within(menu).getByRole("link", { name: "Nearby", hidden: true });
    fireEvent.focusOut(discover, { relatedTarget: nearby });
    fireEvent.focusOut(nearby, { relatedTarget: screen.getByRole("button", { name: "Menu" }) });
    expect(hidePopover).not.toHaveBeenCalled();
    const outside = document.createElement("button");
    document.body.append(outside);
    fireEvent.focusOut(nearby, { relatedTarget: outside });
    expect(hidePopover).toHaveBeenCalledTimes(1);
    outside.remove();
  });
});

describe("Nav — desktop row", () => {
  it("signed in: For organisers, Admin, Messages and the avatar (Account); Saved and Your events are on /account", () => {
    renderNav(fakeAuthValue({ isAdmin: true }));
    const [desktopNav] = screen.getAllByRole("navigation", { name: "Primary" });
    expect(linkHrefs(desktopNav)).toEqual([
      ...PLACES,
      ["For organisers", "/organisers/apply"],
      ["Admin", "/admin"],
      ["Messages", "/messages"],
      ["Account", "/account"],
    ]);
    expect(within(desktopNav).queryByRole("button", { name: "Sign out" })).toBeNull();
    // The rules' signed-in header: For organisers as a nav item, Messages as the small muted chip.
    expect(within(desktopNav).getByRole("link", { name: "For organisers" })).not.toHaveClass("nav-button");
    expect(within(desktopNav).getByRole("link", { name: "For organisers" })).toHaveClass("umlaut", "umlaut-nav");
    expect(within(desktopNav).getByRole("link", { name: "Messages" })).toHaveClass("umlaut", "nav-chip");
  });

  it("signed out: Sign in, then the For organisers nav button", () => {
    pathname = "/events";
    renderNav(fakeAuthValue({ status: "signed-out" }));
    const [desktopNav] = screen.getAllByRole("navigation", { name: "Primary" });
    expect(desktopNav.closest("#site-menu")).toBeNull();
    expect(linkHrefs(desktopNav)).toEqual([...PLACES, ["Sign in", "/login"], ["For organisers", "/organisers/apply"]]);
    expect(within(desktopNav).getByRole("link", { name: "Sign in" })).toHaveClass("umlaut", "label-nav");
    expect(within(desktopNav).getByRole("link", { name: "For organisers" })).toHaveClass("umlaut", "nav-button");
  });

  it("sets the three places as nav items: Label/Nav with the umlaut, Discover current on the home", () => {
    renderNav(fakeAuthValue({ status: "signed-out" }));
    const [desktopNav] = screen.getAllByRole("navigation", { name: "Primary" });
    for (const [name] of PLACES) expect(within(desktopNav).getByRole("link", { name })).toHaveClass("umlaut", "label-nav", "min-h-10");
    expect(within(desktopNav).getByRole("link", { name: "Discover" })).toHaveAttribute("aria-current", "page");
  });

  it("the avatar is a solid square with the account's initial and a caret, hidden from screen readers: the link is named Account", () => {
    renderNav(fakeAuthValue({ email: "latte@example.com" }));
    const [desktopNav] = screen.getAllByRole("navigation", { name: "Primary" });
    const avatar = within(desktopNav).getByRole("link", { name: "Account" });
    expect(avatar).toHaveAttribute("href", "/account");
    expect(avatar).toHaveTextContent(/^L$/);
    expect(avatar.querySelector("span[aria-hidden='true']")).toHaveTextContent("L");
    // The caret (the avatar menu is Batch 2; for now it's the link).
    expect(avatar.querySelectorAll("svg[aria-hidden='true']")).toHaveLength(1);
    expect(avatar).toHaveClass("umlaut", "nav-avatar");
  });

  it("marks Account as the current page on /account (desktop and menu), and For organisers on the apply page", () => {
    pathname = "/account";
    renderNav(fakeAuthValue());
    const accountLinks = screen.getAllByRole("link", { name: "Account", hidden: true });
    expect(accountLinks).toHaveLength(2);
    for (const link of accountLinks) expect(link).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "Your events", hidden: true })).not.toHaveAttribute("aria-current");
    cleanup();
    pathname = "/organisers/apply";
    renderNav(fakeAuthValue({ status: "signed-out" }));
    for (const link of screen.getAllByRole("link", { name: "For organisers", hidden: true })) {
      expect(link).toHaveAttribute("aria-current", "page");
    }
  });
});

describe("Nav — what left the header", () => {
  it("has no Saved heart and no Create profile, in any auth state", () => {
    pathname = "/events";
    for (const auth of [fakeAuthValue({ status: "signed-out" }), fakeAuthValue(), fakeAuthValue({ configured: false, status: "signed-out" })]) {
      const { container } = renderNav(auth);
      const controls = Array.from(compactBar(container).querySelectorAll("a[href], button")).map(
        (el) => el.getAttribute("aria-label") ?? el.textContent,
      );
      expect(controls).toEqual(["Sheltüh home", "Search", "Menu"]);
      const [desktopNav] = screen.getAllByRole("navigation", { name: "Primary" });
      expect(within(desktopNav).queryByRole("link", { name: "Saved" })).toBeNull();
      expect(screen.queryByRole("link", { name: /Create profile/, hidden: true })).toBeNull();
      cleanup();
    }
  });

  it("has no search field anywhere in the header, and no search icon on the desktop row", () => {
    for (const path of ["/events", "/map", "/events/neon-static"]) {
      pathname = path;
      const { container } = renderNav(fakeAuthValue());
      expect(screen.queryByRole("search")).toBeNull();
      // Only the phone bar's icon link.
      const icons = screen.getAllByRole("link", { name: "Search" });
      expect(icons).toHaveLength(1);
      expect(compactBar(container).contains(icons[0])).toBe(true);
      cleanup();
    }
  });

  // Refinement (22 Oct 2026): the home's hero has the page's one search, so the phone bar leaves its icon out there.
  it("has no search icon on the home; on /search it's marked as the current page", () => {
    const { container } = renderNav(fakeAuthValue());
    expect(screen.queryByRole("link", { name: "Search" })).toBeNull();
    expect(container.querySelector("a[href='/search']")).toBeNull();
    cleanup();
    pathname = "/search";
    renderNav(fakeAuthValue());
    expect(screen.getByRole("link", { name: "Search" })).toHaveAttribute("aria-current", "page");
  });
});

describe("Nav — header", () => {
  it("is a black ink section in both themes, 64px below lg and 96px from it, with a 1px rule only in Dark, drawn inside it", () => {
    const { container } = renderNav(fakeAuthValue({ status: "signed-out" }));
    const header = container.querySelector("header");
    expect(header).toHaveAttribute("data-surface", "ink");
    // The rule is an ::after inside the header, so it never adds to --header-h.
    expect(header).toHaveClass("after:absolute", "after:bottom-0", "after:h-px", "after:hidden", "dark:after:block");
    expect(header?.className).not.toMatch(/(?:^|\s)(?:dark:)?border-b\b/);
    expect(compactBar(container)).toHaveClass("h-16");
    const [desktopNav] = screen.getAllByRole("navigation", { name: "Primary" });
    expect(desktopNav.parentElement).toHaveClass("h-24", "gap-8");
    expect(desktopNav).toHaveClass("gap-8");
    expect(desktopNav.parentElement?.querySelector("svg")).toHaveClass("h-5");
  });

  it("gives the phone bar's controls 48px targets and the ü logo", () => {
    pathname = "/events";
    const { container } = renderNav(fakeAuthValue({ status: "signed-out" }));
    const bar = compactBar(container);
    for (const control of bar.querySelectorAll("a[href], button")) expect(control).toHaveClass("size-12");
    expect(within(bar).getByRole("link", { name: "Sheltüh home" }).querySelector("svg")).toHaveClass("h-8");
  });

  it("stays put (not sticky) on phones in a conversation, so the keyboard leaves room for the messages", () => {
    pathname = "/messages/c1";
    const { container } = renderNav(fakeAuthValue());
    const header = container.querySelector("header");
    expect(header).toHaveClass("relative", "lg:sticky");
    expect(header).not.toHaveClass("sticky");
    cleanup();
    pathname = "/messages/blocked";
    const other = renderNav(fakeAuthValue());
    expect(other.container.querySelector("header")).toHaveClass("sticky");
  });

  it("scrolls away at every width on the door check-in page, so it doesn't sit lit above the scanner", () => {
    pathname = "/dashboard/evt-1/check-in";
    const { container } = renderNav(fakeAuthValue());
    const header = container.querySelector("header");
    expect(header).toHaveClass("relative");
    expect(header).not.toHaveClass("sticky");
    expect(header).not.toHaveClass("lg:sticky");
    cleanup();
    pathname = "/dashboard/evt-1";
    expect(renderNav(fakeAuthValue()).container.querySelector("header")).toHaveClass("sticky");
  });

  it("names its two navigation landmarks distinctly: the desktop row's Primary, the phone menu's Site menu (A11)", () => {
    const { menu } = renderNav(fakeAuthValue({ status: "signed-out" }));
    const primary = screen.getAllByRole("navigation", { name: "Primary", hidden: true });
    expect(primary).toHaveLength(1);
    expect(primary[0].closest("#site-menu")).toBeNull();
    expect(within(menu).getByRole("navigation", { name: "Site menu", hidden: true })).toBeInTheDocument();
  });
});
