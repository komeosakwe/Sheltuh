// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import TicketTransfersAdmin, { cancelReasonError, normaliseReference, searchResultText } from "@/components/admin/TicketTransfersAdmin";
import { ApiError } from "@/lib/api/client";
import type { AdminTicketTransfer } from "@/lib/api/types";
import { FakeAuthProvider, fakeAuthValue } from "./test-utils/fakeAuth";
import { fakeUrl } from "./test-utils/fakeUrl";

vi.mock("next/navigation", async () => (await import("./test-utils/fakeUrl")).fakeNavigation);

const adminListTicketTransfers = vi.fn();
const adminCancelTicketTransfer = vi.fn();
vi.mock("@/lib/api/admin", () => ({
  adminListTicketTransfers: (...args: unknown[]) => adminListTicketTransfers(...args),
  adminCancelTicketTransfer: (...args: unknown[]) => adminCancelTicketTransfer(...args),
}));

// jsdom has no modal dialogs: give <dialog> what a browser would.
beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement) {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close = function close(this: HTMLDialogElement) {
    if (!this.hasAttribute("open")) return;
    this.removeAttribute("open");
    this.dispatchEvent(new Event("close"));
  };
});
beforeEach(() => {
  fakeUrl.set("");
  fakeUrl.replace.mockReset();
  adminListTicketTransfers.mockReset();
  adminCancelTicketTransfer.mockReset();
});
afterEach(cleanup);

function transfer(overrides: Partial<AdminTicketTransfer> = {}): AdminTicketTransfer {
  return {
    transferId: "0f1e2d3c-0000-4000-8000-000000000001",
    reference: "#0F1E2D3C",
    orderReference: "#7C1F2E0A",
    eventTitle: "Neon Static",
    status: "pending",
    createdAt: "2026-11-20T01:00:00.000Z",
    expiresAt: "2026-11-23T01:00:00.000Z",
    senderName: "Alex Chen",
    senderKind: "paying_browser",
    toName: "Sam Lee",
    toMaskedEmail: "s***@example.com",
    ...overrides,
  };
}

function renderAdmin() {
  render(
    <FakeAuthProvider value={fakeAuthValue({ isAdmin: true })}>
      <TicketTransfersAdmin />
    </FakeAuthProvider>,
  );
}

const item = async (reference: string) => (await screen.findByRole("heading", { name: new RegExp(`^${reference} · order`) })).closest("li")!;

describe("TicketTransfersAdmin", () => {
  it("lists every offer with its status in words, who sent it, to whom (masked) and when", async () => {
    adminListTicketTransfers.mockResolvedValue({
      items: [
        transfer(),
        transfer({
          transferId: "aa",
          reference: "#AAAAAAAA",
          status: "accepted",
          decidedAt: "2026-11-21T01:00:00.000Z",
          senderKind: "account",
          holderName: "Sam L",
          acceptedMaskedEmail: "j***@outlook.com",
        }),
        transfer({
          transferId: "bb",
          reference: "#BBBBBBBB",
          status: "cancelled",
          decidedAt: "2026-11-21T02:00:00.000Z",
          cancelledBy: "admin",
          cancelReason: "Buyer asked us to",
        }),
      ],
    });
    renderAdmin();
    const pending = await item("#0F1E2D3C");
    expect(adminListTicketTransfers).toHaveBeenCalledWith(expect.any(Function), {});
    expect(screen.getByRole("heading", { level: 2 })).toHaveTextContent("All offers, newest first");
    expect(within(pending).getByText("Waiting")).toBeInTheDocument();
    expect(within(pending).getByText("Alex Chen (from the browser that paid)")).toBeInTheDocument();
    expect(within(pending).getByText("Sam Lee · s***@example.com")).toBeInTheDocument();
    expect(within(pending).getByText("Expires")).toBeInTheDocument();
    expect(within(pending).getByText("Neon Static")).toBeInTheDocument();
    expect(within(pending).getByRole("button", { name: "Cancel offer #0F1E2D3C" })).toBeInTheDocument();

    const accepted = await item("#AAAAAAAA");
    expect(within(accepted).getByText("Accepted", { selector: "span" })).toBeInTheDocument();
    expect(within(accepted).getByText("Sam L · j***@outlook.com")).toBeInTheDocument();
    expect(within(accepted).getByText("Alex Chen (the buyer, signed in)")).toBeInTheDocument();
    // Accepted can't be undone: no cancel.
    expect(within(accepted).queryByRole("button")).toBeNull();

    const cancelled = await item("#BBBBBBBB");
    expect(within(cancelled).getByText("Sheltüh support")).toBeInTheDocument();
    expect(within(cancelled).getByText("Buyer asked us to")).toBeInTheDocument();
    expect(within(cancelled).queryByRole("button")).toBeNull();
  });

  it("finds by an order's or a transfer's reference, kept in the URL; a bad one is refused before asking", async () => {
    adminListTicketTransfers.mockResolvedValue({ items: [] });
    renderAdmin();
    expect(await screen.findByText("No tickets sent yet")).toBeInTheDocument();
    const field = screen.getByLabelText("Order or transfer reference");

    fireEvent.change(field, { target: { value: "nope" } });
    fireEvent.click(screen.getByRole("button", { name: "Find" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Enter the 8-character reference, like #7C1F2E0A.");
    expect(field).toHaveAttribute("aria-invalid", "true");
    expect(field).toHaveFocus();
    expect(fakeUrl.replace).not.toHaveBeenCalled();

    fireEvent.change(field, { target: { value: " 7c1f2e0a " } });
    fireEvent.click(screen.getByRole("button", { name: "Find" }));
    expect(fakeUrl.replace).toHaveBeenCalledWith("/admin/ticket-transfers?reference=%237C1F2E0A", { scroll: false });
    expect(await screen.findByText("No ticket transfers for #7C1F2E0A")).toBeInTheDocument();
    expect(adminListTicketTransfers).toHaveBeenLastCalledWith(expect.any(Function), { reference: "#7C1F2E0A" });
    // Said once the answer is in.
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("No ticket transfers for #7C1F2E0A."));
    expect(screen.getByRole("heading", { level: 2 })).toHaveTextContent("Ticket transfers for #7C1F2E0A");

    fireEvent.click(screen.getByRole("button", { name: "Show all" }));
    expect(fakeUrl.replace).toHaveBeenLastCalledWith("/admin/ticket-transfers", { scroll: false });
    await waitFor(() => expect(adminListTicketTransfers).toHaveBeenLastCalledWith(expect.any(Function), {}));
  });

  it("says how many offers a search found", async () => {
    adminListTicketTransfers.mockResolvedValue({ items: [transfer(), transfer({ transferId: "aa", reference: "#AAAAAAAA" })] });
    renderAdmin();
    await item("#0F1E2D3C");
    expect(screen.getByRole("status")).toHaveTextContent("");
    fireEvent.change(screen.getByLabelText("Order or transfer reference"), { target: { value: "#7C1F2E0A" } });
    fireEvent.click(screen.getByRole("button", { name: "Find" }));
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("2 offers for #7C1F2E0A."));
  });

  it("opens on a linked reference (from Emails)", async () => {
    fakeUrl.set("reference=%237C1F2E0A");
    adminListTicketTransfers.mockResolvedValue({ items: [transfer()] });
    renderAdmin();
    await item("#0F1E2D3C");
    expect(adminListTicketTransfers).toHaveBeenCalledWith(expect.any(Function), { reference: "#7C1F2E0A" });
    expect(screen.getByLabelText("Order or transfer reference")).toHaveValue("#7C1F2E0A");
  });

  it("cancels a waiting offer with a reason: checked first, then the API, and the item says so", async () => {
    adminListTicketTransfers.mockResolvedValue({ items: [transfer()] });
    adminCancelTicketTransfer.mockResolvedValue({ result: "cancelled" });
    renderAdmin();
    const pending = await item("#0F1E2D3C");
    fireEvent.click(within(pending).getByRole("button", { name: "Cancel offer #0F1E2D3C" }));
    const dialog = screen.getByRole("dialog", { name: "Cancel offer #0F1E2D3C?" });
    const reason = within(dialog).getByLabelText(/Reason/);
    expect(reason).toHaveFocus();

    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel offer" }));
    expect(await within(dialog).findByText("Enter a reason.")).toBeInTheDocument();
    fireEvent.change(reason, { target: { value: "Asked by sam@example.com" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel offer" }));
    expect(await within(dialog).findByText("Leave email addresses out of the reason.")).toBeInTheDocument();
    expect(adminCancelTicketTransfer).not.toHaveBeenCalled();

    fireEvent.change(reason, { target: { value: "  Buyer asked us to  " } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel offer" }));
    await waitFor(() => expect(adminCancelTicketTransfer).toHaveBeenCalledWith(transfer().transferId, "Buyer asked us to", expect.any(Function)));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    const after = await item("#0F1E2D3C");
    expect(within(after).getByText("Cancelled", { selector: "span" })).toBeInTheDocument();
    expect(within(after).getByText("Buyer asked us to")).toBeInTheDocument();
    expect(within(after).queryByRole("button")).toBeNull();
    expect(screen.getByRole("status")).toHaveTextContent("Cancelled offer #0F1E2D3C.");
    expect(within(after).getByRole("heading")).toHaveFocus();
  });

  it("Keep it and Escape close the dialog and give focus back to the Cancel offer button", async () => {
    adminListTicketTransfers.mockResolvedValue({ items: [transfer()] });
    renderAdmin();
    const button = within(await item("#0F1E2D3C")).getByRole("button", { name: "Cancel offer #0F1E2D3C" });
    fireEvent.click(button);
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Keep it" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(button).toHaveFocus();
    fireEvent.click(button);
    // A browser closes a modal dialog on Escape (the close event).
    (screen.getByRole("dialog") as HTMLDialogElement).close();
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(button).toHaveFocus();
    expect(adminCancelTicketTransfer).not.toHaveBeenCalled();
  });

  it("Tab wraps inside the dialog", async () => {
    adminListTicketTransfers.mockResolvedValue({ items: [transfer()] });
    renderAdmin();
    fireEvent.click(within(await item("#0F1E2D3C")).getByRole("button", { name: "Cancel offer #0F1E2D3C" }));
    const dialog = screen.getByRole("dialog");
    // jsdom lays nothing out: count every control as visible.
    const rects = vi.spyOn(HTMLElement.prototype, "getClientRects").mockReturnValue([{}] as unknown as DOMRectList);
    try {
      const reason = within(dialog).getByLabelText(/Reason/);
      const keep = within(dialog).getByRole("button", { name: "Keep it" });
      keep.focus();
      fireEvent.keyDown(keep, { key: "Tab" });
      expect(reason).toHaveFocus();
      fireEvent.keyDown(reason, { key: "Tab", shiftKey: true });
      expect(keep).toHaveFocus();
    } finally {
      rects.mockRestore();
    }
  });

  it("an offer decided meanwhile (409) says so, and the list is loaded again when the dialog closes", async () => {
    adminListTicketTransfers.mockResolvedValueOnce({ items: [transfer()] });
    adminListTicketTransfers.mockResolvedValueOnce({ items: [transfer({ status: "accepted", decidedAt: "2026-11-21T01:00:00.000Z", holderName: "Sam Lee" })] });
    adminCancelTicketTransfer.mockRejectedValue(
      new ApiError(409, "Only an offer waiting to be accepted can be cancelled.", undefined, { code: "transfer_not_pending" }),
    );
    renderAdmin();
    fireEvent.click(within(await item("#0F1E2D3C")).getByRole("button", { name: "Cancel offer #0F1E2D3C" }));
    const dialog = screen.getByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText(/Reason/), { target: { value: "Buyer asked us to" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel offer" }));
    // The dialog now only says so: a new title and description, no reason field, and focus on Close.
    const close = await within(dialog).findByRole("button", { name: "Close" });
    await waitFor(() => expect(close).toHaveFocus());
    expect(screen.getByRole("dialog", { name: "This offer can’t be cancelled now" })).toHaveAccessibleDescription(
      "Only an offer waiting to be accepted can be cancelled. Close this to see the list as it is now.",
    );
    expect(dialog).not.toHaveTextContent("can’t be undone");
    expect(within(dialog).queryByLabelText(/Reason/)).toBeNull();
    fireEvent.click(close);
    await waitFor(() => expect(adminListTicketTransfers).toHaveBeenCalledTimes(2));
    const after = await item("#0F1E2D3C");
    expect(await within(after).findByText("Accepted", { selector: "span" })).toBeInTheDocument();
    // Focus on the list's heading, and the update said.
    expect(screen.getByRole("heading", { level: 2 })).toHaveFocus();
    expect(screen.getByRole("status")).toHaveTextContent("List updated.");
  });

  it("the API's own reason refusal is shown on the field", async () => {
    adminListTicketTransfers.mockResolvedValue({ items: [transfer()] });
    adminCancelTicketTransfer.mockRejectedValue(new ApiError(400, "Invalid.", { reason: "Reasons can't contain links." }));
    renderAdmin();
    fireEvent.click(within(await item("#0F1E2D3C")).getByRole("button", { name: "Cancel offer #0F1E2D3C" }));
    const dialog = screen.getByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText(/Reason/), { target: { value: "Buyer asked us to" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel offer" }));
    expect(await within(dialog).findByText("Reasons can't contain links.")).toBeInTheDocument();
  });

  it("says a failed load and tries again", async () => {
    adminListTicketTransfers.mockRejectedValueOnce(new Error("offline"));
    adminListTicketTransfers.mockResolvedValueOnce({ items: [] });
    renderAdmin();
    expect(await screen.findByRole("alert")).toHaveTextContent("Couldn’t load ticket transfers.");
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByText("No tickets sent yet")).toBeInTheDocument();
    // The button is gone: focus is on the list's heading.
    expect(screen.getByRole("heading", { level: 2 })).toHaveFocus();
  });

  it("loads more with the cursor", async () => {
    adminListTicketTransfers.mockResolvedValueOnce({ items: [transfer()], nextCursor: "c1" });
    adminListTicketTransfers.mockResolvedValueOnce({ items: [transfer({ transferId: "aa", reference: "#AAAAAAAA" })] });
    renderAdmin();
    await item("#0F1E2D3C");
    fireEvent.click(screen.getByRole("button", { name: "Load more" }));
    const added = await item("#AAAAAAAA");
    expect(adminListTicketTransfers).toHaveBeenLastCalledWith(expect.any(Function), { cursor: "c1" });
    expect(screen.queryByRole("button", { name: "Load more" })).toBeNull();
    // The last page: the button is gone, so focus goes to the first offer just loaded, and the count is said.
    await waitFor(() => expect(within(added).getByRole("heading")).toHaveFocus());
    expect(screen.getByRole("status")).toHaveTextContent("1 more offer loaded.");
  });
});

describe("the reference and reason checks", () => {
  it("words a search's result", () => {
    expect(searchResultText("#A90133C9", 3, false)).toBe("3 offers for #A90133C9.");
    expect(searchResultText("#A90133C9", 1, false)).toBe("1 offer for #A90133C9.");
    expect(searchResultText("#A90133C9", 20, true)).toBe("20 or more offers for #A90133C9.");
    expect(searchResultText("#A90133C9", 0, false)).toBe("No ticket transfers for #A90133C9.");
  });

  it("normalises a reference, or refuses it", () => {
    expect(normaliseReference("#7c1f2e0a")).toBe("#7C1F2E0A");
    expect(normaliseReference(" 7C1F2E0A ")).toBe("#7C1F2E0A");
    expect(normaliseReference("7C1F2E0")).toBeNull();
    expect(normaliseReference(null)).toBeNull();
  });

  it("checks a reason as the API does", () => {
    expect(cancelReasonError("")).toBe("Enter a reason.");
    expect(cancelReasonError("no")).toBe("Must be at least 3 characters.");
    expect(cancelReasonError("Mail x＠example.com")).toBe("Leave email addresses out of the reason.");
    expect(cancelReasonError("Buyer asked")).toBeNull();
    expect(cancelReasonError("a".repeat(501))).toMatch(/500 characters or fewer/);
  });
});
