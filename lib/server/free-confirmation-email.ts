import { DETAILS_NOTICE } from "@/lib/buyer-details";
import { formatSeatLine } from "@/lib/seating/format";
import { subjectLine, type EmailMessage } from "./email";
import { escapeHtml } from "./email-layout";
import { kitButtons, kitFooter, kitFooterText, kitHeader, kitHelp, kitHelpText, kitIntro, kitPage, kitStack, kitText } from "./email-kit";
import { ticketWordmarkImage } from "./email-ticket-layout";
import { emailEventCard, formatTicketDate, formatTicketTime } from "./ticket-email";
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

/** The origin of a link we built (for the footer image), or "" for anything that isn't a URL. */
function linkOrigin(link: string): string {
  try {
    return new URL(link).origin;
  } catch {
    return "";
  }
}

/** "2 × General admission, 1 × Kids" */
function summarise(lineItems: OrderLineItem[]): string {
  return lineItems.map((l) => `${l.quantity} × ${l.ticketTypeName}`).join(", ");
}

/** Shown with a seated booking's seats: nothing is held until the link is confirmed (decision 7). */
export const SEATS_NOT_HELD_NOTE = "Your seats are only held once you confirm, if they're still free.";

/**
 * The confirm-your-free-tickets email (plain text plus HTML in the shared
 * brand layout, lib/server/email-kit.ts, with the same wordmark header and
 * branded footer as the tickets email that follows it). `seats`: a seated
 * booking's seats, one line each.
 */
export function buildFreeConfirmationEmail(
  to: string,
  event: EventRecord,
  lineItems: OrderLineItem[],
  link: string,
  hoursValid: number,
  seats?: TicketSeat[],
): EmailMessage {
  // In the event's zone, as the tickets email that follows will say it.
  const when = `${formatTicketDate(event.startsAt, event.endsAt, event)}, ${formatTicketTime(event.startsAt, event.endsAt, event)}`;
  const tickets = summarise(lineItems);
  const seatLines = (seats ?? []).map(formatSeatLine);
  // The site's origin, from the confirm link the handler built on it (freeOrderConfirmLink).
  const siteUrl = linkOrigin(link);
  const footer = { siteUrl, tone: "customer" as const };
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
    DETAILS_NOTICE,
    "Didn't ask for this? Ignore this email: no tickets will be issued.",
    "",
    kitHelpText("customer"),
    "",
    kitFooterText(footer),
  ].join("\n");

  const seated = seatLines.length > 0;
  const html = kitPage({
    title: "Confirm your free tickets",
    preheader: `${event.title} · ${when}`,
    siteUrl,
    tone: "customer",
    body: kitStack([
      kitHeader(),
      kitIntro("", "Confirm your free tickets"),
      kitStack(
        [
          emailEventCard(event, siteUrl),
          kitText(`<span style="font-weight:600">${escapeHtml(`Tickets: ${tickets}`)}</span><br>${escapeHtml(when)}`),
          seated
            ? kitText(`<span style="font-weight:600">${seatLines.map(escapeHtml).join("<br>")}</span>`) +
              kitText(escapeHtml(SEATS_NOT_HELD_NOTE), { muted: true })
            : "",
        ],
        16,
      ),
      kitButtons([{ label: "Confirm my tickets", href: link, kind: "primary" }]),
      kitStack(
        [
          kitText(`The link works for ${hoursValid} hours. Open it and press Confirm: your tickets are issued then, and emailed to you.`),
          kitText(escapeHtml(DETAILS_NOTICE)),
          kitText("Didn&rsquo;t ask for this? Ignore this email: no tickets will be issued.", { muted: true }),
        ],
        8,
      ),
      kitHelp("customer"),
      kitFooter(footer),
    ]),
  });

  return {
    to,
    subject: subjectLine(`Confirm your free tickets: ${event.title}`),
    text,
    html,
    // The wordmark, inline like the tickets email's.
    inlineImages: [ticketWordmarkImage()],
  };
}
