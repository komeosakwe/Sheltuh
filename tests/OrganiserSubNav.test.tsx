// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import OrganiserShell from "@/components/dashboard/OrganiserShell";
import OrganiserSubNav, { ORGANISER_SUB_NAV, organiserSectionFor } from "@/components/dashboard/OrganiserSubNav";
import type { AuthContextValue } from "@/lib/auth/AuthContext";
import type { OrganiserRecord } from "@/lib/api/types";
import { fakeAuthValue, FakeAuthProvider } from "./test-utils/fakeAuth";

let pathname = "/dashboard";
vi.mock("next/navigation", () => ({ usePathname: () => pathname }));

let organiser: Pick<OrganiserRecord, "organiserId" | "status"> | null = { organiserId: "org-1", status: "approved" };
let organiserLoading = false;
vi.mock("@/lib/auth/useOrganiser", () => ({
  useOrganiser: () => ({ loading: organiserLoading, organiser, error: null, refetch: vi.fn() }),
}));

afterEach(() => {
  cleanup();
  pathname = "/dashboard";
  organiser = { organiserId: "org-1", status: "approved" };
  organiserLoading = false;
});

function renderAt(path: string) {
  pathname = path;
  render(<OrganiserSubNav />);
  return screen.getByRole("navigation", { name: "Organiser" });
}

/** The links marked current: [name, aria-current]. */
function current(nav: HTMLElement) {
  return within(nav)
    .getAllByRole("link")
    .filter((link) => link.hasAttribute("aria-current"))
    .map((link) => [link.textContent, link.getAttribute("aria-current")]);
}

describe("OrganiserSubNav", () => {
  it("is a nav named Organiser with the four sections in a fixed order, 44px tall, and no New event", () => {
    const nav = renderAt("/dashboard");
    expect(within(nav).getAllByRole("link").map((l) => [l.textContent, l.getAttribute("href")])).toEqual([
      ["Events", "/dashboard"],
      ["Payouts", "/dashboard/payouts"],
      ["Analytics", "/dashboard/analytics"],
      ["Profile", "/dashboard/profile"],
    ]);
    for (const link of within(nav).getAllByRole("link")) {
      expect(link).toHaveClass("min-h-11");
      // Narrower on phones, so the four fit on one row at 320px.
      expect(link).toHaveClass("px-1.5", "sm:px-2");
      expect(link).not.toHaveClass("px-2");
    }
    expect(within(nav).queryByRole("link", { name: /new event/i })).toBeNull();
    expect(within(nav).getByRole("list")).toHaveClass("flex-wrap");
  });

  it("marks each section's own page with aria-current=page, and only that one", () => {
    for (const link of ORGANISER_SUB_NAV) {
      const nav = renderAt(link.href);
      expect(current(nav)).toEqual([[link.label, "page"]]);
      cleanup();
    }
  });

  it("marks the section (aria-current=true) on a page inside it", () => {
    expect(current(renderAt("/dashboard/new"))).toEqual([["Events", "true"]]);
    cleanup();
    expect(current(renderAt("/dashboard/evt-1"))).toEqual([["Events", "true"]]);
    cleanup();
    expect(current(renderAt("/dashboard/evt-1/seat-map"))).toEqual([["Events", "true"]]);
    cleanup();
    expect(current(renderAt("/dashboard/events/evt-1/analytics"))).toEqual([["Analytics", "true"]]);
  });

  it("isn't shown at the door scanner, which has its own way back", () => {
    pathname = "/dashboard/evt-1/check-in";
    const { container } = render(<OrganiserSubNav />);
    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByRole("navigation", { name: "Organiser" })).toBeNull();
  });

  it("maps paths to sections", () => {
    expect(organiserSectionFor("/dashboard")).toBe("/dashboard");
    expect(organiserSectionFor("/dashboard/payouts")).toBe("/dashboard/payouts");
    expect(organiserSectionFor("/dashboard/profile")).toBe("/dashboard/profile");
    expect(organiserSectionFor("/dashboard/analytics")).toBe("/dashboard/analytics");
    expect(organiserSectionFor("/dashboard/events/x/analytics")).toBe("/dashboard/analytics");
    expect(organiserSectionFor("/dashboard/payouts-ish")).toBe("/dashboard");
    expect(organiserSectionFor("/admin")).toBeNull();
  });

  it("is in the organiser layout, before the page", async () => {
    const { default: DashboardLayout } = await import("@/app/dashboard/layout");
    pathname = "/dashboard/payouts";
    render(
      <FakeAuthProvider value={fakeAuthValue()}>
        <DashboardLayout params={Promise.resolve({})}>{<h1>Payouts</h1>}</DashboardLayout>
      </FakeAuthProvider>,
    );
    const nav = screen.getByRole("navigation", { name: "Organiser" });
    expect(nav.compareDocumentPosition(screen.getByRole("heading", { name: "Payouts" })) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});

describe("OrganiserShell — the sub-nav only for a signed-in approved organiser", () => {
  function renderShell(auth: AuthContextValue) {
    render(
      <FakeAuthProvider value={auth}>
        <OrganiserShell>
          <h1>Your events</h1>
        </OrganiserShell>
      </FakeAuthProvider>,
    );
  }

  it("an approved organiser gets the sub-nav, then the page", () => {
    renderShell(fakeAuthValue());
    expect(screen.getByRole("navigation", { name: "Organiser" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Your events" })).toBeInTheDocument();
  });

  it.each<[string, () => AuthContextValue]>([
    ["signed out", () => fakeAuthValue({ status: "signed-out" })],
    ["still loading", () => fakeAuthValue({ status: "loading" })],
    ["the demo (accounts not configured)", () => fakeAuthValue({ configured: false })],
  ])("%s: the page alone, no sub-nav", (_, auth) => {
    organiser = null;
    renderShell(auth());
    expect(screen.queryByRole("navigation", { name: "Organiser" })).toBeNull();
    expect(screen.getByRole("heading", { name: "Your events" })).toBeInTheDocument();
  });

  it.each<[string, Pick<OrganiserRecord, "organiserId" | "status"> | null]>([
    ["no application", null],
    ["an application still pending", { organiserId: "org-1", status: "pending" }],
    ["a rejected application", { organiserId: "org-1", status: "rejected" }],
  ])("signed in with %s: the page alone, no sub-nav", (_, record) => {
    organiser = record;
    renderShell(fakeAuthValue());
    expect(screen.queryByRole("navigation", { name: "Organiser" })).toBeNull();
    expect(screen.getByRole("heading", { name: "Your events" })).toBeInTheDocument();
  });

  it("while the organiser's status loads: no sub-nav yet", () => {
    organiser = null;
    organiserLoading = true;
    renderShell(fakeAuthValue());
    expect(screen.queryByRole("navigation", { name: "Organiser" })).toBeNull();
  });
});
