// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ReportQueue from "@/components/admin/ReportQueue";
import { ApiError } from "@/lib/api/client";
import type { AdminReport } from "@/lib/api/types";
import { fakeAuthValue, FakeAuthProvider } from "./test-utils/fakeAuth";

vi.mock("@/lib/api/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api/client")>()),
  isApiConfigured: true,
}));
const adminListReports = vi.fn();
const adminResolveReport = vi.fn();
vi.mock("@/lib/api/admin", () => ({
  adminListReports: (...args: unknown[]) => adminListReports(...args),
  adminResolveReport: (...args: unknown[]) => adminResolveReport(...args),
}));

beforeEach(() => {
  adminListReports.mockReset();
  adminResolveReport.mockReset();
});
afterEach(cleanup);

function report(id: string, overrides: Partial<AdminReport> = {}): AdminReport {
  return {
    reportId: id,
    status: "open",
    reason: "harassment",
    createdAt: "2026-09-26T09:00:00.000Z",
    reportedDisplayName: `Person ${id}`,
    reportedAccountExists: true,
    reportedSuspended: false,
    eventTitle: "Neon Static",
    context: [],
    ...overrides,
  };
}

function renderQueue() {
  return render(
    <FakeAuthProvider value={fakeAuthValue({ isAdmin: true })}>
      <ReportQueue />
    </FakeAuthProvider>,
  );
}

describe("Admin: member reports", () => {
  it("shows open reports with the evidence as plain text", async () => {
    adminListReports.mockResolvedValue({
      items: [
        report("r1", {
          details: "Kept messaging <img src=x onerror=alert(1)>",
          messageBody: "line one\nline two",
          context: [
            { from: "reporter", body: "Hi", sentAt: "2026-09-26T08:00:00.000Z" },
            { from: "reported", body: "<script>x</script>", sentAt: "2026-09-26T08:05:00.000Z" },
          ],
        }),
      ],
    });
    const { container } = renderQueue();
    const heading = await screen.findByRole("heading", { name: "Harassment or bullying: Person r1" });
    const article = heading.closest("article");
    if (!article) throw new Error("no article");
    expect(adminListReports).toHaveBeenCalledWith("open", expect.any(Function));
    expect(article).toHaveTextContent("Kept messaging <img src=x onerror=alert(1)>");
    expect(article).toHaveTextContent("Met at Neon Static");
    expect(within(article).getByText(/line one/).textContent).toBe("line one\nline two");
    expect(article).toHaveTextContent("<script>x</script>");
    expect(container.querySelector("img, script")).toBeNull();
    expect(screen.getByRole("button", { name: "Open" })).toHaveAttribute("aria-pressed", "true");
  });

  it("Dismiss sends the note, removes the report, announces it and focuses the next", async () => {
    adminListReports.mockResolvedValue({ items: [report("r1"), report("r2")] });
    adminResolveReport.mockResolvedValue(report("r1", { status: "dismissed" }));
    renderQueue();
    await screen.findByRole("heading", { name: /Person r1/ });
    const first = screen.getByRole("heading", { name: /Person r1/ }).closest("article") as HTMLElement;
    fireEvent.change(within(first).getByLabelText("Note (admins only, optional)"), { target: { value: " Not a breach " } });
    fireEvent.click(within(first).getByRole("button", { name: "Dismiss" }));
    await waitFor(() => expect(screen.queryByRole("heading", { name: /Person r1/ })).toBeNull());
    expect(adminResolveReport).toHaveBeenCalledWith("r1", { action: "dismiss", note: "Not a breach" }, expect.any(Function));
    expect(screen.getByRole("status")).toHaveTextContent("Report dismissed.");
    await waitFor(() => expect(screen.getByRole("heading", { name: /Person r2/ })).toHaveFocus());
  });

  it("Suspend asks first (focus on Cancel), then suspends", async () => {
    adminListReports.mockResolvedValue({ items: [report("r1")] });
    adminResolveReport.mockResolvedValue(report("r1", { status: "actioned" }));
    renderQueue();
    await screen.findByRole("heading", { name: /Person r1/ });
    fireEvent.click(screen.getByRole("button", { name: "Suspend member" }));
    expect(screen.getByRole("group", { name: /Suspend Person r1\?/ })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("button", { name: "Cancel" })).toHaveFocus());
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Suspend member" })).toHaveFocus());
    fireEvent.click(screen.getByRole("button", { name: "Suspend member" }));
    fireEvent.click(screen.getByRole("button", { name: "Yes, suspend" }));
    await waitFor(() =>
      expect(adminResolveReport).toHaveBeenCalledWith("r1", { action: "suspend", note: undefined }, expect.any(Function)),
    );
    expect(await screen.findByText("Nothing to review")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Member suspended. Report closed.");
  });

  it("409 (someone else resolved it): the report leaves the queue and that's announced", async () => {
    adminListReports.mockResolvedValue({ items: [report("r1")] });
    adminResolveReport.mockRejectedValue(new ApiError(409, "This report has already been resolved."));
    renderQueue();
    await screen.findByRole("heading", { name: /Person r1/ });
    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(await screen.findByText("Nothing to review")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("already resolved by someone else");
  });

  it("other failures are shown on the report and it stays", async () => {
    adminListReports.mockResolvedValue({ items: [report("r1")] });
    adminResolveReport.mockRejectedValue(new ApiError(500, "boom"));
    renderQueue();
    await screen.findByRole("heading", { name: /Person r1/ });
    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Couldn’t save that. Try again.");
    expect(screen.getByRole("heading", { name: /Person r1/ })).toBeInTheDocument();
  });

  it("switches to resolved reports, which have no actions and show the outcome", async () => {
    adminListReports.mockResolvedValueOnce({ items: [] }).mockResolvedValueOnce({
      items: [report("r9", { status: "dismissed", resolvedAt: "2026-09-27T09:00:00.000Z", resolutionNote: "Fine" })],
    });
    renderQueue();
    await screen.findByText("Nothing to review");
    fireEvent.click(screen.getByRole("button", { name: "Dismissed" }));
    const heading = await screen.findByRole("heading", { name: /Person r9/ });
    expect(adminListReports).toHaveBeenLastCalledWith("dismissed", expect.any(Function));
    const article = heading.closest("article") as HTMLElement;
    expect(article).toHaveTextContent("Note: Fine");
    expect(within(article).queryByRole("button")).toBeNull();
  });

  it("doesn't offer Suspend when there's nothing to suspend, and says why", async () => {
    adminListReports.mockResolvedValue({
      items: [
        report("r1", { reportedSuspended: true }),
        report("r2", { reportedAccountExists: false, reportedDisplayName: "Gone G." }),
      ],
    });
    renderQueue();
    const first = (await screen.findByRole("heading", { name: /Person r1/ })).closest("article") as HTMLElement;
    const second = screen.getByRole("heading", { name: /Gone G\./ }).closest("article") as HTMLElement;
    for (const article of [first, second]) {
      expect(within(article).queryByRole("button", { name: "Suspend member" })).toBeNull();
      expect(within(article).getByRole("button", { name: "Dismiss" })).toBeInTheDocument();
    }
    expect(first).toHaveTextContent("They’re already suspended");
    expect(second).toHaveTextContent("Suspending isn’t available: they’ve deleted their account.");
  });

  it("dates from another year carry the year; the transcript has a visible disclosure marker", async () => {
    adminListReports.mockResolvedValue({
      items: [report("r1", { createdAt: "2024-06-01T02:00:00.000Z", context: [{ from: "reported", body: "hi", sentAt: "2024-06-01T01:00:00.000Z" }] })],
    });
    renderQueue();
    const article = (await screen.findByRole("heading", { name: /Person r1/ })).closest("article") as HTMLElement;
    expect(article).toHaveTextContent(/Reported .* 2024, /);
    const summary = article.querySelector("summary");
    expect(summary?.querySelector("[aria-hidden='true']")).toHaveTextContent("▸");
  });
});
