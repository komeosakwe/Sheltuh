import { SUPPORT_EMAIL } from "@/lib/contact";
import { formatSeatLine } from "@/lib/seating/format";
import { subjectLine, type EmailMessage } from "./email";
import { button, escapeHtml, eventBlock, heading, INK, MUTED, page, SANS } from "./email-layout";
import { formatTicketDate, formatTicketTime } from "./ticket-email";
import type { EventRecord, OrderLineItem, TicketSeat } from "./types";

/**
 * The link a guest must follow before free tickets are issued. The token is
 * in the URL fragment, which browsers never send to a server (so it's not in
 * request logs or Referers), and the page only confirms when the button is
 * pressed (so a mail scanner that opens links can't confirm by accident).
 */
export function freeOrderConfirmLink(siteUrl: string, token: string): string {
  return `${siteUrl}/checkout/confirm#token=${token}`;
}

/** "2 × General admission, 1 × Kids" */
function summarise(lineItems: OrderLineItem[]): string {
  return lineItems.map((l) => `${l.quantity} × ${l.ticketTypeName}`).join(", ");
}

/** Shown with a seated booking's seats: nothing is held until the link is confirmed (decision 7). */
export const SEATS_NOT_HELD_NOTE = "Your seats are only held once you confirm, if they're still free.";

/**
 * The confirm-your-free-tickets email (plain text plus HTML in the shared
 * brand layout, lib/server/email-layout.ts). `seats`: a seated booking's
 * seats, one line each.
 */
export function buildFreeConfirmationEmail(
  to: string,
  event: EventRecord,
  lineItems: OrderLineItem[],
  link: string,
  hoursValid: number,
  seats?: TicketSeat[],
): EmailMessage {
  const when = `${formatTicketDate(event.startsAt, event.endsAt)}, ${formatTicketTime(event.startsAt, event.endsAt)}`;
  const tickets = summarise(lineItems);
  const seatLines = (seats ?? []).map(formatSeatLine);
  const text = [
    "Confirm your free tickets",
    "",
    event.title,
    when,
    `Tickets: ${tickets}`,
    ...(seatLines.length > 0 ? [`Seats: ${seatLines.join("; ")}`, SEATS_NOT_HELD_NOTE] : []),
    "",
    `Confirm here (the link works for ${hoursValid} hours): ${link}`,
    "",
    "Open the link and press Confirm. Your tickets are issued then, and emailed to you.",
    "Didn't ask for this? Ignore this email: no tickets will be issued.",
    "",
    `Need help? Email ${SUPPORT_EMAIL}`,
    "Sheltüh, Melbourne",
  ].join("\n");

  const seated = seatLines.length > 0;
  const html = page({
    title: "Confirm your free tickets",
    body:
      heading("Confirm your free tickets") +
      eventBlock(event.title, [when, `Tickets: ${tickets}`], seated ? 8 : 24) +
      (seated
        ? `<p style="margin:0 0 4px 0;font-family:${SANS};font-size:16px;line-height:24px;font-weight:bold;color:${INK}">${seatLines.map(escapeHtml).join("<br>")}</p>` +
          `<p style="margin:0 0 24px 0;font-family:${SANS};font-size:15px;line-height:22px;color:${MUTED}">${escapeHtml(SEATS_NOT_HELD_NOTE)}</p>`
        : "") +
      button("Confirm my tickets", link) +
      `<p style="margin:0 0 8px 0;font-family:${SANS};font-size:15px;line-height:22px;color:${INK}">The link works for ${hoursValid} hours. Open it and press Confirm: your tickets are issued then, and emailed to you.</p>` +
      `<p style="margin:0;font-family:${SANS};font-size:15px;line-height:22px;color:${MUTED}">Didn&rsquo;t ask for this? Ignore this email: no tickets will be issued.</p>`,
  });

  return { to, subject: subjectLine(`Confirm your free tickets: ${event.title}`), text, html };
}
