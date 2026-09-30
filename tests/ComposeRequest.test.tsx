// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AttendeeMessageAction } from "@/components/messages/ComposeRequest";
import { ApiError } from "@/lib/api/client";
import type { ConversationSummary, GoingAttendee } from "@/lib/api/types";
import { SessionExpiredError } from "@/lib/auth/AuthContext";

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
const getToken = vi.fn().mockResolvedValue("token");

function Harness() {
  const [open, setOpen] = useState(false);
  return (
    <ul>
      <li>
        <AttendeeMessageAction
          attendee={MIA}
          getToken={getToken}
          returnTo="/events/neon-static#whos-going"
          open={open}
          onOpenChange={setOpen}
        />
      </li>
    </ul>
  );
}

function openForm() {
  render(<Harness />);
  const button = screen.getByRole("button", { name: "Message Mia T." });
  expect(button).toHaveAttribute("aria-expanded", "false");
  fireEvent.click(button);
  expect(button).toHaveAttribute("aria-expanded", "true");
  return screen.getByRole("form", { name: "Message Mia T." });
}

function box() {
  return screen.getByRole("textbox", { name: "Your message" });
}

function send(text: string) {
  fireEvent.change(box(), { target: { value: text } });
  fireEvent.click(screen.getByRole("button", { name: "Send request" }));
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
      "This sends Mia T. a message request with your display name and this event. If they reply, you can keep chatting. Until then you can’t send another, and they might not reply. No links in a first message.",
    );
    expect(box()).toHaveAccessibleDescription(expect.stringContaining("This sends Mia T. a message request"));
    expect(screen.getByRole("button", { name: "Send request" })).toHaveAccessibleDescription(
      expect.stringContaining("No links in a first message."),
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
    expect(startConversation).toHaveBeenCalledWith({ attendeeId: "att-1", body: "Hi! Keen for Saturday?" }, getToken);
    expect(within(sent).getByRole("link", { name: "View conversation" })).toHaveAttribute("href", "/messages/c9");
    await waitFor(() => expect(sent).toHaveFocus());
    expect(screen.queryByRole("form")).toBeNull();
    expect(screen.queryByRole("button", { name: "Message Mia T." })).toBeNull();
  });

  it("409: there's already a conversation, with a way to it", async () => {
    startConversation.mockRejectedValue(new ApiError(409, "You already have a conversation with this member."));
    openForm();
    send("Hi again");
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("You already have a conversation with Mia T.");
    expect(within(alert).getByRole("link", { name: "Go to your messages" })).toHaveAttribute("href", "/messages");
    await waitFor(() => expect(alert.closest("[tabindex='-1']")).toHaveFocus());
  });

  it("404: one generic message, whatever the reason (blocked, declined, suspended, gone)", async () => {
    startConversation.mockRejectedValue(new ApiError(404, "This member isn't available to message."));
    openForm();
    send("Hi");
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/^This person can’t be messaged\.$/);
    await waitFor(() => expect(alert.closest("[tabindex='-1']")).toHaveFocus());
    expect(box()).toHaveValue("Hi");
  });

  it.each([
    [new ApiError(403, "You can only message people going to the same event as you."), "You can only message people going to the same event as you."],
    [new ApiError(403, "Your profile can't send messages right now."), "Your profile can't send messages right now."],
    [new ApiError(429, "You've sent a lot of new message requests. Try again tomorrow."), "You’ve sent a lot of message requests today. Try again tomorrow."],
    [new ApiError(400, "You can't message yourself."), "You can't message yourself."],
    [new ApiError(502, "upstream"), "Couldn’t send that. Try again."],
    [new ApiError(413, "Request body too large."), "Couldn’t send that. Try again."],
  ])("maps %s to an alert", async (error, expected) => {
    startConversation.mockRejectedValue(error);
    openForm();
    send("Hi");
    expect(await screen.findByRole("alert")).toHaveTextContent(expected);
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

  it("session expired: Sign in comes back to the Who's Going panel", async () => {
    startConversation.mockRejectedValue(new SessionExpiredError());
    openForm();
    send("Hi");
    const alert = await screen.findByRole("alert");
    expect(within(alert).getByRole("link", { name: "Sign in" })).toHaveAttribute(
      "href",
      "/login?next=%2Fevents%2Fneon-static%23whos-going",
    );
  });

  it("Cancel closes the form and returns focus to the Message button", async () => {
    openForm();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("form")).toBeNull();
    await waitFor(() => expect(screen.getByRole("button", { name: "Message Mia T." })).toHaveFocus());
  });
});
