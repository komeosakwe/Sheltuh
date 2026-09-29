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
    .map((link) => [link.textContent, link.getAttribute("href")]);
}

describe("Nav — phone menu", () => {
  it("is a popover invoked by the Menu button, next to a Search link", () => {
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
      ["Sign in", "/login"],
      ["For organisers", "/organisers/apply"],
    ]);
  });

  it("offers Sign in in demo mode (accounts not configured)", () => {
    const { menu } = renderNav(fakeAuthValue({ status: "signed-out", configured: false }));
    expect(within(menu).getByRole("link", { name: "Sign in", hidden: true })).toHaveAttribute("href", "/login");
  });

  it("offers Admin, My events and Sign out to a signed-in admin", () => {
    const { menu } = renderNav(fakeAuthValue({ isAdmin: true }));
    expect(linkHrefs(menu)).toEqual([
      ["Discover", "/"],
      ["Map", "/map"],
      ["Admin", "/admin"],
      ["My events", "/dashboard"],
      ["For organisers", "/organisers/apply"],
    ]);
    expect(within(menu).getByRole("button", { name: "Sign out", hidden: true })).toBeInTheDocument();
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

  it("relabels the button and focuses the first link when opened, and resets on close", () => {
    const { menu } = renderNav(fakeAuthValue({ status: "signed-out" }));
    fireToggle(menu, "open");
    expect(screen.getByRole("button", { name: "Close" })).toBeInTheDocument();
    expect(within(menu).getByRole("link", { name: "Discover", hidden: true })).toHaveFocus();
    fireToggle(menu, "closed");
    expect(screen.getByRole("button", { name: "Menu" })).toBeInTheDocument();
  });

  it("closes after an action inside the menu", () => {
    const signOut = vi.fn();
    const { menu } = renderNav(fakeAuthValue({ signOut }));
    const hidePopover = vi.fn();
    menu.hidePopover = hidePopover;
    fireEvent.click(within(menu).getByRole("button", { name: "Sign out", hidden: true }));
    expect(signOut).toHaveBeenCalled();
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
  it("keeps the inline site search and the same destinations", () => {
    renderNav(fakeAuthValue({ status: "signed-out" }));
    expect(screen.getByRole("search", { name: "Search the site" })).toBeInTheDocument();
    const [desktopNav] = screen.getAllByRole("navigation", { name: "Primary" });
    expect(desktopNav.closest("#site-menu")).toBeNull();
    expect(linkHrefs(desktopNav)).toEqual([
      ["Discover", "/"],
      ["Map", "/map"],
      ["Sign in", "/login"],
      ["For organisers", "/organisers/apply"],
    ]);
  });
});
