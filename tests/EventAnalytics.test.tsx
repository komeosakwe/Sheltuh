// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import { Suspense } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import EventAnalytics from "@/components/analytics/EventAnalytics";
import { ApiError } from "@/lib/api/client";
import { days, eventReport, stubMatchMedia, totals } from "./test-utils/analyticsFixtures";
import { fakeAuthValue, FakeAuthProvider } from "./test-utils/fakeAuth";

let search = "";
vi.mock("next/navigation", () => ({
  usePathname: () => "/dashboard/events/evt-1/analytics",
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(search),
}));
vi.mock("@/lib/auth/useOrganiser", () => ({
  useOrganiser: () => ({ loading: false, organiser: { organiserId: "org-1", status: "approved" }, error: null, refetch: vi.fn() }),
}));

const api = {
  getEventAnalytics: vi.fn(),
  downloadEventAnalyticsCsv: vi.fn(),
  listTrackingLinks: vi.fn(),
  createTrackingLink: vi.fn(),
  deleteTrackingLink: vi.fn(),
};
vi.mock("@/lib/api/analytics", () => ({
  getEventAnalytics: (...a: unknown[]) => api.getEventAnalytics(...a),
  downloadEventAnalyticsCsv: (...a: unknown[]) => api.downloadEventAnalyticsCsv(...a),
  listTrackingLinks: (...a: unknown[]) => api.listTrackingLinks(...a),
  createTrackingLink: (...a: unknown[]) => api.createTrackingLink(...a),
  deleteTrackingLink: (...a: unknown[]) => api.deleteTrackingLink(...a),
}));

beforeEach(() => {
  stubMatchMedia();
  search = "";
  for (const fn of Object.values(api)) fn.mockReset();
  api.listTrackingLinks.mockResolvedValue({ items: [] });
});
afterEach(() => {
  cleanup();
  Reflect.deleteProperty(window, "matchMedia");
});

function renderEvent(auth = fakeAuthValue()) {
  return render(
    <FakeAuthProvider value={auth}>
      <Suspense fallback={null}>
        <EventAnalytics eventId="evt-1" />
      </Suspense>
    </FakeAuthProvider>,
  );
}

describe("EventAnalytics — states", () => {
  it("demo: accounts aren't configured, no API calls", () => {
    renderEvent(fakeAuthValue({ configured: false, status: "signed-out" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Accounts aren’t configured");
    expect(api.getEventAnalytics).not.toHaveBeenCalled();
    expect(api.listTrackingLinks).not.toHaveBeenCalled();
  });

  it("signed out: Sign in, back to this event's analytics", () => {
    renderEvent(fakeAuthValue({ status: "signed-out", email: undefined }));
    expect(screen.getByRole("link", { name: "Sign in" })).toHaveAttribute(
      "href",
      "/login?next=%2Fdashboard%2Fevents%2Fevt-1%2Fanalytics",
    );
  });

  it("missing or someone else's (404): Event not found as the page heading", async () => {
    api.getEventAnalytics.mockRejectedValue(new ApiError(404, "Event not found."));
    renderEvent();
    expect(await screen.findByRole("heading", { level: 1, name: "Event not found" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Back to analytics" })).toHaveAttribute("href", "/dashboard/analytics");
  });

  it("first load: back links, a heading and a busy region", () => {
    api.getEventAnalytics.mockImplementation(() => new Promise(() => {}));
    renderEvent();
    const nav = screen.getByRole("navigation", { name: "Event" });
    expect(within(nav).getByRole("link", { name: "Edit event" })).toHaveAttribute("href", "/dashboard/evt-1");
    expect(screen.getByRole("heading", { level: 1 })).toBeInTheDocument();
    expect(screen.getByRole("progressbar", { name: "Loading analytics" }).closest("[aria-busy='true']")).not.toBeNull();
  });

  it("never published: says when counting starts, hides the numbers, keeps tracking links", async () => {
    api.getEventAnalytics.mockResolvedValue(
      eventReport({ event: { ...eventReport().event, status: "draft", everPublished: false } }),
    );
    renderEvent();
    expect(await screen.findByText("Analytics start when this event is published. Nothing has been counted yet.")).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Over time" })).toBeNull();
    expect(screen.queryByRole("link", { name: "View event page" })).toBeNull();
    expect(screen.getByRole("region", { name: "Tracking links" })).toBeInTheDocument();
  });
});

describe("EventAnalytics — report", () => {
  it("asks for the event's whole life by default (no dates) and heads the page with the event", async () => {
    api.getEventAnalytics.mockResolvedValue(eventReport());
    renderEvent();
    expect(await screen.findByRole("heading", { level: 1, name: "Night Market" })).toBeInTheDocument();
    expect(api.getEventAnalytics).toHaveBeenCalledWith("evt-1", expect.any(Function), {});
    expect(screen.getByText("Fri 23 Oct · The Shed · Published")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "View event page" })).toHaveAttribute("href", "/events/night-market");
    expect(screen.getByLabelText("Date range")).toHaveValue("all");
    expect(screen.getByRole("checkbox", { name: "Compare with the previous period" })).toBeDisabled();
  });

  it("charts are labelled images with the numbers as a table, null views as 'No data'", async () => {
    api.getEventAnalytics.mockResolvedValue(
      eventReport({ viewsTrackedSince: "2026-10-03", byDay: days("2026-10-01", 14, (i) => (i < 2 ? { views: null } : {})), totals: totals({ conversionRate: null }) }),
    );
    renderEvent();
    const panel = await screen.findByRole("region", { name: "Over time" });
    const charts = within(panel).getAllByRole("img");
    expect(charts[0]).toHaveAccessibleName(
      "Page views per day, 1 to 14 October 2026. Total 120. Highest 10 on 3 October 2026.",
    );
    expect(charts[1]).toHaveAccessibleName(expect.stringMatching(/^Tickets sold per day, 1 to 14 October 2026\. Total 28\./));
    expect(within(panel).getByText("Views before 3 Oct weren't counted.")).toBeInTheDocument();

    const table = within(panel).getByRole("table", { name: "Views and sales per day" });
    const first = within(table).getByRole("rowheader", { name: "1 Oct" }).closest("tr");
    if (!first) throw new Error("row missing");
    expect(within(first).getAllByRole("cell")[0]).toHaveTextContent("—No data");
    const third = within(table).getByRole("rowheader", { name: "3 Oct" }).closest("tr");
    if (!third) throw new Error("row missing");
    expect(within(third).getAllByRole("cell").map((c) => c.textContent)).toEqual([
      "10",
      "1",
      "2",
      "A$10.00",
      "A$1.00",
      "A$9.00",
    ]);
  });

  it("with compare, the table adds the previous period's views and tickets", async () => {
    search = "range=7d&compare=1";
    api.getEventAnalytics.mockResolvedValue(
      eventReport({
        range: { from: "2026-10-08", to: "2026-10-14" },
        byDay: days("2026-10-08", 7),
        previous: { range: { from: "2026-10-01", to: "2026-10-07" }, totals: totals(), byDay: days("2026-10-01", 7, () => ({ views: 3 })) },
      }),
    );
    renderEvent();
    const panel = await screen.findByRole("region", { name: "Over time" });
    const table = within(panel).getByRole("table", { name: "Views and sales per day" });
    expect(within(table).getByRole("columnheader", { name: "Previous views" })).toBeInTheDocument();
    const row = within(table).getByRole("rowheader", { name: "8 Oct" }).closest("tr");
    if (!row) throw new Error("row missing");
    expect(within(row).getAllByRole("cell").at(-2)).toHaveTextContent("3");
  });

  it("a period with no activity shows the chart overlay and zeros", async () => {
    api.getEventAnalytics.mockResolvedValue(
      eventReport({
        totals: totals({ views: 0, orders: 0, ticketsSold: 0, grossCents: 0, feesCents: 0, netCents: 0, conversionRate: null }),
        byDay: days("2026-10-01", 14, () => ({ views: 0, orders: 0, ticketsSold: 0, grossCents: 0, feesCents: 0, netCents: 0 })),
      }),
    );
    renderEvent();
    expect(await screen.findByText("No views in this period.")).toBeInTheDocument();
    expect(screen.getByText("No sales in this period.")).toBeInTheDocument();
  });

  it("by ticket type: face price, who pays the fee, sold against capacity for all time", async () => {
    api.getEventAnalytics.mockResolvedValue(eventReport());
    renderEvent();
    const panel = await screen.findByRole("region", { name: "By ticket type" });
    const table = within(panel).getByRole("table");
    const general = within(table).getByRole("rowheader", { name: "General" }).closest("tr");
    if (!general) throw new Error("row missing");
    expect(general).toHaveTextContent("A$25.00Buyer pays fee");
    expect(general).toHaveTextContent("42 of 100");
    const free = within(table).getByRole("rowheader", { name: "Free list" }).closest("tr");
    expect(free).toHaveTextContent("FreeNo booking fee");
    expect(free).toHaveTextContent("18 of 18 · Sold out");
  });

  it("traffic sources: the API's buckets with shares, social grouped, and no sales by source", async () => {
    api.getEventAnalytics.mockResolvedValue(eventReport());
    renderEvent();
    const panel = await screen.findByRole("region", { name: "Traffic sources" });
    const table = within(panel).getByRole("table");
    const social = within(table).getByRole("rowheader", { name: "Social" }).closest("tr");
    expect(social).toHaveTextContent("80467%");
    const tiktok = within(table).getByRole("rowheader", { name: "TikTok" }).closest("tr");
    expect(tiktok).toHaveTextContent("<1%");
    const x = within(table).getByRole("rowheader", { name: "X (Twitter)" }).closest("tr");
    expect(x).toHaveTextContent("00%");
    expect(within(table).queryByRole("columnheader", { name: "Orders" })).toBeNull();
    expect(within(panel).getByText("Sales can’t be split by source, only by tracking link.")).toBeInTheDocument();
  });

  it("tracking links in the period, including a deleted link's code", async () => {
    api.getEventAnalytics.mockResolvedValue(eventReport());
    renderEvent();
    const panel = await screen.findByRole("region", { name: "Tracking links in this period" });
    expect(within(panel).getByRole("rowheader", { name: "Instagram bio" }).closest("tr")).toHaveTextContent("5.0%");
    expect(within(panel).getByRole("rowheader", { name: "Deleted link (zz9yx8wv)" })).toBeInTheDocument();
  });

  it("attendance: checked in against sold, all time, with the way to the door for a published event", async () => {
    api.getEventAnalytics.mockResolvedValue(
      eventReport({ attendance: { checkedIn: 129, ticketsSold: 240, byTicketType: [] } }),
    );
    renderEvent();
    const panel = await screen.findByRole("region", { name: "At the door" });
    expect(within(panel).getByText("129")).toBeInTheDocument();
    expect(within(panel).getByText("of 240 tickets sold (54%). All time, whatever the dates above.")).toBeInTheDocument();
    expect(within(panel).getByRole("link", { name: "Open door check-in" })).toHaveAttribute("href", "/dashboard/evt-1/check-in");
    // The note no longer promises check-ins "later".
    expect(screen.queryByText(/Door check-ins/)).toBeNull();
  });

  it("attendance null (nothing sold yet): says so, no numbers", async () => {
    api.getEventAnalytics.mockResolvedValue(eventReport({ attendance: null }));
    renderEvent();
    const panel = await screen.findByRole("region", { name: "At the door" });
    expect(within(panel).getByText("No tickets have been sold yet, so there’s no one to check in.")).toBeInTheDocument();
  });

  it("attendance missing (an older response): no panel", async () => {
    api.getEventAnalytics.mockResolvedValue(eventReport());
    renderEvent();
    await screen.findByRole("region", { name: "Over time" });
    expect(screen.queryByRole("region", { name: "At the door" })).toBeNull();
  });
});
