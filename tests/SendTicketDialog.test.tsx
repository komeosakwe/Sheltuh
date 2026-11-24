// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import SendTicketDialog, { SEND_ERROR_MESSAGES, type SendTicketFields } from "@/components/tickets/SendTicketDialog";
import Toast, { TOAST_MS, useToast } from "@/components/ui/Toast";
import { ApiError } from "@/lib/api/client";

// jsdom has no modal dialogs: give <dialog> what a browser would (open, close and its event).
beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement) {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close = function close(this: HTMLDialogElement) {
    this.removeAttribute("open");
    this.dispatchEvent(new Event("close"));
  };
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function Harness({
  onSend,
  onSignIn = () => {},
  defaultSenderName,
}: {
  onSend: (fields: SendTicketFields) => Promise<void>;
  onSignIn?: () => void;
  defaultSenderName?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Send
      </button>
      <SendTicketDialog
        open={open}
        onClose={() => setOpen(false)}
        defaultSenderName={defaultSenderName}
        onSend={async (fields) => {
          await onSend(fields);
          setOpen(false);
        }}
        onSignIn={onSignIn}
      />
    </>
  );
}

async function openDialog() {
  const opener = screen.getByRole("button", { name: "Send" });
  opener.focus();
  fireEvent.click(opener);
  const dialog = await screen.findByRole("dialog", { name: "Send this ticket" });
  return { dialog, opener };
}

function fill(dialog: HTMLElement, fields: Partial<SendTicketFields>) {
  if (fields.name !== undefined) fireEvent.change(within(dialog).getByLabelText("Their name"), { target: { value: fields.name } });
  if (fields.email !== undefined) fireEvent.change(within(dialog).getByLabelText("Their email"), { target: { value: fields.email } });
  if (fields.senderName !== undefined) fireEvent.change(within(dialog).getByLabelText("Your name"), { target: { value: fields.senderName } });
}

describe("SendTicketDialog", () => {
  it("is Latte's dialog: the title and body, Their name, Their email, then Send ticket; the first field takes focus", async () => {
    render(<Harness onSend={vi.fn()} />);
    const { dialog } = await openDialog();
    expect(dialog).toHaveTextContent("Your friend gets their own QR code. This one stops working once they accept.");
    const name = within(dialog).getByLabelText("Their name");
    expect(name).toHaveAttribute("placeholder", "e.g. Sam Lee");
    expect(name).toHaveAttribute("autocomplete", "off");
    const email = within(dialog).getByLabelText("Their email");
    expect(email).toHaveAttribute("type", "email");
    expect(email).toHaveAttribute("inputmode", "email");
    expect(email).toHaveAttribute("placeholder", "sam@email.com");
    // The sender's own name (the API needs it): shown to the friend, said so.
    expect(within(dialog).getByLabelText("Your name")).toHaveAccessibleDescription("Shown to them so they know it’s from you.");
    expect(within(dialog).getByRole("button", { name: "Send ticket" })).toHaveClass("btn-signal");
    // The phone sheet's Cancel (hidden from 768, where the ✕ closes it).
    expect(within(dialog).getByRole("button", { name: "Cancel" })).toBeInTheDocument();
    await waitFor(() => expect(name).toHaveFocus());
  });

  it("prefills the sender's name from the member's profile", async () => {
    render(<Harness onSend={vi.fn()} defaultSenderName="Alex Chen" />);
    const { dialog } = await openDialog();
    expect(within(dialog).getByLabelText("Your name")).toHaveValue("Alex Chen");
  });

  it("checks the fields before sending: each says what's wrong, and the first wrong one takes focus", async () => {
    const onSend = vi.fn();
    render(<Harness onSend={onSend} />);
    const { dialog } = await openDialog();
    fill(dialog, { email: "sam" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Send ticket" }));
    expect(onSend).not.toHaveBeenCalled();
    const name = within(dialog).getByLabelText("Their name");
    expect(name).toHaveFocus();
    expect(name).toHaveAttribute("aria-invalid", "true");
    expect(name).toHaveAccessibleDescription("Enter their name");
    expect(within(dialog).getByLabelText("Their email")).toHaveAccessibleDescription("Enter a valid email");
    expect(within(dialog).getByLabelText("Your name")).toHaveAccessibleDescription(/Enter your name/);
    expect(within(dialog).getAllByRole("alert").map((el) => el.textContent)).toEqual(["Enter their name", "Enter a valid email", "Enter your name"]);

    // Typing in a field clears its message.
    fill(dialog, { name: "Sam Lee" });
    expect(within(dialog).getByLabelText("Their name")).not.toHaveAttribute("aria-invalid");
  });

  it("sends the trimmed fields, then closes and focus goes back to what opened it", async () => {
    const onSend = vi.fn().mockResolvedValue(undefined);
    render(<Harness onSend={onSend} />);
    const { dialog, opener } = await openDialog();
    fill(dialog, { name: "  Sam Lee ", email: " sam@email.com ", senderName: "Alex Chen" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Send ticket" }));
    await waitFor(() => expect(onSend).toHaveBeenCalledWith({ name: "Sam Lee", email: "sam@email.com", senderName: "Alex Chen" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    // The browser puts focus back on the opener when a modal dialog closes (jsdom's stand-in doesn't track it).
    expect(opener).toBeInTheDocument();
  });

  it("the server's own-email refusal is said at the email field", async () => {
    const onSend = vi.fn().mockRejectedValue(new ApiError(409, "That's your own email", { email: "That's your own email" }, { code: "own_email" }));
    render(<Harness onSend={onSend} />);
    const { dialog } = await openDialog();
    fill(dialog, { name: "Sam", email: "alex@email.com", senderName: "Alex" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Send ticket" }));
    const email = within(dialog).getByLabelText("Their email");
    await waitFor(() => expect(email).toHaveAccessibleDescription("That’s your own email"));
    expect(email).toHaveFocus();
  });

  it("a mistyped domain from the server: Did you mean …? with Use this, which puts it in the field", async () => {
    const onSend = vi
      .fn()
      .mockRejectedValue(
        new ApiError(400, "Check the email address.", { email: "Check the email address." }, { code: "email_typo", suggestion: "sam@gmail.com" }),
      );
    render(<Harness onSend={onSend} />);
    const { dialog } = await openDialog();
    fill(dialog, { name: "Sam", email: "sam@gmial.com", senderName: "Alex" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Send ticket" }));
    expect(await within(dialog).findByText("sam@gmail.com")).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: "Use this" }));
    expect(within(dialog).getByLabelText("Their email")).toHaveValue("sam@gmail.com");
    expect(within(dialog).getByLabelText("Their email")).toHaveFocus();
    expect(within(dialog).queryByRole("button", { name: "Use this" })).toBeNull();
  });

  it("a mistyped domain is also caught on leaving the field, before sending", async () => {
    render(<Harness onSend={vi.fn()} />);
    const { dialog } = await openDialog();
    const email = within(dialog).getByLabelText("Their email");
    fireEvent.change(email, { target: { value: "sam@gmial.com" } });
    fireEvent.blur(email);
    expect(await within(dialog).findByText(/Did you mean/)).toHaveTextContent("Did you mean sam@gmail.com?");
  });

  it.each([
    ["transfer_pending", 409],
    ["ticket_already_sent", 409],
    ["ticket_checked_in", 409],
    ["transfers_closed", 409],
    ["event_unlisted", 409],
    ["transfer_attempts_used", 409],
    ["transfer_pending_cap", 409],
    ["rate_limited", 429],
  ] as const)("%s (%i) is said above the button", async (code, status) => {
    render(<Harness onSend={vi.fn().mockRejectedValue(new ApiError(status, "server words", undefined, { code }))} />);
    const { dialog } = await openDialog();
    fill(dialog, { name: "Sam", email: "sam@email.com", senderName: "Alex" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Send ticket" }));
    expect(await within(dialog).findByRole("alert")).toHaveTextContent(SEND_ERROR_MESSAGES[code] ?? "");
    // Still open, the fields kept, ready to try again.
    expect(within(dialog).getByLabelText("Their name")).toHaveValue("Sam");
    expect(within(dialog).getByRole("button", { name: "Send ticket" })).not.toHaveAttribute("aria-disabled");
  });

  it("no control of the order (403): the API's words and a Sign in button", async () => {
    const onSignIn = vi.fn();
    const err = new ApiError(403, "Sign in with the email you bought with (a***@email.com) to send this ticket.", undefined, {
      code: "order_owner_only",
    });
    render(<Harness onSend={vi.fn().mockRejectedValue(err)} onSignIn={onSignIn} />);
    const { dialog } = await openDialog();
    fill(dialog, { name: "Sam", email: "sam@email.com", senderName: "Alex" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Send ticket" }));
    const alert = await within(dialog).findByRole("alert");
    expect(alert).toHaveTextContent("Sign in with the email you bought with (a***@email.com) to send this ticket.");
    fireEvent.click(within(alert).getByRole("button", { name: "Sign in" }));
    expect(onSignIn).toHaveBeenCalled();
  });

  it("while sending, the button says so and a second press does nothing", async () => {
    let finish: () => void = () => {};
    const onSend = vi.fn(() => new Promise<void>((resolve) => (finish = resolve)));
    render(<Harness onSend={onSend} />);
    const { dialog } = await openDialog();
    fill(dialog, { name: "Sam", email: "sam@email.com", senderName: "Alex" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Send ticket" }));
    const busy = await within(dialog).findByRole("button", { name: "Sending…" });
    expect(busy).toHaveAttribute("aria-disabled", "true");
    fireEvent.click(busy);
    expect(onSend).toHaveBeenCalledTimes(1);
    await act(async () => finish());
  });

  it("Escape closes it (the dialog's own close)", async () => {
    render(<Harness onSend={vi.fn()} />);
    const { dialog } = await openDialog();
    act(() => {
      (dialog as HTMLDialogElement).close();
    });
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});

function ToastHarness() {
  const controls = useToast();
  return (
    <>
      <button type="button" onClick={() => controls.show("Sent to Sam. We’ll email you when they accept.")}>
        Show
      </button>
      <Toast controls={controls} />
    </>
  );
}

describe("Toast", () => {
  it("is a polite status, always there, that says the words and goes after 6 seconds", () => {
    vi.useFakeTimers();
    render(<ToastHarness />);
    const status = screen.getByRole("status");
    expect(status).toHaveAttribute("aria-live", "polite");
    expect(status).toBeEmptyDOMElement();
    fireEvent.click(screen.getByRole("button", { name: "Show" }));
    expect(status).toHaveTextContent("Sent to Sam. We’ll email you when they accept.");
    act(() => vi.advanceTimersByTime(TOAST_MS - 1));
    expect(status).toHaveTextContent("Sent to Sam.");
    act(() => vi.advanceTimersByTime(1));
    expect(status).toBeEmptyDOMElement();
  });

  it("stays while the pointer is on it, then gets its full time again", () => {
    vi.useFakeTimers();
    render(<ToastHarness />);
    fireEvent.click(screen.getByRole("button", { name: "Show" }));
    const status = screen.getByRole("status");
    const box = status.firstElementChild as HTMLElement;
    fireEvent.pointerEnter(box);
    act(() => vi.advanceTimersByTime(TOAST_MS * 3));
    expect(status).toHaveTextContent("Sent to Sam.");
    fireEvent.pointerLeave(box);
    act(() => vi.advanceTimersByTime(TOAST_MS - 1));
    expect(status).toHaveTextContent("Sent to Sam.");
    act(() => vi.advanceTimersByTime(1));
    expect(status).toBeEmptyDOMElement();
  });
});
