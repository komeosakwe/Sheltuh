// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
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
    expect(await screen.findByRole("status")).toHaveTextContent("Resending the email for order #7C1F2E0A.");
    expect(adminResendEmailJob).toHaveBeenCalledWith("7", expect.any(Function));
    expect(within(item).queryByText("421 Service not available")).toBeNull();
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
    expect(await screen.findByRole("heading", { name: "Sent ticket emails" })).toBeInTheDocument();
    expect(adminListEmailJobs).toHaveBeenLastCalledWith("sent", expect.any(Function));
  });
});
