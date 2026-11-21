// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import MessagesFrame from "@/components/messages/MessagesFrame";
import { ThreadPageContent } from "@/components/messages/MessagesPages";
import type { ConversationSummary, MessagePage } from "@/lib/api/types";
import { fakeAuthValue, FakeAuthProvider } from "./test-utils/fakeAuth";

/**
 * The conversation list stays mounted beside the open conversation (MessagesFrame), so it must
 * follow what happens in it: reading clears the unread dot, a reply updates the preview, blocking
 * removes the conversation, and moving back to /messages reloads it.
 */

vi.mock("@/lib/api/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api/client")>()),
  isApiConfigured: true,
}));

const api = {
  listConversations: vi.fn(),
  getMessages: vi.fn(),
  sendMessage: vi.fn(),
  markConversationRead: vi.fn(),
  declineConversation: vi.fn(),
  blockMember: vi.fn(),
  unblockMember: vi.fn(),
  reportMember: vi.fn(),
  getUnreadCount: vi.fn(),
};
vi.mock("@/lib/api/messages", () => ({
  listConversations: (...args: unknown[]) => api.listConversations(...args),
  getMessages: (...args: unknown[]) => api.getMessages(...args),
  sendMessage: (...args: unknown[]) => api.sendMessage(...args),
  markConversationRead: (...args: unknown[]) => api.markConversationRead(...args),
  declineConversation: (...args: unknown[]) => api.declineConversation(...args),
  blockMember: (...args: unknown[]) => api.blockMember(...args),
  unblockMember: (...args: unknown[]) => api.unblockMember(...args),
  reportMember: (...args: unknown[]) => api.reportMember(...args),
  getUnreadCount: (...args: unknown[]) => api.getUnreadCount(...args),
}));

let segment: string | null = "c1";
vi.mock("next/navigation", () => ({
  usePathname: () => (segment ? `/messages/${segment}` : "/messages"),
  useSelectedLayoutSegment: () => segment,
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));

function conversation(id: string, name: string, overrides: Partial<ConversationSummary> = {}): ConversationSummary {
  return {
    conversationId: id,
    otherDisplayName: name,
    status: "active",
    event: { title: "Neon Static", slug: "neon-static" },
    lastMessage: { preview: "See you there", sentAt: "2026-09-26T09:00:00.000Z", fromYou: false },
    unread: false,
    ...overrides,
  };
}

const SAM = conversation("c1", "Sam K.", { unread: true });
const LEO = conversation("c2", "Leo");

function thread(c: ConversationSummary): MessagePage {
  return {
    conversation: c,
    items: [{ messageId: "m1", body: "See you there", sentAt: "2026-09-26T09:00:00.000Z", fromYou: false }],
    hasMore: false,
  };
}

beforeEach(() => {
  for (const fn of Object.values(api)) fn.mockReset();
  segment = "c1";
  api.getUnreadCount.mockResolvedValue({ count: 0 });
  api.markConversationRead.mockResolvedValue(undefined);
  api.getMessages.mockResolvedValue(thread(SAM));
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "visible" });
});
afterEach(cleanup);

function renderSplit() {
  const tree = () => (
    <FakeAuthProvider value={fakeAuthValue({ email: "latte@example.com" })}>
      <MessagesFrame>{segment ? <ThreadPageContent conversationId={segment} /> : <p>Pick one</p>}</MessagesFrame>
    </FakeAuthProvider>
  );
  const result = render(tree());
  return { ...result, rerenderAt: (next: string | null) => ((segment = next), result.rerender(tree())) };
}

const row = (name: string) =>
  within(screen.getByRole("list", { name: "Conversations" }))
    .getAllByRole("listitem")
    .find((item) => item.textContent?.includes(name));

describe("the conversation list beside an open conversation", () => {
  it("drops the unread dot once the open conversation is read", async () => {
    api.listConversations.mockResolvedValueOnce({ items: [SAM, LEO] }).mockResolvedValue({ items: [{ ...SAM, unread: false }, LEO] });
    renderSplit();
    await waitFor(() => expect(row("Sam K.")?.querySelector("[data-unread-dot]")).not.toBeNull());
    await waitFor(() => expect(api.markConversationRead).toHaveBeenCalled());
    await waitFor(() => expect(row("Sam K.")?.querySelector("[data-unread-dot]")).toBeNull());
    expect(api.listConversations.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it("takes a blocked conversation out of the list", async () => {
    api.getMessages.mockResolvedValue(thread({ ...SAM, unread: false }));
    api.listConversations.mockResolvedValue({ items: [{ ...SAM, unread: false }, LEO] });
    api.blockMember.mockResolvedValue({ blockId: "b1", displayName: "Sam K.", createdAt: "2026-09-26T10:00:00.000Z" });
    renderSplit();
    await screen.findByRole("heading", { level: 1, name: "Sam K." });
    await waitFor(() => expect(row("Sam K.")).toBeDefined());
    api.listConversations.mockResolvedValue({ items: [LEO] });
    fireEvent.click(screen.getByRole("button", { name: "Block" }));
    fireEvent.click(within(screen.getByRole("group", { name: "Block Sam K.?" })).getByRole("button", { name: "Yes, block" }));
    await screen.findByRole("heading", { level: 1, name: "You blocked Sam K." });
    await waitFor(() => expect(row("Sam K.")).toBeUndefined());
    expect(row("Leo")).toBeDefined();
  });

  it("shows a reply's preview in the list", async () => {
    api.getMessages.mockResolvedValue(thread({ ...SAM, unread: false }));
    api.listConversations.mockResolvedValue({ items: [{ ...SAM, unread: false }, LEO] });
    api.sendMessage.mockResolvedValue({ messageId: "m2", body: "On my way", sentAt: "2026-09-26T10:00:00.000Z", fromYou: true });
    renderSplit();
    const box = await screen.findByRole("textbox");
    api.listConversations.mockResolvedValue({
      items: [{ ...SAM, unread: false, lastMessage: { preview: "On my way", sentAt: "2026-09-26T10:00:00.000Z", fromYou: true } }, LEO],
    });
    fireEvent.change(box, { target: { value: "On my way" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() => expect(row("Sam K.")).toHaveTextContent("You: On my way"));
  });

  it("reloads when you go back to /messages, keeping the rows on screen meanwhile", async () => {
    api.getMessages.mockResolvedValue(thread({ ...SAM, unread: false }));
    api.listConversations.mockResolvedValue({ items: [{ ...SAM, unread: false }, LEO] });
    const { rerenderAt } = renderSplit();
    await waitFor(() => expect(row("Leo")).toBeDefined());
    const calls = api.listConversations.mock.calls.length;
    let resolve: (value: { items: ConversationSummary[] }) => void = () => undefined;
    api.listConversations.mockReturnValue(new Promise((r) => (resolve = r)));
    rerenderAt(null);
    await waitFor(() => expect(api.listConversations.mock.calls.length).toBe(calls + 1));
    // Still showing the last rows (no loading state) while it reloads.
    expect(row("Leo")).toBeDefined();
    resolve({ items: [LEO, conversation("c3", "Priya R.", { unread: true })] });
    await waitFor(() => expect(row("Priya R.")).toBeDefined());
  });

  it("keeps the rows, and says so, when a reload fails", async () => {
    api.getMessages.mockResolvedValue(thread({ ...SAM, unread: false }));
    api.listConversations.mockResolvedValueOnce({ items: [{ ...SAM, unread: false }, LEO] }).mockRejectedValue(new Error("offline"));
    const { rerenderAt } = renderSplit();
    await waitFor(() => expect(row("Leo")).toBeDefined());
    rerenderAt(null);
    const note = await screen.findByText("Couldn’t refresh this list.");
    expect(note.closest('[role="status"]')).not.toBeNull();
    expect(row("Leo")).toBeDefined();
    // Try again reloads, keeping the rows meanwhile.
    api.listConversations.mockResolvedValue({ items: [LEO] });
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    await waitFor(() => expect(row("Sam K.")).toBeUndefined());
    expect(screen.queryByText("Couldn’t refresh this list.")).toBeNull();
  });

  it("says a reload failed even when the list is empty, with Try again", async () => {
    segment = null;
    api.listConversations.mockResolvedValueOnce({ items: [] }).mockRejectedValueOnce(new Error("offline"));
    const { rerenderAt } = renderSplit();
    expect(await screen.findByText("No messages yet")).toBeInTheDocument();
    api.getMessages.mockResolvedValue(thread({ ...SAM, unread: false }));
    rerenderAt("c1");
    expect(await screen.findByText("Couldn’t refresh this list.")).toBeInTheDocument();
    api.listConversations.mockResolvedValue({ items: [{ ...SAM, unread: false }] });
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    await waitFor(() => expect(row("Sam K.")).toBeDefined());
  });

  it("drops a Load more that a reload overtook, so it can't bring back a blocked conversation", async () => {
    segment = null;
    const PRIYA = conversation("c3", "Priya R.");
    let resolveMore: (page: { items: ConversationSummary[] }) => void = () => undefined;
    let reload: { items: ConversationSummary[] } = { items: [{ ...SAM, unread: false }, LEO] };
    let firstLoad = true;
    api.listConversations.mockImplementation((_token: unknown, cursor?: string) => {
      if (cursor) return new Promise((resolve) => (resolveMore = resolve));
      if (firstLoad) {
        firstLoad = false;
        return Promise.resolve({ items: [{ ...SAM, unread: false }, LEO], nextCursor: "n2" });
      }
      return Promise.resolve(reload);
    });
    const { rerenderAt } = renderSplit();
    fireEvent.click(await screen.findByRole("button", { name: "Load more" }));
    expect(api.listConversations).toHaveBeenLastCalledWith(expect.any(Function), "n2");
    // Meanwhile Sam is blocked elsewhere and the list reloads without them.
    reload = { items: [LEO] };
    api.getMessages.mockResolvedValue(thread(LEO));
    rerenderAt("c2");
    await waitFor(() => expect(row("Sam K.")).toBeUndefined());
    // The old Load more lands: dropped, not merged onto the old rows, and not announced.
    resolveMore({ items: [PRIYA] });
    await act(async () => {});
    expect(row("Sam K.")).toBeUndefined();
    expect(row("Priya R.")).toBeUndefined();
    expect(screen.queryByText(/more conversation/)).toBeNull();
  });
});
