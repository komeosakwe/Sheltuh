// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AdminSummaryContextValue } from "@/components/admin/AdminSummaryProvider";
import AdminLayout from "@/app/admin/layout";
import AdminHomePage from "@/app/admin/page";
import type { AuthContextValue } from "@/lib/auth/AuthContext";
import { adminSummary, FakeAdminSummaryProvider } from "./test-utils/fakeAdminSummary";
import { fakeAuthValue, FakeAuthProvider } from "./test-utils/fakeAuth";

vi.mock("next/navigation", () => ({
  usePathname: () => "/admin",
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));

afterEach(cleanup);

function renderHub(auth: AuthContextValue, summary: Partial<AdminSummaryContextValue> = {}) {
  return render(
    <FakeAuthProvider value={auth}>
      <FakeAdminSummaryProvider value={summary}>
        <AdminLayout params={Promise.resolve({})}>
          <AdminHomePage />
        </AdminLayout>
      </FakeAdminSummaryProvider>
    </FakeAuthProvider>,
  );
}

const section = (name: string) => screen.getByRole("region", { name });

describe("Admin hub", () => {
  it("is in three sections, each a heading: Needs you, Manage, Done outside Sheltüh admin", () => {
    renderHub(fakeAuthValue({ isAdmin: true }), { summary: adminSummary() });
    expect(screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent)).toEqual([
      "Needs you",
      "Manage",
      "Done outside Sheltüh admin",
    ]);
    expect(within(section("Needs you")).getAllByRole("heading", { level: 3 }).map((h) => h.textContent)).toEqual([
      "Member reports",
      "Event submissions",
      "Organiser applications",
      "Failed ticket emails",
    ]);
  });

  it("each Needs you card links to its queue, says what's waiting and what to do", () => {
    renderHub(fakeAuthValue({ isAdmin: true }), {
      summary: adminSummary({
        reportsOpen: { count: 3, oldestAt: "2026-10-20T01:00:00.000Z" },
        eventsPending: { count: 4, soonestStartsAt: "2026-10-25T09:00:00.000Z", startingSoon: 1, startingSoonHours: 72 },
        emailsRetrying: { count: 2 },
      }),
    });
    const needs = section("Needs you");
    const reports = within(needs).getByRole("link", { name: /^Member reports/ });
    expect(reports).toHaveAttribute("href", "/admin/reports");
    expect(reports).toHaveTextContent("3 open · oldest from");
    // What to do is the link's description, not part of its name.
    expect(reports).not.toHaveTextContent("Dismiss, or suspend the member");
    expect(reports).toHaveAccessibleName(/^Member reports\s*3 open · oldest from/);
    expect(reports).toHaveAccessibleDescription("Dismiss, or suspend the member.");
    const events = within(needs).getByRole("link", { name: /^Event submissions/ });
    expect(events).toHaveAttribute("href", "/admin/events");
    expect(events).toHaveTextContent("4 waiting · 1 starts within 3 days");
    // Nothing waiting: the card stays, says so, and is still a link.
    expect(within(needs).getByRole("link", { name: /^Organiser applications/ })).toHaveTextContent("All clear");
    expect(within(needs).getByRole("link", { name: /^Failed ticket emails/ })).toHaveTextContent(
      "All clear · 2 retrying automatically",
    );
  });

  it("Manage links to the tools, with the door count", () => {
    renderHub(fakeAuthValue({ isAdmin: true }), {
      summary: adminSummary({ doorEvents: { count: 2, windowHours: 24 } }),
    });
    const manage = section("Manage");
    expect(within(manage).getAllByRole("link").map((l) => l.getAttribute("href"))).toEqual([
      "/admin/events?status=published",
      "/admin/events?status=published&view=recent",
      "/admin/organisers?status=approved",
      "/admin/events/new",
      "/admin/invites",
      "/admin/trending",
      "/admin/events?status=published&view=door",
    ]);
    expect(within(manage).getByRole("link", { name: /^Door check-in/ })).toHaveTextContent("2 events in the next 24 hours");
    expect(within(manage).getByRole("link", { name: "Invite someone" })).toHaveAccessibleDescription(
      "As an organiser or a member.",
    );
    expect(within(section("Done outside Sheltüh admin")).getByText(/Stripe dashboard/)).toBeInTheDocument();
  });

  it("Recently published: how many organisers published themselves lately, linking to the recent view", () => {
    const { unmount } = renderHub(fakeAuthValue({ isAdmin: true }), {
      summary: adminSummary({ eventsPublishedByOrganisers: { count: 3, windowHours: 72 } }),
    });
    const card = within(section("Manage")).getByRole("link", { name: /^Recently published/ });
    expect(card).toHaveAttribute("href", "/admin/events?status=published&view=recent");
    expect(card).toHaveTextContent("3 by organisers in the last 3 days");
    expect(card).toHaveAccessibleDescription(/Unpublish anything that shouldn’t be live/);
    expect(within(card).getByText("3 by organisers in the last 3 days")).toHaveClass("text-foreground");
    unmount();

    renderHub(fakeAuthValue({ isAdmin: true }), {
      summary: adminSummary({ eventsPublishedByOrganisers: { count: 1, windowHours: 72 } }),
    });
    expect(within(section("Manage")).getByRole("link", { name: /^Recently published/ })).toHaveTextContent(
      "1 by an organiser in the last 3 days",
    );
  });

  it("Recently published says None when there are none, and has no count from an older server (field absent)", () => {
    const { unmount } = renderHub(fakeAuthValue({ isAdmin: true }), {
      summary: adminSummary({ eventsPublishedByOrganisers: { count: 0, windowHours: 72 } }),
    });
    const none = within(section("Manage")).getByRole("link", { name: /^Recently published/ });
    expect(within(none).getByText("None by organisers in the last 3 days")).toHaveClass("text-muted");
    unmount();

    renderHub(fakeAuthValue({ isAdmin: true }), { summary: adminSummary() });
    const card = within(section("Manage")).getByRole("link", { name: /^Recently published/ });
    expect(card).toHaveTextContent(/^Recently published$/);
    expect(card).not.toHaveTextContent("Checking…");
  });

  it("while the counts load the cards say so; if they fail, an alert offers to check again and the links still work", () => {
    const { unmount } = renderHub(fakeAuthValue({ isAdmin: true }));
    expect(within(section("Needs you")).getAllByText("Checking…")).toHaveLength(4);
    unmount();
    const refresh = vi.fn();
    renderHub(fakeAuthValue({ isAdmin: true }), { summary: null, failed: true, refresh });
    expect(screen.getByRole("alert")).toHaveTextContent("Couldn’t check what’s waiting. The links still work.");
    fireEvent.click(screen.getByRole("button", { name: "Check again" }));
    expect(refresh).toHaveBeenCalled();
    expect(within(section("Needs you")).getByRole("link", { name: /^Member reports/ })).toHaveAttribute("href", "/admin/reports");
  });

  it("if the API says the account isn't an admin any more, says so instead of checking forever", () => {
    renderHub(fakeAuthValue({ isAdmin: true }), { summary: null, denied: true });
    expect(screen.getByRole("alert")).toHaveTextContent("this account no longer has admin access");
    expect(screen.queryByText("Checking…")).toBeNull();
    expect(within(section("Needs you")).getByRole("link", { name: /^Member reports/ })).toHaveAttribute("href", "/admin/reports");
  });

  it("shows the admin sub-nav to an admin", () => {
    renderHub(fakeAuthValue({ isAdmin: true }), { summary: adminSummary() });
    expect(screen.getByRole("navigation", { name: "Admin" })).toBeInTheDocument();
  });

  it("shows no admin page or sub-nav to a member without admin access", () => {
    renderHub(fakeAuthValue({ isAdmin: false }));
    expect(screen.queryByRole("navigation", { name: "Admin" })).toBeNull();
    expect(screen.queryByRole("heading", { name: "Needs you" })).toBeNull();
    expect(screen.getByRole("heading", { level: 1, name: "Admin" })).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("Your account doesn’t have admin access.");
  });

  it("in the demo (accounts not configured) says so, and shows nothing else", () => {
    renderHub(fakeAuthValue({ configured: false, status: "signed-out" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Accounts aren’t configured in this environment yet.");
    expect(screen.queryByRole("navigation", { name: "Admin" })).toBeNull();
  });

  it("asks a signed-out visitor to sign in", () => {
    renderHub(fakeAuthValue({ status: "signed-out" }));
    expect(screen.getByRole("link", { name: "Sign in" })).toHaveAttribute("href", "/login");
  });
});
