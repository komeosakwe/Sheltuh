// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useRef, useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import BuyerEmailField, { EMAIL_HINT_DELAY_MS } from "@/components/checkout/BuyerEmailField";
import { DETAILS_NOTICE } from "@/lib/buyer-details";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

/** Typing pauses long enough for the "Did you mean …?" to be worked out. */
function pause(ms = EMAIL_HINT_DELAY_MS) {
  act(() => {
    vi.advanceTimersByTime(ms);
  });
}

function Harness({
  initial = "",
  error = null,
  suggestion = null,
  onSignOut,
  onValue,
  detailsNotice,
  submitOnEnter,
}: {
  initial?: string;
  error?: string | null;
  suggestion?: string | null;
  onSignOut?: () => void;
  onValue?: (value: string) => void;
  detailsNotice?: boolean;
  submitOnEnter?: boolean;
}) {
  const [value, setValue] = useState(initial);
  const ref = useRef<HTMLInputElement>(null);
  return (
    <BuyerEmailField
      id="email"
      value={value}
      onChange={(next) => {
        setValue(next);
        onValue?.(next);
      }}
      error={error}
      suggestion={suggestion}
      inputRef={ref}
      onSignOut={onSignOut}
      detailsNotice={detailsNotice}
      submitOnEnter={submitOnEnter}
    />
  );
}

function field() {
  return screen.getByLabelText("Email for your tickets");
}

describe("BuyerEmailField", () => {
  it("is an email field for the tickets: 16px and 48px, with autocomplete and a guest's hint", () => {
    render(<Harness />);
    const input = field();
    expect(input).toHaveAttribute("type", "email");
    expect(input).toHaveAttribute("autocomplete", "email");
    expect(input).toHaveAttribute("inputmode", "email");
    expect(input).toHaveAttribute("enterkeyhint", "done");
    expect(input).toBeRequired();
    expect(input).toHaveClass("min-h-12", "text-base");
    // Signed out: nothing about an account or Who's Going.
    expect(input).toHaveAccessibleDescription("Tickets are sent here.");
    expect(screen.queryByRole("button", { name: "Not you? Sign out" })).toBeNull();
  });

  it("the details notice, when asked for, comes after the field and describes it", () => {
    render(<Harness detailsNotice />);
    expect(field()).toHaveAccessibleDescription(`Tickets are sent here. ${DETAILS_NOTICE}`);
    const notice = screen.getByText(DETAILS_NOTICE);
    expect(field().compareDocumentPosition(notice) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("suggests a fix for a mistyped domain once typing pauses, before the buyer leaves the field", () => {
    vi.useFakeTimers();
    const onValue = vi.fn();
    render(<Harness onValue={onValue} />);
    const input = field();
    input.focus();
    fireEvent.change(input, { target: { value: "mia@gmial.com" } });
    // Not on every keystroke…
    pause(EMAIL_HINT_DELAY_MS - 1);
    expect(screen.queryByText(/Did you mean/)).toBeNull();
    // …but once typing pauses, while focus is still in the field.
    pause(1);
    const hint = screen.getByText(/Did you mean/);
    expect(input).toHaveFocus();
    expect(hint).toHaveTextContent("Did you mean mia@gmail.com?");
    // Said when it appears (a polite live region that was there before it).
    expect(hint.closest("[aria-live]")).toHaveAttribute("aria-live", "polite");
    expect(input).toHaveAccessibleDescription(/Did you mean mia@gmail\.com\?$/);
    // Never blocking: no error, nothing invalid.
    expect(screen.queryByRole("alert")).toBeNull();
    expect(input).not.toHaveAttribute("aria-invalid");
    // Leaving the field changes nothing (nothing moves under a click).
    fireEvent.blur(input);
    expect(screen.getByText(/Did you mean/)).toBe(hint);

    const use = screen.getByRole("button", { name: "Use this" });
    expect(use).toHaveClass("min-h-11", "min-w-11");
    expect(use).toHaveAccessibleDescription("Did you mean mia@gmail.com?");
    fireEvent.click(use);
    expect(onValue).toHaveBeenLastCalledWith("mia@gmail.com");
    expect(input).toHaveValue("mia@gmail.com");
    expect(input).toHaveFocus();
    expect(screen.queryByText(/Did you mean/)).toBeNull();
  });

  it("works nothing out until the domain has a dot, and drops a pending hint when the field is left by a click", () => {
    vi.useFakeTimers();
    render(<Harness />);
    const input = field();
    input.focus();
    fireEvent.change(input, { target: { value: "mia@gmial" } });
    pause();
    expect(screen.queryByText(/Did you mean/)).toBeNull();
    // Left (a click on Checkout, say) before typing paused: no hint appears under the pointer afterwards.
    fireEvent.change(input, { target: { value: "mia@gmial.com" } });
    fireEvent.blur(input);
    pause();
    expect(screen.queryByText(/Did you mean/)).toBeNull();
  });

  it("Tab works the hint out at once, so Use this is next in the Tab order", () => {
    vi.useFakeTimers();
    render(
      <>
        <Harness />
        <button type="button">Checkout</button>
      </>,
    );
    const input = field();
    input.focus();
    fireEvent.change(input, { target: { value: "mia@hotmial.com" } });
    fireEvent.keyDown(input, { key: "Tab" });
    expect(screen.getByText(/Did you mean/)).toHaveTextContent("Did you mean mia@hotmail.com?");
    const use = screen.getByRole("button", { name: "Use this" });
    const checkout = screen.getByRole("button", { name: "Checkout" });
    expect(input.compareDocumentPosition(use) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(use.compareDocumentPosition(checkout) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("suggests nothing for an address that looks right, and keeps the part before the @", () => {
    vi.useFakeTimers();
    render(<Harness />);
    const input = field();
    for (const ok of ["mia@gmail.com", "mia@bigpond.com", "jo@example.com", "a@b.co"]) {
      fireEvent.change(input, { target: { value: ok } });
      pause();
      expect(screen.queryByText(/Did you mean/)).toBeNull();
    }
    fireEvent.change(input, { target: { value: "Mia.Tran+gigs@hotmial.com" } });
    pause();
    expect(screen.getByText(/Did you mean/)).toHaveTextContent("Did you mean Mia.Tran+gigs@hotmail.com?");
    // Typing again takes it away until typing pauses again.
    fireEvent.change(input, { target: { value: "Mia.Tran+gigs@hotmial.co" } });
    expect(screen.queryByText(/Did you mean/)).toBeNull();
  });

  it("shows the server's suggestion straight away, with its error as an alert on the field", () => {
    render(<Harness initial="mia@gmail.con" error="That email address looks mistyped." suggestion="mia@gmail.com" />);
    const input = field();
    expect(screen.getByRole("alert")).toHaveTextContent("That email address looks mistyped.");
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(input).toHaveAccessibleDescription("Tickets are sent here. That email address looks mistyped. Did you mean mia@gmail.com?");
    expect(screen.getByRole("button", { name: "Use this" })).toBeInTheDocument();
  });

  it("signed in: the account's hint, and Not you? Sign out, a 44px button", () => {
    const onSignOut = vi.fn();
    render(<Harness initial="mia@example.com" onSignOut={onSignOut} />);
    expect(field()).toHaveAccessibleDescription("Tickets are sent here. Use your account email to join Who’s Going.");
    const out = screen.getByRole("button", { name: "Not you? Sign out" });
    expect(out).toHaveClass("min-h-11");
    fireEvent.click(out);
    expect(onSignOut).toHaveBeenCalledTimes(1);
  });

  it("submitOnEnter: the keyboard's key says Send, and Enter leaves focus in the field (the form submits)", () => {
    vi.stubGlobal("matchMedia", (query: string) => ({ matches: query === "(pointer: coarse)" }));
    render(<Harness submitOnEnter />);
    const input = field();
    expect(input).toHaveAttribute("enterkeyhint", "send");
    input.focus();
    fireEvent.keyDown(input, { key: "Enter" });
    expect(input).toHaveFocus();
    cleanup();
    // Without it (checkout: no form), Enter closes a phone's keyboard.
    render(<Harness />);
    field().focus();
    fireEvent.keyDown(field(), { key: "Enter" });
    expect(field()).not.toHaveFocus();
    vi.unstubAllGlobals();
  });
});
