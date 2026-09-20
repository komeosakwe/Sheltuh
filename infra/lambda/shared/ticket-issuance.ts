import type { IssuedTicket, OrderLineItem } from "./types";

/** Short, unambiguous (no 0/O/1/I) code — good enough to read aloud or show on a door list. */
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function generateTicketCode(): string {
  let code = "";
  for (let i = 0; i < 8; i++) {
    code += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
    if (i === 3) code += "-";
  }
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
