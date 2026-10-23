// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { Suspense } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import AnalyticsOverview from "@/components/analytics/AnalyticsOverview";
import { ApiError } from "@/lib/api/client";
import type { OrganiserRecord } from "@/lib/api/types";
import type { AuthContextValue } from "@/lib/auth/AuthContext";
import { days, overview, totals } from "./test-utils/analyticsFixtures";
import { fakeAuthValue, FakeAuthProvider } from "./test-utils/fakeAuth";

let search = "";
const replace = vi.fn();
vi.mock("next/navigation", () => ({
  usePathname: () => "/dashboard/analytics",
  useRouter: () => ({ replace, push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(search),
}));

let organiserState: { loading: boolean; organiser: Partial<OrganiserRecord> | null; error: string | null } = {
  loading: false,
  organiser: { organiserId: "org-1", status: "approved" },
  error: null,
};
vi.mock("@/lib/auth/useOrganiser", () => ({ useOrganiser: () => ({ ...organiserState, refetch: vi.fn() }) }));

const api = {
  getAnalyticsOverview: vi.fn(),
  downloadAnalyticsOverviewCsv: vi.fn(),
};
vi.mock("@/lib/api/analytics", () => ({
  getAnalyticsOverview: (...a: unknown[]) => api.getAnalyticsOverview(...a),
  downloadAnalyticsOverviewCsv: (...a: unknown[]) => api.downloadAnalyticsOverviewCsv(...a),
}));

beforeEach(() => {
  search = "";
  replace.mockReset();
  organiserState = { loading: false, organiser: { organiserId: "org-1", status: "approved" }, error: null };
  for (const fn of Object.values(api)) fn.mockReset();
});
afterEach(cleanup);

function renderOverview(auth: AuthContextValue = fakeAuthValue()) {
  return render(
    <FakeAuthProvider value={auth}>
      <Suspense fallback={null}>
        <AnalyticsOverview />
      </Suspense>
    </FakeAuthProvider>,
  );
}

/** The stat grid as label → [value, change?] (the first dl on the page). */
function statValues() {
  const grid = document.querySelector("dl");
  if (!grid) throw new Error("no stats");
  return Object.fromEntries(
    Array.from(grid.children).map((item) => {
      const [dt, ...dds] = Array.from(item.children);
      return [dt.textContent, dds.map((dd) => dd.textContent)];
    }),
  );
}

describe("AnalyticsOverview — states", () => {
  it("demo: says accounts aren't configured, and calls nothing", () => {
    renderOverview(fakeAuthValue({ configured: false, status: "signed-out" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Accounts aren’t configured in this environment yet.");
    expect(screen.getByRole("heading", { level: 1, name: "Analytics" })).toBeInTheDocument();
    expect(api.getAnalyticsOverview).not.toHaveBeenCalled();
  });

  it("auth or organiser loading: Loading…", () => {
    organiserState = { loading: true, organiser: null, error: null };
    renderOverview();
    expect(screen.getByRole("progressbar", { name: "Loading your account" })).toBeInTheDocument();
    // The gate is the page's whole content, so it carries the page's h1.
    expect(screen.getByRole("heading", { level: 1, name: "Analytics" })).toBeInTheDocument();
    expect(api.getAnalyticsOverview).not.toHaveBeenCalled();
  });

  it("signed out: Sign in, back to analytics", () => {
    renderOverview(fakeAuthValue({ status: "signed-out", email: undefined }));
    // The prompt is the page's h1.
    expect(screen.getByRole("heading", { level: 1, name: "Sign in to see your analytics" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Sign in" })).toHaveAttribute("href", "/login?next=%2Fdashboard%2Fanalytics");
  });

  it("not an approved organiser: the dashboard's copy and Apply link", () => {
    organiserState = { loading: false, organiser: { status: "pending" }, error: null };
    renderOverview();
    expect(screen.getByText("Your organiser application is still pending review.")).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1, name: "Analytics" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "View application" })).toHaveAttribute("href", "/organisers/apply");
    expect(api.getAnalyticsOverview).not.toHaveBeenCalled();
  });

  it("a 403 from the API is the not-approved state, not an error", async () => {
    api.getAnalyticsOverview.mockRejectedValue(new ApiError(403, "Organisers only."));
    renderOverview();
    expect(await screen.findByRole("link", { name: "Apply as an organiser" })).toBeInTheDocument();
    expect(screen.queryByText("Couldn’t load analytics.")).toBeNull();
  });

  it("first load: a busy region", () => {
    api.getAnalyticsOverview.mockImplementation(() => new Promise(() => {}));
    renderOverview();
    expect(screen.getByRole("progressbar", { name: "Loading analytics" }).closest("[aria-busy='true']")).not.toBeNull();
    expect(screen.getByRole("heading", { level: 1, name: "Analytics" })).toBeInTheDocument();
  });

  it("error: an alert with Try again, which reloads", async () => {
    api.getAnalyticsOverview.mockRejectedValueOnce(new ApiError(500, "boom")).mockResolvedValue(overview());
    renderOverview();
    expect(await screen.findByRole("alert")).toHaveTextContent("Couldn’t load analytics.");
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByRole("region", { name: "By event" })).toBeInTheDocument();
    expect(api.getAnalyticsOverview).toHaveBeenCalledTimes(2);
  });

  it("nothing yet: points to making an event", async () => {
    api.getAnalyticsOverview.mockResolvedValue(overview({ events: [] }));
    renderOverview();
    expect(await screen.findByText("Nothing to show yet")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "New event" })).toHaveAttribute("href", "/dashboard/new");
  });
});

describe("AnalyticsOverview — report", () => {
  it("asks for the last 30 days by default and shows the headline numbers with cents", async () => {
    api.getAnalyticsOverview.mockResolvedValue(overview());
    renderOverview();
    await screen.findByRole("region", { name: "By event" });
    expect(api.getAnalyticsOverview).toHaveBeenCalledWith(expect.any(Function), {
      from: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
      to: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
    });
    const stats = statValues();
    expect(stats.Views).toEqual(["1,204"]);
    expect(stats.Orders).toEqual(["41"]);
    expect(stats.Conversion).toEqual(["3.4%"]);
    expect(stats.Gross).toEqual(["A$1,204.50"]);
    expect(stats.Net).toEqual(["A$1,120.00"]);
    expect(stats.Fees).toBeUndefined(); // the event page has fees; the overview doesn't
    expect(await screen.findByText("Showing Last 30 days.")).toHaveAttribute("role", "status");
  });

  it("with compare: the change in words, never colour", async () => {
    search = "range=7d&compare=1";
    api.getAnalyticsOverview.mockResolvedValue(
      overview({
        range: { from: "2026-10-09", to: "2026-10-15" },
        previous: { range: { from: "2026-10-02", to: "2026-10-08" }, totals: totals({ grossCents: 107545, orders: 0 }), byDay: [] },
      }),
    );
    renderOverview();
    await screen.findByRole("region", { name: "By event" });
    expect(api.getAnalyticsOverview).toHaveBeenCalledWith(expect.any(Function), expect.objectContaining({ compare: "prevPeriod" }));
    const stats = statValues();
    expect(stats.Gross).toEqual(["A$1,204.50", "Up 12% vs previous 7 days"]);
    expect(stats.Orders).toEqual(["41", "New this period"]);
    expect(stats.Views).toEqual(["1,204", "No change vs previous 7 days"]);
  });

  it("views not counted yet: '—' read as 'No data', never 0, with a footnote", async () => {
    api.getAnalyticsOverview.mockResolvedValue(
      overview({ viewsTrackedSince: null, totals: totals({ views: 0, conversionRate: null }) }),
    );
    renderOverview();
    await screen.findByRole("region", { name: "By event" });
    expect(statValues().Views).toEqual(["—No data"]);
    expect(statValues().Conversion).toEqual(["—No data"]);
    expect(screen.getByText(/Page views weren't being counted yet in this period/)).toBeInTheDocument();
  });

  it("views counted part-way: shows the count, conversion as no data, and when counting began", async () => {
    api.getAnalyticsOverview.mockResolvedValue(overview({ viewsTrackedSince: "2026-10-01", totals: totals({ conversionRate: null }) }));
    renderOverview();
    await screen.findByRole("region", { name: "By event" });
    expect(statValues().Views).toEqual(["1,204"]);
    expect(statValues().Conversion).toEqual(["—No data"]);
    expect(screen.getByText(/Views were first counted on 1 October 2026/)).toBeInTheDocument();
  });

  it("notes days where some views may be missing (optional API flag)", async () => {
    api.getAnalyticsOverview.mockResolvedValue(
      overview({ byDay: days("2026-10-01", 3, (i) => (i === 1 ? { viewsUnreliable: true } as object : {})) }),
    );
    renderOverview();
    expect(await screen.findByText("Some views may be missing on these days: 2 Oct.")).toBeInTheDocument();
  });

  it("lists each event, linking to its analytics, with totals", async () => {
    api.getAnalyticsOverview.mockResolvedValue(overview());
    renderOverview();
    const panel = await screen.findByRole("region", { name: "By event" });
    const table = within(panel).getByRole("table", { name: "Views and sales by event" });
    expect(within(table).getByRole("link", { name: "Night Market" })).toHaveAttribute(
      "href",
      "/dashboard/events/evt-1/analytics",
    );
    expect(within(table).getByText("Fri 23 Oct · Published")).toBeInTheDocument();
    const totalsRow = within(table).getByRole("rowheader", { name: "Total" }).closest("tr");
    expect(totalsRow).toHaveTextContent("A$1,204.50");
  });

  it("changing the range updates the URL (no scroll)", async () => {
    api.getAnalyticsOverview.mockResolvedValue(overview());
    renderOverview();
    await screen.findByRole("region", { name: "By event" });
    fireEvent.change(screen.getByLabelText("Date range"), { target: { value: "7d" } });
    expect(replace).toHaveBeenCalledWith("/dashboard/analytics?range=7d", { scroll: false });
    expect(screen.queryByRole("option", { name: "All time" })).toBeNull();
  });

  it("custom dates apply on Apply, and an end before the start is refused on the field", async () => {
    api.getAnalyticsOverview.mockResolvedValue(overview());
    renderOverview();
    await screen.findByRole("region", { name: "By event" });
    fireEvent.change(screen.getByLabelText("Date range"), { target: { value: "custom" } });
    expect(replace).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText("From"), { target: { value: "2026-10-10" } });
    fireEvent.change(screen.getByLabelText("To"), { target: { value: "2026-10-01" } });
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));
    const to = screen.getByLabelText("To");
    expect(to).toHaveAttribute("aria-invalid", "true");
    expect(to).toHaveAccessibleDescription("Choose an end date on or after the start date.");
    expect(to).toHaveFocus();
    expect(replace).not.toHaveBeenCalled();
    fireEvent.change(to, { target: { value: "2026-10-12" } });
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));
    expect(replace).toHaveBeenCalledWith("/dashboard/analytics?range=custom&from=2026-10-10&to=2026-10-12", { scroll: false });
  });

  it("a range the API refuses (400) shows its message on To", async () => {
    search = "range=custom&from=2024-01-01&to=2026-10-01";
    api.getAnalyticsOverview.mockRejectedValue(new ApiError(400, "Bad range.", { to: "Choose a range of two years or less." }));
    renderOverview();
    expect(await screen.findByText("Choose a range of two years or less.")).toBeInTheDocument();
    expect(screen.getByLabelText("To")).toHaveAttribute("aria-invalid", "true");
  });

  it("Export CSV downloads the API's file for the range", async () => {
    api.getAnalyticsOverview.mockResolvedValue(overview());
    api.downloadAnalyticsOverviewCsv.mockResolvedValue(new Blob(["a,b"], { type: "text/csv" }));
    const createObjectURL = vi.fn(() => "blob:x");
    Object.assign(URL, { createObjectURL, revokeObjectURL: vi.fn() });
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    renderOverview();
    const button = await screen.findByRole("button", { name: "Export CSV for Last 30 days" });
    fireEvent.click(button);
    await waitFor(() => expect(click).toHaveBeenCalled());
    expect(api.downloadAnalyticsOverviewCsv).toHaveBeenCalledWith(expect.any(Function), expect.objectContaining({ from: expect.any(String) }));
    const anchor = click.mock.contexts[0] as HTMLAnchorElement;
    expect(anchor.download).toBe("sheltuh-analytics_2026-09-16_2026-10-15.csv");
    click.mockRestore();
  });

  it("an export failure is shown beside the button", async () => {
    api.getAnalyticsOverview.mockResolvedValue(overview());
    api.downloadAnalyticsOverviewCsv.mockRejectedValue(new ApiError(500, "boom"));
    renderOverview();
    fireEvent.click(await screen.findByRole("button", { name: "Export CSV for Last 30 days" }));
    expect(await screen.findByText("Couldn't prepare the file. Try again.")).toHaveAttribute("role", "alert");
  });
});
