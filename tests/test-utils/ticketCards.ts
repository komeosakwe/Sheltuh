import { fireEvent, screen } from "@testing-library/react";

/**
 * Taps a release's card in the ticket panel: the quantity stepper (below the cards) moves to it, and a
 * release with none chosen gets its first ticket. Throws for a card that can't be pressed (sold out, waiting).
 */
export function selectCard(name: string): void {
  const button = screen.getByText(name).closest("button");
  if (!button) throw new Error(`"${name}" has no card to press`);
  fireEvent.click(button);
}

/**
 * A card's price line as one matcher ("A$32.30 incl. booking fee"): the amount is bold and the rest lighter,
 * so they're two runs inside one element. For `getByText(priceLine(...))`.
 */
export function priceLine(text: string) {
  return (_content: string, element: Element | null) => Boolean(element?.hasAttribute("data-ticket-price")) && element?.textContent === text;
}
