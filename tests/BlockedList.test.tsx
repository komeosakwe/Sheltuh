// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BlockedPageContent } from "@/components/messages/MessagesPages";
import { ApiError } from "@/lib/api/client";
import type { BlockRecord } from "@/lib/api/types";
import type { AuthContextValue } from "@/lib/auth/AuthContext";
import { fakeAuthValue, FakeAuthProvider } from "./test-utils/fakeAuth";

vi.mock("@/lib/api/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api/client")>()),
  isApiConfigured: true,
}));
const listBlocks = vi.fn();
const unblockMember = vi.fn();
vi.mock("@/lib/api/messages", () => ({
  listBlocks: (...args: unknown[]) => listBlocks(...args),
  unblockMember: (...args: unknown[]) => unblockMember(...args),
}));

beforeEach(() => {
  listBlocks.mockReset();
  unblockMember.mockReset();
});
afterEach(cleanup);

function block(id: string, displayName?: string): BlockRecord {
  return { blockId: id, displayName, createdAt: "2026-09-20T09:00:00.000Z" };
}

function renderBlocked(auth: AuthContextValue = fakeAuthValue()) {
  return render(
    <FakeAuthProvider value={auth}>
      <BlockedPageContent />
    </FakeAuthProvider>,
  );
}

describe("Blocked members", () => {
  it("lists blocks (with the name kept at block time; none if they had no profile) and Unblock removes one, announces it and moves focus on", async () => {
    listBlocks.mockResolvedValue({ items: [block("b1", "Sam K."), block("b2"), block("b3", "Leo")] });
    unblockMember.mockResolvedValue(undefined);
    renderBlocked();
    const list = await screen.findByRole("list", { name: "Blocked members" });
    expect(within(list).getAllByRole("listitem").map((li) => li.firstElementChild?.firstElementChild?.firstElementChild?.textContent)).toEqual([
      "Sam K.",
      "Member without a name",
      "Leo",
    ]);

    fireEvent.click(screen.getByRole("button", { name: "Unblock Sam K." }));
    await waitFor(() => expect(within(list).getAllByRole("listitem")).toHaveLength(2));
    expect(unblockMember).toHaveBeenCalledWith("b1", expect.any(Function));
    expect(screen.getByRole("status")).toHaveTextContent("Unblocked Sam K.");
    await waitFor(() => expect(screen.getByRole("button", { name: "Unblock Member without a name" })).toHaveFocus());
  });

  it("unblocking the last one focuses the heading and shows the empty state", async () => {
    listBlocks.mockResolvedValue({ items: [block("b1", "Sam K.")] });
    unblockMember.mockResolvedValue(undefined);
    renderBlocked();
    fireEvent.click(await screen.findByRole("button", { name: "Unblock Sam K." }));
    expect(await screen.findByText("You haven’t blocked anyone.")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("heading", { name: "Blocked members" })).toHaveFocus());
  });

  it("a failed unblock is shown on its row and the row stays", async () => {
    listBlocks.mockResolvedValue({ items: [block("b1", "Sam K.")] });
    unblockMember.mockRejectedValue(new ApiError(500, "boom"));
    renderBlocked();
    fireEvent.click(await screen.findByRole("button", { name: "Unblock Sam K." }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Couldn’t unblock. Try again.");
    expect(screen.getByRole("button", { name: "Unblock Sam K." })).toBeInTheDocument();
  });

  it("empty, load error with Try again, and demo (no API calls)", async () => {
    listBlocks.mockRejectedValueOnce(new ApiError(500, "boom")).mockResolvedValueOnce({ items: [] });
    renderBlocked();
    expect(await screen.findByRole("alert")).toHaveTextContent("Couldn’t load the people you’ve blocked.");
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByText("You haven’t blocked anyone.")).toBeInTheDocument();
    cleanup();
    listBlocks.mockClear();
    renderBlocked(fakeAuthValue({ configured: false, status: "signed-out" }));
    expect(screen.getByRole("note")).toHaveTextContent("Blocking isn’t available in this demo.");
    expect(listBlocks).not.toHaveBeenCalled();
  });
});
