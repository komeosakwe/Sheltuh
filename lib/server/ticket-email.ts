import { formatAud, formatEventDateTimeRange } from "@/lib/format";
import type { EmailMessage } from "./email";
import type { EventRecord, OrderRecord } from "./types";

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

/** The buyer's tickets, sent once an order is paid (free orders included). */
export function buildTicketEmail(order: OrderRecord, event: EventRecord, siteUrl: string): EmailMessage {
  const when = formatEventDateTimeRange(event.startsAt, event.endsAt);
  const where = `${event.venueName}, ${event.venueAddress}`;
  const link = `${siteUrl}/checkout/success?session_id=${encodeURIComponent(order.orderId)}`;
  const total = order.totalCents === 0 ? "Free" : `${formatAud(order.totalCents)} (incl. booking fees)`;

  const text = [
    `You're going to ${event.title}.`,
    "",
    `When: ${when}`,
    `Where: ${where}`,
    "",
    "Your tickets — show these codes at the door:",
    ...order.tickets.map((t) => `  ${t.ticketCode}  ${t.ticketTypeName}`),
    "",
    `Total: ${total}`,
    `View your order: ${link}`,
    "",
    "Questions? Just reply to this email.",
    "— Sheltüh",
  ].join("\n");

  const rows = order.tickets
    .map(
      (t) =>
        `<tr><td style="padding:6px 12px 6px 0">${escapeHtml(t.ticketTypeName)}</td>` +
        `<td style="padding:6px 0;font-family:monospace;font-size:16px;letter-spacing:1px"><strong>${escapeHtml(t.ticketCode)}</strong></td></tr>`,
    )
    .join("");

  const html = `<div style="font-family:system-ui,-apple-system,sans-serif;color:#111;max-width:520px">
<p style="font-size:18px">You&rsquo;re going to <strong>${escapeHtml(event.title)}</strong>.</p>
<p><strong>When:</strong> ${escapeHtml(when)}<br><strong>Where:</strong> ${escapeHtml(where)}</p>
<p>Your tickets — show these codes at the door:</p>
<table style="border-collapse:collapse">${rows}</table>
<p><strong>Total:</strong> ${escapeHtml(total)}</p>
<p><a href="${escapeHtml(link)}">View your order</a></p>
<p style="color:#555;font-size:13px">Questions? Just reply to this email.<br>— Sheltüh</p>
</div>`;

  return { to: order.buyerEmail ?? "", subject: `Your tickets: ${event.title}`, text, html };
}
