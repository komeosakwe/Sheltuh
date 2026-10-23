// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import { Suspense } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import AnalyticsOverview from "@/components/analytics/AnalyticsOverview";
import EventAnalytics from "@/components/analytics/EventAnalytics";
import { clicksReliabilityNote } from "@/components/analytics/OutboundClicks";
import { addDays } from "@/lib/analytics-format";
import type { OutboundClickStats } from "@/lib/api/types";
import { eventReport, overview, stubMatchMedia, totals } from "./test-utils/analyticsFixtures";
import { fakeAuthValue, FakeAuthProvider } from "./test-utils/fakeAuth";

/** Outbound (ticket-link) clicks for external events in organiser analytics (F4). */

vi.mock("next/navigation", () => ({
  usePathname: () => "/dashboard/analytics",
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(""),
}));
vi.mock("@/lib/auth/useOrganiser", () => ({
  useOrganiser: () => ({ loading: false, organiser: { organiserId: "org-1", status: "approved" }, error: null, refetch: vi.fn() }),
}));
const api = {
  getEventAnalytics: vi.fn(),
  downloadEventAnalyticsCsv: vi.fn(),
  getAnalyticsOverview: vi.fn(),
  downloadAnalyticsOverviewCsv: vi.fn(),
  listTrackingLinks: vi.fn(),
  createTrackingLink: vi.fn(),
  deleteTrackingLink: vi.fn(),
};
vi.mock("@/lib/api/analytics", () => ({
  getEventAnalytics: (...a: unknown[]) => api.getEventAnalytics(...a),
  downloadEventAnalyticsCsv: (...a: unknown[]) => api.downloadEventAnalyticsCsv(...a),
  getAnalyticsOverview: (...a: unknown[]) => api.getAnalyticsOverview(...a),
  downloadAnalyticsOverviewCsv: (...a: unknown[]) => api.downloadAnalyticsOverviewCsv(...a),
  listTrackingLinks: (...a: unknown[]) => api.listTrackingLinks(...a),
  createTrackingLink: (...a: unknown[]) => api.createTrackingLink(...a),
  deleteTrackingLink: (...a: unknown[]) => api.deleteTrackingLink(...a),
}));

beforeEach(() => {
  stubMatchMedia();
  for (const fn of Object.values(api)) fn.mockReset();
  api.listTrackingLinks.mockResolvedValue({ items: [] });
});
afterEach(() => {
  cleanup();
  Reflect.deleteProperty(window, "matchMedia");
});

function clickStats(from: string, n: number, clicks: (i: number) => number, unreliable: number[] = []): OutboundClickStats {
  const byDay = Array.from({ length: n }, (_, i) => ({ date: addDays(from, i), clicks: clicks(i), unreliable: unreliable.includes(i) }));
  return { total: byDay.reduce((a, d) => a + d.clicks, 0), unreliable: unreliable.length > 0, byDay };
}

function renderWithAuth(node: React.ReactNode) {
  return render(
    <FakeAuthProvider value={fakeAuthValue()}>
      <Suspense fallback={null}>{node}</Suspense>
    </FakeAuthProvider>,
  );
}

describe("event analytics: ticket link clicks", () => {
  it("an external event: the total, the change, a chart per day and the cap-reached days named", async () => {
    const report = eventReport({ outboundClicks: { ...clickStats("2026-10-01", 14, (i) => i, [2, 5]), previous: clickStats("2026-09-17", 14, () => 2) } });
    report.event.ticketingMode = "external";
    api.getEventAnalytics.mockResolvedValue(report);
    renderWithAuth(<EventAnalytics eventId="evt-1" />);

    const region = await screen.findByRole("region", { name: "Ticket link clicks" });
    // 0 + 1 + … + 13 = 91, against 28 in the previous 14 days.
    const stat = within(region).getAllByText("Ticket link clicks").find((el) => el.tagName === "DT");
    expect(stat?.nextElementSibling).toHaveTextContent("91");
    expect(within(region).getByText("Up 225% vs previous 14 days")).toBeInTheDocument();
    expect(within(region).getByRole("img", { name: /^Ticket link clicks per day, .*Total 91\. Highest 13 on 14 October 2026\.$/ })).toBeInTheDocument();
    expect(within(region).getAllByText("Some clicks may be missing on these days: 3 Oct, 6 Oct.").length).toBeGreaterThan(0);
    // The day table flags those days in words.
    expect(within(region).getAllByText("some may be missing").length).toBeGreaterThanOrEqual(2);
    // And says sales happen on the other site.
    expect(region).toHaveTextContent(/aren’t counted here/);
  });

  it("a Sheltüh-ticketed event (outboundClicks null): no clicks section", async () => {
    api.getEventAnalytics.mockResolvedValue(eventReport({ outboundClicks: null }));
    renderWithAuth(<EventAnalytics eventId="evt-1" />);
    await screen.findByRole("region", { name: "Over time" });
    expect(screen.queryByRole("region", { name: "Ticket link clicks" })).toBeNull();
  });
});

describe("analytics overview: ticket link clicks", () => {
  it("adds the organiser-wide clicks and a per-event column when there's an external event", async () => {
    api.getAnalyticsOverview.mockResolvedValue(
      overview({
        outboundClicks: clickStats("2026-09-16", 30, (i) => (i === 29 ? 7 : 0)),
        events: [
          { eventId: "evt-1", title: "Night Market", slug: "night-market", status: "published", startsAt: "2026-10-23T09:00:00.000Z", totals: totals() },
          {
            eventId: "evt-2",
            title: "Dub Session",
            slug: "dub-session",
            status: "published",
            startsAt: "2026-10-24T09:00:00.000Z",
            totals: totals({ orders: 0, ticketsSold: 0, grossCents: 0, feesCents: 0, netCents: 0, conversionRate: 0 }),
            ticketingMode: "external",
            outboundClicks: { total: 7, unreliable: false },
          },
        ],
      }),
    );
    renderWithAuth(<AnalyticsOverview />);
    const region = await screen.findByRole("region", { name: "Ticket link clicks" });
    expect(within(region).getAllByText("7").length).toBeGreaterThan(0);
    const byEvent = screen.getByRole("region", { name: "By event" });
    expect(within(byEvent).getAllByText("Ticket link clicks").length).toBeGreaterThan(0);
  });

  it("no external events (outboundClicks null): no section and no column", async () => {
    api.getAnalyticsOverview.mockResolvedValue(overview({ outboundClicks: null }));
    renderWithAuth(<AnalyticsOverview />);
    const byEvent = await screen.findByRole("region", { name: "By event" });
    expect(screen.queryByRole("region", { name: "Ticket link clicks" })).toBeNull();
    expect(within(byEvent).queryByText("Ticket link clicks")).toBeNull();
  });
});

describe("clicksReliabilityNote", () => {
  it("names the days, or the period when there's no per-day flag, or nothing", () => {
    expect(clicksReliabilityNote(clickStats("2026-10-01", 3, () => 1, [1]))).toBe("Some clicks may be missing on these days: 2 Oct.");
    expect(clicksReliabilityNote({ ...clickStats("2026-10-01", 3, () => 1), unreliable: true })).toBe(
      "Some clicks may be missing in this period.",
    );
    expect(clicksReliabilityNote(clickStats("2026-10-01", 3, () => 1))).toBeNull();
  });
});
