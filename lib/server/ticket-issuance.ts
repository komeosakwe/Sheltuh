import type { IssuedTicket, OrderLineItem } from "./types";

/** Short, unambiguous (no 0/O/1/I) code — good enough to read aloud or show on a door list. */
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

/** Cryptographically random — a ticket code is what gets someone through the door. */
function generateTicketCode(): string {
  // 256 is a multiple of the 32-letter alphabet, so `byte % 32` has no bias.
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  let code = "";
  bytes.forEach((byte, i) => {
    code += CODE_ALPHABET[byte % CODE_ALPHABET.length];
    if (i === 3) code += "-";
  });
  return code;
}

/** One ticket per unit purchased, not per line item — a quantity-3 line becomes 3 individually-coded tickets. */
export function issueTickets(lineItems: OrderLineItem[]): IssuedTicket[] {
  return lineItems.flatMap((line) =>
    Array.from({ length: line.quantity }, () => ({
      ticketCode: generateTicketCode(),
      ticketTypeId: line.ticketTypeId,
      ticketTypeName: line.ticketTypeName,
    })),
  );
}
