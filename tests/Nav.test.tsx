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

describe("Nav — phone menu", () => {
  it("is a popover invoked by the Menu button, next to a Search link (off the home)", () => {
    pathname = "/events";
    const { menu } = renderNav(fakeAuthValue({ status: "signed-out", configured: true }));
    expect(menu).toHaveAttribute("popover", "auto");
    const button = screen.getByRole("button", { name: "Menu" });
    expect(button).toHaveAttribute("popovertarget", "site-menu");
    expect(screen.getByRole("link", { name: "Search" })).toHaveAttribute("href", "/search");
  });

  it("offers every destination when signed out", () => {
    const { menu } = renderNav(fakeAuthValue({ status: "signed-out", configured: true }));
    expect(linkHrefs(menu)).toEqual([
      ["Discover", "/"],
      ["Map", "/map"],
      ["Saved", "/saved"],
      ["Sign in", "/login"],
      ["For organisers", "/organisers/apply"],
    ]);
  });

  it("offers Sign in in demo mode (accounts not configured)", () => {
    const { menu } = renderNav(fakeAuthValue({ status: "signed-out", configured: false }));
    expect(within(menu).getByRole("link", { name: "Sign in", hidden: true })).toHaveAttribute("href", "/login");
  });

  it("offers Admin, Messages, My events and Account to a signed-in admin (Sign out is on /account)", () => {
    const { menu } = renderNav(fakeAuthValue({ isAdmin: true }));
    expect(linkHrefs(menu)).toEqual([
      ["Discover", "/"],
      ["Map", "/map"],
      ["Saved", "/saved"],
      ["Admin", "/admin"],
      ["Messages", "/messages"],
      ["My events", "/dashboard"],
      ["Account", "/account"],
      ["For organisers", "/organisers/apply"],
    ]);
    expect(within(menu).queryByRole("button", { name: "Sign out", hidden: true })).toBeNull();
  });

  it("hides Admin from a signed-in organiser", () => {
    const { menu } = renderNav(fakeAuthValue({ isAdmin: false }));
    expect(within(menu).queryByRole("link", { name: "Admin", hidden: true })).not.toBeInTheDocument();
    expect(within(menu).getByRole("link", { name: "My events", hidden: true })).toBeInTheDocument();
  });

  it("shows the loading placeholder while auth resolves", () => {
    const { menu } = renderNav(fakeAuthValue({ status: "loading" }));
    expect(within(menu).getByText("…")).toBeInTheDocument();
    expect(within(menu).queryByRole("link", { name: "Sign in", hidden: true })).not.toBeInTheDocument();
  });

  it("marks the current page in the menu", () => {
    pathname = "/map";
    const { menu } = renderNav(fakeAuthValue({ status: "signed-out" }));
    expect(within(menu).getByRole("link", { name: "Map", hidden: true })).toHaveAttribute("aria-current", "page");
    expect(within(menu).getByRole("link", { name: "Discover", hidden: true })).not.toHaveAttribute("aria-current");
  });

  it("marks Discover as the current section on an event's page (and What's on)", () => {
    for (const path of ["/events/neon-static", "/events"]) {
      pathname = path;
      const { menu } = renderNav(fakeAuthValue({ status: "signed-out" }));
      expect(within(menu).getByRole("link", { name: "Discover", hidden: true })).toHaveAttribute("aria-current", "true");
      expect(within(menu).getByRole("link", { name: "Map", hidden: true })).not.toHaveAttribute("aria-current");
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

  it("closes after an action inside the menu", () => {
    const { menu } = renderNav(fakeAuthValue());
    const hidePopover = vi.fn();
    menu.hidePopover = hidePopover;
    const account = within(menu).getByRole("link", { name: "Account", hidden: true });
    // Keep jsdom from attempting the navigation; the click still bubbles to the menu.
    account.addEventListener("click", (event) => event.preventDefault());
    fireEvent.click(account);
    expect(hidePopover).toHaveBeenCalled();
  });

  it("closes when keyboard focus leaves the menu for the page", () => {
    const { menu } = renderNav(fakeAuthValue({ status: "signed-out" }));
    const hidePopover = vi.fn();
    menu.hidePopover = hidePopover;
    const discover = within(menu).getByRole("link", { name: "Discover", hidden: true });
    const map = within(menu).getByRole("link", { name: "Map", hidden: true });
    fireEvent.focusOut(discover, { relatedTarget: map });
    fireEvent.focusOut(map, { relatedTarget: screen.getByRole("button", { name: "Menu" }) });
    expect(hidePopover).not.toHaveBeenCalled();
    const outside = document.createElement("button");
    document.body.append(outside);
    fireEvent.focusOut(map, { relatedTarget: outside });
    expect(hidePopover).toHaveBeenCalledTimes(1);
    outside.remove();
  });
});

describe("Nav — desktop row", () => {
  it("signed in: Messages and Account (plus Admin); My events is in the menu and on /account", () => {
    renderNav(fakeAuthValue({ isAdmin: true }));
    const [desktopNav] = screen.getAllByRole("navigation", { name: "Primary" });
    expect(linkHrefs(desktopNav)).toEqual([
      ["Discover", "/"],
      ["Map", "/map"],
      ["Saved", "/saved"],
      ["Admin", "/admin"],
      ["Messages", "/messages"],
      ["Account", "/account"],
      ["For organisers", "/organisers/apply"],
    ]);
    expect(within(desktopNav).queryByRole("button", { name: "Sign out" })).toBeNull();
  });

  it("marks Account as the current page on /account (desktop and menu)", () => {
    pathname = "/account";
    renderNav(fakeAuthValue());
    const accountLinks = screen.getAllByRole("link", { name: "Account", hidden: true });
    expect(accountLinks).toHaveLength(2);
    for (const link of accountLinks) expect(link).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "My events", hidden: true })).not.toHaveAttribute("aria-current");
  });

  it("keeps the inline site search and the same destinations", () => {
    // Off the home: the home's hero has the page's search (V16).
    pathname = "/events";
    renderNav(fakeAuthValue({ status: "signed-out" }));
    expect(screen.getByRole("search", { name: "Search the site" })).toBeInTheDocument();
    const [desktopNav] = screen.getAllByRole("navigation", { name: "Primary" });
    expect(desktopNav.closest("#site-menu")).toBeNull();
    expect(linkHrefs(desktopNav)).toEqual([
      ["Discover", "/"],
      ["Map", "/map"],
      ["Saved", "/saved"],
      ["Sign in", "/login"],
      ["For organisers", "/organisers/apply"],
    ]);
  });
});

describe("Nav — Saved", () => {
  it("puts a Saved heart in the compact bar, between Search and Menu, in every auth state", () => {
    pathname = "/events";
    for (const auth of [fakeAuthValue({ status: "signed-out" }), fakeAuthValue(), fakeAuthValue({ configured: false, status: "signed-out" })]) {
      const { container } = renderNav(auth);
      const bar = container.querySelector<HTMLElement>("header > div.lg\\:hidden");
      if (!bar) throw new Error("compact bar not rendered");
      const controls = Array.from(bar.querySelectorAll("a[href], button")).map(
        (el) => el.getAttribute("aria-label") ?? el.textContent,
      );
      expect(controls).toEqual(["Sheltüh home", "Search", "Saved", "Menu"]);
      cleanup();
    }
  });

  it("marks Saved as the current page on /saved and fills its heart", () => {
    pathname = "/saved";
    renderNav(fakeAuthValue());
    const links = screen.getAllByRole("link", { name: "Saved", hidden: true });
    // Compact bar, desktop row and the phone menu.
    expect(links).toHaveLength(3);
    for (const link of links) expect(link).toHaveAttribute("aria-current", "page");
    const hearts = links.map((link) => link.querySelector("svg")).filter((svg) => svg !== null);
    expect(hearts.length).toBe(2);
    for (const svg of hearts) expect(svg).toHaveAttribute("fill", "currentColor");
  });

  it("leaves the heart unfilled and not current elsewhere", () => {
    pathname = "/map";
    renderNav(fakeAuthValue());
    for (const link of screen.getAllByRole("link", { name: "Saved", hidden: true })) {
      expect(link).not.toHaveAttribute("aria-current");
      const svg = link.querySelector("svg");
      if (svg) expect(svg).toHaveAttribute("fill", "none");
    }
  });
});

describe("Nav — header", () => {
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

  // A3 (WCAG 2.5.3, accessibility review 22 Oct 2026): the field was named "Search by event, venue or
  // suburb" while it showed "Search events". Its name is now the words it shows.
  it("gives the desktop search a short placeholder, which is also the field's name", () => {
    pathname = "/events";
    renderNav(fakeAuthValue());
    const search = within(screen.getByRole("search", { name: "Search the site" })).getByRole("searchbox", {
      name: "Search events",
    });
    expect(search).toHaveAttribute("placeholder", "Search events");
  });

  // Refinement (22 Oct 2026): the phone bar's search icon goes on the home too, so the hero's field is
  // the page's one search (no duplicate magnifier).
  it("has no header search on the home, field or icon, where the hero's search is (V16); every other page keeps both", () => {
    const { container } = renderNav(fakeAuthValue());
    expect(screen.queryByRole("search")).toBeNull();
    expect(screen.queryByRole("link", { name: "Search" })).toBeNull();
    expect(container.querySelector("a[href='/search']")).toBeNull();
    cleanup();
    pathname = "/map";
    renderNav(fakeAuthValue());
    expect(screen.getByRole("search", { name: "Search the site" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Search" })).toHaveAttribute("href", "/search");
  });

  it("names its two navigation landmarks distinctly: the desktop row's Primary, the phone menu's Site menu (A11)", () => {
    const { menu } = renderNav(fakeAuthValue({ status: "signed-out" }));
    const primary = screen.getAllByRole("navigation", { name: "Primary", hidden: true });
    expect(primary).toHaveLength(1);
    expect(primary[0].closest("#site-menu")).toBeNull();
    expect(within(menu).getByRole("navigation", { name: "Site menu", hidden: true })).toBeInTheDocument();
  });
});
