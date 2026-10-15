import { SUPPORT_EMAIL } from "@/lib/contact";
import type { EmailMessage } from "./email";
import { formatTicketDate, formatTicketTime } from "./ticket-email";
import type { EventRecord, OrderLineItem } from "./types";

const SANS = `'Helvetica Neue', Helvetica, Arial, sans-serif`;
const CREAM = "#f3f0e8";
const INK = "#0b0b0b";
const MUTED = "#5b574e";
const BLUE = "#2b3cff";

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

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

/** The confirm-your-free-tickets email (plain text plus a simple HTML version). */
export function buildFreeConfirmationEmail(
  to: string,
  event: EventRecord,
  lineItems: OrderLineItem[],
  link: string,
  hoursValid: number,
): EmailMessage {
  const when = `${formatTicketDate(event.startsAt, event.endsAt)}, ${formatTicketTime(event.startsAt, event.endsAt)}`;
  const tickets = summarise(lineItems);
  const text = [
    "Confirm your free tickets",
    "",
    event.title,
    when,
    `Tickets: ${tickets}`,
    "",
    `Confirm here (the link works for ${hoursValid} hours): ${link}`,
    "",
    "Open the link and press Confirm. Your tickets are issued then, and emailed to you.",
    "Didn't ask for this? Ignore this email: no tickets will be issued.",
    "",
    `Need help? Email ${SUPPORT_EMAIL}`,
    "Sheltüh, Melbourne",
  ].join("\n");

  const html = `<!DOCTYPE html>
<html lang="en-AU">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Confirm your free tickets</title></head>
<body style="margin:0;padding:24px 12px;background-color:${CREAM};font-family:${SANS};color:${INK}">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;margin:0 auto;background-color:#ffffff;border-radius:14px">
<tr><td style="padding:32px 30px">
<h1 style="margin:0 0 12px 0;font-size:30px;line-height:36px">Confirm your free tickets</h1>
<p style="margin:0 0 4px 0;font-size:20px;line-height:26px;font-weight:bold;color:${BLUE}">${escapeHtml(event.title)}</p>
<p style="margin:0 0 4px 0;font-size:16px;line-height:24px">${escapeHtml(when)}</p>
<p style="margin:0 0 24px 0;font-size:16px;line-height:24px">Tickets: ${escapeHtml(tickets)}</p>
<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 24px 0"><tr>
<td bgcolor="${BLUE}" style="background-color:${BLUE};border-radius:10px"><a href="${escapeHtml(link)}" style="display:block;padding:14px 30px;font-size:16px;line-height:20px;font-weight:bold;color:#ffffff;text-decoration:none">Confirm my tickets</a></td>
</tr></table>
<p style="margin:0 0 8px 0;font-size:15px;line-height:22px">The link works for ${hoursValid} hours. Open it and press Confirm: your tickets are issued then, and emailed to you.</p>
<p style="margin:0;font-size:15px;line-height:22px;color:${MUTED}">Didn&rsquo;t ask for this? Ignore this email: no tickets will be issued.</p>
</td></tr></table>
<p style="text-align:center;font-size:13px;line-height:20px;color:${MUTED}">Need help? Email <a href="mailto:${escapeHtml(SUPPORT_EMAIL)}" style="color:${MUTED}">${escapeHtml(SUPPORT_EMAIL)}</a><br>Sheltüh &middot; Melbourne</p>
</body>
</html>`;

  return { to, subject: `Confirm your free tickets: ${event.title}`, text, html };
}
