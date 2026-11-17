// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useRef, useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import BuyerEmailField from "@/components/checkout/BuyerEmailField";

afterEach(cleanup);

function Harness({
  initial = "",
  error = null,
  suggestion = null,
  onSignOut,
  onValue,
}: {
  initial?: string;
  error?: string | null;
  suggestion?: string | null;
  onSignOut?: () => void;
  onValue?: (value: string) => void;
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
    />
  );
}

function field() {
  return screen.getByLabelText("Email for your tickets");
}

describe("BuyerEmailField", () => {
  it("is an email field for the tickets: 16px and 48px, with autocomplete and the hint", () => {
    render(<Harness />);
    const input = field();
    expect(input).toHaveAttribute("type", "email");
    expect(input).toHaveAttribute("autocomplete", "email");
    expect(input).toHaveAttribute("inputmode", "email");
    expect(input).toBeRequired();
    expect(input).toHaveClass("min-h-12", "text-base");
    expect(input).toHaveAccessibleDescription("Tickets are sent here. Use your account email to join Who’s Going.");
    expect(screen.queryByRole("button", { name: "Not you? Sign out" })).toBeNull();
  });

  it("suggests a fix for a mistyped domain once the buyer leaves the field, not while they type", () => {
    const onValue = vi.fn();
    render(<Harness onValue={onValue} />);
    const input = field();
    input.focus();
    fireEvent.change(input, { target: { value: "mia@gmial.com" } });
    expect(screen.queryByText(/Did you mean/)).toBeNull();
    fireEvent.blur(input);
    const hint = screen.getByText(/Did you mean/);
    expect(hint).toHaveTextContent("Did you mean mia@gmail.com?");
    // Said when it appears (a polite live region that was there before it).
    expect(hint.closest("[aria-live]")).toHaveAttribute("aria-live", "polite");
    expect(input).toHaveAccessibleDescription(/Did you mean mia@gmail\.com\?$/);
    // Never blocking: no error, nothing invalid.
    expect(screen.queryByRole("alert")).toBeNull();
    expect(input).not.toHaveAttribute("aria-invalid");

    const use = screen.getByRole("button", { name: "Use this" });
    expect(use).toHaveClass("min-h-11", "min-w-11");
    expect(use).toHaveAccessibleDescription("Did you mean mia@gmail.com?");
    fireEvent.click(use);
    expect(onValue).toHaveBeenLastCalledWith("mia@gmail.com");
    expect(input).toHaveValue("mia@gmail.com");
    expect(input).toHaveFocus();
    expect(screen.queryByText(/Did you mean/)).toBeNull();
  });

  it("suggests nothing for an address that looks right, and keeps the part before the @", () => {
    render(<Harness />);
    const input = field();
    for (const ok of ["mia@gmail.com", "mia@bigpond.com", "jo@example.com", "a@b.co"]) {
      fireEvent.change(input, { target: { value: ok } });
      fireEvent.blur(input);
      expect(screen.queryByText(/Did you mean/)).toBeNull();
    }
    fireEvent.change(input, { target: { value: "Mia.Tran+gigs@hotmial.com" } });
    fireEvent.blur(input);
    expect(screen.getByText(/Did you mean/)).toHaveTextContent("Did you mean Mia.Tran+gigs@hotmail.com?");
    // Typing again takes it away until they leave the field again.
    fireEvent.change(input, { target: { value: "Mia.Tran+gigs@hotmial.co" } });
    expect(screen.queryByText(/Did you mean/)).toBeNull();
  });

  it("shows the server's suggestion straight away, with its error as an alert on the field", () => {
    render(<Harness initial="mia@gmail.con" error="That email address looks mistyped." suggestion="mia@gmail.com" />);
    const input = field();
    expect(screen.getByRole("alert")).toHaveTextContent("That email address looks mistyped.");
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(input).toHaveAccessibleDescription(
      "Tickets are sent here. Use your account email to join Who’s Going. That email address looks mistyped. Did you mean mia@gmail.com?",
    );
    expect(screen.getByRole("button", { name: "Use this" })).toBeInTheDocument();
  });

  it("signed in: Not you? Sign out, a 44px button", () => {
    const onSignOut = vi.fn();
    render(<Harness initial="mia@example.com" onSignOut={onSignOut} />);
    const out = screen.getByRole("button", { name: "Not you? Sign out" });
    expect(out).toHaveClass("min-h-11");
    fireEvent.click(out);
    expect(onSignOut).toHaveBeenCalledTimes(1);
  });
});
