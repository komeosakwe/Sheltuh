// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { useEffect } from "react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import OrganiserShell from "@/components/dashboard/OrganiserShell";
import type { AuthContextValue } from "@/lib/auth/AuthContext";
import type { OrganiserRecord } from "@/lib/api/types";
import { isFullScreenOrganiserPath, ORGANISER_NAV, organiserCurrent, organiserSectionFor } from "@/lib/organiser-nav";
import { fakeAuthValue, FakeAuthProvider } from "./test-utils/fakeAuth";

/**
 * The organiser area's frame and nav (Latte's dashboard frames: "Org / Sidebar" on a desktop, the
 * collapsed rail and its drawer below 1024px; organiser-dashboard plan OD-2). jsdom shows every
 * width at once (no Tailwind), so the desktop sidebar's nav and the rail's are both in the
 * document here; a browser shows one (e2e/organiser-shell.spec.ts checks which at each width).
 */

let pathname = "/dashboard";
const push = vi.fn();
vi.mock("next/navigation", () => ({ usePathname: () => pathname, useRouter: () => ({ push }) }));

type Organiser = Pick<OrganiserRecord, "organiserId" | "status" | "displayName" | "logoUrl">;
const APPROVED: Organiser = { organiserId: "org-1", status: "approved", displayName: "Here & Now Collective" };
let organiser: Organiser | null = APPROVED;
let organiserLoading = false;
vi.mock("@/lib/auth/useOrganiser", () => ({
  useOrganiser: () => ({ loading: organiserLoading, organiser, error: null, refetch: vi.fn() }),
}));

// jsdom has no modal dialogs: give <dialog> what a browser would.
beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement) {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close = function close(this: HTMLDialogElement) {
    this.removeAttribute("open");
    this.dispatchEvent(new Event("close"));
  };
});

beforeEach(() => {
  pathname = "/dashboard";
  organiser = APPROVED;
  organiserLoading = false;
  push.mockReset();
});

afterEach(() => {
  cleanup();
  localStorage.clear();
});

function renderShell(path = "/dashboard", auth: AuthContextValue = fakeAuthValue()) {
  pathname = path;
  render(
    <FakeAuthProvider value={auth}>
      <OrganiserShell>
        <div data-page="">
          <h1>Your events</h1>
        </div>
      </OrganiserShell>
    </FakeAuthProvider>,
  );
}

function sidebar() {
  const element = document.querySelector<HTMLElement>("[data-organiser-sidebar]");
  if (!element) throw new Error("no sidebar");
  return element;
}

function rail() {
  const element = document.querySelector<HTMLElement>("[data-organiser-rail]");
  if (!element) throw new Error("no rail");
  return element;
}

/** The links marked current in a nav: [name, aria-current]. */
function current(nav: HTMLElement) {
  return within(nav)
    .getAllByRole("link")
    .filter((link) => link.hasAttribute("aria-current"))
    .map((link) => [link.textContent, link.getAttribute("aria-current")]);
}

describe("organiser nav places", () => {
  it("are the built pages, in the frames' order (Events, the Orders slot's Analytics, Payouts, the Settings slot's Profile)", () => {
    expect(ORGANISER_NAV.map((link) => [link.label, link.href])).toEqual([
      ["Events", "/dashboard"],
      ["Analytics", "/dashboard/analytics"],
      ["Payouts", "/dashboard/payouts"],
      ["Profile", "/dashboard/profile"],
    ]);
  });

  it("map each page to its place", () => {
    expect(organiserSectionFor("/dashboard")).toBe("events");
    expect(organiserSectionFor("/dashboard/new")).toBe("events");
    expect(organiserSectionFor("/dashboard/evt-1")).toBe("events");
    expect(organiserSectionFor("/dashboard/events/evt-1/orders")).toBe("events");
    expect(organiserSectionFor("/dashboard/payouts")).toBe("payouts");
    expect(organiserSectionFor("/dashboard/profile")).toBe("profile");
    expect(organiserSectionFor("/dashboard/analytics")).toBe("analytics");
    expect(organiserSectionFor("/dashboard/events/x/analytics")).toBe("analytics");
    expect(organiserSectionFor("/dashboard/payouts-ish")).toBe("events");
    expect(organiserSectionFor("/admin")).toBeNull();
  });

  it("say page on a place's own page and true on a page inside it", () => {
    const [events, analytics] = ORGANISER_NAV;
    expect(organiserCurrent(events, "/dashboard")).toBe("page");
    expect(organiserCurrent(events, "/dashboard/evt-1")).toBe("true");
    expect(organiserCurrent(analytics, "/dashboard/events/evt-1/analytics")).toBe("true");
    expect(organiserCurrent(analytics, "/dashboard")).toBe(false);
  });

  it("leave the door scanner and the seat-map editor full-screen", () => {
    expect(isFullScreenOrganiserPath("/dashboard/evt-1/check-in")).toBe(true);
    expect(isFullScreenOrganiserPath("/dashboard/evt-1/seat-map")).toBe(true);
    expect(isFullScreenOrganiserPath("/dashboard/evt-1")).toBe(false);
    expect(isFullScreenOrganiserPath("/dashboard/payouts")).toBe(false);
  });
});

describe("OrganiserShell — an approved organiser", () => {
  it("puts the page in the frame's main column, beside the sidebar and the rail", () => {
    renderShell();
    const main = document.querySelector("[data-organiser-main]");
    expect(main).toContainElement(screen.getByRole("heading", { name: "Your events" }));
    const shell = document.querySelector("[data-organiser-shell]");
    expect(shell).toContainElement(sidebar());
    expect(shell).toContainElement(rail());
    // Desktop only / tablet and phone only.
    expect(sidebar()).toHaveClass("hidden", "lg:flex");
    expect(rail()).toHaveClass("lg:hidden");
  });

  it("the sidebar: an ink column with their initials, name and 'Organiser', the places, and a white Log out", () => {
    renderShell();
    const aside = sidebar();
    expect(aside).toHaveAttribute("data-surface", "ink");
    expect(aside.tagName).toBe("ASIDE");
    expect(aside).toHaveAccessibleName("Organiser account");
    expect(aside.querySelector('[data-organiser-mark="sidebar"]')).toHaveTextContent("HC");
    expect(within(aside).getByText("Here & Now Collective")).toBeInTheDocument();
    expect(within(aside).getByText("Organiser")).toBeInTheDocument();
    const nav = within(aside).getByRole("navigation", { name: "Organiser" });
    expect(within(nav).getAllByRole("link").map((link) => link.textContent)).toEqual(["Events", "Analytics", "Payouts", "Profile"]);
    const logOut = within(aside).getByRole("button", { name: "Log out" });
    expect(logOut).toHaveClass("text-foreground");
    expect(logOut).not.toHaveClass("text-signal");
  });

  it("shows their logo in the circle when they have one, and the initials if it fails", () => {
    organiser = { ...APPROVED, logoUrl: "/api/organisers/org-1/logo?v=3" };
    renderShell();
    const logo = sidebar().querySelector("img");
    if (!logo) throw new Error("no logo");
    expect(logo).toHaveAttribute("src", "/api/organisers/org-1/logo?v=3");
    expect(logo).toHaveAttribute("alt", "");
    fireEvent.error(logo);
    expect(sidebar().querySelector("img")).toBeNull();
    expect(sidebar().querySelector('[data-organiser-mark="sidebar"]')).toHaveTextContent("HC");
  });

  it.each([
    ["/dashboard", "Events", "page"],
    ["/dashboard/payouts", "Payouts", "page"],
    ["/dashboard/profile", "Profile", "page"],
    ["/dashboard/analytics", "Analytics", "page"],
    ["/dashboard/new", "Events", "true"],
    ["/dashboard/evt-1", "Events", "true"],
    ["/dashboard/events/evt-1/orders", "Events", "true"],
    ["/dashboard/events/evt-1/analytics", "Analytics", "true"],
  ])("at %s, %s is current (aria-current=%s) in both the sidebar and the rail, and only it", (path, label, state) => {
    renderShell(path);
    expect(current(within(sidebar()).getByRole("navigation"))).toEqual([[label, state]]);
    expect(current(within(rail()).getByRole("navigation"))).toEqual([[label, state]]);
    expect(within(sidebar()).getByRole("link", { name: label })).toHaveClass("bg-surface", "text-signal");
    const railLink = within(rail()).getByRole("link", { name: label });
    expect(railLink).toHaveClass("bg-surface");
    // The rail's orange dot, only on the current place.
    expect(within(rail()).getAllByRole("link").filter((link) => link.querySelector(".bg-signal"))).toEqual([railLink]);
  });

  it("the rail: each place an icon over its visible label, 56px, then Log out (labelled too)", () => {
    const auth = fakeAuthValue();
    renderShell("/dashboard", auth);
    const aside = rail();
    expect(aside).toHaveAttribute("data-surface", "ink");
    expect(aside).toHaveAccessibleName("Organiser account");
    const links = within(within(aside).getByRole("navigation", { name: "Organiser" })).getAllByRole("link");
    expect(links.map((link) => [link.textContent, link.getAttribute("href"), link.getAttribute("data-organiser-rail-item")])).toEqual([
      ["Events", "/dashboard", "events"],
      ["Analytics", "/dashboard/analytics", "analytics"],
      ["Payouts", "/dashboard/payouts", "payouts"],
      ["Profile", "/dashboard/profile", "profile"],
    ]);
    for (const link of links) {
      expect(link).toHaveClass("w-14", "min-h-14");
      expect(link.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
      // The label is shown, not only read.
      expect(within(link).getByText(link.textContent ?? "")).not.toHaveClass("sr-only");
    }
    // Hover and focus fill differently from the current place.
    expect(links[0]).toHaveClass("bg-surface");
    expect(links[0]).not.toHaveClass("hover:bg-surface-border");
    expect(links[1]).toHaveClass("hover:bg-surface-border", "focus-visible:bg-surface-border");
    fireEvent.click(within(aside).getByRole("button", { name: "Log out" }));
    expect(auth.signOut).toHaveBeenCalled();
    expect(push).toHaveBeenCalledWith("/");
  });

  it("the page column is the skip link's target (past the sidebar), not when there's no frame", () => {
    renderShell();
    const main = document.querySelector("[data-organiser-main]");
    expect(main).toHaveAttribute("data-skip-target");
    expect(main).toHaveAttribute("tabindex", "-1");
  });

  it("» opens the full sidebar as a drawer; « closes it", () => {
    renderShell("/dashboard/payouts");
    const expand = within(rail()).getByRole("button", { name: "Show organiser menu" });
    expect(expand).toHaveAttribute("aria-expanded", "false");
    expect(expand).toHaveAttribute("aria-haspopup", "dialog");
    expect(screen.queryByRole("dialog")).toBeNull();

    fireEvent.click(expand);
    const drawer = screen.getByRole("dialog", { name: "Organiser menu" });
    expect(expand).toHaveAttribute("aria-expanded", "true");
    expect(drawer).toHaveAttribute("data-surface", "ink");
    expect(drawer).toHaveClass("w-66");
    expect(within(drawer).getByText("Here & Now Collective")).toBeInTheDocument();
    expect(current(within(drawer).getByRole("navigation", { name: "Organiser" }))).toEqual([["Payouts", "page"]]);
    // « is first, so it's where focus lands when the drawer opens.
    expect(within(drawer).getAllByRole("button")[0]).toHaveAccessibleName("Hide organiser menu");
    expect(within(drawer).getByRole("button", { name: "Log out" })).toBeInTheDocument();

    fireEvent.click(within(drawer).getByRole("button", { name: "Hide organiser menu" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(expand).toHaveAttribute("aria-expanded", "false");
  });

  it("the drawer closes when a place is chosen, and when the dialog closes itself (Escape)", () => {
    renderShell();
    fireEvent.click(within(rail()).getByRole("button", { name: "Show organiser menu" }));
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("link", { name: "Payouts" }));
    expect(screen.queryByRole("dialog")).toBeNull();

    fireEvent.click(within(rail()).getByRole("button", { name: "Show organiser menu" }));
    // What the browser does on Escape: the dialog closes and fires "close".
    const dialog = screen.getByRole("dialog");
    if (!(dialog instanceof HTMLDialogElement)) throw new Error("not a dialog");
    dialog.close();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it.each(["/dashboard/evt-1/check-in", "/dashboard/evt-1/seat-map"])("%s is full-screen: no frame, no nav", (path) => {
    renderShell(path);
    expect(document.querySelector("[data-organiser-shell]")).toBeNull();
    expect(screen.queryByRole("navigation", { name: "Organiser" })).toBeNull();
    expect(screen.getByRole("heading", { name: "Your events" })).toBeInTheDocument();
  });

  it("is the organiser layout's frame", async () => {
    const { default: DashboardLayout } = await import("@/app/dashboard/layout");
    pathname = "/dashboard/payouts";
    render(
      <FakeAuthProvider value={fakeAuthValue()}>
        <DashboardLayout params={Promise.resolve({})}>{<h1>Payouts</h1>}</DashboardLayout>
      </FakeAuthProvider>,
    );
    expect(document.querySelector("[data-organiser-main]")).toContainElement(screen.getByRole("heading", { name: "Payouts" }));
  });
});

describe("OrganiserShell — anyone else gets the page alone", () => {
  it.each<[string, () => AuthContextValue]>([
    ["signed out", () => fakeAuthValue({ status: "signed-out" })],
    ["still loading", () => fakeAuthValue({ status: "loading" })],
    ["the demo (accounts not configured)", () => fakeAuthValue({ configured: false })],
  ])("%s", (_, auth) => {
    organiser = null;
    renderShell("/dashboard", auth());
    expect(document.querySelector("[data-organiser-shell]")).toBeNull();
    expect(screen.queryByRole("navigation", { name: "Organiser" })).toBeNull();
    expect(screen.getByRole("heading", { name: "Your events" })).toBeInTheDocument();
  });

  it.each<[string, Organiser | null]>([
    ["no application", null],
    ["an application still pending", { ...APPROVED, status: "pending" }],
    ["a rejected application", { ...APPROVED, status: "rejected" }],
  ])("signed in with %s", (_, record) => {
    organiser = record;
    renderShell();
    expect(document.querySelector("[data-organiser-shell]")).toBeNull();
    expect(screen.queryByRole("navigation", { name: "Organiser" })).toBeNull();
  });

  it("the page stays mounted when the frame arrives with the organiser's record (no lost state)", () => {
    const mounts = vi.fn();
    function Page() {
      useEffect(() => {
        mounts();
      }, []);
      return <h1>Your events</h1>;
    }
    organiser = null;
    organiserLoading = true;
    const auth = fakeAuthValue();
    const { rerender } = render(
      <FakeAuthProvider value={auth}>
        <OrganiserShell>
          <Page />
        </OrganiserShell>
      </FakeAuthProvider>,
    );
    expect(document.querySelector("[data-organiser-shell]")).toBeNull();
    organiser = APPROVED;
    organiserLoading = false;
    rerender(
      <FakeAuthProvider value={auth}>
        <OrganiserShell>
          <Page />
        </OrganiserShell>
      </FakeAuthProvider>,
    );
    expect(document.querySelector("[data-organiser-main]")).toContainElement(screen.getByRole("heading", { name: "Your events" }));
    expect(mounts).toHaveBeenCalledTimes(1);
  });

  it("a returning organiser keeps the frame (places, no name yet) while the record loads; no one else does", () => {
    localStorage.setItem("sheltuh:organiser-frame", "user-1");
    organiser = null;
    organiserLoading = true;
    renderShell("/dashboard", fakeAuthValue({ userId: "user-1" }));
    expect(document.querySelector("[data-organiser-shell]")).not.toBeNull();
    expect(within(sidebar()).getAllByRole("link").map((link) => link.textContent)).toEqual(["Events", "Analytics", "Payouts", "Profile"]);
    expect(sidebar().querySelector("[data-organiser-mark]")).toHaveTextContent("");
    cleanup();
    renderShell("/dashboard", fakeAuthValue({ userId: "user-2" }));
    expect(document.querySelector("[data-organiser-shell]")).toBeNull();
    cleanup();
    // Once the record says they aren't approved (any more), the hint goes.
    organiserLoading = false;
    organiser = { ...APPROVED, status: "rejected" };
    renderShell("/dashboard", fakeAuthValue({ userId: "user-1" }));
    expect(document.querySelector("[data-organiser-shell]")).toBeNull();
    expect(localStorage.getItem("sheltuh:organiser-frame")).toBeNull();
  });

  it("an approved organiser is remembered for the next load (their user id only)", () => {
    localStorage.removeItem("sheltuh:organiser-frame");
    renderShell("/dashboard", fakeAuthValue({ userId: "user-9" }));
    expect(localStorage.getItem("sheltuh:organiser-frame")).toBe("user-9");
  });

  it("while the organiser's status loads", () => {
    organiser = null;
    organiserLoading = true;
    renderShell();
    expect(screen.queryByRole("navigation", { name: "Organiser" })).toBeNull();
  });
});
