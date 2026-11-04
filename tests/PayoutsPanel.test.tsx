// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import PayoutsPanel from "@/components/dashboard/PayoutsPanel";
import { ApiError } from "@/lib/api/client";
import type { OrganiserPayoutEvent, OrganiserPayouts, OrganiserRecord } from "@/lib/api/types";
import { fakeAuthValue, FakeAuthProvider } from "./test-utils/fakeAuth";

vi.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams() }));

const getMyPayouts = vi.fn();
vi.mock("@/lib/api/organisers", () => ({
  getMyPayouts: (...args: unknown[]) => getMyPayouts(...args),
  connectStripeOnboarding: vi.fn(),
  refreshStripeConnectStatus: vi.fn(),
}));

let organiser: Pick<OrganiserRecord, "organiserId" | "status" | "payoutsEnabled"> | null = null;
vi.mock("@/lib/auth/useOrganiser", () => ({
  useOrganiser: () => ({ loading: false, organiser, error: null, refetch: vi.fn() }),
}));

beforeEach(() => {
  getMyPayouts.mockReset();
  organiser = { organiserId: "org-1", status: "approved", payoutsEnabled: true };
});
afterEach(cleanup);

function item(overrides: Partial<OrganiserPayoutEvent> = {}): OrganiserPayoutEvent {
  return {
    eventId: "evt-1",
    title: "Neon Static",
    endsAt: "2026-11-01T13:00:00.000Z",
    paidOutCents: 0,
    pendingCents: 4550,
    sentCents: 0,
    dueAt: "2026-11-03T13:00:00.000Z",
    ...overrides,
  };
}

function payouts(overrides: Partial<OrganiserPayouts> = {}): OrganiserPayouts {
  return {
    delayedPayouts: true,
    payoutDelayHours: 48,
    totals: { paidOutCents: 1000, pendingCents: 4550, sentCents: 2000 },
    items: [item()],
    ...overrides,
  };
}

function renderPanel() {
  render(
    <FakeAuthProvider value={fakeAuthValue()}>
      <PayoutsPanel />
    </FakeAuthProvider>,
  );
}

const DELAY_COPY =
  "We send your share about 2 days after your event ends. Stripe then pays your bank, usually in 1–3 business days.";

describe("PayoutsPanel earnings", () => {
  it("keeps the Stripe account section and shows the delay copy, the totals and a per-event list", async () => {
    getMyPayouts.mockResolvedValue(
      payouts({ items: [item(), item({ eventId: "evt-2", title: "Late Bloom", pendingCents: 0, sentCents: 2000, dueAt: undefined })] }),
    );
    renderPanel();

    expect(screen.getByRole("heading", { name: "Stripe account" })).toBeInTheDocument();
    expect(screen.getByText("Payouts are on.")).toBeInTheDocument();
    expect(await screen.findByText(DELAY_COPY)).toBeInTheDocument();

    const totals = screen.getByText("Paid out", { selector: "dt" }).closest("dl")!;
    expect(within(totals).getByText("A$10")).toBeInTheDocument();
    expect(within(totals).getByText("A$45.50")).toBeInTheDocument();
    expect(within(totals).getByText("A$20")).toBeInTheDocument();
    expect(getMyPayouts).toHaveBeenCalledWith(expect.any(Function), { limit: 20 });

    const first = screen.getByRole("heading", { name: "Neon Static" }).closest("li")!;
    expect(first).toHaveTextContent("Ended");
    expect(first).toHaveTextContent("Pending");
    expect(first).toHaveTextContent("A$45.50, due");
    // Zero amounts are left out.
    expect(first).not.toHaveTextContent("Sent");
    expect(first).not.toHaveTextContent("Paid out");
    const second = screen.getByRole("heading", { name: "Late Bloom" }).closest("li")!;
    expect(second).toHaveTextContent("Sent");
    expect(second).toHaveTextContent("A$20");
    expect(second).not.toHaveTextContent("due");
  });

  it("says nothing about the delay when payouts aren't delayed", async () => {
    getMyPayouts.mockResolvedValue(payouts({ delayedPayouts: false }));
    renderPanel();
    await screen.findByRole("heading", { name: "Neon Static" });
    expect(screen.queryByText(DELAY_COPY)).toBeNull();
  });

  it("shows a loading state, then an empty state with no totals", async () => {
    getMyPayouts.mockResolvedValue(payouts({ items: [], totals: { paidOutCents: 0, pendingCents: 0, sentCents: 0 } }));
    renderPanel();
    expect(screen.getByRole("progressbar")).toBeInTheDocument();
    expect(await screen.findByText("No ticket sales yet.")).toBeInTheDocument();
    expect(screen.queryByText("Pending", { selector: "dt" })).toBeNull();
  });

  it("shows an error, and Try again loads it", async () => {
    getMyPayouts.mockRejectedValueOnce(new ApiError(404, "No organiser application found."));
    getMyPayouts.mockResolvedValueOnce(payouts());
    renderPanel();
    expect(await screen.findByRole("alert")).toHaveTextContent("No organiser application found.");
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByRole("heading", { name: "Neon Static" })).toBeInTheDocument();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("a server error shows a generic message, not its text", async () => {
    getMyPayouts.mockRejectedValue(new ApiError(500, "relation \"x\" does not exist"));
    renderPanel();
    expect(await screen.findByRole("alert")).toHaveTextContent("Couldn’t load your payouts.");
  });

  it("Load more adds the next page, skipping repeats, and goes when there's no more", async () => {
    getMyPayouts.mockResolvedValueOnce(payouts({ nextCursor: "c1" }));
    getMyPayouts.mockResolvedValueOnce(
      payouts({ items: [item(), item({ eventId: "evt-3", title: "Tape Swap" })] }),
    );
    renderPanel();
    fireEvent.click(await screen.findByRole("button", { name: "Load more" }));
    expect(await screen.findByRole("heading", { name: "Tape Swap" })).toBeInTheDocument();
    expect(screen.getAllByRole("heading", { name: "Neon Static" })).toHaveLength(1);
    expect(getMyPayouts).toHaveBeenLastCalledWith(expect.any(Function), { limit: 20, cursor: "c1" });
    expect(screen.queryByRole("button", { name: "Load more" })).toBeNull();
  });

  it("a failed Load more keeps the list and says so", async () => {
    getMyPayouts.mockResolvedValueOnce(payouts({ nextCursor: "c1" }));
    getMyPayouts.mockRejectedValueOnce(new Error("offline"));
    renderPanel();
    fireEvent.click(await screen.findByRole("button", { name: "Load more" }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Couldn’t load more."));
    expect(screen.getByRole("heading", { name: "Neon Static" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Load more" })).toBeInTheDocument();
  });

  it("asks for nothing until the application is approved", () => {
    organiser = { organiserId: "org-1", status: "pending" };
    renderPanel();
    expect(screen.getByText("Payouts open once your application is approved.")).toBeInTheDocument();
    expect(getMyPayouts).not.toHaveBeenCalled();
  });
});
