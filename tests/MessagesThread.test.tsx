// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ThreadPageContent } from "@/components/messages/MessagesPages";
import { UnreadProvider } from "@/components/messages/UnreadProvider";
import { ApiError } from "@/lib/api/client";
import type { ConversationSummary, MessagePage, MessageRecord } from "@/lib/api/types";
import { SessionExpiredError, type AuthContextValue } from "@/lib/auth/AuthContext";
import { fakeAuthValue, FakeAuthProvider } from "./test-utils/fakeAuth";

vi.mock("@/lib/api/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api/client")>()),
  isApiConfigured: true,
}));

const api = {
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
  getMessages: (...args: unknown[]) => api.getMessages(...args),
  sendMessage: (...args: unknown[]) => api.sendMessage(...args),
  markConversationRead: (...args: unknown[]) => api.markConversationRead(...args),
  declineConversation: (...args: unknown[]) => api.declineConversation(...args),
  blockMember: (...args: unknown[]) => api.blockMember(...args),
  unblockMember: (...args: unknown[]) => api.unblockMember(...args),
  reportMember: (...args: unknown[]) => api.reportMember(...args),
  getUnreadCount: (...args: unknown[]) => api.getUnreadCount(...args),
}));

// jsdom has no modal dialogs: give <dialog> what a browser would.
beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement) {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close = function close(this: HTMLDialogElement) {
    this.removeAttribute("open");
    this.dispatchEvent(new Event("close"));
  };
});

let visibility: DocumentVisibilityState = "visible";
beforeEach(() => {
  for (const fn of Object.values(api)) fn.mockReset();
  api.markConversationRead.mockResolvedValue(undefined);
  api.getUnreadCount.mockResolvedValue({ count: 0 });
  visibility = "visible";
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => visibility });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

function conversation(overrides: Partial<ConversationSummary> = {}): ConversationSummary {
  return {
    conversationId: "c1",
    otherDisplayName: "Sam K.",
    status: "active",
    event: { title: "Neon Static", slug: "neon-static" },
    lastMessage: { preview: "Hi", sentAt: "2026-09-26T09:03:00.000Z", fromYou: false },
    unread: false,
    ...overrides,
  };
}

function msg(id: number, fromYou = false, body = `Message ${id}`): MessageRecord {
  return { messageId: String(id), body, sentAt: new Date(Date.UTC(2026, 8, 26, 9, id)).toISOString(), fromYou };
}

function page(items: MessageRecord[], conv: ConversationSummary = conversation(), hasMore = false): MessagePage {
  return { conversation: conv, items, hasMore };
}

function renderThread(auth: AuthContextValue = fakeAuthValue(), { withUnread = false } = {}) {
  const content = <ThreadPageContent conversationId="c1" />;
  return render(<FakeAuthProvider value={auth}>{withUnread ? <UnreadProvider>{content}</UnreadProvider> : content}</FakeAuthProvider>);
}

async function ready() {
  return screen.findByRole("list", { name: "Messages with Sam K." });
}

function composer() {
  return screen.getByRole("textbox", { name: /Message Sam K\.|Reply to Sam K\. to accept/ });
}

function liveRegion() {
  const regions = screen.getAllByRole("status");
  const region = regions.find((r) => r.classList.contains("sr-only"));
  if (!region) throw new Error("no live region");
  return region;
}

async function type(text: string) {
  fireEvent.change(composer(), { target: { value: text } });
}

describe("Thread — loading and reading", () => {
  it("shows loading, then messages oldest first, rendered as plain text with line breaks and no links", async () => {
    api.getMessages.mockResolvedValue(
      page([
        msg(1, false, "<script>window.pwned = true</script><b>bold?</b>"),
        msg(2, true, "line one\nline two"),
        msg(3, false, "see https://example.com/a-very-long-url"),
      ]),
    );
    renderThread();
    expect(screen.getByText("Loading the conversation…")).toBeInTheDocument();
    const list = await ready();
    const items = within(list).getAllByRole("listitem");
    expect(items.map((li) => li.dataset.messageId)).toEqual(["1", "2", "3"]);

    // Markup in a message is text, not HTML.
    expect(within(list).getByText("<script>window.pwned = true</script><b>bold?</b>")).toBeInTheDocument();
    expect(list.querySelector("script, b")).toBeNull();
    expect((window as unknown as { pwned?: boolean }).pwned).toBeUndefined();
    // Line breaks are kept (pre-wrap), long words wrap, and URLs aren't linked.
    const multiline = within(items[1]).getByText(/line one/);
    expect(multiline.textContent).toBe("line one\nline two");
    expect(multiline).toHaveClass("whitespace-pre-wrap", "break-words");
    expect(within(list).queryAllByRole("link")).toHaveLength(0);
    // Who said what, for screen readers.
    expect(items[0]).toHaveTextContent(/^Sam K\.:/);
    expect(items[1]).toHaveTextContent(/^You:/);

    expect(screen.getByRole("heading", { level: 1, name: "Sam K." })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Neon Static" })).toHaveAttribute("href", "/events/neon-static");
    expect(api.getMessages).toHaveBeenCalledWith("c1", expect.any(Function));
  });

  it("a conversation that isn't there (404) says so generically, never why", async () => {
    api.getMessages.mockRejectedValue(new ApiError(404, "Conversation not found."));
    renderThread();
    const heading = await screen.findByRole("heading", { name: "This conversation isn’t available" });
    const text = heading.parentElement?.textContent ?? "";
    expect(text).toContain("It may have been removed, or this person can’t be messaged.");
    expect(text).not.toMatch(/block|declin|suspend/i);
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(screen.getByRole("link", { name: /All messages/ })).toHaveAttribute("href", "/messages");
  });

  it("explains a 403 (unverified email) and Try again reloads", async () => {
    api.getMessages.mockRejectedValueOnce(new ApiError(403, "Verify your email address first."));
    renderThread();
    expect(await screen.findByRole("alert")).toHaveTextContent("Verify your email address first.");
    api.getMessages.mockResolvedValueOnce(page([msg(1)]));
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    await ready();
    expect(api.getMessages).toHaveBeenCalledTimes(2);
  });

  it("shows a generic load error for anything else", async () => {
    api.getMessages.mockRejectedValue(new ApiError(500, "Internal detail"));
    renderThread();
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Couldn’t load this conversation.");
    expect(alert).not.toHaveTextContent("Internal detail");
  });

  it("signed out: offers Sign in, coming back to this conversation", () => {
    renderThread(fakeAuthValue({ status: "signed-out", email: undefined }));
    expect(screen.getByRole("link", { name: "Sign in" })).toHaveAttribute("href", "/login?next=%2Fmessages%2Fc1");
    expect(api.getMessages).not.toHaveBeenCalled();
  });

  it("demo mode: a sample conversation, a disabled composer, and no API calls", () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    renderThread(fakeAuthValue({ configured: false, status: "signed-out" }));
    expect(screen.getByRole("note")).toHaveTextContent("Messages aren’t available in this demo.");
    expect(screen.getByRole("list", { name: "Messages with Priya R." })).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Your message" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Send" })).toBeDisabled();
    for (const fn of Object.values(api)) expect(fn).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("marks an unread conversation read up to the newest message shown, and refreshes the nav count", async () => {
    api.getMessages.mockResolvedValue(page([msg(1), msg(2)], conversation({ unread: true })));
    renderThread(fakeAuthValue(), { withUnread: true });
    await ready();
    await waitFor(() => expect(api.markConversationRead).toHaveBeenCalledWith("c1", expect.any(Function), "2"));
    // Once on mount, and again after marking read.
    await waitFor(() => expect(api.getUnreadCount).toHaveBeenCalledTimes(2));
  });

  it("doesn't mark read a conversation opened in a background tab", async () => {
    visibility = "hidden";
    api.getMessages.mockResolvedValue(page([msg(1)], conversation({ unread: true })));
    renderThread();
    await ready();
    expect(api.markConversationRead).not.toHaveBeenCalled();
  });
});

describe("Thread — sending", () => {
  beforeEach(() => {
    api.getMessages.mockResolvedValue(page([msg(1), msg(2, true)]));
  });

  it("sends, shows the message, clears and refocuses the box, and announces it", async () => {
    api.sendMessage.mockResolvedValue(msg(3, true, "Hello there"));
    renderThread();
    const list = await ready();
    await type("  Hello there  ");
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    const sent = await within(list).findByText("Hello there");
    expect(api.sendMessage).toHaveBeenCalledWith("c1", "Hello there", expect.any(Function));
    expect(sent.closest("li")?.dataset.messageId).toBe("3");
    await waitFor(() => expect(composer()).toHaveFocus());
    expect(composer()).toHaveValue("");
    expect(liveRegion()).toHaveTextContent("Message sent.");
  });

  it("checks the message before sending: blank or over 1,000 characters", async () => {
    renderThread();
    await ready();
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    const box = composer();
    expect(box).toHaveAttribute("aria-invalid", "true");
    expect(box).toHaveAccessibleDescription(expect.stringContaining("Write a message."));
    expect(box).toHaveFocus();

    await type("é".repeat(1001));
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    expect(composer()).toHaveAccessibleDescription(expect.stringContaining("Keep it to 1,000 characters or fewer."));
    expect(api.sendMessage).not.toHaveBeenCalled();
  });

  it("shows the API's field error on the box and keeps the draft (400)", async () => {
    api.sendMessage.mockRejectedValue(
      new ApiError(400, "Invalid", { body: "Messages can't stack accents or other marks on one character." }),
    );
    renderThread();
    await ready();
    await type("Z̵̢̛a̶l̸g̷o̴");
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() =>
      expect(composer()).toHaveAccessibleDescription(expect.stringContaining("can't stack accents")),
    );
    await waitFor(() => expect(composer()).toHaveFocus());
    expect(composer()).toHaveValue("Z̵̢̛a̶l̸g̷o̴");
  });

  it.each([
    [new ApiError(429, "You're sending messages too quickly."), "You’ve sent a lot of messages in the last hour. Take a break and try again a bit later."],
    [new ApiError(403, "Your profile can't send messages right now."), "Your profile can't send messages right now."],
    [new ApiError(0, "Couldn't reach the server. Check your connection and try again."), "Couldn't reach the server."],
    [new ApiError(500, "db exploded"), "Couldn’t send that. Try again."],
    [new ApiError(413, "Request body too large."), "Couldn’t send that. Try again."],
  ])("maps %s to a focused alert and keeps the draft", async (error, expected) => {
    api.sendMessage.mockRejectedValue(error);
    renderThread();
    await ready();
    await type("Still here");
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(expected);
    await waitFor(() => expect(alert.closest("[tabindex='-1']")).toHaveFocus());
    expect(composer()).toHaveValue("Still here");
  });

  it("a session that has expired offers Sign in back to this conversation", async () => {
    api.sendMessage.mockRejectedValue(new SessionExpiredError());
    renderThread();
    await ready();
    await type("Hi");
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    const alert = await screen.findByRole("alert");
    expect(within(alert).getByRole("link", { name: "Sign in" })).toHaveAttribute("href", "/login?next=%2Fmessages%2Fc1");
  });

  it("409 (still waiting for a reply): says so and disables the composer", async () => {
    api.sendMessage.mockRejectedValue(new ApiError(409, "Wait for a reply before sending another message."));
    renderThread();
    await ready();
    await type("One more thing");
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Wait for Sam K. to reply before sending another message.");
    expect(composer()).toBeDisabled();
  });

  it("404 while sending: the conversation has gone, and focus moves to the explanation", async () => {
    api.sendMessage.mockRejectedValue(new ApiError(404, "Conversation not found."));
    renderThread();
    await ready();
    await type("Hello?");
    composer().focus();
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    const heading = await screen.findByRole("heading", { name: "This conversation isn’t available" });
    await waitFor(() => expect(heading).toHaveFocus());
  });
});

describe("Thread — requests", () => {
  it("received: reply to accept, with the choice to decline explained", async () => {
    api.getMessages.mockResolvedValue(page([msg(1)], conversation({ status: "request_received" })));
    api.sendMessage.mockResolvedValue(msg(2, true, "Sure, hi!"));
    renderThread();
    await ready();
    expect(screen.getByText("Sam K. wants to message you.")).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Reply to Sam K. to accept" })).toBeEnabled();

    await type("Sure, hi!");
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await within(screen.getByRole("list", { name: "Messages with Sam K." })).findByText("Sure, hi!");
    // Accepted: an ordinary conversation now.
    expect(screen.getByRole("textbox", { name: "Message Sam K." })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Decline" })).toBeNull();
    expect(liveRegion()).toHaveTextContent("Message sent. You’re now chatting with Sam K.");
  });

  it("received: Decline asks first (focus on Cancel), then declines silently", async () => {
    api.getMessages.mockResolvedValue(page([msg(1)], conversation({ status: "request_received" })));
    api.declineConversation.mockResolvedValue(undefined);
    renderThread();
    await ready();
    fireEvent.click(screen.getByRole("button", { name: "Decline" }));
    expect(screen.getByRole("group", { name: "Decline Sam K.’s request?" })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("button", { name: "Cancel" })).toHaveFocus());
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Decline" })).toHaveFocus());

    fireEvent.click(screen.getByRole("button", { name: "Decline" }));
    fireEvent.click(screen.getByRole("button", { name: "Yes, decline" }));
    const done = await screen.findByText("Request declined");
    expect(api.declineConversation).toHaveBeenCalledWith("c1", expect.any(Function));
    expect(done.closest("[tabindex='-1']")).toHaveTextContent("Sam K. won’t be told.");
    await waitFor(() => expect(done.closest("[tabindex='-1']")).toHaveFocus());
  });

  it("received: a failed decline is shown and can be retried", async () => {
    api.getMessages.mockResolvedValue(page([msg(1)], conversation({ status: "request_received" })));
    api.declineConversation.mockRejectedValueOnce(new ApiError(500, "boom"));
    renderThread();
    await ready();
    fireEvent.click(screen.getByRole("button", { name: "Decline" }));
    fireEvent.click(screen.getByRole("button", { name: "Yes, decline" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Couldn’t decline. Try again.");
    expect(screen.getByRole("button", { name: "Yes, decline" })).not.toHaveAttribute("aria-disabled");
  });

  it("sent: waiting for a reply, with the composer disabled and honest copy", async () => {
    api.getMessages.mockResolvedValue(page([msg(1, true)], conversation({ status: "request_sent" })));
    renderThread();
    await ready();
    const box = composer();
    expect(box).toBeDisabled();
    expect(screen.getByRole("button", { name: "Send" })).toBeDisabled();
    expect(box).toHaveAccessibleDescription(
      expect.stringContaining("Waiting for Sam K. to reply. You can send more once they do. People don’t always reply, and we won’t tell you either way."),
    );
    // Declining is silent: nothing here hints that it might have happened.
    expect(document.body.textContent).not.toMatch(/declined/i);
  });
});

describe("Thread — block and report", () => {
  beforeEach(() => {
    api.getMessages.mockResolvedValue(page([msg(1), msg(2, true)]));
  });

  it("Block asks first, blocks by conversation, and Unblock brings the conversation back", async () => {
    api.blockMember.mockResolvedValue({ blockId: "b1", displayName: "Sam K.", createdAt: "2026-09-26T10:00:00.000Z" });
    api.unblockMember.mockResolvedValue(undefined);
    renderThread();
    await ready();
    fireEvent.click(screen.getByRole("button", { name: "Block" }));
    const group = screen.getByRole("group", { name: "Block Sam K.?" });
    expect(group).toHaveTextContent("They won’t be told.");
    await waitFor(() => expect(within(group).getByRole("button", { name: "Cancel" })).toHaveFocus());
    fireEvent.click(within(group).getByRole("button", { name: "Yes, block" }));

    const blocked = await screen.findByText("You blocked Sam K.");
    expect(api.blockMember).toHaveBeenCalledWith({ conversationId: "c1" }, expect.any(Function));
    await waitFor(() => expect(blocked.closest("[tabindex='-1']")).toHaveFocus());
    expect(screen.queryByRole("textbox")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Unblock" }));
    await ready();
    expect(api.unblockMember).toHaveBeenCalledWith("b1", expect.any(Function));
    expect(api.getMessages).toHaveBeenCalledTimes(2);
    await waitFor(() => expect(screen.getByRole("heading", { level: 1, name: "Sam K." })).toHaveFocus());
    expect(liveRegion()).toHaveTextContent("Unblocked Sam K.");
  });

  it("Block when they're already blocked or gone (404): shown as blocked, not as an error", async () => {
    api.blockMember.mockRejectedValue(new ApiError(404, "Member not found."));
    renderThread();
    await ready();
    fireEvent.click(screen.getByRole("button", { name: "Block" }));
    fireEvent.click(screen.getByRole("button", { name: "Yes, block" }));
    const blocked = await screen.findByText("You blocked Sam K.");
    await waitFor(() => expect(blocked.closest("[tabindex='-1']")).toHaveFocus());
    expect(screen.queryByRole("alert")).toBeNull();
    // No block id to undo here: that's done from the list.
    expect(screen.queryByRole("button", { name: "Unblock" })).toBeNull();
    expect(screen.getByRole("link", { name: "Blocked members" })).toHaveAttribute("href", "/messages/blocked");
  });

  it("Block rate-limited (429): a calm message, and nothing changes", async () => {
    api.blockMember.mockRejectedValue(new ApiError(429, "Too many"));
    renderThread();
    await ready();
    fireEvent.click(screen.getByRole("button", { name: "Block" }));
    fireEvent.click(screen.getByRole("button", { name: "Yes, block" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "You’ve blocked a lot of people today. Try again tomorrow, or email support@sheltuh.com.au if someone is bothering you.",
    );
    expect(screen.getByRole("list", { name: "Messages with Sam K." })).toBeInTheDocument();
  });

  it("Report needs a reason, sends reason and details, then confirms and keeps focus sensible", async () => {
    api.reportMember.mockResolvedValue({ reportId: "r1", createdAt: "2026-09-26T10:00:00.000Z" });
    renderThread();
    await ready();
    fireEvent.click(screen.getByRole("button", { name: "Report" }));
    const dialog = await screen.findByRole("dialog", { name: "Report Sam K." });
    const radios = within(dialog).getAllByRole("radio");
    expect(radios.map((r) => (r as HTMLInputElement).value)).toEqual([
      "harassment",
      "spam",
      "inappropriate",
      "impersonation",
      "other",
    ]);
    await waitFor(() => expect(radios[0]).toHaveFocus());

    fireEvent.click(within(dialog).getByRole("button", { name: "Send report" }));
    const reasons = within(dialog).getByRole("group", { name: "What’s the problem?" });
    expect(reasons).toHaveAccessibleDescription("Choose a reason.");
    expect(api.reportMember).not.toHaveBeenCalled();

    fireEvent.click(within(dialog).getByLabelText("Spam or a scam"));
    fireEvent.change(within(dialog).getByLabelText("Anything else we should know? (optional)"), {
      target: { value: "  Keeps sending links  " },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Send report" }));
    await waitFor(() =>
      expect(api.reportMember).toHaveBeenCalledWith(
        { conversationId: "c1", reason: "spam", details: "Keeps sending links" },
        expect.any(Function),
      ),
    );
    await waitFor(() => expect(dialog).not.toHaveAttribute("open"));
    const thanks = screen.getByText(/Your report has been sent/);
    await waitFor(() => expect(thanks.closest("[tabindex='-1']")).toHaveFocus());
    expect(thanks).toHaveTextContent("We won’t tell Sam K.");
  });

  it("Report: a rate limit (429) is shown calmly in the dialog, focused", async () => {
    api.reportMember.mockRejectedValue(new ApiError(429, "Too many"));
    renderThread();
    await ready();
    fireEvent.click(screen.getByRole("button", { name: "Report" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByLabelText("Harassment or bullying"));
    fireEvent.click(within(dialog).getByRole("button", { name: "Send report" }));
    const alert = await within(dialog).findByRole("alert");
    expect(alert).toHaveTextContent("You’ve sent a lot of reports today. If it’s urgent, email support@sheltuh.com.au.");
    await waitFor(() => expect(alert.closest("[tabindex='-1']")).toHaveFocus());
    expect(dialog).toHaveAttribute("open");
  });

  it("Report: the API's field error goes on the details field", async () => {
    api.reportMember.mockRejectedValue(
      new ApiError(400, "Invalid", { details: "Details can't contain control or text-direction characters." }),
    );
    renderThread();
    await ready();
    fireEvent.click(screen.getByRole("button", { name: "Report" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByLabelText("Something else"));
    fireEvent.change(within(dialog).getByLabelText("Anything else we should know? (optional)"), {
      target: { value: "hmm" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Send report" }));
    const details = within(dialog).getByLabelText("Anything else we should know? (optional)");
    await waitFor(() => expect(details).toHaveAccessibleDescription(expect.stringContaining("text-direction")));
    await waitFor(() => expect(details).toHaveFocus());
  });
});

describe("Thread — earlier messages", () => {
  it("loads the page before the oldest shown, keeps order, focuses the first loaded and announces it", async () => {
    api.getMessages
      .mockResolvedValueOnce(page([msg(3), msg(4, true)], conversation(), true))
      .mockResolvedValueOnce(page([msg(1), msg(2, true)], conversation(), false));
    renderThread();
    const list = await ready();
    fireEvent.click(screen.getByRole("button", { name: "Load earlier messages" }));
    await waitFor(() => expect(within(list).getAllByRole("listitem")).toHaveLength(4));
    expect(api.getMessages).toHaveBeenLastCalledWith("c1", expect.any(Function), { before: "3" });
    expect(within(list).getAllByRole("listitem").map((li) => li.dataset.messageId)).toEqual(["1", "2", "3", "4"]);
    await waitFor(() => expect(within(list).getAllByRole("listitem")[0]).toHaveFocus());
    expect(liveRegion()).toHaveTextContent("2 earlier messages loaded.");
    expect(screen.queryByRole("button", { name: "Load earlier messages" })).toBeNull();
  });

  it("shows a failure to load earlier messages and keeps the button", async () => {
    api.getMessages
      .mockResolvedValueOnce(page([msg(3)], conversation(), true))
      .mockRejectedValueOnce(new ApiError(500, "boom"));
    renderThread();
    await ready();
    fireEvent.click(screen.getByRole("button", { name: "Load earlier messages" }));
    expect(await screen.findByText("Couldn’t load earlier messages.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Load earlier messages" })).toBeInTheDocument();
  });
});

describe("Thread — checking for new messages", () => {
  /** Runs timers (and the promises they start) forward. */
  async function advance(ms: number) {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(ms);
    });
  }

  async function readyWithFakeTimers() {
    await advance(0);
    expect(screen.getByRole("list", { name: "Messages with Sam K." })).toBeInTheDocument();
  }

  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(document, "hasFocus").mockReturnValue(true);
  });

  function newMessagesCalls() {
    return api.getMessages.mock.calls.filter((call) => call[2] && "after" in (call[2] as object));
  }

  it("checks every 10s after the newest message, announces what arrives, and marks it read", async () => {
    api.getMessages
      .mockResolvedValueOnce(page([msg(1), msg(2, true)]))
      .mockResolvedValueOnce(page([]))
      .mockResolvedValueOnce(page([msg(3, false, "You there?")], conversation({ unread: true })));
    renderThread();
    await readyWithFakeTimers();

    await advance(9_999);
    expect(newMessagesCalls()).toHaveLength(0);
    await advance(1);
    expect(newMessagesCalls()).toEqual([["c1", expect.any(Function), { after: "2" }]]);
    expect(liveRegion()).toHaveTextContent("");

    await advance(10_000);
    expect(newMessagesCalls()).toHaveLength(2);
    expect(screen.getByText("You there?")).toBeInTheDocument();
    expect(liveRegion()).toHaveTextContent("New message from Sam K.");
    expect(api.markConversationRead).toHaveBeenCalledWith("c1", expect.any(Function), "3");
  });

  it("pauses while the tab is hidden and checks straight away when it's back (once a full interval has passed)", async () => {
    api.getMessages.mockResolvedValueOnce(page([msg(1)])).mockResolvedValue(page([]));
    renderThread();
    await readyWithFakeTimers();

    visibility = "hidden";
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await advance(60_000);
    expect(newMessagesCalls()).toHaveLength(0);

    visibility = "visible";
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await advance(0);
    expect(newMessagesCalls()).toHaveLength(1);
    await advance(10_000);
    expect(newMessagesCalls()).toHaveLength(2);
  });

  it("pauses while the window isn't focused, and resumes on focus", async () => {
    const hasFocus = vi.spyOn(document, "hasFocus").mockReturnValue(true);
    api.getMessages.mockResolvedValueOnce(page([msg(1)])).mockResolvedValue(page([]));
    renderThread();
    await readyWithFakeTimers();

    hasFocus.mockReturnValue(false);
    act(() => {
      window.dispatchEvent(new Event("blur"));
    });
    await advance(30_000);
    expect(newMessagesCalls()).toHaveLength(0);

    hasFocus.mockReturnValue(true);
    act(() => {
      window.dispatchEvent(new Event("focus"));
    });
    await advance(0);
    expect(newMessagesCalls()).toHaveLength(1);
  });

  it("a failed check is shown quietly and cleared by the next one that works", async () => {
    api.getMessages
      .mockResolvedValueOnce(page([msg(1)]))
      .mockRejectedValueOnce(new ApiError(503, "Unavailable"))
      .mockResolvedValue(page([]));
    renderThread();
    await readyWithFakeTimers();
    await advance(10_000);
    expect(screen.getByText("Couldn’t check for new messages. We’ll try again shortly.")).toBeInTheDocument();
    await advance(10_000);
    expect(screen.queryByText("Couldn’t check for new messages. We’ll try again shortly.")).toBeNull();
  });

  it("a conversation that disappears between checks (404) is shown as unavailable, without stealing focus", async () => {
    api.getMessages.mockResolvedValueOnce(page([msg(1)])).mockRejectedValue(new ApiError(404, "Conversation not found."));
    const outside = document.createElement("button");
    document.body.append(outside);
    renderThread();
    await readyWithFakeTimers();
    outside.focus();
    await advance(10_000);
    expect(screen.getByRole("heading", { name: "This conversation isn’t available" })).not.toHaveFocus();
    expect(outside).toHaveFocus();
    outside.remove();
  });
});
