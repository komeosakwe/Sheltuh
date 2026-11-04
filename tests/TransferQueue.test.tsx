// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import TransferQueue from "@/components/admin/TransferQueue";
import { transferActions, transferErrorWords } from "@/components/admin/transfer-copy";
import { ApiError } from "@/lib/api/client";
import type { AdminTransfer, AdminTransfersPage } from "@/lib/api/types";
import { fakeAuthValue, FakeAuthProvider } from "./test-utils/fakeAuth";
import { stubDialog } from "./test-utils/checkInFixtures";
import { fakeUrl } from "./test-utils/fakeUrl";

vi.mock("next/navigation", async () => (await import("./test-utils/fakeUrl")).fakeNavigation);

const adminListTransfers = vi.fn();
const adminTransferAction = vi.fn();
vi.mock("@/lib/api/admin", () => ({
  adminListTransfers: (...args: unknown[]) => adminListTransfers(...args),
  adminTransferAction: (...args: unknown[]) => adminTransferAction(...args),
}));

beforeEach(() => {
  stubDialog();
  fakeUrl.set("");
  fakeUrl.replace.mockReset();
  adminListTransfers.mockReset();
  adminTransferAction.mockReset();
});
afterEach(cleanup);

function transfer(overrides: Partial<AdminTransfer> = {}): AdminTransfer {
  return {
    transferId: "11",
    orderReference: "#7C1F2E0A",
    orderStatus: "paid",
    eventTitle: "Neon Static",
    eventEndsAt: "2026-11-01T13:00:00.000Z",
    organiserName: "Static Collective",
    amountCents: 4550,
    status: "failed",
    attempts: 5,
    lastError: "balance_insufficient",
    createdAt: "2026-11-02T00:00:00.000Z",
    updatedAt: "2026-11-04T00:00:00.000Z",
    ...overrides,
  };
}

function page(items: AdminTransfer[], overrides: Partial<AdminTransfersPage> = {}): AdminTransfersPage {
  return {
    counts: { failed: 1, held: 2, retry: 0, sending: 1, sent: 7, cancelled: 3 },
    owedToOrganisersCents: 123_450,
    lastRun: { finishedAt: "2026-11-04T01:00:00.000Z", claimed: 5, sent: 3, retrying: 1, failed: 1 },
    items,
    ...overrides,
  };
}

function renderQueue() {
  render(
    <FakeAuthProvider value={fakeAuthValue({ isAdmin: true })}>
      <TransferQueue />
    </FakeAuthProvider>,
  );
}

const card = (name: string) => screen.getByRole("heading", { name }).closest("article")!;

describe("the Payouts page", () => {
  it("has the heading and the queue, with no explanatory paragraph under the heading", async () => {
    adminListTransfers.mockResolvedValue(page([transfer()]));
    const { default: AdminPayoutsPage } = await import("@/app/admin/payouts/page");
    render(
      <FakeAuthProvider value={fakeAuthValue({ isAdmin: true })}>
        <AdminPayoutsPage />
      </FakeAuthProvider>,
    );
    expect(screen.getByRole("heading", { level: 1, name: "Payouts" })).toBeInTheDocument();
    expect(screen.queryByText(/about 2 days after their event ends/)).not.toBeInTheDocument();
    expect(await screen.findByText(/Owed to organisers/)).toBeInTheDocument();
    expect(screen.getByText(/Last run/)).toBeInTheDocument();
  });
});

describe("transfer copy", () => {
  it("maps codes to words, and makes up words for a code it doesn't know", () => {
    expect(transferErrorWords("refunded")).toBe("Refunded");
    expect(transferErrorWords("balance_insufficient")).toBe("Not enough in the Stripe balance");
    expect(transferErrorWords("destination_account")).toBe("Organiser’s Stripe account can’t receive");
    expect(transferErrorWords("refunded_outcome_unknown")).toBe("Refunded; may already be sent (check Stripe)");
    expect(transferErrorWords("some_new_code")).toBe("Some new code");
    expect(transferErrorWords("rejected_amount_too_small")).toBe("Stripe turned it down: amount too small");
  });

  it("offers an action only where the server allows it", () => {
    expect(transferActions("failed")).toEqual(["retry", "cancel"]);
    expect(transferActions("retry")).toEqual(["retry", "cancel"]);
    expect(transferActions("held")).toEqual(["release", "cancel"]);
    expect(transferActions("sending")).toEqual([]);
    expect(transferActions("sent")).toEqual([]);
    expect(transferActions("cancelled")).toEqual([]);
  });
});

describe("TransferQueue", () => {
  it("shows owed, the last run, the filters with counts, and open transfers by default", async () => {
    adminListTransfers.mockResolvedValue(page([transfer()]));
    renderQueue();

    expect(await screen.findByText("Owed to organisers: A$1234.50")).toBeInTheDocument();
    expect(screen.getByText(/Last run .*: 3 sent, 1 retrying, 1 failed \(5 picked up\)\./)).toBeInTheDocument();
    expect(adminListTransfers).toHaveBeenCalledWith(expect.any(Function), { status: "open" });

    const filters = screen.getByRole("group", { name: "Show transfers" });
    expect(within(filters).getAllByRole("button").map((b) => b.textContent)).toEqual([
      "Open (4)",
      "Failed (1)",
      "Held (2)",
      "Retrying (0)",
      "Sending now (1)",
      "Sent (7)",
      "Cancelled (3)",
    ]);
    expect(within(filters).getByRole("button", { name: "Open (4)" })).toHaveAttribute("aria-pressed", "true");

    const item = card("Order #7C1F2E0A: Neon Static");
    expect(item).toHaveTextContent("Static Collective");
    expect(item).toHaveTextContent("A$45.50");
    expect(item).toHaveTextContent("Not enough in the Stripe balance");
    expect(within(item).getAllByRole("button").map((b) => b.textContent)).toEqual(["Retry", "Cancel"]);
  });

  it("says when no run has been recorded", async () => {
    adminListTransfers.mockResolvedValue(page([], { lastRun: undefined }));
    renderQueue();
    expect(await screen.findByText("No payouts run yet.")).toBeInTheDocument();
    expect(screen.getByText("Nothing needs you")).toBeInTheDocument();
  });

  it("a filter reloads for that status and is kept in the URL", async () => {
    adminListTransfers.mockResolvedValue(page([transfer()]));
    renderQueue();
    await screen.findByRole("heading", { name: "Order #7C1F2E0A: Neon Static" });
    adminListTransfers.mockResolvedValue(
      page([transfer({ transferId: "12", status: "sent", lastError: undefined, stripeTransferId: "tr_123", sentAt: "2026-11-04T01:00:00.000Z" })]),
    );
    fireEvent.click(screen.getByRole("button", { name: "Sent (7)" }));
    expect(fakeUrl.replace).toHaveBeenCalledWith("/admin/payouts?status=sent", { scroll: false });
    expect(await screen.findByRole("heading", { name: "Sent transfers" })).toBeInTheDocument();
    expect(adminListTransfers).toHaveBeenLastCalledWith(expect.any(Function), { status: "sent" });
    await waitFor(() => expect(screen.getByText("tr_123")).toBeInTheDocument());
    // Nothing to do to a sent transfer.
    expect(within(card("Order #7C1F2E0A: Neon Static")).queryAllByRole("button")).toHaveLength(0);
  });

  it("shows loading, then an error with Try again", async () => {
    adminListTransfers.mockRejectedValueOnce(new ApiError(403, "Admins only."));
    adminListTransfers.mockResolvedValueOnce(page([]));
    renderQueue();
    expect(screen.getByRole("progressbar")).toBeInTheDocument();
    expect(await screen.findByRole("alert")).toHaveTextContent("Admins only.");
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByText("Nothing needs you")).toBeInTheDocument();
  });

  it("Retry needs no confirm; the transfer stays in Open, updated in place", async () => {
    adminListTransfers.mockResolvedValue(page([transfer()]));
    adminTransferAction.mockResolvedValue(transfer({ status: "retry", attempts: 0, lastError: undefined, nextAttemptAt: "2026-11-04T02:00:00.000Z" }));
    renderQueue();
    const item = (await screen.findByRole("heading", { name: "Order #7C1F2E0A: Neon Static" })).closest("article")!;
    fireEvent.click(within(item).getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(within(card("Order #7C1F2E0A: Neon Static")).getByText("Retrying")).toBeInTheDocument());
    expect(adminTransferAction).toHaveBeenCalledWith("11", "retry", expect.any(Function));
    expect(screen.getByRole("status")).toHaveTextContent("Retry for order #7C1F2E0A: now retrying.");
    // Counts follow: one fewer failed, one more retrying.
    expect(screen.getByRole("button", { name: "Failed (0)" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Retrying (1)" })).toBeInTheDocument();
  });

  it("Cancel asks first; Keep it does nothing, Cancel transfer cancels, drops owed and moves focus on", async () => {
    const late = transfer({ transferId: "12", orderReference: "#8D2A3B1C", eventTitle: "Late Bloom" });
    adminListTransfers.mockResolvedValueOnce(page([transfer(), late]));
    // After the cancel the list is fetched again from the start, so its counts and cursor are the server's.
    adminListTransfers.mockResolvedValue(
      page([late], { counts: { failed: 0, held: 2, retry: 0, sending: 1, sent: 7, cancelled: 4 }, owedToOrganisersCents: 118_900 }),
    );
    adminTransferAction.mockResolvedValue(transfer({ status: "cancelled", lastAdminAction: { action: "cancel", at: "2026-11-04T03:00:00.000Z" } }));
    renderQueue();
    const item = (await screen.findByRole("heading", { name: "Order #7C1F2E0A: Neon Static" })).closest("article")!;

    fireEvent.click(within(item).getByRole("button", { name: "Cancel" }));
    const dialog = await screen.findByRole("dialog", { name: "Cancel this transfer?" });
    expect(dialog).toHaveTextContent("A$45.50 for Static Collective (order #7C1F2E0A) will never be sent.");
    fireEvent.click(within(dialog).getByRole("button", { name: "Keep it" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(adminTransferAction).not.toHaveBeenCalled();

    fireEvent.click(within(item).getByRole("button", { name: "Cancel" }));
    fireEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Cancel transfer" }));
    await waitFor(() => expect(screen.queryByRole("heading", { name: "Order #7C1F2E0A: Neon Static" })).toBeNull());
    expect(adminTransferAction).toHaveBeenCalledWith("11", "cancel", expect.any(Function));
    expect(screen.getByText("Owed to organisers: A$1189")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Cancelled (4)" })).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("It’s moved out of this list.");
    await waitFor(() => expect(screen.getByRole("heading", { name: "Order #8D2A3B1C: Late Bloom" })).toHaveFocus());
  });

  it("Release is offered on a held transfer only, after a confirm that says why it's held", async () => {
    adminListTransfers.mockResolvedValue(page([transfer({ status: "held", lastError: "disputed", attempts: 0 })]));
    adminTransferAction.mockResolvedValue(transfer({ status: "retry", lastError: undefined, attempts: 0 }));
    renderQueue();
    const item = (await screen.findByRole("heading", { name: "Order #7C1F2E0A: Neon Static" })).closest("article")!;
    expect(within(item).getAllByRole("button").map((b) => b.textContent)).toEqual(["Release", "Cancel"]);
    fireEvent.click(within(item).getByRole("button", { name: "Release" }));
    const dialog = await screen.findByRole("dialog", { name: "Release this transfer?" });
    expect(dialog).toHaveTextContent("It’s held because: Disputed.");
    expect(adminTransferAction).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole("button", { name: "Release" }));
    await waitFor(() => expect(adminTransferAction).toHaveBeenCalledWith("11", "release", expect.any(Function)));
  });

  it("shows a 409's reason by its code and leaves the transfer as it was", async () => {
    adminListTransfers.mockResolvedValue(page([transfer()]));
    adminTransferAction.mockRejectedValue(
      new ApiError(409, "The order was refunded, so its transfer can't be sent. Cancel it instead.", undefined, {
        code: "transfer_not_payable",
      }),
    );
    renderQueue();
    const item = (await screen.findByRole("heading", { name: "Order #7C1F2E0A: Neon Static" })).closest("article")!;
    fireEvent.click(within(item).getByRole("button", { name: "Retry" }));
    expect(await within(item).findByRole("alert")).toHaveTextContent(
      "The order was refunded, so its transfer can’t be sent. Cancel it instead.",
    );
    expect(within(item).getByRole("button", { name: "Retry" })).toBeEnabled();

    adminTransferAction.mockRejectedValue(new ApiError(409, "x", undefined, { code: "transfer_in_progress" }));
    fireEvent.click(within(item).getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(within(item).getByRole("alert")).toHaveTextContent("being sent right now"));

    adminTransferAction.mockRejectedValue(new ApiError(409, "The server's own words."));
    fireEvent.click(within(item).getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(within(item).getByRole("alert")).toHaveTextContent("The server's own words."));

    adminTransferAction.mockRejectedValue(new Error("offline"));
    fireEvent.click(within(item).getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(within(item).getByRole("alert")).toHaveTextContent("Couldn’t do that. Nothing changed."));
  });

  it("a sending transfer has no actions; Load more appends the next page", async () => {
    adminListTransfers.mockResolvedValueOnce(
      page([transfer({ status: "sending", lastError: undefined })], { nextCursor: "c1" }),
    );
    adminListTransfers.mockResolvedValueOnce(
      page([transfer({ transferId: "12", orderReference: "#8D2A3B1C", eventTitle: "Late Bloom" })]),
    );
    renderQueue();
    const first = (await screen.findByRole("heading", { name: "Order #7C1F2E0A: Neon Static" })).closest("article")!;
    expect(within(first).queryAllByRole("button")).toHaveLength(0);
    fireEvent.click(screen.getByRole("button", { name: "Load more" }));
    expect(await screen.findByRole("heading", { name: "Order #8D2A3B1C: Late Bloom" })).toBeInTheDocument();
    expect(adminListTransfers).toHaveBeenLastCalledWith(expect.any(Function), { status: "open", cursor: "c1" });
    expect(screen.queryByRole("button", { name: "Load more" })).toBeNull();
  });

  describe("after a transfer leaves the list (cursors are row offsets)", () => {
    /** A server with failed transfers and a default page size, whose cursor is an offset into the rows still failed. */
    function serverWith(ids: string[], pageSize = 2) {
      const status = new Map(ids.map((id) => [id, "failed" as AdminTransfer["status"]]));
      const row = (id: string) => transfer({ transferId: id, orderReference: `#REF${id}`, eventTitle: `Event ${id}`, status: status.get(id) });
      const counts = () => ({
        failed: ids.filter((id) => status.get(id) === "failed").length, held: 0, retry: 0, sending: 0, sent: 0,
        cancelled: ids.filter((id) => status.get(id) === "cancelled").length,
      });
      adminListTransfers.mockImplementation(async (_getToken: unknown, query: { limit?: number; cursor?: string }) => {
        const open = ids.filter((id) => status.get(id) === "failed");
        const offset = query.cursor ? Number(query.cursor) : 0;
        const size = query.limit ?? pageSize;
        const items = open.slice(offset, offset + size).map(row);
        return page(items, { counts: counts(), ...(offset + size < open.length ? { nextCursor: String(offset + size) } : {}) });
      });
      adminTransferAction.mockImplementation(async (id: string) => {
        status.set(id, "cancelled");
        return row(id);
      });
    }

    async function cancel(reference: string) {
      const item = screen.getByRole("heading", { name: new RegExp(`^Order #REF${reference}:`) }).closest("article")!;
      fireEvent.click(within(item).getByRole("button", { name: "Cancel" }));
      fireEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Cancel transfer" }));
    }

    const shown = () => screen.getAllByRole("heading", { level: 3 }).map((h) => h.textContent);

    it("fetches the list again from the start, so Load more skips no row", async () => {
      serverWith(["1", "2", "3", "4", "5"]);
      renderQueue();
      await screen.findByRole("heading", { name: "Order #REF1: Event 1" });
      expect(shown()).toEqual(["Order #REF1: Event 1", "Order #REF2: Event 2"]);

      await cancel("1");
      await waitFor(() => expect(screen.getByRole("heading", { name: "Order #REF3: Event 3" })).toBeInTheDocument());
      expect(shown()).toEqual(["Order #REF2: Event 2", "Order #REF3: Event 3"]);
      expect(adminListTransfers).toHaveBeenLastCalledWith(expect.any(Function), { status: "open" });
      expect(screen.getByRole("button", { name: "Cancelled (1)" })).toBeInTheDocument();

      // The server's offset moved up by one: with the old cursor ("2") row 3 would have been skipped.
      fireEvent.click(screen.getByRole("button", { name: "Load more" }));
      await screen.findByRole("heading", { name: "Order #REF5: Event 5" });
      expect(shown()).toEqual(["Order #REF2: Event 2", "Order #REF3: Event 3", "Order #REF4: Event 4", "Order #REF5: Event 5"]);
      expect(screen.queryByRole("button", { name: "Load more" })).toBeNull();
    });

    it("keeps what was loaded: after Load more and a cancel, it asks for as many rows as were showing", async () => {
      const ids = Array.from({ length: 45 }, (_, i) => String(i + 1));
      serverWith(ids, 20);
      renderQueue();
      fireEvent.click(await screen.findByRole("button", { name: "Load more" }));
      await screen.findByRole("heading", { name: "Order #REF40: Event 40" });
      expect(shown()).toHaveLength(40);

      await cancel("2");
      await waitFor(() => expect(screen.getByRole("heading", { name: "Order #REF41: Event 41" })).toBeInTheDocument());
      expect(adminListTransfers).toHaveBeenLastCalledWith(expect.any(Function), { status: "open", limit: 40 });
      // Not cut back to one page, and the next one starts right after the last row shown.
      expect(shown()).toHaveLength(40);
      expect(screen.queryByRole("heading", { name: "Order #REF2: Event 2" })).toBeNull();
      fireEvent.click(screen.getByRole("button", { name: "Load more" }));
      await screen.findByRole("heading", { name: "Order #REF45: Event 45" });
      expect(shown()).toHaveLength(44);
      expect(new Set(shown()).size).toBe(44);
    });

    it("a refetch that fails drops the cursor instead of trusting it, and offers Reload", async () => {
      serverWith(["1", "2", "3", "4", "5"]);
      renderQueue();
      await screen.findByRole("heading", { name: "Order #REF1: Event 1" });
      const working = adminListTransfers.getMockImplementation()!;
      adminListTransfers.mockRejectedValueOnce(new Error("offline"));
      await cancel("1");
      expect(await screen.findByRole("alert")).toHaveTextContent("Couldn’t refresh the list");
      expect(screen.queryByRole("button", { name: "Load more" })).toBeNull();
      expect(shown()).toEqual(["Order #REF2: Event 2"]);

      adminListTransfers.mockImplementation(working);
      fireEvent.click(screen.getByRole("button", { name: "Reload" }));
      await screen.findByRole("heading", { name: "Order #REF3: Event 3" });
      expect(shown()).toEqual(["Order #REF2: Event 2", "Order #REF3: Event 3"]);
      expect(screen.queryByRole("alert")).toBeNull();
    });

    it("a transfer that stays in the list (a retry) fetches nothing again", async () => {
      serverWith(["1", "2", "3"]);
      adminTransferAction.mockResolvedValue(transfer({ transferId: "1", orderReference: "#REF1", eventTitle: "Event 1", status: "retry", attempts: 0, lastError: undefined }));
      renderQueue();
      await screen.findByRole("heading", { name: "Order #REF1: Event 1" });
      fireEvent.click(within(card("Order #REF1: Event 1")).getByRole("button", { name: "Retry" }));
      await waitFor(() => expect(within(card("Order #REF1: Event 1")).getByText("Retrying")).toBeInTheDocument());
      expect(adminListTransfers).toHaveBeenCalledTimes(1);
    });
  });

  it("a failed Load more says so and keeps the list", async () => {
    adminListTransfers.mockResolvedValueOnce(page([transfer()], { nextCursor: "c1" }));
    adminListTransfers.mockRejectedValueOnce(new Error("offline"));
    renderQueue();
    fireEvent.click(await screen.findByRole("button", { name: "Load more" }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Couldn’t load more transfers."));
    expect(screen.getByRole("heading", { name: "Order #7C1F2E0A: Neon Static" })).toBeInTheDocument();
  });
});
