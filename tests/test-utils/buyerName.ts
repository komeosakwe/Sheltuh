import { fireEvent, screen } from "@testing-library/react";

/** The ticket email typeName fills in when the checkout's email field is empty. */
export const TEST_BUYER_EMAIL = "alex@example.com";

/**
 * Types a buyer name into the checkout's "Your name" field, and (every checkout, paid or free, asks for one)
 * `email` into "Email for your tickets" when that field is shown and still empty: an address a test typed, or
 * a signed-in account's prefilled one, is left as it is. `email: null` leaves the field alone.
 */
export function typeName(name = "Alex Doe", email: string | null = TEST_BUYER_EMAIL) {
  fireEvent.change(screen.getByLabelText("Your name"), { target: { value: name } });
  if (email === null) return;
  const field = screen.queryByLabelText("Email for your tickets");
  if (field instanceof HTMLInputElement && field.value === "") fireEvent.change(field, { target: { value: email } });
}
