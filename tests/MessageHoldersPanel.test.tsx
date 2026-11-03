// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import MessageHoldersPanel from "@/components/dashboard/MessageHoldersPanel";
import { ApiError } from "@/lib/api/client";
import type { EventRecord, HolderMessageInput, HolderMessagesState } from "@/lib/api/types";
import { validateHolderField } from "@/lib/holder-message-rules";

const configured = vi.hoisted(() => ({ value: true }));
vi.mock("@/lib/api/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api/client")>()),
  get isApiConfigured() {
    return configured.value;
  },
}));
const getHolderMessages = vi.fn();
const sendHolderMessage = vi.fn();
vi.mock("@/lib/api/holder-messages", () => ({
  getHolderMessages: (...args: unknown[]) => getHolderMessages(...args),
  sendHolderMessage: (...args: unknown[]) => sendHolderMessage(...args),
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
afterAll(() => {
  configured.value = true;
});
beforeEach(() => {
  configured.value = true;
  getHolderMessages.mockReset();
  sendHolderMessage.mockReset();
});
afterEach(cleanup);

const getToken = async () => "token";
const EVENT_ID = "00000000-0000-4000-8000-000000000001";

const EVENT: EventRecord = {
  organiserId: "org-1",
  eventId: EVENT_ID,
  slug: "cinder",
  title: "Cinder",
  description: "d",
  category: "live-music",
  venueName: "v",
  venueAddress: "a",
  suburb: "s",
  startsAt: "2999-12-01T09:00:00.000Z",
  endsAt: "2999-12-01T12:00:00.000Z",
  organiserName: "Org",
  ticketTypes: [{ id: "t1", name: "GA", priceCents: 2800, feePolicy: "buyer-pays", quantityAvailable: 50 }],
  ticketingMode: "sheltuh",
  status: "published",
  moderationLog: [],
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

function state(overrides: Partial<HolderMessagesState> = {}): HolderMessagesState {
  return {
    eventId: EVENT_ID,
    audienceCount: 12,
    canSend: true,
    limits: {
      subjectMin: 5,
      subjectMax: 100,
      bodyMin: 20,
      bodyMax: 1500,
      maxRecipients: 1000,
      perEventPerDay: 2,
      perEventTotal: 6,
      perOrganiserPerDay: 4,
    },
    remaining: { eventToday: 2, eventTotal: 5, organiserToday: 4 },
    messages: [],
    ...overrides,
  };
}

const SUBJECT = "Doors now open at 7pm";
const BODY = "Doors now open at 7pm instead of 8pm. See you there.";

function renderPanel(event: EventRecord = EVENT) {
  render(<MessageHoldersPanel event={event} getToken={getToken} />);
}

async function ready() {
  return screen.findByRole("heading", { name: "Message ticket holders" });
}

function compose(subject = SUBJECT, body = BODY) {
  fireEvent.change(screen.getByLabelText("Subject"), { target: { value: subject } });
  fireEvent.change(screen.getByLabelText("Message"), { target: { value: body } });
}

function clickSend() {
  fireEvent.click(screen.getByRole("button", { name: "Send…" }));
}

function dialog() {
  return screen.getByRole("dialog");
}

function tick() {
  fireEvent.click(within(dialog()).getByRole("checkbox", { name: "This is about the event, not promotion" }));
}

function confirm() {
  fireEvent.click(within(dialog()).getByRole("button", { name: "Send" }));
}

describe("MessageHoldersPanel: what shows", () => {
  it("says how many ticket holders and what is left, and shows the form", async () => {
    getHolderMessages.mockResolvedValue(state());
    renderPanel();
    await ready();
    expect(await screen.findByText("12 ticket holders · 2 left today · 5 left in total")).toBeInTheDocument();
    expect(getHolderMessages).toHaveBeenCalledWith(EVENT_ID, getToken);
    expect(screen.getByLabelText("Subject")).toBeInTheDocument();
    expect(screen.getByLabelText("Message")).toBeInTheDocument();
    expect(screen.getByText("0/100")).toBeInTheDocument();
    expect(screen.getByText("0/1500")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Send…" })).toBeInTheDocument();
  });

  it("uses the smaller of the event's and the account's allowance for 'left today'", async () => {
    getHolderMessages.mockResolvedValue(state({ remaining: { eventToday: 2, eventTotal: 5, organiserToday: 1 } }));
    renderPanel();
    expect(await screen.findByText("12 ticket holders · 1 left today · 5 left in total")).toBeInTheDocument();
  });

  it("is a singular for one holder", async () => {
    getHolderMessages.mockResolvedValue(state({ audienceCount: 1 }));
    renderPanel();
    expect(await screen.findByText(/^1 ticket holder ·/)).toBeInTheDocument();
  });

  it("lists sent messages: date, subject, sent X of N, and Stopped", async () => {
    getHolderMessages.mockResolvedValue(
      state({
        messages: [
          {
            messageId: "m1",
            subject: "Parking changes",
            body: "b",
            recipientCount: 40,
            sentCount: 12,
            skippedCount: 0,
            createdAt: "2026-10-20T01:00:00.000Z",
            cancelled: true,
          },
          {
            messageId: "m2",
            subject: "Doors at 7pm",
            body: "b",
            recipientCount: 40,
            sentCount: 40,
            skippedCount: 0,
            createdAt: "2026-10-19T01:00:00.000Z",
            cancelled: false,
          },
        ],
      }),
    );
    renderPanel();
    const items = within(await screen.findByRole("list")).getAllByRole("listitem");
    expect(items).toHaveLength(2);
    expect(items[0]).toHaveTextContent("Parking changes");
    expect(items[0]).toHaveTextContent("Sent 12 of 40");
    expect(items[0]).toHaveTextContent("Stopped");
    expect(items[1]).toHaveTextContent("Doors at 7pm");
    expect(items[1]).toHaveTextContent("Sent 40 of 40");
    expect(items[1]).not.toHaveTextContent("Stopped");
    expect(items[0].querySelector("time")).toHaveAttribute("datetime", "2026-10-20T01:00:00.000Z");
  });

  it("says there are none yet when nothing was sent", async () => {
    getHolderMessages.mockResolvedValue(state());
    renderPanel();
    expect(await screen.findByText("None yet.")).toBeInTheDocument();
  });

  it.each([
    ["outside_window", "Messages close 2 days after the event."],
    ["no_recipients", "Nobody holds a ticket yet."],
    ["event_day_cap", "This event has sent its messages for today. Try again tomorrow."],
    ["event_total_cap", "This event has used all its messages."],
    ["rate_limited", "You've reached today's limit. Try again tomorrow."],
    ["too_many", "Too many ticket holders to message at once. Contact support."],
  ] as const)("when %s, says so in a few words and offers no form", async (blockedReason, words) => {
    getHolderMessages.mockResolvedValue(state({ canSend: false, blockedReason }));
    renderPanel();
    expect(await screen.findByText(words)).toBeInTheDocument();
    expect(screen.queryByLabelText("Subject")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Send…" })).not.toBeInTheDocument();
    expect(screen.queryByText(/left today/)).not.toBeInTheDocument();
  });

  it("is hidden when the tickets are sold elsewhere (no request is made)", () => {
    renderPanel({ ...EVENT, ticketingMode: "external" });
    expect(screen.queryByRole("heading", { name: "Message ticket holders" })).not.toBeInTheDocument();
    expect(getHolderMessages).not.toHaveBeenCalled();
  });

  it("is hidden when the API says external", async () => {
    getHolderMessages.mockResolvedValue(state({ canSend: false, blockedReason: "external" }));
    renderPanel();
    await waitFor(() => expect(getHolderMessages).toHaveBeenCalled());
    await waitFor(() => expect(screen.queryByRole("heading", { name: "Message ticket holders" })).not.toBeInTheDocument());
  });

  it("is hidden in demo mode (no request is made)", () => {
    configured.value = false;
    renderPanel();
    expect(screen.queryByRole("heading", { name: "Message ticket holders" })).not.toBeInTheDocument();
    expect(getHolderMessages).not.toHaveBeenCalled();
  });

  it("shows a loading state, then an error with Try again", async () => {
    getHolderMessages.mockRejectedValueOnce(new ApiError(0, "Couldn't reach the server."));
    getHolderMessages.mockResolvedValueOnce(state());
    renderPanel();
    expect(screen.getByRole("progressbar", { name: "Loading" })).toBeInTheDocument();
    expect(await screen.findByRole("alert")).toHaveTextContent("Couldn’t load this.");
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByLabelText("Subject")).toBeInTheDocument();
  });

  it("says why when the API refuses", async () => {
    getHolderMessages.mockRejectedValue(new ApiError(404, "Event not found."));
    renderPanel();
    expect(await screen.findByRole("alert")).toHaveTextContent("Event not found.");
  });
});

describe("MessageHoldersPanel: checks before the dialog", () => {
  beforeEach(() => getHolderMessages.mockResolvedValue(state()));

  it("counts characters and wires the counter and error to the fields", async () => {
    renderPanel();
    await screen.findByLabelText("Subject");
    fireEvent.change(screen.getByLabelText("Subject"), { target: { value: "Hello" } });
    fireEvent.change(screen.getByLabelText("Message"), { target: { value: "Too short" } });
    expect(screen.getByText("5/100")).toBeInTheDocument();
    clickSend();
    const body = screen.getByLabelText("Message");
    expect(body).toHaveAttribute("aria-invalid", "true");
    const errorId = body.getAttribute("aria-describedby")?.split(" ")[0];
    expect(document.getElementById(errorId ?? "")).toHaveTextContent("The message must be at least 20 characters.");
    expect(body).toHaveFocus();
  });

  it("asks for both fields and focuses the first problem", async () => {
    renderPanel();
    await screen.findByLabelText("Subject");
    clickSend();
    expect(screen.getByText("Write a subject.")).toBeInTheDocument();
    expect(screen.getByText("Write a message.")).toBeInTheDocument();
    expect(screen.getByLabelText("Subject")).toHaveFocus();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it.each([
    ["a web address", "Tickets at https://example.com/tickets now", /can't include links or web addresses/],
    ["a bare domain", "Tickets at example.com tonight for everyone", /can't include links or web addresses/],
    ["a www address", "See www.example for the full lineup tonight", /can't include links or web addresses/],
    ["an email address", "Questions to mia@home before the show tonight", /can't include email addresses/],
  ])("refuses %s in the message", async (_name, body, error) => {
    renderPanel();
    await screen.findByLabelText("Subject");
    compose(SUBJECT, body);
    clickSend();
    expect(screen.getByText(error)).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(sendHolderMessage).not.toHaveBeenCalled();
  });

  it("refuses a link or an address in the subject, and a subject that is too short", async () => {
    renderPanel();
    await screen.findByLabelText("Subject");
    compose("See example.com", BODY);
    clickSend();
    expect(screen.getByText("The subject can't include links or web addresses.")).toBeInTheDocument();
    compose("Hi", BODY);
    clickSend();
    expect(screen.getByText("The subject must be at least 5 characters.")).toBeInTheDocument();
    compose("Mail me a@b", BODY);
    clickSend();
    expect(screen.getByText("The subject can't include email addresses.")).toBeInTheDocument();
  });

  it("accepts a handle with an @ and a sentence ending in a full stop", async () => {
    renderPanel();
    await screen.findByLabelText("Subject");
    compose("Support act: @nightbloom", "Mr. Fox is on first. Thanks for coming, see you at the show tonight.");
    clickSend();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("clears a field's error when it is edited", async () => {
    renderPanel();
    await screen.findByLabelText("Subject");
    clickSend();
    expect(screen.getByText("Write a subject.")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Subject"), { target: { value: "Doors" } });
    expect(screen.queryByText("Write a subject.")).not.toBeInTheDocument();
  });

  it("refuses control and text-direction characters, and too long text", () => {
    const limits = state().limits;
    expect(validateHolderField("body", `${BODY}‮`, limits)).toMatch(/can't contain control, invisible or text-direction/);
    expect(validateHolderField("body", "a".repeat(1501), limits)).toMatch(/1,500 characters or fewer/);
    expect(validateHolderField("subject", "Line one\nLine two", limits)).toBe("The subject must be on one line.");
    expect(validateHolderField("body", BODY, limits)).toBeNull();
  });
});

describe("MessageHoldersPanel: the dialog", () => {
  beforeEach(() => getHolderMessages.mockResolvedValue(state()));

  it("asks 'Send to N ticket holders?' with a preview and Send and Cancel", async () => {
    renderPanel();
    await screen.findByLabelText("Subject");
    compose();
    clickSend();
    const d = dialog();
    expect(within(d).getByRole("heading", { name: "Send to 12 ticket holders?" })).toHaveFocus();
    expect(d).toHaveAccessibleName("Send to 12 ticket holders?");
    expect(within(d).getByText(SUBJECT)).toBeInTheDocument();
    expect(within(d).getByText(BODY)).toBeInTheDocument();
    expect(within(d).getByRole("button", { name: "Send" })).toBeInTheDocument();
    expect(within(d).getByRole("button", { name: "Cancel" })).toBeInTheDocument();
  });

  it("will not send until the box is ticked, and says so on the box", async () => {
    renderPanel();
    await screen.findByLabelText("Subject");
    compose();
    clickSend();
    confirm();
    const box = within(dialog()).getByRole("checkbox", { name: "This is about the event, not promotion" });
    expect(box).toHaveAttribute("aria-required", "true");
    expect(box).toHaveAttribute("aria-invalid", "true");
    expect(box).toHaveFocus();
    expect(within(dialog()).getByText("Tick the box to send.")).toBeInTheDocument();
    expect(sendHolderMessage).not.toHaveBeenCalled();
  });

  it("Cancel closes it and keeps what was written", async () => {
    renderPanel();
    await screen.findByLabelText("Subject");
    compose();
    clickSend();
    fireEvent.click(within(dialog()).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Subject")).toHaveValue(SUBJECT);
    expect(sendHolderMessage).not.toHaveBeenCalled();
  });

  it("sends the cleaned text with the attest, the confirmed count and a uuid request id", async () => {
    sendHolderMessage.mockResolvedValue({ messageId: "m1", recipientCount: 12, createdAt: "2026-10-20T01:00:00.000Z", replayed: false });
    renderPanel();
    await screen.findByLabelText("Subject");
    compose(`  ${SUBJECT}  `, `${BODY}   `);
    clickSend();
    tick();
    confirm();
    await waitFor(() => expect(sendHolderMessage).toHaveBeenCalledTimes(1));
    const [eventId, input] = sendHolderMessage.mock.calls[0] as [string, HolderMessageInput, unknown];
    expect(eventId).toBe(EVENT_ID);
    expect(input).toEqual({
      requestId: expect.stringMatching(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/),
      subject: SUBJECT,
      body: BODY,
      attest: true,
      expectedRecipients: 12,
    });
  });
});

describe("MessageHoldersPanel: after sending", () => {
  const SENT = { messageId: "m1", recipientCount: 12, createdAt: "2026-10-20T01:00:00.000Z", replayed: false };

  beforeEach(() => getHolderMessages.mockResolvedValue(state()));

  it("on success clears the form, closes the dialog, says 'Sent to N.' and refreshes the history", async () => {
    sendHolderMessage.mockResolvedValue(SENT);
    renderPanel();
    await screen.findByLabelText("Subject");
    compose();
    clickSend();
    tick();
    getHolderMessages.mockResolvedValue(
      state({
        remaining: { eventToday: 1, eventTotal: 4, organiserToday: 3 },
        messages: [
          { messageId: "m1", subject: SUBJECT, body: BODY, recipientCount: 12, sentCount: 0, skippedCount: 0, createdAt: SENT.createdAt, cancelled: false },
        ],
      }),
    );
    confirm();
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Sent to 12."));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Subject")).toHaveValue("");
    expect(screen.getByLabelText("Message")).toHaveValue("");
    expect(await screen.findByText("Sent 0 of 12", { exact: false })).toBeInTheDocument();
    expect(screen.getByText("12 ticket holders · 1 left today · 4 left in total")).toBeInTheDocument();
  });

  it("keeps the request id across a retry, and makes a new one after a success", async () => {
    sendHolderMessage.mockRejectedValueOnce(new ApiError(0, "Couldn't reach the server. Check your connection and try again."));
    sendHolderMessage.mockResolvedValueOnce({ ...SENT, replayed: true });
    sendHolderMessage.mockResolvedValueOnce(SENT);
    renderPanel();
    await screen.findByLabelText("Subject");
    compose();
    clickSend();
    tick();
    confirm();
    // The dialog stays open with the reason; the box stays ticked, so a retry is one click.
    expect(await within(dialog()).findByRole("alert")).toHaveTextContent("Couldn’t send. Try again.");
    expect(within(dialog()).getByRole("checkbox")).toBeChecked();
    confirm();
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Sent to 12."));
    const [first, second] = sendHolderMessage.mock.calls.map((call) => (call[1] as HolderMessageInput).requestId);
    expect(second).toBe(first);

    compose("Parking is full tonight", "Parking at the venue is full tonight, so please take the tram.");
    clickSend();
    tick();
    confirm();
    await waitFor(() => expect(sendHolderMessage).toHaveBeenCalledTimes(3));
    expect((sendHolderMessage.mock.calls[2][1] as HolderMessageInput).requestId).not.toBe(first);
  });

  it("makes a new request id when the text is changed after a failed try", async () => {
    sendHolderMessage.mockRejectedValueOnce(new ApiError(503, "Service unavailable"));
    sendHolderMessage.mockResolvedValueOnce(SENT);
    renderPanel();
    await screen.findByLabelText("Subject");
    compose();
    clickSend();
    tick();
    confirm();
    await within(dialog()).findByRole("alert");
    fireEvent.click(within(dialog()).getByRole("button", { name: "Cancel" }));
    fireEvent.change(screen.getByLabelText("Subject"), { target: { value: "Doors now open at 6:30pm" } });
    clickSend();
    tick();
    confirm();
    await waitFor(() => expect(sendHolderMessage).toHaveBeenCalledTimes(2));
    const [first, second] = sendHolderMessage.mock.calls.map((call) => (call[1] as HolderMessageInput).requestId);
    expect(second).not.toBe(first);
  });

  it("shows the new count and asks again on audience_changed, with the same request id", async () => {
    sendHolderMessage.mockRejectedValueOnce(
      new ApiError(409, "The number of ticket holders changed. Check it and confirm again.", undefined, {
        code: "audience_changed",
        audienceCount: 14,
      }),
    );
    sendHolderMessage.mockResolvedValueOnce({ ...SENT, recipientCount: 14 });
    renderPanel();
    await screen.findByLabelText("Subject");
    compose();
    clickSend();
    tick();
    confirm();
    expect(await screen.findByRole("heading", { name: "Send to 14 ticket holders?" })).toBeInTheDocument();
    expect(within(dialog()).getByText("It’s now 14 ticket holders. Check, then send again.")).toBeInTheDocument();
    // Asked again: the box is unticked.
    expect(within(dialog()).getByRole("checkbox")).not.toBeChecked();
    confirm();
    expect(within(dialog()).getByText("Tick the box to send.")).toBeInTheDocument();
    expect(sendHolderMessage).toHaveBeenCalledTimes(1);
    tick();
    confirm();
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Sent to 14."));
    const calls = sendHolderMessage.mock.calls.map((call) => call[1] as HolderMessageInput);
    expect(calls[1].expectedRecipients).toBe(14);
    expect(calls[1].requestId).toBe(calls[0].requestId);
  });

  it("on a 429 closes the dialog, keeps the text, and says the allowance is used up", async () => {
    sendHolderMessage.mockRejectedValueOnce(
      new ApiError(429, "This event has sent its messages for today. Try again tomorrow.", undefined, { code: "event_day_cap" }),
    );
    renderPanel();
    await screen.findByLabelText("Subject");
    compose();
    clickSend();
    tick();
    getHolderMessages.mockResolvedValue(
      state({ canSend: false, blockedReason: "event_day_cap", remaining: { eventToday: 0, eventTotal: 4, organiserToday: 3 } }),
    );
    confirm();
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("This event has sent its messages for today. Try again tomorrow.");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Send…" })).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Message ticket holders" })).toHaveFocus();
  });

  it("on a 409 that blocks sending, closes the dialog and says why", async () => {
    sendHolderMessage.mockRejectedValueOnce(
      new ApiError(409, "This event ended too long ago to message its ticket holders.", undefined, { code: "outside_window" }),
    );
    renderPanel();
    await screen.findByLabelText("Subject");
    compose();
    clickSend();
    tick();
    getHolderMessages.mockResolvedValue(state({ canSend: false, blockedReason: "outside_window" }));
    confirm();
    expect(await screen.findByRole("alert")).toHaveTextContent("Messages close 2 days after the event.");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("shows the API's field errors on the fields and closes the dialog", async () => {
    sendHolderMessage.mockRejectedValueOnce(
      new ApiError(400, "Please fix the highlighted fields.", { body: "The message can't include links or web addresses." }),
    );
    renderPanel();
    await screen.findByLabelText("Subject");
    compose();
    clickSend();
    tick();
    confirm();
    expect(await screen.findByText("The message can't include links or web addresses.")).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Message")).toHaveFocus();
    expect(screen.getByLabelText("Message")).toHaveAttribute("aria-invalid", "true");
  });

  it("shows another refusal in the dialog", async () => {
    sendHolderMessage.mockRejectedValueOnce(new ApiError(403, "Your organiser application must be approved first."));
    renderPanel();
    await screen.findByLabelText("Subject");
    compose();
    clickSend();
    tick();
    confirm();
    expect(await within(dialog()).findByRole("alert")).toHaveTextContent("Your organiser application must be approved first.");
  });
});
