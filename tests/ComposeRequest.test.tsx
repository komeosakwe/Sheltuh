// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AttendeeMessageAction } from "@/components/messages/ComposeRequest";
import { ApiError } from "@/lib/api/client";
import type { ConversationSummary, GoingAttendee } from "@/lib/api/types";
import { SessionExpiredError, type AuthContextValue } from "@/lib/auth/AuthContext";
import { callsTokenFirst, fakeAuthValue, FakeAuthProvider, switchableSession } from "./test-utils/fakeAuth";

vi.mock("@/lib/api/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api/client")>()),
  isApiConfigured: true,
}));
const startConversation = vi.fn();
vi.mock("@/lib/api/messages", () => ({
  startConversation: (...args: unknown[]) => startConversation(...args),
}));

beforeEach(() => {
  startConversation.mockReset();
});
afterEach(cleanup);

const MIA: GoingAttendee = { attendeeId: "att-1", displayName: "Mia T.", isYou: false };

function Harness() {
  const [open, setOpen] = useState(false);
  return (
    <ul>
      <li>
        <AttendeeMessageAction
          attendee={MIA}
          returnTo="/events/neon-static#whos-going"
          open={open}
          onOpenChange={setOpen}
        />
      </li>
    </ul>
  );
}

let signIn = vi.fn();

function openForm() {
  signIn = vi.fn().mockResolvedValue(undefined);
  render(
    <FakeAuthProvider value={fakeAuthValue({ email: "sam@example.com", signIn })}>
      <Harness />
    </FakeAuthProvider>,
  );
  const button = screen.getByRole("button", { name: "Message Mia T." });
  expect(button).toHaveAttribute("aria-expanded", "false");
  fireEvent.click(button);
  expect(button).toHaveAttribute("aria-expanded", "true");
  return screen.getByRole("form", { name: "Message Mia T." });
}

function box() {
  return screen.getByRole("textbox", { name: "Your message" });
}

/** Types, then clicks Send request as a pointer would (focus moves to the button). */
function send(text: string) {
  fireEvent.change(box(), { target: { value: text } });
  const button = screen.getByRole("button", { name: "Send request" });
  button.focus();
  fireEvent.click(button);
}

const SUMMARY: ConversationSummary = {
  conversationId: "c9",
  otherDisplayName: "Mia T.",
  status: "request_sent",
  lastMessage: { preview: "Hi!", sentAt: "2026-09-26T09:00:00.000Z", fromYou: true },
  unread: false,
};

describe("Message someone on Who's Going", () => {
  it("opens a labelled form that explains what happens, with focus in the box", () => {
    const form = openForm();
    expect(box()).toHaveFocus();
    expect(form).toHaveTextContent(
      "Mia T. sees a request with your display name and this event. One message until they reply. No links.",
    );
    expect(box()).toHaveAccessibleDescription(expect.stringContaining("Mia T. sees a request"));
    expect(screen.getByRole("button", { name: "Send request" })).toHaveAccessibleDescription(
      expect.stringContaining("No links."),
    );
  });

  it("won't send a blank message", () => {
    openForm();
    send("   ");
    expect(box()).toHaveAttribute("aria-invalid", "true");
    expect(box()).toHaveAccessibleDescription(expect.stringContaining("Write a message."));
    expect(box()).toHaveFocus();
    expect(startConversation).not.toHaveBeenCalled();
  });

  it("sends the request by attendee id, then confirms with a link to the conversation (focused)", async () => {
    startConversation.mockResolvedValue(SUMMARY);
    openForm();
    send("  Hi! Keen for Saturday?  ");
    const sent = await screen.findByText(/Request sent to Mia T\./);
    expect(startConversation).toHaveBeenCalledWith({ attendeeId: "att-1", body: "Hi! Keen for Saturday?" }, expect.any(Function));
    // Sent with the writer's own token (the fake session's).
    await expect(startConversation.mock.calls[0][1]()).resolves.toBe("fake-access-token");
    expect(within(sent).getByRole("link", { name: "View conversation" })).toHaveAttribute("href", "/messages/c9");
    await waitFor(() => expect(sent).toHaveFocus());
    expect(screen.queryByRole("form")).toBeNull();
    expect(screen.queryByRole("button", { name: "Message Mia T." })).toBeNull();
  });

  it("409: there's already a conversation, with a way to it", async () => {
    startConversation.mockRejectedValue(new ApiError(409, "You already have a conversation with this member."));
    openForm();
    send("Hi again");
    const notice = (await screen.findByText(/You already have a conversation with Mia T\./)).closest("[tabindex='-1']");
    expect(within(notice as HTMLElement).getByRole("link", { name: "Go to your messages" })).toHaveAttribute("href", "/messages");
    await waitFor(() => expect(notice).toHaveFocus());
    // Focused, so read once: not an alert as well.
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("404: one generic message, whatever the reason (blocked, declined, suspended, gone)", async () => {
    startConversation.mockRejectedValue(new ApiError(404, "This member isn't available to message."));
    openForm();
    send("Hi");
    const notice = (await screen.findByText("This person can’t be messaged.")).closest("[tabindex='-1']");
    expect(notice).toHaveTextContent(/^This person can’t be messaged\.$/);
    await waitFor(() => expect(notice).toHaveFocus());
    expect(box()).toHaveValue("Hi");
  });

  it.each([
    [new ApiError(403, "You can only message people going to the same event as you."), "You can only message people going to the same event as you."],
    [new ApiError(403, "Your profile can't send messages right now."), "Your profile can't send messages right now."],
    [new ApiError(429, "You've sent a lot of new message requests. Try again tomorrow."), "You’ve sent a lot of message requests today. Try again tomorrow."],
    [new ApiError(400, "You can't message yourself."), "You can't message yourself."],
    [new ApiError(502, "upstream"), "Couldn’t send that. Try again."],
    [new ApiError(413, "Request body too large."), "Couldn’t send that. Try again."],
    // A field error that isn't about the message isn't the person's to fix.
    [new ApiError(400, "Invalid", { attendeeId: "Choose who to message." }), "Couldn’t send that. Try again."],
  ])("maps %s to a focused notice", async (error, expected) => {
    startConversation.mockRejectedValue(error);
    openForm();
    send("Hi");
    const notice = (await screen.findByText(expected)).closest("[tabindex='-1']");
    await waitFor(() => expect(notice).toHaveFocus());
    expect(box()).not.toHaveAttribute("aria-invalid");
    expect(document.body.textContent).not.toContain("Choose who to message.");
  });

  it("a field error on the message (from Ctrl/Cmd+Enter, focus in the box) is announced", async () => {
    startConversation.mockRejectedValue(
      new ApiError(400, "Invalid", { attendeeId: "Invalid id.", body: "A first message can't include links." }),
    );
    openForm();
    fireEvent.change(box(), { target: { value: "example.com" } });
    box().focus();
    fireEvent.keyDown(box(), { key: "Enter", metaKey: true });
    expect(await screen.findByRole("alert")).toHaveTextContent("A first message can't include links.");
    expect(box()).toHaveFocus();
  });

  it("links to how messages and reports are handled", () => {
    const form = openForm();
    expect(within(form).getByRole("link", { name: "How messages and reports are handled" })).toHaveAttribute(
      "href",
      "/privacy#messages",
    );
  });

  it("shows the API's field error (a link in a first message) on the box", async () => {
    startConversation.mockRejectedValue(
      new ApiError(400, "Invalid", { body: "A first message can't include links. You can share them once they reply." }),
    );
    openForm();
    send("check example.com");
    await waitFor(() =>
      expect(box()).toHaveAccessibleDescription(expect.stringContaining("A first message can't include links.")),
    );
    await waitFor(() => expect(box()).toHaveFocus());
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it.each([
    ["session expired", new SessionExpiredError()],
    ["a 401", new ApiError(401, "Sign in first.")],
  ])("%s: sign in again in place, and the message is kept and can be sent", async (_label, error) => {
    startConversation.mockRejectedValueOnce(error).mockResolvedValueOnce(SUMMARY);
    openForm();
    send("Hi there");
    const notice = (await screen.findByText(/Your session has expired/)).closest("[tabindex='-1']");
    await waitFor(() => expect(notice).toHaveFocus());
    expect(screen.queryByRole("link", { name: "Sign in" })).toBeNull();
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "pw" } });
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
    await waitFor(() => expect(signIn).toHaveBeenCalledWith("sam@example.com", "pw"));
    await waitFor(() => expect(screen.queryByText(/Your session has expired/)).toBeNull());
    expect(box()).toHaveValue("Hi there");
    fireEvent.click(screen.getByRole("button", { name: "Send request" }));
    expect(await screen.findByText(/Request sent to Mia T\./)).toBeInTheDocument();
  });

  it("Cancel closes the form and returns focus to the Message button", async () => {
    openForm();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("form")).toBeNull();
    await waitFor(() => expect(screen.getByRole("button", { name: "Message Mia T." })).toHaveFocus());
  });
});

describe("Message someone on Who's Going — never sent as another account", () => {
  const SAM = { userId: "user-sam", email: "sam@example.com" };
  const ALEX = { userId: "user-alex", email: "alex@example.com" };

  function openAs(session = switchableSession(SAM)) {
    const tree = (account: Partial<AuthContextValue>) => (
      <FakeAuthProvider value={fakeAuthValue({ status: "signed-in", ...account, ...session.auth })}>
        <Harness />
      </FakeAuthProvider>
    );
    const view = render(tree(SAM));
    fireEvent.click(screen.getByRole("button", { name: "Message Mia T." }));
    return (account: Partial<AuthContextValue>) => view.rerender(tree(account));
  }

  it("someone else signed in by now (another tab): the request isn't sent, and the sign-in is the writer's", async () => {
    const become = openAs();
    fireEvent.change(box(), { target: { value: "Hi!" } });
    become(ALEX);
    fireEvent.click(screen.getByRole("button", { name: "Send request" }));
    expect(await screen.findByText(/Your session has expired/)).toBeInTheDocument();
    expect(startConversation).not.toHaveBeenCalled();
    expect(screen.getByLabelText("Email")).toHaveValue("sam@example.com");
    expect(box()).toHaveValue("Hi!");
  });

  it("changed after the check, before the request: the token is refused, so nothing is sent as them", async () => {
    const session = switchableSession(SAM);
    startConversation.mockImplementation((...args: unknown[]) => {
      session.become(ALEX); // After the check, before the request's token.
      return callsTokenFirst(SUMMARY)(...args);
    });
    openAs(session);
    send("Hi!");
    expect(await screen.findByText(/Your session has expired/)).toBeInTheDocument();
    expect(screen.queryByText(/Request sent to/)).toBeNull();
    expect(screen.getByLabelText("Email")).toHaveValue("sam@example.com");
    expect(box()).toHaveValue("Hi!");
  });
});
