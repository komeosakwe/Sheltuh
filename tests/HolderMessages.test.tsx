// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import HolderMessages from "@/components/admin/HolderMessages";
import { ApiError } from "@/lib/api/client";
import type { AdminHolderMessage, AdminHolderMessageDetail } from "@/lib/api/types";
import { FakeAuthProvider, fakeAuthValue } from "./test-utils/fakeAuth";

const adminListHolderMessages = vi.fn();
const adminGetHolderMessage = vi.fn();
const adminCancelHolderMessage = vi.fn();
vi.mock("@/lib/api/holder-messages", () => ({
  adminListHolderMessages: (...args: unknown[]) => adminListHolderMessages(...args),
  adminGetHolderMessage: (...args: unknown[]) => adminGetHolderMessage(...args),
  adminCancelHolderMessage: (...args: unknown[]) => adminCancelHolderMessage(...args),
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
  adminListHolderMessages.mockReset();
  adminGetHolderMessage.mockReset();
  adminCancelHolderMessage.mockReset();
});
afterEach(cleanup);

function message(id: string, overrides: Partial<AdminHolderMessage> = {}): AdminHolderMessage {
  return {
    messageId: id,
    eventId: "00000000-0000-4000-8000-000000000001",
    eventTitle: "Neon Static",
    organiserName: "Northside Noise",
    subject: `Subject ${id}`,
    recipientCount: 40,
    sentCount: 12,
    skippedCount: 0,
    createdAt: "2026-10-20T01:00:00.000Z",
    cancelled: false,
    ...overrides,
  };
}

function detail(id: string, overrides: Partial<AdminHolderMessageDetail> = {}): AdminHolderMessageDetail {
  return { ...message(id), body: "Doors open at 7pm.\nBring ID.", ...overrides };
}

function renderMessages() {
  render(
    <FakeAuthProvider value={fakeAuthValue({ isAdmin: true })}>
      <HolderMessages />
    </FakeAuthProvider>,
  );
}

describe("HolderMessages (admin)", () => {
  it("lists messages with their event, organiser, date and how many have gone out", async () => {
    adminListHolderMessages.mockResolvedValue({
      items: [message("a"), message("b", { cancelled: true, skippedCount: 3 })],
    });
    renderMessages();
    const items = within(await screen.findByRole("list")).getAllByRole("listitem");
    expect(items).toHaveLength(2);
    expect(items[0]).toHaveTextContent("Subject a");
    expect(items[0]).toHaveTextContent("Neon Static · Northside Noise");
    expect(items[0]).toHaveTextContent("Sent 12 of 40");
    expect(items[0]).not.toHaveTextContent("Stopped");
    expect(items[1]).toHaveTextContent("Sent 12 of 40 · 3 skipped · Stopped");
    expect(adminListHolderMessages).toHaveBeenCalledWith({ eventId: undefined }, expect.any(Function));
    expect(adminGetHolderMessage).not.toHaveBeenCalled();
  });

  it("shows loading, an empty state and an error with Try again", async () => {
    adminListHolderMessages.mockRejectedValueOnce(new ApiError(0, "x"));
    adminListHolderMessages.mockResolvedValueOnce({ items: [] });
    renderMessages();
    expect(screen.getByRole("progressbar", { name: "Loading" })).toBeInTheDocument();
    expect(await screen.findByRole("alert")).toHaveTextContent("Couldn’t load messages.");
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByText("No messages sent")).toBeInTheDocument();
  });

  it("loads more with the cursor and skips ones already shown", async () => {
    adminListHolderMessages.mockResolvedValueOnce({ items: [message("a")], nextCursor: "c1" });
    adminListHolderMessages.mockResolvedValueOnce({ items: [message("a"), message("b")] });
    renderMessages();
    await screen.findByText("Subject a");
    fireEvent.click(screen.getByRole("button", { name: "Load more" }));
    await screen.findByText("Subject b");
    expect(adminListHolderMessages).toHaveBeenLastCalledWith({ eventId: undefined, cursor: "c1" }, expect.any(Function));
    expect(screen.getAllByText(/^Subject /)).toHaveLength(2);
    expect(screen.queryByRole("button", { name: "Load more" })).not.toBeInTheDocument();
  });

  it("says when more couldn't be loaded and keeps the list", async () => {
    adminListHolderMessages.mockResolvedValueOnce({ items: [message("a")], nextCursor: "c1" });
    adminListHolderMessages.mockRejectedValueOnce(new ApiError(0, "x"));
    renderMessages();
    await screen.findByText("Subject a");
    fireEvent.click(screen.getByRole("button", { name: "Load more" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Couldn’t load more messages.");
    expect(screen.getByText("Subject a")).toBeInTheDocument();
  });

  it("opens a message to read its text", async () => {
    adminListHolderMessages.mockResolvedValue({ items: [message("a")] });
    adminGetHolderMessage.mockResolvedValue(detail("a"));
    renderMessages();
    const toggle = await screen.findByRole("button", { name: "Subject a" });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(toggle);
    expect(await screen.findByText(/Doors open at 7pm\./)).toBeInTheDocument();
    expect(adminGetHolderMessage).toHaveBeenCalledWith("a", expect.any(Function));
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "false");
  });

  it("says when a message couldn't be opened, and tries again", async () => {
    adminListHolderMessages.mockResolvedValue({ items: [message("a")] });
    adminGetHolderMessage.mockRejectedValueOnce(new ApiError(404, "Message not found."));
    adminGetHolderMessage.mockResolvedValueOnce(detail("a"));
    renderMessages();
    fireEvent.click(await screen.findByRole("button", { name: "Subject a" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Message not found.");
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByText(/Bring ID\./)).toBeInTheDocument();
  });

  it("stops a message only after a confirm, then shows it stopped", async () => {
    adminListHolderMessages.mockResolvedValue({ items: [message("a")] });
    adminGetHolderMessage.mockResolvedValue(detail("a"));
    adminCancelHolderMessage.mockResolvedValue(detail("a", { cancelled: true, cancelledAt: "2026-10-20T02:00:00.000Z" }));
    renderMessages();
    fireEvent.click(await screen.findByRole("button", { name: "Subject a" }));
    fireEvent.click(await screen.findByRole("button", { name: "Stop “Subject a”" }));
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByRole("heading", { name: "Stop “Subject a”?" })).toBeInTheDocument();
    expect(adminCancelHolderMessage).not.toHaveBeenCalled();

    // Cancel leaves it alone.
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(adminCancelHolderMessage).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Stop “Subject a”" }));
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Stop sending" }));
    await waitFor(() => expect(adminCancelHolderMessage).toHaveBeenCalledWith("a", expect.any(Function)));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    const item = screen.getByRole("listitem");
    expect(item).toHaveTextContent("Sent 12 of 40 · Stopped");
    expect(screen.queryByRole("button", { name: /^Stop “/ })).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Stopped “Subject a”.");
    expect(screen.getByRole("button", { name: "Subject a" })).toHaveFocus();
  });

  it("keeps the dialog open with the reason when stopping fails", async () => {
    adminListHolderMessages.mockResolvedValue({ items: [message("a")] });
    adminGetHolderMessage.mockResolvedValue(detail("a"));
    adminCancelHolderMessage.mockRejectedValue(new ApiError(0, "x"));
    renderMessages();
    fireEvent.click(await screen.findByRole("button", { name: "Subject a" }));
    fireEvent.click(await screen.findByRole("button", { name: "Stop “Subject a”" }));
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Stop sending" }));
    expect(await within(screen.getByRole("dialog")).findByRole("alert")).toHaveTextContent("Couldn’t stop it. Try again.");
    expect(screen.getByRole("listitem")).not.toHaveTextContent("Stopped");
  });

  it("offers no Stop for a message that is already stopped", async () => {
    adminListHolderMessages.mockResolvedValue({ items: [message("a", { cancelled: true })] });
    adminGetHolderMessage.mockResolvedValue(detail("a", { cancelled: true, cancelledAt: "2026-10-20T02:00:00.000Z" }));
    renderMessages();
    fireEvent.click(await screen.findByRole("button", { name: "Subject a" }));
    await screen.findByText(/Bring ID\./);
    expect(screen.queryByRole("button", { name: /^Stop “/ })).not.toBeInTheDocument();
  });

  it("narrows the list to one event, and back", async () => {
    adminListHolderMessages.mockResolvedValue({ items: [message("a")] });
    adminGetHolderMessage.mockResolvedValue(detail("a"));
    renderMessages();
    fireEvent.click(await screen.findByRole("button", { name: "Subject a" }));
    fireEvent.click(await screen.findByRole("button", { name: "Only this event" }));
    expect(await screen.findByRole("heading", { name: "Messages for Neon Static" })).toBeInTheDocument();
    await waitFor(() =>
      expect(adminListHolderMessages).toHaveBeenLastCalledWith(
        { eventId: "00000000-0000-4000-8000-000000000001" },
        expect.any(Function),
      ),
    );
    fireEvent.click(screen.getByRole("button", { name: "Show all events" }));
    await waitFor(() => expect(adminListHolderMessages).toHaveBeenLastCalledWith({ eventId: undefined }, expect.any(Function)));
  });
});
