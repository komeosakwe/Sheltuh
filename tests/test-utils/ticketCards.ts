import { fireEvent, screen } from "@testing-library/react";

/**
 * Presses a ticket type's "+" in the ticket panel (each row has its own − n + stepper: the owner's event reference,
 * 13 Nov 2026), adding one ticket (or group). Throws for a row with no stepper (sold out, waiting).
 */
export function addTicket(name: string): void {
  fireEvent.click(screen.getByRole("button", { name: `Increase quantity for ${name}` }));
}

/**
 * A row's price line as one matcher ("A$32.30 incl. booking fee"): the amount is set apart from the rest, so they're
 * two runs inside one element. For `getByText(priceLine(...))`.
 */
export function priceLine(text: string) {
  return (_content: string, element: Element | null) => Boolean(element?.hasAttribute("data-ticket-price")) && element?.textContent === text;
}
