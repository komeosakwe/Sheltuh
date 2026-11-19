// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import EmailOutbox from "@/components/admin/EmailOutbox";
import { ApiError } from "@/lib/api/client";
import type { AdminEmailJob } from "@/lib/api/types";
import { fakeAuthValue, FakeAuthProvider } from "./test-utils/fakeAuth";
import { fakeUrl } from "./test-utils/fakeUrl";

vi.mock("next/navigation", async () => (await import("./test-utils/fakeUrl")).fakeNavigation);

vi.mock("@/lib/api/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api/client")>()),
  isApiConfigured: true,
}));
const adminListEmailJobs = vi.fn();
const adminResendEmailJob = vi.fn();
const adminChangeOrderEmail = vi.fn();
vi.mock("@/lib/api/admin", () => ({
  adminListEmailJobs: (...args: unknown[]) => adminListEmailJobs(...args),
  adminResendEmailJob: (...args: unknown[]) => adminResendEmailJob(...args),
  adminChangeOrderEmail: (...args: unknown[]) => adminChangeOrderEmail(...args),
}));

beforeEach(() => {
  fakeUrl.set("");
  fakeUrl.replace.mockReset();
  adminListEmailJobs.mockReset();
  adminResendEmailJob.mockReset();
  adminChangeOrderEmail.mockReset();
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
      "Resending the email for order #7C1F2E0A. It’s moved to Retrying automatically.",
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
    // Switch to the Retrying automatically view, then resend from it.
    fireEvent.click(await screen.findByRole("button", { name: "Retrying automatically" }));
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
    expect(fakeUrl.replace).toHaveBeenLastCalledWith("/admin/emails?status=sent", { scroll: false });
  });

  it("opens on the URL's filter, with plain labels for what's happening to each email", async () => {
    fakeUrl.set("status=sending");
    adminListEmailJobs.mockResolvedValue({ items: [] });
    renderOutbox();
    expect(await screen.findByRole("heading", { name: "Ticket emails sending now" })).toBeInTheDocument();
    expect(adminListEmailJobs).toHaveBeenCalledWith("sending", expect.any(Function));
    const group = screen.getByRole("group", { name: "Show emails" });
    expect(within(group).getAllByRole("button").map((b) => b.textContent)).toEqual([
      "Failed",
      "Retrying automatically",
      "Sending now",
      "Sent",
    ]);
    expect(within(group).getByRole("button", { name: "Sending now" })).toHaveAttribute("aria-pressed", "true");
  });

  it("a Load more answering after the filter changed doesn't replace the new list", async () => {
    let finishMore: (page: { items: AdminEmailJob[] }) => void = () => {};
    adminListEmailJobs.mockImplementation(async (status: string, _getToken: unknown, cursor?: string) => {
      if (cursor) return new Promise((resolve) => (finishMore = resolve));
      return status === "failed"
        ? { items: [job()], nextCursor: "c1" }
        : { items: [job({ jobId: "9", status: "sent", orderReference: "#9E3B4C2D" })] };
    });
    renderOutbox();
    await screen.findByRole("heading", { name: "Order #7C1F2E0A: Neon Static" });
    fireEvent.click(screen.getByRole("button", { name: "Load more" }));
    fireEvent.click(screen.getByRole("button", { name: "Sent" }));
    await screen.findByRole("heading", { name: "Order #9E3B4C2D: Neon Static" });
    finishMore({ items: [job({ jobId: "8", orderReference: "#8D2A3B1C" })] });
    await waitFor(() => expect(screen.getByRole("heading", { name: "Sent ticket emails" })).toBeInTheDocument());
    expect(screen.getByRole("heading", { name: "Order #9E3B4C2D: Neon Static" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Order #8D2A3B1C: Neon Static" })).toBeNull();
    expect(screen.queryByRole("heading", { name: "Order #7C1F2E0A: Neon Static" })).toBeNull();
  });
});

describe("EmailOutbox: find an order, change its email", () => {
  it("finds an order's ticket email by its reference (any status), and Clear goes back to the list", async () => {
    adminListEmailJobs.mockResolvedValueOnce({ items: [] }).mockResolvedValueOnce({ items: [job({ status: "sent", lastError: undefined })] });
    renderOutbox();
    await screen.findByText("Nothing has failed");
    const search = screen.getByRole("search", { name: "Find an order" });
    const input = within(search).getByLabelText("Find an order by reference");
    fireEvent.change(input, { target: { value: "7c1f2e0" } });
    fireEvent.click(within(search).getByRole("button", { name: "Find" }));
    expect(within(search).getByRole("alert")).toHaveTextContent("Enter the 8-character reference, like #7C1F2E0A.");
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(adminListEmailJobs).toHaveBeenCalledTimes(1);

    fireEvent.change(input, { target: { value: " 7c1f2e0a " } });
    fireEvent.click(within(search).getByRole("button", { name: "Find" }));
    expect(await screen.findByRole("heading", { name: "Ticket email for order #7C1F2E0A" })).toBeInTheDocument();
    expect(adminListEmailJobs).toHaveBeenLastCalledWith("failed", expect.any(Function), undefined, "#7C1F2E0A");
    // Said once the answer is in (the search's button keeps focus).
    expect(await screen.findByRole("status")).toHaveTextContent("Found order #7C1F2E0A.");
    // The field is a reference's width, not the page's.
    expect(input.parentElement).toHaveClass("max-w-xs");
    expect(screen.getByRole("heading", { name: "Order #7C1F2E0A: Neon Static" })).toBeInTheDocument();
    // No status filter is selected while one order is shown.
    for (const filter of within(screen.getByRole("group", { name: "Show emails" })).getAllByRole("button")) {
      expect(filter).toHaveAttribute("aria-pressed", "false");
    }

    // An order with no ticket email: said too. The same reference again looks it up again.
    adminListEmailJobs.mockResolvedValueOnce({ items: [] });
    fireEvent.change(input, { target: { value: "#0000beef" } });
    fireEvent.click(within(search).getByRole("button", { name: "Find" }));
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("No ticket email for order #0000BEEF."));
    expect(screen.getByText("No ticket email for order #0000BEEF")).toBeInTheDocument();
    const calls = adminListEmailJobs.mock.calls.length;
    adminListEmailJobs.mockResolvedValueOnce({ items: [] });
    fireEvent.click(within(search).getByRole("button", { name: "Find" }));
    await waitFor(() => expect(adminListEmailJobs).toHaveBeenCalledTimes(calls + 1));
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("No ticket email for order #0000BEEF."));

    adminListEmailJobs.mockResolvedValueOnce({ items: [] });
    fireEvent.click(within(search).getByRole("button", { name: "Clear" }));
    expect(await screen.findByRole("heading", { name: "Failed ticket emails" })).toBeInTheDocument();
    expect(input).toHaveValue("");
    expect(input).toHaveFocus();
  });

  it("changes a paid order's email with a reason, then shows the change and says so", async () => {
    adminListEmailJobs.mockResolvedValue({ items: [job()] });
    adminChangeOrderEmail.mockResolvedValue({
      result: "changed",
      job: job({
        status: "failed",
        attempts: 0,
        lastError: undefined,
        maskedEmail: "j***@example.com",
        emailChanges: [
          { changedBy: "admin", reason: "Buyer called to fix a typo", oldMaskedEmail: "m***@example.com", newMaskedEmail: "j***@example.com", changedAt: "2026-11-17T01:00:00.000Z" },
          { changedBy: "buyer", oldMaskedEmail: "m***@gmail.con", newMaskedEmail: "m***@example.com", changedAt: "2026-11-16T01:00:00.000Z" },
        ],
      }),
    });
    renderOutbox();
    const item = (await screen.findByRole("heading", { name: "Order #7C1F2E0A: Neon Static" })).closest("article")!;
    const open = within(item).getByRole("button", { name: "Change email" });
    expect(open).toHaveClass("min-h-11");
    fireEvent.click(open);
    const form = within(item).getByRole("form", { name: "Change email for order #7C1F2E0A" });
    const email = within(form).getByLabelText("New email");
    await waitFor(() => expect(email).toHaveFocus());
    const reason = within(form).getByLabelText("Reason");
    expect(reason).toHaveAccessibleDescription("What the buyer confirmed. Leave email addresses out.");

    // Both are needed.
    fireEvent.click(within(form).getByRole("button", { name: "Change and send" }));
    expect(within(form).getByText("Enter the new email address.")).toBeInTheDocument();
    expect(email).toHaveFocus();
    fireEvent.change(email, { target: { value: "jo@example.com" } });
    fireEvent.change(reason, { target: { value: "x" } });
    fireEvent.click(within(form).getByRole("button", { name: "Change and send" }));
    expect(within(form).getByRole("alert")).toHaveTextContent("Say why, in a few words.");
    expect(reason).toHaveFocus();
    expect(adminChangeOrderEmail).not.toHaveBeenCalled();

    fireEvent.change(reason, { target: { value: "  Buyer called to fix a typo " } });
    fireEvent.click(within(form).getByRole("button", { name: "Change and send" }));
    await waitFor(() =>
      expect(adminChangeOrderEmail).toHaveBeenCalledWith("7", { email: "jo@example.com", reason: "Buyer called to fix a typo" }, expect.any(Function)),
    );
    expect(await screen.findByText("Email changed for order #7C1F2E0A. The tickets are being sent to the new address.")).toBeInTheDocument();
    const updated = screen.getByRole("heading", { name: "Order #7C1F2E0A: Neon Static" }).closest("article")!;
    expect(within(updated).queryByRole("form")).toBeNull();
    expect(within(updated).getByText("j***@example.com")).toBeInTheDocument();
    expect(within(updated).getByRole("heading", { level: 4, name: "Email changes" })).toBeInTheDocument();
    expect(within(updated).getByText("m***@example.com → j***@example.com")).toBeInTheDocument();
    expect(within(updated).getByText("Reason: Buyer called to fix a typo")).toBeInTheDocument();
    expect(within(updated).getByText(/^By the buyer,/)).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("heading", { name: "Order #7C1F2E0A: Neon Static" })).toHaveFocus());
  });

  it("a changed email that has left this status's list goes, focus on the next one; the same address says nothing changed", async () => {
    adminListEmailJobs.mockResolvedValue({ items: [job(), job({ jobId: "8", orderReference: "#8D2A3B1C" })] });
    // The failed job is pending again once its order's email changes: it belongs to Retrying automatically now.
    adminChangeOrderEmail.mockResolvedValueOnce({ result: "changed", job: job({ status: "pending", attempts: 0, maskedEmail: "j***@example.com" }) });
    renderOutbox();
    const item = (await screen.findByRole("heading", { name: "Order #7C1F2E0A: Neon Static" })).closest("article")!;
    fireEvent.click(within(item).getByRole("button", { name: "Change email" }));
    const form = within(item).getByRole("form");
    expect(form).toHaveClass("border-t");
    fireEvent.change(within(form).getByLabelText("New email"), { target: { value: "jo@example.com" } });
    fireEvent.change(within(form).getByLabelText("Reason"), { target: { value: "Buyer phoned" } });
    fireEvent.click(within(form).getByRole("button", { name: "Change and send" }));
    await waitFor(() => expect(screen.queryByRole("heading", { name: "Order #7C1F2E0A: Neon Static" })).toBeNull());
    expect(screen.getByRole("status")).toHaveTextContent(
      "Email changed for order #7C1F2E0A. The tickets are being sent to the new address. It’s moved to Retrying automatically.",
    );
    await waitFor(() => expect(screen.getByRole("heading", { name: "Order #8D2A3B1C: Neon Static" })).toHaveFocus());

    // The same address (result unchanged, whatever the history says): nothing changed, and it stays.
    adminChangeOrderEmail.mockResolvedValueOnce({ result: "unchanged", job: job({ jobId: "8", orderReference: "#8D2A3B1C" }) });
    const other = screen.getByRole("heading", { name: "Order #8D2A3B1C: Neon Static" }).closest("article")!;
    fireEvent.click(within(other).getByRole("button", { name: "Change email" }));
    fireEvent.change(within(other).getByLabelText("New email"), { target: { value: "m@example.com" } });
    fireEvent.change(within(other).getByLabelText("Reason"), { target: { value: "Buyer phoned" } });
    fireEvent.click(within(other).getByRole("button", { name: "Change and send" }));
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("That’s already the email for order #8D2A3B1C. Nothing changed."));
    await waitFor(() => expect(screen.getByRole("heading", { name: "Order #8D2A3B1C: Neon Static" })).toHaveFocus());
  });

  it("Load more on a found order's list keeps to that order", async () => {
    adminListEmailJobs.mockImplementation(async (_status: string, _getToken: unknown, cursor?: string, reference?: string) =>
      reference && !cursor ? { items: [job()], nextCursor: "c1" } : { items: [] },
    );
    renderOutbox();
    await screen.findByText("Nothing has failed");
    const search = screen.getByRole("search", { name: "Find an order" });
    fireEvent.change(within(search).getByLabelText("Find an order by reference"), { target: { value: "7c1f2e0a" } });
    fireEvent.click(within(search).getByRole("button", { name: "Find" }));
    fireEvent.click(await screen.findByRole("button", { name: "Load more" }));
    await waitFor(() => expect(adminListEmailJobs).toHaveBeenLastCalledWith("failed", expect.any(Function), "c1", "#7C1F2E0A"));
  });

  it("puts the API's refusals on the fields, and a busy order as a notice", async () => {
    adminListEmailJobs.mockResolvedValue({ items: [job()] });
    adminChangeOrderEmail
      .mockRejectedValueOnce(new ApiError(400, "Please fix the highlighted fields.", { reason: "Leave email addresses out of the reason." }))
      .mockRejectedValueOnce(new ApiError(409, "Your tickets are being sent right now. Try again in a moment.", undefined, { code: "email_change_busy" }));
    renderOutbox();
    const item = (await screen.findByRole("heading", { name: "Order #7C1F2E0A: Neon Static" })).closest("article")!;
    fireEvent.click(within(item).getByRole("button", { name: "Change email" }));
    const form = within(item).getByRole("form");
    fireEvent.change(within(form).getByLabelText("New email"), { target: { value: "jo@example.com" } });
    fireEvent.change(within(form).getByLabelText("Reason"), { target: { value: "Asked by jo@example.com" } });
    fireEvent.click(within(form).getByRole("button", { name: "Change and send" }));
    expect(await within(form).findByRole("alert")).toHaveTextContent("Leave email addresses out of the reason.");
    await waitFor(() => expect(within(form).getByLabelText("Reason")).toHaveFocus());

    fireEvent.change(within(form).getByLabelText("Reason"), { target: { value: "Asked by phone" } });
    fireEvent.click(within(form).getByRole("button", { name: "Change and send" }));
    expect(await within(form).findByRole("alert")).toHaveTextContent("Your tickets are being sent right now. Try again in a moment.");

    // Cancel: the form goes, focus back on Change email.
    fireEvent.click(within(form).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(within(item).getByRole("button", { name: "Change email" })).toHaveFocus());
  });

  it("Cancel can't close the form while the change is being sent; it can again after a failure", async () => {
    adminListEmailJobs.mockResolvedValue({ items: [job()] });
    let fail!: (err: unknown) => void;
    adminChangeOrderEmail.mockReturnValueOnce(new Promise((_, reject) => (fail = reject)));
    renderOutbox();
    const item = (await screen.findByRole("heading", { name: "Order #7C1F2E0A: Neon Static" })).closest("article")!;
    fireEvent.click(within(item).getByRole("button", { name: "Change email" }));
    const form = within(item).getByRole("form");
    expect(within(form).getByRole("button", { name: "Cancel" })).toBeEnabled();
    fireEvent.change(within(form).getByLabelText("New email"), { target: { value: "jo@example.com" } });
    fireEvent.change(within(form).getByLabelText("Reason"), { target: { value: "Buyer phoned" } });
    fireEvent.click(within(form).getByRole("button", { name: "Change and send" }));
    await waitFor(() => expect(adminChangeOrderEmail).toHaveBeenCalledTimes(1));
    const cancel = within(form).getByRole("button", { name: "Cancel" });
    expect(cancel).toBeDisabled();
    fireEvent.click(cancel);
    expect(within(item).getByRole("form")).toBe(form);

    fail(new ApiError(409, "Your tickets are being sent right now. Try again in a moment.", undefined, { code: "email_change_busy" }));
    expect(await within(form).findByRole("alert")).toHaveTextContent("Your tickets are being sent right now.");
    expect(within(form).getByRole("button", { name: "Cancel" })).toBeEnabled();
  });

  it("both fields say they're required; the reason has no native cap, so 500 characters with an emoji fit", async () => {
    adminListEmailJobs.mockResolvedValue({ items: [job()] });
    adminChangeOrderEmail.mockReturnValue(new Promise(() => {}));
    renderOutbox();
    const item = (await screen.findByRole("heading", { name: "Order #7C1F2E0A: Neon Static" })).closest("article")!;
    fireEvent.click(within(item).getByRole("button", { name: "Change email" }));
    const form = within(item).getByRole("form");
    const reason = within(form).getByLabelText("Reason");
    expect(within(form).getByLabelText("New email")).toBeRequired();
    expect(reason).toBeRequired();
    expect(reason).not.toHaveAttribute("maxlength");
    // 499 letters and an emoji: 500 characters (as the API counts), 501 UTF-16 units.
    const full = `${"a".repeat(499)}😀`;
    fireEvent.change(within(form).getByLabelText("New email"), { target: { value: "jo@example.com" } });
    fireEvent.change(reason, { target: { value: full } });
    fireEvent.click(within(form).getByRole("button", { name: "Change and send" }));
    await waitFor(() => expect(adminChangeOrderEmail).toHaveBeenCalledWith("7", { email: "jo@example.com", reason: full }, expect.any(Function)));
  });

  it("a change answered after the list was left and shown again doesn't overwrite the fresher list", async () => {
    adminListEmailJobs.mockResolvedValue({ items: [job()] });
    let answer!: (result: unknown) => void;
    adminChangeOrderEmail.mockReturnValueOnce(new Promise((resolve) => (answer = resolve)));
    renderOutbox();
    const search = screen.getByRole("search", { name: "Find an order" });
    const input = within(search).getByLabelText("Find an order by reference");
    fireEvent.change(input, { target: { value: "7c1f2e0a" } });
    fireEvent.click(within(search).getByRole("button", { name: "Find" }));
    await screen.findByRole("heading", { name: "Ticket email for order #7C1F2E0A" });
    const item = (await screen.findByRole("heading", { name: "Order #7C1F2E0A: Neon Static" })).closest("article")!;
    fireEvent.click(within(item).getByRole("button", { name: "Change email" }));
    fireEvent.change(within(item).getByLabelText("New email"), { target: { value: "jo@example.com" } });
    fireEvent.change(within(item).getByLabelText("Reason"), { target: { value: "Buyer phoned" } });
    fireEvent.click(within(item).getByRole("button", { name: "Change and send" }));
    await waitFor(() => expect(adminChangeOrderEmail).toHaveBeenCalledTimes(1));

    // Another order, then back to this one: its fresh lookup says the new email has been sent.
    adminListEmailJobs.mockResolvedValueOnce({ items: [job({ jobId: "8", orderReference: "#8D2A3B1C" })] });
    fireEvent.change(input, { target: { value: "8d2a3b1c" } });
    fireEvent.click(within(search).getByRole("button", { name: "Find" }));
    await screen.findByRole("heading", { name: "Order #8D2A3B1C: Neon Static" });
    adminListEmailJobs.mockResolvedValueOnce({ items: [job({ status: "sent", attempts: 1, lastError: undefined, maskedEmail: "j***@example.com", sentAt: "2026-11-18T01:00:00.000Z" })] });
    fireEvent.change(input, { target: { value: "7c1f2e0a" } });
    fireEvent.click(within(search).getByRole("button", { name: "Find" }));
    const fresh = (await screen.findByRole("heading", { name: "Order #7C1F2E0A: Neon Static" })).closest("article")!;
    await waitFor(() => expect(within(fresh).getByText("Sent")).toBeInTheDocument());
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Found order #7C1F2E0A."));

    // The first change's answer (its job as it was then: pending) arrives late.
    await act(async () =>
      answer({ result: "changed", job: job({ status: "pending", attempts: 0, lastError: undefined, maskedEmail: "j***@example.com" }) }),
    );
    const after = screen.getByRole("heading", { name: "Order #7C1F2E0A: Neon Static" }).closest("article")!;
    expect(within(after).getByText("Sent")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Found order #7C1F2E0A.");
  });

  it("a change answered with a new job (the old one purged meanwhile) replaces the row it was made on", async () => {
    adminListEmailJobs.mockResolvedValue({ items: [job()] });
    adminChangeOrderEmail.mockResolvedValueOnce({
      result: "changed",
      job: job({ jobId: "9", status: "pending", attempts: 0, lastError: undefined, maskedEmail: "j***@example.com" }),
    });
    renderOutbox();
    const search = screen.getByRole("search", { name: "Find an order" });
    fireEvent.change(within(search).getByLabelText("Find an order by reference"), { target: { value: "7c1f2e0a" } });
    fireEvent.click(within(search).getByRole("button", { name: "Find" }));
    const item = (await screen.findByRole("heading", { name: "Order #7C1F2E0A: Neon Static" })).closest("article")!;
    fireEvent.click(within(item).getByRole("button", { name: "Change email" }));
    fireEvent.change(within(item).getByLabelText("New email"), { target: { value: "jo@example.com" } });
    fireEvent.change(within(item).getByLabelText("Reason"), { target: { value: "Buyer phoned" } });
    fireEvent.click(within(item).getByRole("button", { name: "Change and send" }));
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Email changed for order #7C1F2E0A."));
    // One row, the new job's (its heading id is the new job's, and has focus).
    const headings = screen.getAllByRole("heading", { name: "Order #7C1F2E0A: Neon Static" });
    expect(headings).toHaveLength(1);
    expect(headings[0]).toHaveAttribute("id", "email-9");
    expect(within(headings[0].closest("article")!).getByText("j***@example.com")).toBeInTheDocument();
    await waitFor(() => expect(headings[0]).toHaveFocus());
  });

  it("Load more's busy state and error stay with the list it was started on", async () => {
    let fail!: (err: unknown) => void;
    adminListEmailJobs.mockImplementation(async (_status: string, _getToken: unknown, cursor?: string, reference?: string) => {
      if (cursor === "c1") return new Promise((_, reject) => (fail = reject));
      return reference ? { items: [job({ status: "sent" })], nextCursor: "r1" } : { items: [job()], nextCursor: "c1" };
    });
    renderOutbox();
    fireEvent.click(await screen.findByRole("button", { name: "Load more" }));
    expect(screen.getByRole("button", { name: "Loading…" })).toBeInTheDocument();
    const search = screen.getByRole("search", { name: "Find an order" });
    fireEvent.change(within(search).getByLabelText("Find an order by reference"), { target: { value: "7c1f2e0a" } });
    fireEvent.click(within(search).getByRole("button", { name: "Find" }));
    await screen.findByRole("heading", { name: "Ticket email for order #7C1F2E0A" });
    // The found order's own Load more: not busy with the other list's request.
    const own = await screen.findByRole("button", { name: "Load more" });
    expect(own).not.toHaveAttribute("aria-disabled", "true");
    await act(async () => fail(new ApiError(500, "Server error.")));
    expect(screen.queryByText("Couldn’t load more emails.")).toBeNull();
    expect(screen.getByRole("button", { name: "Load more" })).toBeInTheDocument();
  });

  it("offers no change for a free booking (paid, but not by card)", async () => {
    adminListEmailJobs.mockResolvedValue({ items: [job({ cardOrder: false })] });
    renderOutbox();
    const item = (await screen.findByRole("heading", { name: "Order #7C1F2E0A: Neon Static" })).closest("article")!;
    expect(within(item).queryByRole("button", { name: "Change email" })).toBeNull();
  });

  it("no Change email while a resend is out, and a refusal isn't put on a field corrected since it was sent", async () => {
    adminListEmailJobs.mockResolvedValue({ items: [job()] });
    let resent!: (value: unknown) => void;
    adminResendEmailJob.mockReturnValueOnce(new Promise((resolve) => (resent = resolve)));
    renderOutbox();
    const item = (await screen.findByRole("heading", { name: "Order #7C1F2E0A: Neon Static" })).closest("article")!;
    fireEvent.click(within(item).getByRole("button", { name: "Resend now" }));
    expect(within(item).getByRole("button", { name: "Change email" })).toBeDisabled();
    await act(async () => resent(job({ attempts: 6 })));
    expect(within(item).getByRole("button", { name: "Change email" })).toBeEnabled();

    let refuse!: (err: unknown) => void;
    adminChangeOrderEmail.mockReturnValueOnce(new Promise((_, reject) => (refuse = reject)));
    fireEvent.click(within(item).getByRole("button", { name: "Change email" }));
    const form = within(item).getByRole("form");
    fireEvent.change(within(form).getByLabelText("New email"), { target: { value: "jo@example.com" } });
    fireEvent.change(within(form).getByLabelText("Reason"), { target: { value: "Asked by jo@example.com" } });
    fireEvent.click(within(form).getByRole("button", { name: "Change and send" }));
    await waitFor(() => expect(adminChangeOrderEmail).toHaveBeenCalledTimes(1));
    fireEvent.change(within(form).getByLabelText("Reason"), { target: { value: "Asked by phone" } });
    await act(async () =>
      refuse(new ApiError(400, "Please fix the highlighted fields.", { reason: "Leave email addresses out of the reason." })),
    );
    expect(within(form).queryByRole("alert")).toBeNull();
    expect(within(form).getByLabelText("Reason")).not.toHaveAttribute("aria-invalid");
  });

  it("offers no change for an order that isn't paid", async () => {
    adminListEmailJobs.mockResolvedValue({ items: [job({ orderStatus: "refunded" })] });
    renderOutbox();
    const item = (await screen.findByRole("heading", { name: "Order #7C1F2E0A: Neon Static" })).closest("article")!;
    expect(within(item).queryByRole("button", { name: "Change email" })).toBeNull();
  });
});
