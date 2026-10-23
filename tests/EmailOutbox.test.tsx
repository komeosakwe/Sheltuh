// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import EmailOutbox from "@/components/admin/EmailOutbox";
import { ApiError } from "@/lib/api/client";
import type { AdminEmailJob } from "@/lib/api/types";
import { fakeAuthValue, FakeAuthProvider } from "./test-utils/fakeAuth";

vi.mock("@/lib/api/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api/client")>()),
  isApiConfigured: true,
}));
const adminListEmailJobs = vi.fn();
const adminResendEmailJob = vi.fn();
vi.mock("@/lib/api/admin", () => ({
  adminListEmailJobs: (...args: unknown[]) => adminListEmailJobs(...args),
  adminResendEmailJob: (...args: unknown[]) => adminResendEmailJob(...args),
}));

beforeEach(() => {
  adminListEmailJobs.mockReset();
  adminResendEmailJob.mockReset();
});
afterEach(cleanup);

function job(overrides: Partial<AdminEmailJob> = {}): AdminEmailJob {
  return {
    jobId: "7",
    kind: "ticket_email",
    status: "failed",
    attempts: 6,
    lastError: "421 Service not available",
    createdAt: "2026-10-14T09:00:00.000Z",
    orderReference: "#7C1F2E0A",
    orderStatus: "paid",
    eventTitle: "Neon Static",
    maskedEmail: "m***@example.com",
    ...overrides,
  };
}

function renderOutbox() {
  render(
    <FakeAuthProvider value={fakeAuthValue({ isAdmin: true })}>
      <EmailOutbox />
    </FakeAuthProvider>,
  );
}

describe("EmailOutbox", () => {
  it("lists failed emails by order reference and masked address, and resends one", async () => {
    adminListEmailJobs.mockResolvedValue({ items: [job()] });
    adminResendEmailJob.mockResolvedValue(job({ status: "pending", attempts: 0, lastError: undefined }));
    renderOutbox();

    const item = (await screen.findByRole("heading", { name: "Order #7C1F2E0A: Neon Static" })).closest("article")!;
    expect(within(item).getByText("m***@example.com")).toBeInTheDocument();
    expect(within(item).getByText("421 Service not available")).toBeInTheDocument();
    expect(adminListEmailJobs).toHaveBeenCalledWith("failed", expect.any(Function));

    fireEvent.click(within(item).getByRole("button", { name: "Resend now" }));
    expect(await screen.findByRole("status")).toHaveTextContent(
      "Resending the email for order #7C1F2E0A. It’s moved to Retrying.",
    );
    expect(adminResendEmailJob).toHaveBeenCalledWith("7", expect.any(Function));
    // It's no longer failed, so it leaves the Failed list rather than sitting there as "Retrying".
    expect(screen.queryByRole("heading", { name: "Order #7C1F2E0A: Neon Static" })).toBeNull();
    expect(screen.getByText("Nothing has failed")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("heading", { name: "Failed ticket emails" })).toHaveFocus());
  });

  it("moves focus to the next email when a resent one leaves the list", async () => {
    adminListEmailJobs.mockResolvedValue({
      items: [job(), job({ jobId: "8", orderReference: "#8D2A3B1C" }), job({ jobId: "9", orderReference: "#9E3B4C2D" })],
    });
    adminResendEmailJob.mockResolvedValue(job({ jobId: "8", orderReference: "#8D2A3B1C", status: "pending", attempts: 0 }));
    renderOutbox();
    const middle = (await screen.findByRole("heading", { name: "Order #8D2A3B1C: Neon Static" })).closest("article")!;
    fireEvent.click(within(middle).getByRole("button", { name: "Resend now" }));
    await waitFor(() => expect(screen.queryByRole("heading", { name: "Order #8D2A3B1C: Neon Static" })).toBeNull());
    await waitFor(() => expect(screen.getByRole("heading", { name: "Order #9E3B4C2D: Neon Static" })).toHaveFocus());
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
  });

  it("updates a resent email in place when it stays in the same view", async () => {
    adminListEmailJobs.mockResolvedValue({ items: [job({ status: "pending", lastError: "timeout" })] });
    adminResendEmailJob.mockResolvedValue(job({ status: "pending", attempts: 0, lastError: undefined }));
    renderOutbox();
    // Switch to the Retrying view, then resend from it.
    fireEvent.click(await screen.findByRole("button", { name: "Retrying" }));
    const item = (await screen.findByRole("heading", { name: "Order #7C1F2E0A: Neon Static" })).closest("article")!;
    expect(within(item).getByText("timeout")).toBeInTheDocument();
    fireEvent.click(within(item).getByRole("button", { name: "Resend now" }));
    expect(await screen.findByRole("status")).toHaveTextContent("Resending the email for order #7C1F2E0A.");
    expect(screen.getByRole("heading", { name: "Order #7C1F2E0A: Neon Static" })).toBeInTheDocument();
    expect(within(item).queryByText("timeout")).toBeNull();
  });

  it("shows why a resend was refused", async () => {
    adminListEmailJobs.mockResolvedValue({ items: [job()] });
    adminResendEmailJob.mockRejectedValue(new ApiError(429, "That email was resent in the last few minutes."));
    renderOutbox();
    fireEvent.click(await screen.findByRole("button", { name: "Resend now" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("That email was resent in the last few minutes.");
  });

  it("switches status with pressed toggle buttons", async () => {
    adminListEmailJobs.mockResolvedValue({ items: [] });
    renderOutbox();
    expect(await screen.findByText("Nothing has failed")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Sent" }));
    expect(screen.getByRole("button", { name: "Sent" })).toHaveAttribute("aria-pressed", "true");
    // Pressed shows the two dots too, not colour alone.
    expect(screen.getByRole("button", { name: "Sent" }).querySelector("[data-selected-dots]")).not.toBeNull();
    expect(await screen.findByRole("heading", { name: "Sent ticket emails" })).toBeInTheDocument();
    expect(adminListEmailJobs).toHaveBeenLastCalledWith("sent", expect.any(Function));
  });
});
