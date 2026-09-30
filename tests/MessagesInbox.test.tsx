// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { InboxPageContent } from "@/components/messages/MessagesPages";
import { ApiError } from "@/lib/api/client";
import type { ConversationSummary } from "@/lib/api/types";
import type { AuthContextValue } from "@/lib/auth/AuthContext";
import { fakeAuthValue, FakeAuthProvider } from "./test-utils/fakeAuth";

vi.mock("@/lib/api/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api/client")>()),
  isApiConfigured: true,
}));

const listConversations = vi.fn();
vi.mock("@/lib/api/messages", () => ({
  listConversations: (...args: unknown[]) => listConversations(...args),
}));

beforeEach(() => {
  listConversations.mockReset();
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function summary(id: string, overrides: Partial<ConversationSummary> = {}): ConversationSummary {
  return {
    conversationId: id,
    otherDisplayName: `Person ${id}`,
    status: "active",
    event: { title: "Neon Static", slug: "neon-static" },
    lastMessage: { preview: `Last from ${id}`, sentAt: "2026-09-26T09:00:00.000Z", fromYou: false },
    unread: false,
    ...overrides,
  };
}

function renderInbox(auth: AuthContextValue = fakeAuthValue()) {
  return render(
    <FakeAuthProvider value={auth}>
      <InboxPageContent />
    </FakeAuthProvider>,
  );
}

function rows() {
  return within(screen.getByRole("list", { name: "Conversations" })).getAllByRole("listitem");
}

describe("Inbox", () => {
  it("lists conversations with their state, event, preview and unread marker, each linking to its thread", async () => {
    listConversations.mockResolvedValue({
      items: [
        summary("c1", { status: "request_received", unread: true, otherDisplayName: "Sam K." }),
        summary("c2", {
          status: "request_sent",
          otherDisplayName: "Priya R.",
          lastMessage: { preview: "Hi <b>there</b>", sentAt: "2026-09-26T09:00:00.000Z", fromYou: true },
        }),
        summary("c3", { otherDisplayName: "Leo", event: undefined }),
      ],
    });
    renderInbox();
    expect(screen.getByText("Loading your messages…")).toBeInTheDocument();
    await screen.findByRole("list", { name: "Conversations" });
    const [request, sent, active] = rows();

    const requestLink = within(request).getByRole("link");
    expect(requestLink).toHaveAttribute("href", "/messages/c1");
    expect(requestLink).toHaveTextContent("Unread: Sam K.");
    expect(request).toHaveTextContent("Message request");
    expect(request.querySelector("[data-unread-dot]")).not.toBeNull();

    expect(within(sent).getByRole("link")).toHaveAttribute("href", "/messages/c2");
    expect(sent).toHaveTextContent("Waiting for a reply");
    expect(sent).toHaveTextContent("You: Hi <b>there</b>");
    expect(sent.querySelector("b")).toBeNull();
    expect(sent).not.toHaveTextContent("Unread");
    expect(sent.querySelector("[data-unread-dot]")).toBeNull();

    expect(active).not.toHaveTextContent("Message request");
    expect(active).not.toHaveTextContent("Waiting for a reply");
    expect(active).not.toHaveTextContent("Neon Static");
    expect(listConversations).toHaveBeenCalledWith(expect.any(Function));
  });

  it("empty: explains where messages come from", async () => {
    listConversations.mockResolvedValue({ items: [] });
    renderInbox();
    expect(await screen.findByText("No messages yet")).toBeInTheDocument();
    expect(screen.getByText(/added yourself to its Who’s Going list/)).toBeInTheDocument();
  });

  it("a load error is shown with Try again; a 403 says why", async () => {
    listConversations.mockRejectedValueOnce(new ApiError(500, "boom"));
    renderInbox();
    expect(await screen.findByRole("alert")).toHaveTextContent("Couldn’t load your messages.");
    listConversations.mockRejectedValueOnce(new ApiError(403, "Verify your email address first."));
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Verify your email address first."));
    expect(listConversations).toHaveBeenCalledTimes(2);
  });

  it("Load more appends the next page (no duplicates), focuses the first new one and announces it", async () => {
    listConversations
      .mockResolvedValueOnce({ items: [summary("c1"), summary("c2")], nextCursor: "2" })
      .mockResolvedValueOnce({ items: [summary("c2"), summary("c3")] });
    renderInbox();
    await screen.findByRole("list", { name: "Conversations" });
    fireEvent.click(screen.getByRole("button", { name: "Load more" }));
    await waitFor(() => expect(rows()).toHaveLength(3));
    expect(listConversations).toHaveBeenLastCalledWith(expect.any(Function), "2");
    await waitFor(() => expect(within(rows()[2]).getByRole("link")).toHaveFocus());
    expect(screen.getByRole("status")).toHaveTextContent("1 more conversation shown.");
    expect(screen.queryByRole("button", { name: "Load more" })).toBeNull();
  });

  it("keeps Load more and says so when the next page fails", async () => {
    listConversations
      .mockResolvedValueOnce({ items: [summary("c1")], nextCursor: "1" })
      .mockRejectedValueOnce(new ApiError(500, "boom"));
    renderInbox();
    await screen.findByRole("list", { name: "Conversations" });
    fireEvent.click(screen.getByRole("button", { name: "Load more" }));
    expect(await screen.findByText("Couldn’t load more conversations.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Load more" })).toBeInTheDocument();
  });

  it("signed out: Sign in comes back to /messages, with no API call", () => {
    renderInbox(fakeAuthValue({ status: "signed-out", email: undefined }));
    expect(screen.getByRole("link", { name: "Sign in" })).toHaveAttribute("href", "/login?next=%2Fmessages");
    expect(listConversations).not.toHaveBeenCalled();
  });

  it("demo: a notice and a sample conversation, and never calls the API", () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    renderInbox(fakeAuthValue({ configured: false, status: "signed-out" }));
    expect(screen.getByRole("note")).toHaveTextContent("Messages aren’t available in this demo.");
    expect(screen.getByRole("list", { name: "Messages with Priya R." })).toBeInTheDocument();
    expect(listConversations).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
