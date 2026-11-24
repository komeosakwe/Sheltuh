import { BEFORE_YOU_GO_TITLE } from "@/lib/before-you-go";
import { SUPPORT_EMAIL } from "@/lib/contact";
import { formatEventDateShort } from "@/lib/format";
import { firstName } from "@/lib/person-name";
import { formatSeatLine, speakSeatLine } from "@/lib/seating/format";
import { ticketNameWithGroup } from "@/lib/ticket-groups";
import { TICKET_TRANSFER_RULES } from "@/lib/ticket-transfer-rules";
import { PLATFORM_TIME_ZONE } from "@/lib/time-zones";
import { subjectLine, type EmailMessage } from "./email";
import { escapeHtml } from "./email-layout";
import {
  kitButtons,
  kitDetails,
  kitFooter,
  kitFooterText,
  kitHeader,
  kitHelp,
  kitHelpText,
  kitIntro,
  kitLink,
  kitNotice,
  kitP,
  kitPage,
  kitStack,
  kitType,
  KIT,
  type KitButton,
} from "./email-kit";
import { TICKET_PHONE_RULES, ticketWordmarkImage } from "./email-ticket-layout";
import { orderReference } from "./order-reference";
import { qrImage, ticketCard, ticketCardEvent, ticketDetails, ticketPageLink, ticketQr } from "./ticket-email";
import { transferReference } from "./transfer-reference";
import type { EventRecord, TicketGroup, TicketSeat } from "./types";

/**
 * The five ticket transfer emails (docs/architecture.md, "Ticket
 * transfers"), on the shared 1120 layout (./email-kit.ts) to Latte's frames
 * "Ticket received (sent by a friend)", "Transfer accepted" and "Transfer
 * declined" (the expired one built like declined; the recipient's own ticket
 * email like the ticket email). The full ticket is the ticket email's own
 * orange-outline card (owner decision): locked (a placeholder that doesn't
 * decode, never any code) in the offer, live with the recipient's issued code
 * in theirs. Transactional, about one ticket (Spam Act): no promotion, no
 * unsubscribe. Every name is the database-checked text a person typed
 * (person_name_ok, parsePersonName) and is escaped as quoted user content;
 * none becomes a link.
 *
 * What each one carries is limited by who reads it (my-ticket.md §7.2):
 * nothing sent to the recipient carries the order's id or reference, the
 * buyer's details, amounts or the order's other tickets; nothing sent to the
 * sender carries the recipient's code.
 */

export type TicketTransferEmailKind = "transfer_offer" | "transfer_accepted" | "transfer_declined" | "transfer_expired" | "transfer_ticket";

/** The ticket being sent, as its card shows it. */
export interface TransferTicket {
  typeName: string;
  group?: TicketGroup;
  seat?: TicketSeat;
}

const NOT_FORWARD = "Don’t forward this email: whoever accepts first gets the ticket.";
const OFFER_REASON = (from: string) => `You’re getting this email because ${from} sent you a ticket on Sheltüh.`;
const BUYER_REASON = "You’re getting this email because you bought a ticket on Sheltüh.";
const HOLDER_REASON = "You’re getting this email because you accepted a ticket on Sheltüh.";

/** An event title as the headings and subjects draw it: in capitals ("HERE & NOW"). */
export function eventCaps(title: string): string {
  return subjectLine(title).toLocaleUpperCase("en-AU");
}

const site = (siteUrl: string) => siteUrl.replace(/\/+$/, "");
const zoneOf = (event: EventRecord) => event.timeZone ?? PLATFORM_TIME_ZONE;
const listed = (event: EventRecord) => event.status === "published";
const typeLabel = (t: TransferTicket) => (t.typeName ? ticketNameWithGroup(t.typeName, t.group) : "");

/** The offer link (the token in the fragment: never sent to a server, never in a log or a Referer). */
export function ticketOfferLink(siteUrl: string, token: string, decline = false): string {
  return `${site(siteUrl)}/tickets/accept#token=${encodeURIComponent(token)}${decline ? "&decline=1" : ""}`;
}

/** A recipient's received ticket page (account-gated: the id isn't a credential). */
export function receivedTicketLink(siteUrl: string, transferId: string): string {
  return `${site(siteUrl)}/tickets/received/${encodeURIComponent(transferId)}`;
}

/** "Before you go", Latte's box under the details, when the organiser wrote one and the event is listed. */
function beforeYouGo(event: EventRecord): { html: string; text: string[] } {
  const items = listed(event) ? (event.beforeYouGo ?? []) : [];
  if (items.length === 0) return { html: "", text: [] };
  return {
    html: kitNotice(
      BEFORE_YOU_GO_TITLE,
      items.map((i) => `<span style="color:${KIT.black};font-weight:600">${escapeHtml(i.label)}</span>&nbsp;&nbsp;${escapeHtml(i.value)}`),
    ),
    text: ["", BEFORE_YOU_GO_TITLE.toUpperCase(), ...items.map((i) => `${i.label}: ${i.value}`)],
  };
}

/** The event's details and "Before you go", or the unlisted line. */
function eventBlocks(event: EventRecord, siteUrl: string): { html: string[]; text: string[] } {
  if (!listed(event)) {
    const line = `This event is no longer listed. Contact ${SUPPORT_EMAIL} if you have questions.`;
    return {
      html: [kitP(`This event is no longer listed. Contact ${kitLink(`mailto:${SUPPORT_EMAIL}`, escapeHtml(SUPPORT_EMAIL))} if you have questions.`, kitType("sans", 16, 24, 400, KIT.black))],
      text: [line],
    };
  }
  const details = ticketDetails(event, siteUrl);
  const before = beforeYouGo(event);
  return { html: [kitDetails(siteUrl, details.rows), before.html], text: [...details.text, ...before.text] };
}

function page(title: string, preheader: string, siteUrl: string, blocks: string[]): string {
  return kitPage({ title, preheader, siteUrl, body: kitStack(blocks), tone: "customer", phoneCss: TICKET_PHONE_RULES });
}

function buttonsText(buttons: ReadonlyArray<KitButton>): string[] {
  return [...buttons.map((b) => `${b.label}: ${b.href}`), "(Button not working? Use the links above.)"];
}

// ---------------------------------------------------------------------------
// (a) The offer, to the address the sender typed
// ---------------------------------------------------------------------------

export interface TransferOfferEmailInput {
  to: string;
  siteUrl: string;
  /** The link's token (its hash is stored first). Only in the two links; never logged. */
  token: string;
  senderName: string;
  event: EventRecord;
  ticket: TransferTicket;
}

export function buildTransferOfferEmail(input: TransferOfferEmailInput): EmailMessage {
  const { siteUrl, event, ticket } = input;
  const from = subjectLine(input.senderName);
  const fromFirst = firstName(from);
  const caps = eventCaps(event.title);
  const subject = subjectLine(`${fromFirst} sent you a ticket to ${caps}`);
  const heading = `${fromFirst} sent you a ticket to ${caps}.`;
  const eyebrow = `From ${from}`;
  const how = [
    "Sign in or create an account, then accept to get your own QR code.",
    `${fromFirst}’s copy stops working once you accept.`,
    `Not going? Decline and the ticket goes back to ${fromFirst}.`,
  ];
  const buttons: KitButton[] = [
    { label: "Accept ticket", href: ticketOfferLink(siteUrl, input.token), kind: "primary" },
    { label: "Decline", href: ticketOfferLink(siteUrl, input.token, true), kind: "secondary" },
  ];
  const card = ticketCard({
    siteUrl,
    title: event.title,
    event: ticketCardEvent(event, siteUrl),
    code: "",
    typeName: typeLabel(ticket),
    ...(ticket.seat ? { seat: ticket.seat } : {}),
    qr: null,
    index: 0,
    total: 1,
    state: "locked",
    lockedCaption: "Accept the ticket to get your QR code",
  });
  const blocks = eventBlocks(event, siteUrl);
  const footer = { siteUrl, tone: "customer" as const, reason: OFFER_REASON(from) };
  const html = page(subject, "Accept it to get your own QR code", siteUrl, [
    kitHeader(),
    kitIntro(eyebrow, heading),
    card,
    kitButtons(buttons),
    kitStack([kitNotice("How it works", how.map(escapeHtml)), kitP(escapeHtml(NOT_FORWARD), kitType("sans", 14, 20, 400, KIT.muted))], 12),
    ...blocks.html,
    kitHelp("customer"),
    kitFooter(footer),
  ]);
  const text = [
    "SHELTÜH",
    "",
    eyebrow,
    subject,
    `${from} sent you a ticket to ${subjectLine(event.title)}.`,
    ...(typeLabel(ticket) ? [`Ticket: ${typeLabel(ticket)}`] : []),
    ...(ticket.seat ? [`Seat: ${speakSeatLine(ticket.seat)}`] : []),
    "",
    ...buttonsText(buttons),
    "",
    "HOW IT WORKS",
    ...how,
    NOT_FORWARD,
    "",
    ...blocks.text,
    "",
    kitHelpText("customer"),
    "",
    kitFooterText(footer),
  ].join("\n");
  return { to: input.to, subject, text: text.replaceAll("’", "'"), html, inlineImages: [ticketWordmarkImage()] };
}

// ---------------------------------------------------------------------------
// (b) Accepted, to the sender
// ---------------------------------------------------------------------------

export interface TransferAcceptedEmailInput {
  to: string;
  siteUrl: string;
  orderId: string;
  /** buyer: the order's buyer sent it; holder: a recipient sent it on (fromTransferId is theirs). */
  senderKind: "buyer" | "holder";
  fromTransferId?: string | null;
  holderName: string;
  recipientEmail: string;
  acceptedEmail: string;
  /** The ticket's number in the buyer's order (the buyer's own context only). */
  ticketNumber: number;
  ticketCount: number;
  event: EventRecord;
  maskedAcceptedEmail: string;
}

export function buildTransferAcceptedEmail(input: TransferAcceptedEmailInput): EmailMessage {
  const { siteUrl, event } = input;
  const holder = subjectLine(input.holderName);
  const holderFirst = firstName(holder);
  const caps = eventCaps(event.title);
  const buyer = input.senderKind === "buyer";
  const subject = subjectLine(`${holderFirst} accepted your ticket`);
  const eyebrow = buyer
    ? `Order ${orderReference(input.orderId)} · Transfer complete`
    : `Ticket ${transferReference(input.fromTransferId ?? "")} · Transfer complete`;
  const heading = `${holderFirst} accepted your ticket.`;
  const day = formatEventDateShort(event.startsAt, zoneOf(event));
  const differs = input.acceptedEmail.trim().toLowerCase() !== input.recipientEmail.trim().toLowerCase();
  const lines = [
    `${holder} now holds ${buyer ? `Ticket ${input.ticketNumber} of ${input.ticketCount} for ` : "your ticket to "}${caps} on ${day}.`,
    "Your QR code for this ticket no longer works.",
    ...(differs ? [`They accepted with ${input.maskedAcceptedEmail}, not the address you sent it to. If you didn’t expect this, contact ${SUPPORT_EMAIL}.`] : []),
  ];
  const link = buyer ? ticketPageLink(site(siteUrl), input.orderId) : receivedTicketLink(siteUrl, input.fromTransferId ?? "");
  const buttons: KitButton[] = [{ label: buyer ? "View order" : "View your ticket", href: link, kind: "primary" }];
  const footer = { siteUrl, tone: "customer" as const, reason: buyer ? BUYER_REASON : HOLDER_REASON };
  const linesHtml = lines.map((l) =>
    escapeHtml(l).replace(escapeHtml(SUPPORT_EMAIL), kitLink(`mailto:${SUPPORT_EMAIL}`, escapeHtml(SUPPORT_EMAIL), KIT.muted)),
  );
  const html = page(subject, `Your QR code for ${caps} no longer works`, siteUrl, [
    kitHeader(),
    kitIntro(eyebrow, heading),
    kitNotice("What this means", linesHtml),
    kitButtons(buttons),
    kitHelp("customer"),
    kitFooter(footer),
  ]);
  const text = ["SHELTÜH", "", eyebrow, heading, "", "WHAT THIS MEANS", ...lines, "", ...buttonsText(buttons), "", kitHelpText("customer"), "", kitFooterText(footer)].join("\n");
  return { to: input.to, subject, text: text.replaceAll("’", "'"), html, inlineImages: [ticketWordmarkImage()] };
}

// ---------------------------------------------------------------------------
// (c) Declined and (d) expired, to the sender
// ---------------------------------------------------------------------------

export interface TransferBackEmailInput {
  to: string;
  siteUrl: string;
  orderId: string;
  senderKind: "buyer" | "holder";
  fromTransferId?: string | null;
  recipientName: string;
  ticketNumber: number;
  event: EventRecord;
  /** Past the cut-off: it can't be sent again. */
  closed: boolean;
}

export function buildTransferBackEmail(kind: "transfer_declined" | "transfer_expired", input: TransferBackEmailInput): EmailMessage {
  const { siteUrl } = input;
  const toFirst = firstName(subjectLine(input.recipientName));
  const buyer = input.senderKind === "buyer";
  const declined = kind === "transfer_declined";
  const subject = subjectLine(declined ? `${toFirst} declined your ticket` : `${toFirst} didn’t accept your ticket in time`);
  const preheader = declined ? "It’s back with you — your QR code still works" : "It’s still yours — your QR code still works";
  const reference = buyer ? `Order ${orderReference(input.orderId)}` : `Ticket ${transferReference(input.fromTransferId ?? "")}`;
  const eyebrow = `${reference} · ${declined ? "Transfer declined" : "Transfer expired"}`;
  const heading = declined ? `${toFirst} declined, so the ticket is back with you.` : `${toFirst} didn’t accept in time, so the ticket is still yours.`;
  const canResend = buyer && !input.closed;
  const lines = [
    "Your QR code still works.",
    canResend
      ? "You can send it to someone else from your ticket."
      : buyer
        ? `Tickets can be sent until ${TICKET_TRANSFER_RULES.cutoffBeforeStart} before the event starts.`
        : "Show it at the door as before.",
  ];
  const link = buyer ? ticketPageLink(site(siteUrl), input.orderId) : receivedTicketLink(siteUrl, input.fromTransferId ?? "");
  const buttons: KitButton[] = [
    { label: "View your ticket", href: link, kind: "primary" },
    ...(canResend ? [{ label: "Send to a friend", href: `${link}&send=${input.ticketNumber}`, kind: "secondary" as const }] : []),
  ];
  const footer = { siteUrl, tone: "customer" as const, reason: buyer ? BUYER_REASON : HOLDER_REASON };
  const html = page(subject, preheader, siteUrl, [
    kitHeader(),
    kitIntro(eyebrow, heading),
    kitNotice("What this means", lines.map(escapeHtml)),
    kitButtons(buttons),
    kitHelp("customer"),
    kitFooter(footer),
  ]);
  const text = ["SHELTÜH", "", eyebrow, heading, "", "WHAT THIS MEANS", ...lines, "", ...buttonsText(buttons), "", kitHelpText("customer"), "", kitFooterText(footer)].join("\n");
  return { to: input.to, subject, text: text.replaceAll("’", "'"), html, inlineImages: [ticketWordmarkImage()] };
}

// ---------------------------------------------------------------------------
// (e) The recipient's own ticket
// ---------------------------------------------------------------------------

export interface TransferTicketEmailInput {
  to: string;
  siteUrl: string;
  transferId: string;
  senderName: string;
  /** The recipient's own code (the transfer's issued_code). */
  code: string;
  event: EventRecord;
  ticket: TransferTicket;
}

export function buildTransferTicketEmail(input: TransferTicketEmailInput): EmailMessage {
  const { siteUrl, event, ticket } = input;
  const from = subjectLine(input.senderName);
  const caps = eventCaps(event.title);
  const subject = subjectLine(`Your ticket to ${caps}`);
  const eyebrow = `From ${from}`;
  const heading = "You’re in. Here’s your ticket.";
  const qr = ticketQr(input.code, 0);
  const cardEvent = ticketCardEvent(event, siteUrl);
  const card = ticketCard({
    siteUrl,
    title: event.title,
    event: cardEvent,
    code: input.code,
    typeName: typeLabel(ticket),
    ...(ticket.seat ? { seat: ticket.seat } : {}),
    qr,
    index: 0,
    total: 1,
    note: "Show this at the door",
  });
  const buttons: KitButton[] = [{ label: "View your ticket", href: receivedTicketLink(siteUrl, input.transferId), kind: "primary" }];
  const blocks = eventBlocks(event, siteUrl);
  const footer = { siteUrl, tone: "customer" as const, reason: HOLDER_REASON };
  const preheader = [cardEvent?.date ?? "", listed(event) ? (event.venueName?.trim() ?? "") : "", `From ${firstName(from)}`]
    .filter(Boolean)
    .join(" · ");
  const html = page(subject, preheader, siteUrl, [
    kitHeader(),
    kitIntro(eyebrow, heading),
    card,
    kitButtons(buttons),
    ...blocks.html,
    kitHelp("customer"),
    kitFooter(footer),
  ]);
  const text = [
    "SHELTÜH",
    "",
    eyebrow,
    heading,
    "",
    subjectLine(event.title),
    ...(cardEvent ? [cardEvent.venueLine, `Date: ${cardEvent.date} · Time: ${cardEvent.time}`] : []),
    ...(typeLabel(ticket) ? [`Ticket: ${typeLabel(ticket)}`] : []),
    ...(ticket.seat ? [`Seat: ${formatSeatLine(ticket.seat)}`] : []),
    `Show this code at the door: ${input.code}${qr ? " (the QR code is in the full email)" : ""}`,
    "",
    ...buttonsText(buttons),
    "",
    ...blocks.text,
    "",
    kitHelpText("customer"),
    "",
    kitFooterText(footer),
  ].join("\n");
  return {
    to: input.to,
    subject,
    text: text.replaceAll("’", "'"),
    html,
    inlineImages: [ticketWordmarkImage(), ...(qr ? qrImage(qr) : [])],
  };
}
