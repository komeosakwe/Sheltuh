// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AdminBreadcrumbs } from "@/components/admin/AdminPage";
import AdminSubNav, { ADMIN_SUB_NAV, adminSectionFor } from "@/components/admin/AdminSubNav";
import { needsYouTotal } from "@/lib/admin-summary";
import { adminSummary, FakeAdminSummaryProvider } from "./test-utils/fakeAdminSummary";

let pathname = "/admin";
vi.mock("next/navigation", () => ({ usePathname: () => pathname }));

afterEach(() => {
  cleanup();
  pathname = "/admin";
});

const SUMMARY = adminSummary({
  reportsOpen: { count: 3, oldestAt: null },
  eventsPending: { count: 2, soonestStartsAt: null, startingSoon: 0, startingSoonHours: 72 },
  emailsFailed: { count: 1 },
  emailsRetrying: { count: 5 },
  doorEvents: { count: 4, windowHours: 24 },
});

function renderSubNav() {
  render(
    <FakeAdminSummaryProvider value={{ summary: SUMMARY }}>
      <AdminSubNav />
    </FakeAdminSummaryProvider>,
  );
  return screen.getByRole("navigation", { name: "Admin" });
}

describe("AdminSubNav", () => {
  it("lists every area in a fixed order, the count in each link's name, and New event last", () => {
    const nav = renderSubNav();
    expect(within(nav).getAllByRole("link").map((l) => [l.textContent?.replace(/\d+,.*$/, "").trim(), l.getAttribute("href")])).toEqual([
      ["Overview", "/admin"],
      ["Reports", "/admin/reports"],
      ["Events", "/admin/events"],
      ["Organisers", "/admin/organisers"],
      ["Emails", "/admin/emails"],
      ["Trending", "/admin/trending"],
      ["New event", "/admin/events/new"],
    ]);
    expect(within(nav).getByRole("link", { name: "Reports, 3 open" })).toBeInTheDocument();
    expect(within(nav).getByRole("link", { name: "Events, 2 waiting" })).toBeInTheDocument();
    expect(within(nav).getByRole("link", { name: "Emails, 1 failed" })).toBeInTheDocument();
    // Nothing waiting: no badge, no count in the name.
    expect(within(nav).getByRole("link", { name: "Organisers" })).toBeInTheDocument();
    // The number is decorative, not a live region.
    const badge = within(nav).getByRole("link", { name: "Reports, 3 open" }).querySelector("[data-admin-count]");
    expect(badge).toHaveAttribute("aria-hidden", "true");
    expect(nav.querySelector("[aria-live]")).toBeNull();
  });

  it("marks the current area: the page itself, or (as true) a page inside it, an event's edit page counting as Events", () => {
    pathname = "/admin/events/evt-1/edit";
    const nav = renderSubNav();
    expect(within(nav).getByRole("link", { name: "Events, 2 waiting" })).toHaveAttribute("aria-current", "true");
    expect(within(nav).getByRole("link", { name: "Overview" })).not.toHaveAttribute("aria-current");
    cleanup();
    pathname = "/admin/events";
    expect(within(renderSubNav()).getByRole("link", { name: "Events, 2 waiting" })).toHaveAttribute("aria-current", "page");
    cleanup();
    pathname = "/admin/events/new";
    const onNew = renderSubNav();
    expect(within(onNew).getByRole("link", { name: "New event" })).toHaveAttribute("aria-current", "page");
    expect(within(onNew).getByRole("link", { name: "Events, 2 waiting" })).not.toHaveAttribute("aria-current");
    expect(adminSectionFor("/admin/events/new")).toBe("/admin/events/new");
    expect(adminSectionFor("/admin")).toBe("/admin");
    expect(adminSectionFor("/admin/trending")).toBe("/admin/trending");
  });

  it("each area's page is titled with its sub-nav label", async () => {
    const pages: Record<string, { metadata: { title?: unknown } }> = {
      "/admin/reports": await import("@/app/admin/reports/page"),
      "/admin/events": await import("@/app/admin/events/page"),
      "/admin/organisers": await import("@/app/admin/organisers/page"),
      "/admin/emails": await import("@/app/admin/emails/page"),
      "/admin/trending": await import("@/app/admin/trending/page"),
    };
    for (const link of ADMIN_SUB_NAV.filter((l) => l.href !== "/admin")) {
      expect(pages[link.href]?.metadata.title).toBe(`${link.label} — Sheltüh admin`);
    }
  });

  it("totals only what needs an admin (not retrying emails or door events)", () => {
    expect(needsYouTotal(SUMMARY)).toBe(6);
  });
});

describe("AdminBreadcrumbs", () => {
  it("is a named nav with an ordered list; the current page is marked and isn't a link", () => {
    render(
      <AdminBreadcrumbs
        trail={[
          { href: "/admin", label: "Admin" },
          { href: "/admin/events", label: "Events" },
          { label: "Edit event" },
        ]}
      />,
    );
    const nav = screen.getByRole("navigation", { name: "Breadcrumb" });
    expect(within(nav).getAllByRole("listitem")).toHaveLength(3);
    expect(within(nav).getAllByRole("link").map((l) => l.getAttribute("href"))).toEqual(["/admin", "/admin/events"]);
    expect(within(nav).getByText("Edit event")).toHaveAttribute("aria-current", "page");
  });
});
