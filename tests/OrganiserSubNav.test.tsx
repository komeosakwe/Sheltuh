// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import OrganiserSubNav, { ORGANISER_SUB_NAV, organiserSectionFor } from "@/components/dashboard/OrganiserSubNav";

let pathname = "/dashboard";
vi.mock("next/navigation", () => ({ usePathname: () => pathname }));

afterEach(() => {
  cleanup();
  pathname = "/dashboard";
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
      ["Your events", "/dashboard"],
      ["Payouts", "/dashboard/payouts"],
      ["Analytics", "/dashboard/analytics"],
      ["Public profile", "/dashboard/profile"],
    ]);
    for (const link of within(nav).getAllByRole("link")) expect(link).toHaveClass("min-h-11");
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
    expect(current(renderAt("/dashboard/new"))).toEqual([["Your events", "true"]]);
    cleanup();
    expect(current(renderAt("/dashboard/evt-1"))).toEqual([["Your events", "true"]]);
    cleanup();
    expect(current(renderAt("/dashboard/evt-1/seat-map"))).toEqual([["Your events", "true"]]);
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
    render(<DashboardLayout params={Promise.resolve({})}>{<h1>Payouts</h1>}</DashboardLayout>);
    const nav = screen.getByRole("navigation", { name: "Organiser" });
    expect(nav.compareDocumentPosition(screen.getByRole("heading", { name: "Payouts" })) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});
