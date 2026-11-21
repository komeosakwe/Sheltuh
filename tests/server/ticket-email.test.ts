import { readFileSync } from "node:fs";
import path from "node:path";
import nodemailer from "nodemailer";
import { describe, expect, it } from "vitest";
import { googleCalendarUrl, outlookCalendarUrl } from "@/lib/calendar";
import { REFUND_ACL_STATEMENT } from "@/lib/refund-policy";
import { SUPPORT_REFUND_NOTE } from "@/lib/support";
import { mailOptions } from "@/lib/server/email";
import { TICKET_EMAIL_ASSETS, TICKET_EMAIL_COLOURS, TICKET_EMAIL_FONTS, TICKET_EMAIL_WALLET_BADGES } from "@/lib/server/email-ticket-layout";
import { TICKET_EMAIL_WORDMARK } from "@/lib/server/email-ticket-wordmark";
import { ticketQrPng } from "@/lib/server/qr-image";
import {
  buildTicketEmail,
  eventImageEmailUrl,
  EVENT_UNLISTED_TEXT,
  formatInfoTime,
  formatStubTime,
  formatTicketDate,
  formatTicketTime,
  orderReference,
  ticketAddressLine,
  ticketCalendarLinks,
  ticketDirectionsLink,
  TICKET_EMAIL_HTML_BUDGET,
  ticketEmailLineItems,
  ticketEmailRefundPolicy,
  ticketPageLink,
  ticketQrAlt,
  ticketVenueLine,
  ticketWalletLinks,
  ticketWhen,
  walletPassLink,
} from "@/lib/server/ticket-email";
import type { EventRecord, OrderRecord } from "@/lib/server/types";

/*
 * The ticket email (docs/design/ticket-email.md): "You're in. Here's your
 * ticket.", one full ticket card per issued code. Structure, copy, links,
 * group orders, the size budget and the plain-text part; the QR's decoding is
 * tests/ticket-qr-decode.test.tsx.
 */

const SITE = "https://sheltuh.com.au";

const event = {
  eventId: "00000000-0000-4000-8000-0000000000e1",
  slug: "paint-and-sip",
  title: "Paint & <Sip>",
  description: "Paint, sip and talk. Bring a friend.",
  venueName: "Studio 5",
  venueAddress: "5 Smith St, Fitzroy",
  suburb: "Fitzroy",
  state: "VIC",
  startsAt: "2027-03-06T09:00:00.000Z", // 8:00 pm AEDT
  endsAt: "2027-03-06T11:00:00.000Z", // 10:00 pm AEDT
  status: "published",
} as EventRecord;

const order = {
  orderId: "ord_abc",
  buyerEmail: "fan@example.com",
  status: "paid",
  totalCents: 6400,
  tickets: [
    { ticketCode: "ABCD-EFGH", ticketTypeId: "ga", ticketTypeName: "GA" },
    { ticketCode: "JKLM-NPQR", ticketTypeId: "ga", ticketTypeName: "GA" },
  ],
} as OrderRecord;

/** The design's fixture (Latte's 1120 ticket email): HERE & NOW, one "Second release" ticket, A$23.00 + A$2.94 booking fee = A$25.94, #A90133C9. */
const mockEvent = {
  ...event,
  slug: "here-and-now",
  title: "HERE & NOW",
  venueName: "Interconnect Studio",
  venueAddress: "16 Catherine St",
  suburb: "Coburg North",
  state: "VIC",
  startsAt: "2026-11-14T06:00:00.000Z", // Sat 14 Nov 2026, 5:00 pm AEDT
  endsAt: "2026-11-14T10:00:00.000Z", // 9:00 pm AEDT
  organiserId: "org_herenow",
  organiserName: "Here & Now Collective",
} as EventRecord;
const mockOrder = {
  orderId: "ord_a90133c95b3d4f6e9a182d4c6b8e0f13",
  buyerEmail: "fan@example.com",
  status: "paid",
  totalCents: 2594,
  subtotalCents: 2300,
  buyerFeeCents: 294,
  createdAt: "2026-11-12T10:41:00.000Z", // 9:41 pm AEDT
  lineItems: [{ ticketTypeId: "t2", ticketTypeName: "Second release", unitPriceCents: 2300, feePolicy: "buyer-pays", quantity: 1 }],
  tickets: [{ ticketCode: "BPT7-7P6W", ticketTypeId: "t2", ticketTypeName: "Second release" }],
} as OrderRecord;
const BUILT = new Date("2026-11-01T00:00:00.000Z");
const BOTH = { google: true, apple: true };

const IMAGE_PATH = "/api/events/00000000-0000-4000-8000-000000000001/image?v=1730000000";
const withImage = { ...event, imageUrl: IMAGE_PATH } as EventRecord;
const WORDMARK_CID = "sheltuh-wordmark@sheltuh.com.au";
/** Each ticket card's opening, so cards can be counted and split. */
const CARD = 'bgcolor="#ff4800" class="ticket"';
const cardsOf = (html: string) => html.split(CARD).slice(1);
const qrImages = (email: ReturnType<typeof buildTicketEmail>) => (email.inlineImages ?? []).filter((image) => image.cid.startsWith("ticket-qr-"));
const visibleText = (html: string) =>
  html
    .replace(/<style[\s\S]*?<\/style>/g, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&#38;/g, "&")
    .replace(/&#39;/g, "'")
    .replace(/&middot;/g, "·")
    .replace(/&nbsp;/g, " ")
    .replace(/&rsquo;/g, "’")
    .replace(/&Uuml;/g, "Ü")
    .replace(/&rarr;/g, "→")
    .replace(/&#8599;/g, "↗")
    .replace(/\s+/g, " ");
const esc = (s: string) => s.replaceAll("&", "&#38;");

describe("buildTicketEmail: the design's fixture, top to bottom", () => {
  const email = buildTicketEmail(mockOrder, { ...mockEvent, imageUrl: IMAGE_PATH } as EventRecord, SITE, BUILT, BOTH);
  const text = visibleText(email.html);

  it("reads in the design's order, word for word", () => {
    const sequence = [
      "Order #A90133C9 · Confirmed",
      "Hi, you’re in. Here’s your ticket.",
      "ADMIT ONE · SHELTÜH",
      "HERE & NOW",
      "Interconnect Studio · Coburg North",
      "Date",
      "Sat 14 Nov",
      "Time",
      "5–9 pm",
      "Ticket",
      "Second release",
      "BPT7-7P6W",
      "Show this at the door · ticket 1 of 1",
      // The wallet badges' words are their images' alt text (the "official badges" test below), then Apple's note.
      "To add your ticket to Apple Wallet, open this email on your iPhone or Mac.",
      "View your ticket →",
      "Manage order",
      "Saturday 14 November 2026",
      "5:00 – 9:00 pm AEDT",
      "Add to calendar: Google · Apple · Outlook",
      "Interconnect Studio",
      "16 Catherine St, Coburg North VIC",
      "Get directions ↗",
      "Event info",
      "Line-up, door times and what to bring",
      "View event info",
      "Hosted by Here & Now Collective",
      "Questions about the event? Ask the organiser.",
      "Contact organiser",
      "Order summary",
      "Order reference",
      "#A90133C9",
      "Order date",
      "12 Nov 2026, 9:41 pm",
      "1 × Second release",
      "A$23.00",
      "Booking fee",
      "A$2.94",
      "Total paid",
      "A$25.94",
      `No refunds for change of mind. ${REFUND_ACL_STATEMENT}`,
      "Going with friends?",
      "Send them the event so you can go together.",
      "WhatsApp",
      "Messages",
      "Email",
      "Share page",
      "Need a hand? support@sheltuh.com.au",
      "Find your place, find your people.",
      "SHELTÜH · MELBOURNE",
      "Privacy policy · Terms · Help centre",
      "You’re getting this email because you bought a ticket on Sheltüh.",
    ];
    let at = -1;
    for (const piece of sequence) {
      const next = text.indexOf(piece, at + 1);
      expect(next, piece).toBeGreaterThan(at);
      at = next;
    }
  });

  it("has no footer legal line, no Copy link, and nothing from the mock that isn't real", () => {
    for (const gone of ["Pty Ltd", "ABN", "Naarm", "Copy link", "XX XXX", "2nd release", "lorem"]) {
      expect(email.html).not.toContain(gone);
      expect(email.text).not.toContain(gone);
    }
  });

  it("is light only, at most 600px wide, with the self-hosted Instrument Sans and IBM Plex Mono and their fallbacks", () => {
    const { html } = email;
    expect(html).toContain('<html lang="en-AU"');
    expect(html).toContain('<meta name="color-scheme" content="light">');
    expect(html).toContain('<meta name="supported-color-schemes" content="light">');
    expect(html).toContain("color-scheme:light;supported-color-schemes:light");
    // Latte's 1120 frames: a white 600px column on the cream page.
    expect(html).toContain('bgcolor="#ffffff" style="width:100%;max-width:600px;background-color:#ffffff"');
    expect(html).toContain('<body bgcolor="#fffae7"');
    expect(html).toContain("font-family:'Instrument Sans',Arial,Helvetica,sans-serif");
    expect(html).toContain("font-family:'IBM Plex Mono','Courier New',monospace");
    for (const file of Object.values(TICKET_EMAIL_FONTS)) {
      expect(html).toContain(`src:url('https://sheltuh.com.au${file}') format('woff2')`);
      expect(readFileSync(path.join(process.cwd(), "public", file)).subarray(0, 4).toString("ascii")).toBe("wOF2");
    }
    for (const licence of ["public/fonts/instrument-sans/OFL.txt", "public/fonts/ibm-plex-mono/OFL.txt"]) {
      expect(readFileSync(path.join(process.cwd(), licence), "utf8")).toContain("SIL Open Font License");
    }
    // Never a third-party font host; the mso block pins Outlook to Arial.
    expect(html).not.toMatch(/fonts\.googleapis|fonts\.gstatic|@import/);
    expect(html).toContain("<!--[if mso]><style>body,table,td,p,a,h1,h2,span{font-family:Arial,sans-serif!important}</style><![endif]-->");
    // No layout email clients drop.
    expect(html).not.toMatch(/display:\s*(flex|grid)|<script|background-image/i);
    // A local http site gets no web fonts (the fallbacks alone).
    expect(buildTicketEmail(order, event, "http://127.0.0.1:3000").html).not.toContain("@font-face");
  });

  it("has the phone values in one @media (max-width:620px) block", () => {
    const media = email.html.match(/@media only screen and \(max-width:620px\)\{([\s\S]*?)\n\}/)?.[1] ?? "";
    for (const rule of [
      ".pg{padding:34px 16px 40px 16px!important}",
      ".tx{padding-left:16px!important;padding-right:16px!important}",
      ".qr{width:231px!important;height:231px!important}",
      ".ei{max-height:144px!important}",
      ".sd{display:none!important}",
      ".bt{padding:14px 4px!important}",
    ]) {
      expect(media).toContain(rule);
    }
  });

  it("uses only the design's colours, Signal Orange as text only in the eyebrow", () => {
    const colours = new Set(email.html.match(/#[0-9a-fA-F]{6}\b/g)?.map((c) => c.toLowerCase()));
    for (const colour of colours) expect(Object.values<string>(TICKET_EMAIL_COLOURS)).toContain(colour);
    // Latte's eyebrow: IBM Plex Mono Medium 14/20, Signal Orange (owner rule 21 Nov: the frames win; contrast logged for the owner).
    expect(email.html).toMatch(/font-size:14px;line-height:20px;font-weight:500;color:#ff4800;letter-spacing:0\.56px[^"]*">Order #A90133C9 · Confirmed<\/p>/);
    expect(email.html.match(/(?<!-)color:#ff4800/g)).toHaveLength(1);
    // The ticket card keeps its darker orange venue line (the card is unchanged).
    expect(email.html).toMatch(/font-size:11px;line-height:16px;font-weight:500;color:#d03e00;letter-spacing:0\.12em;text-transform:uppercase[^"]*">Interconnect Studio · Coburg North<\/p>/);
  });

  it("one h1, and h2s for Order summary and Going with friends?", () => {
    expect(email.html.match(/<h1/g)).toHaveLength(1);
    expect(email.html).toContain(">Hi, you’re in. Here’s your ticket.</h1>");
    expect([...email.html.matchAll(/<h2[^>]*>([^<]*)<\/h2>/g)].map((m) => m[1])).toEqual(["Order summary", "Going with friends?"]);
  });

  it("every layout table is presentational, and every image has its size and alt text", () => {
    for (const table of email.html.match(/<table[^>]*>/g) ?? []) expect(table).toContain('role="presentation"');
    for (const tag of email.html.match(/<img [^>]*>/g) ?? []) {
      expect(tag).toMatch(/ width="\d+"/);
      expect(tag).toMatch(/ alt="[^"]*"/);
      // Only the event's photo has no height (its proportions aren't stored).
      if (!tag.includes("/api/events/")) expect(tag).toMatch(/ height="\d+"/);
    }
  });
});

describe("the ticket card", () => {
  it("an orange frame (a cell's bgcolor, so Outlook draws it) round a white inside: stripes, ADMIT ONE · SHELTÜH, image, title, venue, perforation, stub, QR, code, note", () => {
    const { html } = buildTicketEmail(mockOrder, { ...mockEvent, imageUrl: IMAGE_PATH } as EventRecord, SITE, BUILT);
    const [card] = cardsOf(html);
    expect(html).toContain(`<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" ${CARD} style="background-color:#ff4800;border-radius:15px;border-collapse:separate"><tr><td style="padding:12px">`);
    expect(card).toContain('bgcolor="#ffffff" style="background-color:#ffffff;border-radius:7px');
    const sequence = [
      `src="${SITE}${TICKET_EMAIL_ASSETS.stripesDesktop}" width="112" height="14" alt=""`,
      `src="${SITE}${TICKET_EMAIL_ASSETS.stripesPhone}" width="72" height="14" alt=""`,
      ">ADMIT ONE &middot; SHELT&Uuml;H</td>",
      `src="${SITE}${IMAGE_PATH}"`,
      ">HERE &#38; NOW</p>",
      ">Interconnect Studio · Coburg North</p>",
      `src="${SITE}${TICKET_EMAIL_ASSETS.notchLeft}" width="12" height="24" alt=""`,
      "border-top:1.5px dashed #000000",
      `src="${SITE}${TICKET_EMAIL_ASSETS.notchRight}" width="12" height="24" alt=""`,
      ">Date</p>",
      ">Sat 14 Nov</p>",
      ">Time</p>",
      ">5–9 pm</p>",
      ">Ticket</p>",
      ">Second release</p>",
      'src="cid:ticket-qr-1@sheltuh.com.au"',
      ">BPT7-7P6W</p>",
      ">Show this at the door &middot; ticket 1 of 1</p>",
    ];
    let at = -1;
    for (const piece of sequence) {
      const next = card.indexOf(piece, at + 1);
      expect(next, piece).toBeGreaterThan(at);
      at = next;
    }
    // The phone's stripes stay hidden unless the media query shows them, and Outlook never draws them.
    expect(card).toContain('<!--[if !mso]><!--><div class="sm" style="display:none;max-height:0;overflow:hidden;mso-hide:all">');
  });

  it("the event image: the site's own https URL, 464 wide, cropped to 2:1 where the client can, with alt text", () => {
    const { html } = buildTicketEmail(order, withImage, SITE);
    const tag = html.match(/<img src="https:\/\/sheltuh\.com\.au\/api\/events\/[^"]+"[^>]*>/)?.[0] ?? "";
    expect(tag).toContain('width="464"');
    expect(tag).not.toContain("height=");
    expect(tag).toContain('alt="Event image for Paint &#38; &#60;Sip&#62;"');
    expect(tag).toContain("width:100%;max-width:464px;height:auto;aspect-ratio:2/1;object-fit:cover;border-radius:4px;");
    expect(html).toContain('<div class="ei" style="max-height:232px;overflow:hidden;border-radius:4px">');
    // Its subject stays in frame where it's cropped.
    const focused = buildTicketEmail(order, { ...withImage, imageFocus: { x: 30, y: 70 } } as EventRecord, SITE).html;
    expect(focused).toContain("object-fit:cover;object-position:30% 70%;border-radius:4px;");
    // Remote images are only on our own origin, and none carries anything about the order or buyer.
    const remote = [...html.matchAll(/src="(https?:[^"]+)"/g)].map((m) => m[1]);
    expect(remote.length).toBeGreaterThan(0);
    for (const url of remote) {
      expect(url.startsWith(`${SITE}/`)).toBe(true);
      expect(url).not.toMatch(/ord_|fan@|ABCD|JKLM/);
    }
  });

  it("leaves the image row out when there's none, the site isn't https, or the event isn't listed", () => {
    for (const [e, site] of [
      [event, SITE],
      [withImage, "http://127.0.0.1:3000"],
      [{ ...withImage, status: "draft" }, SITE],
    ] as const) {
      const { html } = buildTicketEmail(order, e as EventRecord, site);
      expect(html).not.toContain("/api/events/");
      expect(html).not.toContain("Event image");
      expect(html).not.toContain('class="ei"');
    }
  });

  it("one full card per issued code: each its own number, QR and code, none dropped", () => {
    const codes = ["K7QM-2XPD", "R4TN-9WJC", "B8VF-3HLZ", "M2GD-6SYA"];
    const four = { ...order, tickets: codes.map((code, i) => ({ ticketCode: code, ticketTypeId: "t", ticketTypeName: i === 3 ? "VIP" : "GA" })) } as OrderRecord;
    const email = buildTicketEmail(four, event, SITE);
    const cards = cardsOf(email.html);
    expect(cards).toHaveLength(4);
    for (const [i, card] of cards.entries()) {
      expect(card).toContain(`>${codes[i]}</p>`);
      expect(card).toContain(`>${i === 3 ? "VIP" : "GA"}</p>`);
      expect(card).toContain(`ticket ${i + 1} of 4</p>`);
      expect(card.match(/<img class="qr" src="cid:ticket-qr-/g)).toHaveLength(1);
      expect(card).toContain(`cid:ticket-qr-${i + 1}@sheltuh.com.au`);
      // Every card is a whole ticket: the event's title, venue, date and time on each.
      for (const piece of [">Paint &#38; &#60;Sip&#62;</p>", ">Studio 5 · Fitzroy</p>", ">Sat 6 Mar</p>", ">8–10 pm</p>"]) expect(card).toContain(piece);
    }
    expect(email.html).toContain(">Hi, you’re in. Here are your 4 tickets.</h1>");
    expect(email.html).toContain(">View your tickets&nbsp;&nbsp;");
    expect(qrImages(email).map((q) => q.cid)).toEqual(codes.map((_, i) => `ticket-qr-${i + 1}@sheltuh.com.au`));
  });

  it("group tickets: one card per person, ADMIT ONE on each, the group position in the TICKET column", () => {
    const group = {
      ...order,
      tickets: ["A2B3-C4D5", "E6F7-G8H9", "J2K3-L4M5"].map((code, i) => ({
        ticketCode: code,
        ticketTypeId: "g",
        ticketTypeName: "Group of 3",
        group: { number: 1, position: i + 1, size: 3 },
      })),
    } as unknown as OrderRecord;
    const { html, text } = buildTicketEmail(group, event, SITE);
    const cards = cardsOf(html);
    expect(cards).toHaveLength(3);
    for (const [i, card] of cards.entries()) {
      expect(card).toContain("ADMIT ONE");
      expect(card).toContain(`ticket ${i + 1} of 3</p>`);
      expect(card).toMatch(/>Group of 3 \([^)]*\)<\/p>/);
    }
    expect(text).toMatch(/Ticket 2 of 3 · Group of 3 \([^)]*\) — Entry code: E6F7-G8H9/);
  });

  it("a seated ticket's card has a SEAT row after the stub, before the QR (HTML and plain text)", () => {
    const seated = { ...order, tickets: [{ ...order.tickets[0], seat: { section: "Stalls", row: "F", seat: "12", kind: "standard" } }] } as OrderRecord;
    const { html, text } = buildTicketEmail(seated, event, SITE);
    const [card] = cardsOf(html);
    const seatAt = card.indexOf(">Stalls · Row F · Seat 12</p>");
    expect(card.indexOf(">Seat</p>")).toBeGreaterThan(card.indexOf(">GA</p>"));
    expect(seatAt).toBeGreaterThan(card.indexOf(">Seat</p>"));
    expect(card.indexOf("cid:ticket-qr-1@")).toBeGreaterThan(seatAt);
    expect(text).toContain("Ticket 1 of 1 — Entry code: ABCD-EFGH (show this at the door; the QR code is in the full email)\nSeat: Stalls, Row F, Seat 12");
  });

  it("prints the ticket type as entered, never abbreviated, and leaves the column out when there's none", () => {
    const long = { ...mockOrder, tickets: [{ ...mockOrder.tickets[0], ticketTypeName: "Second release (limited)" }] } as OrderRecord;
    expect(buildTicketEmail(long, mockEvent, SITE).html).toContain(">Second release (limited)</p>");
    const untyped = buildTicketEmail({ ...order, tickets: [{ ...order.tickets[0], ticketTypeName: "" }] }, event, SITE);
    const [card] = cardsOf(untyped.html);
    expect(card).not.toContain(">Ticket</p>");
    expect(card).toContain(">Date</p>");
    expect(untyped.text).not.toContain("Ticket: ");
  });

  it("a code that isn't a real one: no QR or attachment, the code larger as the Entry code", () => {
    const bad = { ...order, tickets: [{ ticketCode: "abcd-efgh", ticketTypeId: "t", ticketTypeName: "GA" }] } as OrderRecord;
    const email = buildTicketEmail(bad, event, SITE);
    expect(email.inlineImages?.map((i) => i.cid)).toEqual([WORDMARK_CID]);
    expect(email.html).not.toContain("cid:ticket-qr");
    expect(email.html).toContain(">Entry code</p>");
    expect(email.html).toMatch(/font-size:24px;line-height:32px;font-weight:600[^"]*">abcd-efgh<\/p>/);
    expect(email.html).toContain("Order #ABC&nbsp;&zwnj;"); // the preheader
    expect(email.text).toContain("Entry code: abcd-efgh (show this at the door)");
  });

  it("only gives QR codes to the real codes in a mixed order", () => {
    const mixed = {
      ...order,
      tickets: [
        { ticketCode: "AAAA-1111", ticketTypeId: "t", ticketTypeName: "GA" }, // 1 isn't in the alphabet
        { ticketCode: "BBBB-2222", ticketTypeId: "t", ticketTypeName: "GA" },
      ],
    } as OrderRecord;
    const email = buildTicketEmail(mixed, event, SITE);
    expect(qrImages(email).map((i) => i.cid)).toEqual(["ticket-qr-2@sheltuh.com.au"]);
    expect(email.html).not.toContain("QR code for ticket AAAA-1111");
    expect(email.html).toContain('alt="QR code for ticket BBBB-2222. If it doesn&#39;t show, use the backup code below."');
  });
});

describe("QR codes", () => {
  it("each real code's QR (with the centre ü) inline under a numbered cid, shown at 264px (231 on a phone), on white, with alt text pointing at the backup code", () => {
    const email = buildTicketEmail(order, event, SITE);
    const images = qrImages(email);
    expect(images.map((i) => i.cid)).toEqual(["ticket-qr-1@sheltuh.com.au", "ticket-qr-2@sheltuh.com.au"]);
    for (const [i, code] of ["ABCD-EFGH", "JKLM-NPQR"].entries()) {
      const tag = email.html.match(new RegExp(`<img class="qr" src="cid:ticket-qr-${i + 1}@sheltuh\\.com\\.au"[^>]*>`))?.[0] ?? "";
      expect(tag).toContain(`alt="QR code for ticket ${code}. If it doesn&#39;t show, use the backup code below."`);
      expect(ticketQrAlt(code)).toBe(`QR code for ticket ${code}. If it doesn't show, use the backup code below.`);
      expect(tag).toContain('width="264" height="264"');
      expect(tag).toContain("width:264px;max-width:100%;height:auto");
      expect(tag).toContain("background-color:#ffffff");
      // The backup code straight under it: the PNG's own 4-module white margin is the space (owner decision P2).
      const card = cardsOf(email.html)[i];
      expect(card.indexOf(`>${code}</p>`)).toBeGreaterThan(card.indexOf(tag));
      expect(images[i].contentType).toBe("image/png");
      expect(images[i].filename).toBe(`ticket-${i + 1}-qr.png`);
      expect(images[i].filename).not.toContain(code);
      expect(images[i].content.equals(ticketQrPng(code)!.png)).toBe(true);
    }
  });

  it("builds identical images and HTML every time, so an outbox retry sends the same email", () => {
    const first = buildTicketEmail(order, event, SITE, BUILT, BOTH);
    const second = buildTicketEmail(order, event, SITE, BUILT, BOTH);
    expect(second.html).toBe(first.html);
    expect(second.text).toBe(first.text);
    expect(second.inlineImages).toEqual(first.inlineImages);
  });

  it("sends the wordmark and the QR codes as inline parts of a multipart/related message", async () => {
    const transport = nodemailer.createTransport({ streamTransport: true, buffer: true, newline: "\n" });
    const email = buildTicketEmail(order, event, SITE);
    const info = await transport.sendMail(mailOptions("tickets@sheltuh.com.au", email));
    const raw = (info.message as Buffer).toString("utf8");
    expect(raw).toMatch(/Content-Type: multipart\/related/);
    for (const image of email.inlineImages ?? []) {
      expect(raw).toContain(`Content-ID: <${image.cid}>`);
      expect(raw).toContain(image.content.toString("base64").slice(0, 60));
    }
    expect(raw.match(/Content-Disposition: inline/g)?.length).toBe(1 + order.tickets.length);
    expect(raw).not.toMatch(/Content-Disposition: attachment/);
  });
});

describe("the wordmark and the hosted images", () => {
  it("the wordmark: Signal Orange on transparent, inline (cid), 106 x 24 at the top and 88 x 20 in the footer, alt Sheltüh", () => {
    const email = buildTicketEmail(order, event, SITE);
    const wordmark = email.inlineImages?.[0];
    expect(wordmark?.cid).toBe(WORDMARK_CID);
    expect(wordmark?.filename).toBe("sheltuh.png");
    expect(wordmark?.content.equals(Buffer.from(TICKET_EMAIL_WORDMARK.pngBase64, "base64"))).toBe(true);
    const tags = email.html.match(new RegExp(`<img src="cid:${WORDMARK_CID}"[^>]*>`, "g")) ?? [];
    expect(tags).toHaveLength(2);
    const [header = "", footer = ""] = tags;
    expect(header).toContain('width="106" height="24" alt="Sheltüh"');
    expect(footer).toContain('width="88" height="20" alt="Sheltüh"');
    expect(email.html.indexOf(header)).toBeLessThan(email.html.indexOf("Order #ABC · Confirmed"));
  });

  it("the wordmark is the PNG shipped in public/email/ticket, at 2x", () => {
    const shipped = readFileSync(path.join(process.cwd(), "public/email/ticket/wordmark.png"));
    const png = Buffer.from(TICKET_EMAIL_WORDMARK.pngBase64, "base64");
    expect(png.equals(shipped)).toBe(true);
    expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([212, 48]);
  });

  it("the hosted decorations exist in public/, at 2x their shown size", () => {
    const sizes: Record<string, [number, number]> = {
      stripesDesktop: [224, 28],
      stripesPhone: [144, 28],
      notchLeft: [24, 48],
      notchRight: [24, 48],
      calendar: [40, 40],
      pin: [40, 40],
      info: [40, 40],
    };
    for (const [name, file] of Object.entries(TICKET_EMAIL_ASSETS)) {
      const png = readFileSync(path.join(process.cwd(), "public", file));
      expect([png.readUInt32BE(16), png.readUInt32BE(20)], name).toEqual(sizes[name]);
    }
  });
});

describe("wallet buttons (ticketWalletLinks; the outbox passes which wallets are on)", () => {
  const link = (provider: "apple" | "google", n: number) => `${SITE}/api/orders/by-session/ord_abc/wallet/${provider}?ticket=${n}`;
  const pattern = (s: string) => s.replace(/[.?]/g, "\\$&");

  it("none by default (no wallet on)", () => {
    const { html, text } = buildTicketEmail(order, event, SITE);
    for (const body of [html, text]) {
      expect(body).not.toContain("/wallet/");
      expect(body).not.toMatch(/Add to (Apple|Google) Wallet/);
    }
  });

  it("under each ticket's card, its own number's route (1-based), Apple's then Google's, in the vendors' wording", () => {
    const { html, text } = buildTicketEmail(order, event, SITE, BUILT, BOTH);
    for (const [i, card] of cardsOf(html).entries()) {
      const n = i + 1;
      const apple = card.indexOf(`href="${link("apple", n)}"`);
      expect(apple).toBeGreaterThan(card.indexOf(`ticket ${n} of 2</p>`));
      expect(card.indexOf(`href="${link("google", n)}"`)).toBeGreaterThan(apple);
      expect(card).toContain(`aria-label="Add to Apple Wallet: ticket ${n} of 2"`);
      expect(card).toContain(`aria-label="Add to Google Wallet: ticket ${n} of 2"`);
    }
    expect(text).toContain(
      [
        "Ticket 1 of 2 · GA — Entry code: ABCD-EFGH (show this at the door; the QR code is in the full email)",
        `Add to Apple Wallet: ${link("apple", 1)}`,
        `Add to Google Wallet: ${link("google", 1)}`,
      ].join("\n"),
    );
    expect(walletPassLink(SITE, "ord_abc", "google", 2)).toBe(link("google", 2));
  });

  it("both are the vendors' official badges (hosted PNGs of their SVGs), never text: alt in their words, in their pass links, the same height", () => {
    const { html } = buildTicketEmail(order, event, SITE, BUILT, BOTH);
    for (const [i, card] of cardsOf(html).entries()) {
      const n = i + 1;
      for (const [provider, words, file, width] of [
        ["apple", "Add to Apple Wallet", "apple-wallet-badge", 152],
        ["google", "Add to Google Wallet", "google-wallet-badge", 174],
      ] as const) {
        const anchor = card.match(new RegExp(`<a class="wa" href="${pattern(link(provider, n))}"[^>]*>([\\s\\S]*?)</a>`));
        expect(anchor, `${provider} ${n}`).not.toBeNull();
        const [whole, inside] = anchor!;
        expect(whole).toContain(`aria-label="${words}: ticket ${n} of 2"`);
        // No words of its own: one image, the badge.
        expect(inside.replace(/<[^>]+>/g, "").trim()).toBe("");
        expect(inside.match(/<img [^>]*>/g)).toEqual([
          expect.stringContaining(
            `<img class="wb" src="${SITE}/email/ticket/${file}@2x.png" srcset="${SITE}/email/ticket/${file}@3x.png 3x" width="${width}" height="48" alt="${words}" style="display:block;border:0;width:${width}px;max-width:100%;height:auto;`,
          ),
        ]);
      }
      // No colour behind them (their corners are transparent): plain cells.
      expect(card).not.toMatch(/<td bgcolor="#000000"[^>]*><a class="wa"/);
    }
    // On a phone both are 46px tall, at their own proportions.
    expect(html.match(/@media only screen and \(max-width:620px\)\{([\s\S]*?)\n\}/)?.[1]).toContain(".wb{width:auto!important;height:46px!important}");
    expect(visibleText(html)).not.toMatch(/Add to (Apple|Google) Wallet/);
  });

  it("Apple's note, once under the last card's badges and in the plain text: how to add from a device without Wallet", () => {
    const { html, text } = buildTicketEmail(order, event, SITE, BUILT, BOTH);
    const note = "To add your tickets to Apple Wallet, open this email on your iPhone or Mac.";
    expect(html.split(note)).toHaveLength(2);
    const cards = cardsOf(html);
    expect(cards[0]).not.toContain(note);
    expect(cards[1]).toContain(`text-align:center;padding-top:12px">${note}</p>`);
    expect(text.split(note)).toHaveLength(2);
    // Not without Apple's badge.
    const google = buildTicketEmail(order, event, SITE, BUILT, { google: true, apple: false });
    expect(google.html + google.text).not.toContain("Apple Wallet");
  });

  it("the wallet PNGs are the vendors' SVGs rendered at 2x and 3x the 48px shown, at their own proportions, transparent outside", () => {
    for (const [svg, shown, width, height] of [
      ["public/wallet/badges/US-UK_Add_to_Apple_Wallet_RGB_101421.svg", TICKET_EMAIL_WALLET_BADGES.apple, 110.739, 35.016],
      ["public/wallet/badges/enAU_add_to_google_wallet_add-wallet-badge.svg", TICKET_EMAIL_WALLET_BADGES.google, 199, 55],
    ] as const) {
      expect(readFileSync(path.join(process.cwd(), svg), "utf8")).toContain(`viewBox="0 0 ${width} ${height}"`);
      expect(shown.height).toBe(48);
      // Shown at the artwork's proportions, to within rounding (under half a pixel).
      expect(Math.abs((shown.height * width) / height - shown.width)).toBeLessThan(0.5);
      for (const [file, scale] of [[shown.x2, 2], [shown.x3, 3]] as const) {
        const png = readFileSync(path.join(process.cwd(), "public", file));
        expect(png.readUInt32BE(20), file).toBe(48 * scale);
        expect(Math.abs(png.readUInt32BE(16) - (48 * scale * width) / height), file).toBeLessThanOrEqual(1);
        // Colour type 6: RGBA, so the corners outside the badge stay transparent.
        expect(png[25], file).toBe(6);
      }
    }
  });

  it("only the wallets that are on", () => {
    const google = buildTicketEmail(order, event, SITE, BUILT, { google: true, apple: false });
    expect(google.html).toContain('alt="Add to Google Wallet"');
    expect(google.html).toContain(`href="${link("google", 1)}"`);
    expect(google.html).not.toContain("Apple Wallet");
    expect(google.text).not.toContain("Apple Wallet");
  });

  it("none for an event that isn't listed, or an order that isn't paid (the routes would 404)", () => {
    for (const status of ["draft", "pending_review", "rejected"] as const) {
      const { html, text } = buildTicketEmail(order, { ...event, status }, SITE, BUILT, BOTH);
      expect(html).not.toContain("/wallet/");
      expect(text).not.toContain("/wallet/");
      expect(ticketWalletLinks(order, { status }, SITE, BOTH, 0)).toEqual([]);
    }
    for (const status of ["pending", "refunded"] as const) {
      expect(ticketWalletLinks({ ...order, status }, event, SITE, BOTH, 0)).toEqual([]);
      expect(buildTicketEmail({ ...order, status }, event, SITE, BUILT, BOTH).html).not.toContain("/wallet/");
    }
    const odd = buildTicketEmail({ ...order, orderId: "ord_a/b&c" }, event, SITE, BUILT, BOTH);
    expect(odd.html).toContain(`href="${SITE}/api/orders/by-session/ord_a%2Fb%26c/wallet/apple?ticket=1"`);
  });
});

describe("the buttons", () => {
  it("View your ticket(s) → (orange, black label, Latte's 56px email CTA) and Manage order (1.5px outline): both the order's existing ticket page, Outlook-safe", () => {
    for (const [tickets, label] of [
      [[order.tickets[0]], "View your ticket"],
      [order.tickets, "View your tickets"],
    ] as const) {
      const { html, text } = buildTicketEmail({ ...order, tickets: [...tickets] }, event, SITE);
      const page = ticketPageLink(SITE, "ord_abc");
      expect(page).toBe(`${SITE}/checkout/success?session_id=ord_abc`);
      const href = page.replace(/[.?]/g, "\\$&");
      expect(html).toMatch(
        new RegExp(`<td align="center" bgcolor="#ff4800" style="background-color:#ff4800;border-radius:8px;mso-padding-alt:16px 24px"><a class="kbp" href="${href}" style="display:block;padding:16px 24px;font-family:[^"]*;font-size:18px;line-height:24px;font-weight:500;color:#000000[^"]*">${label}&nbsp;&nbsp;<span[^>]*>&rarr;</span></a>`),
      );
      // Its table keeps separate borders: in the collapsed model the stroke ignores the radius (square corners).
      expect(html).toMatch(
        new RegExp(`<table [^>]*style="border-collapse:separate"><tr><td align="center" bgcolor="#ffffff" style="background-color:#ffffff;border:1\\.5px solid #000000;border-radius:8px;mso-padding-alt:14px 24px"><a class="kbs" href="${href}" style="display:block;padding:14\\.5px 24px;[^"]*">Manage order</a>`),
      );
      // The text fallback is only in the plain-text part.
      expect(text).toContain(`${label}: ${page}\nManage order: ${page}\n(Button not working? Use the links above.)`);
      expect(html).not.toContain("Button not working");
      expect(html.replace(/href="[^"]*"/g, "")).not.toContain("ord_abc");
    }
  });
});

describe("the info rows", () => {
  it("When: the long date, the time line and Google · Apple · Outlook calendar links (the label not underlined)", () => {
    const email = buildTicketEmail(mockOrder, mockEvent, SITE, BUILT);
    const links = ticketCalendarLinks(mockEvent, SITE);
    const url = `${SITE}/events/here-and-now`;
    const entry = {
      id: mockEvent.eventId,
      slug: "here-and-now",
      title: "HERE & NOW",
      description: mockEvent.description,
      venueName: "Interconnect Studio",
      venueAddress: "16 Catherine St",
      startsAt: mockEvent.startsAt,
      endsAt: mockEvent.endsAt,
    };
    expect(links).toEqual({ google: googleCalendarUrl(entry, url), apple: `${SITE}/events/here-and-now/calendar.ics`, outlook: outlookCalendarUrl(entry, url) });
    expect(links.outlook).toMatch(/^https:\/\/outlook\.live\.com\/calendar\/0\/deeplink\/compose\?path=\/calendar\/action\/compose&rru=addevent&/);
    expect(links.google).toMatch(/^https:\/\/calendar\.google\.com\/calendar\/render\?action=TEMPLATE&/);
    const anchor = (href: string, title: string, label: string) =>
      `<a href="${esc(href)}" title="${title}" style="color:#000000;text-decoration:underline;text-underline-offset:2px">${label}</a>`;
    // P3: "Add to calendar:" itself isn't underlined; only the three links are.
    expect(email.html).toContain(
      `font-size:15px;line-height:22px;font-weight:600;color:#000000">Add to calendar: ${anchor(links.google!, "Add to Google Calendar", "Google")} &middot; ${anchor(links.apple!, "Add to Apple Calendar", "Apple")} &middot; ${anchor(links.outlook!, "Add to Outlook Calendar", "Outlook")}</p>`,
    );
    expect(email.html).toContain(">Saturday 14 November 2026</p>");
    expect(email.html).toContain(">5:00 – 9:00 pm AEDT</p>");
    expect(email.text).toContain(`Saturday 14 November 2026, 5:00 – 9:00 pm AEDT\nAdd to calendar — Google: ${links.google} · Apple: ${links.apple} · Outlook: ${links.outlook}`);
  });

  it("Where: the venue, the address with suburb and state, and Get directions", () => {
    const email = buildTicketEmail(mockOrder, mockEvent, SITE);
    const directions = ticketDirectionsLink(mockEvent)!;
    expect(email.html).toContain(">Interconnect Studio</p>");
    expect(email.html).toContain(">16 Catherine St, Coburg North VIC</p>");
    expect(email.html).toContain(`<a href="${esc(directions)}" style="color:#000000;text-decoration:underline;text-underline-offset:2px">Get directions&nbsp;&#8599;</a>`);
    expect(email.text).toContain(`Interconnect Studio, 16 Catherine St, Coburg North VIC\nGet directions: ${directions}`);
  });

  it("Event info: links the event's public page; Hosted by links the organiser's page; hosted, decorative icons in 40px grey circles", () => {
    const email = buildTicketEmail(mockOrder, mockEvent, SITE);
    expect(email.html).toContain(`<a href="${SITE}/events/here-and-now" style="color:#000000;text-decoration:underline;text-underline-offset:2px">View event info</a>`);
    expect(email.html).toContain(`<a href="${SITE}/organisers/org_herenow" style="color:#000000;text-decoration:underline;text-underline-offset:2px">Contact organiser</a>`);
    expect(email.text).toContain(`Hosted by Here & Now Collective. Questions about the event? Ask the organiser: ${SITE}/organisers/org_herenow`);
    expect(email.text).toContain(`Event info (line-up, door times and what to bring): ${SITE}/events/here-and-now`);
    for (const icon of [TICKET_EMAIL_ASSETS.calendar, TICKET_EMAIL_ASSETS.pin, TICKET_EMAIL_ASSETS.info]) {
      expect(email.html).toContain(
        `<td width="40" height="40" align="center" valign="middle" bgcolor="#f2f1ee" style="width:40px;height:40px;border-radius:20px;background-color:#f2f1ee"><img src="${SITE}${icon}" width="20" height="20" alt=""`,
      );
    }
  });

  it("an overnight or multi-day event keeps its Starts / Ends lines, each in its own zone", () => {
    const email = buildTicketEmail(order, { ...event, startsAt: "2027-04-02T09:00:00.000Z", endsAt: "2027-04-04T06:00:00.000Z" } as EventRecord, SITE);
    expect(email.html).toContain(">Friday 2 April – Sunday 4 April 2027</p>");
    expect(email.html).toContain(">Starts Friday 2 April, 8:00 pm AEDT</p>");
    expect(email.html).toContain(">Ends Sunday 4 April, 4:00 pm AEST</p>");
    expect(email.text).toContain("Friday 2 April – Sunday 4 April 2027\nStarts Friday 2 April, 8:00 pm AEDT\nEnds Sunday 4 April, 4:00 pm AEST");
    // The stub shows the start alone (its days are in the When row).
    expect(email.html).toContain(">8 pm</p>");
  });

  it("leaves Get directions out when there's nothing to route to", () => {
    for (const where of [{ venueAddress: "", suburb: "" }, { venueName: "", venueAddress: " ", suburb: "" }]) {
      const e = { ...event, ...where } as EventRecord;
      expect(ticketDirectionsLink(e)).toBeNull();
      const { html, text } = buildTicketEmail(order, e, SITE);
      expect(html).not.toContain("Get directions");
      expect(text).not.toContain("Get directions");
    }
  });
});

describe("the order summary", () => {
  it("the reference, each line's all-inclusive amount (lib/fees.ts), the total and Incl. booking fees", () => {
    const two = {
      ...order,
      totalCents: 2594 * 2 + 1000,
      lineItems: [
        { ticketTypeId: "a", ticketTypeName: "Second release", unitPriceCents: 2400, feePolicy: "buyer-pays", quantity: 2 },
        { ticketTypeId: "b", ticketTypeName: "Organiser pays", unitPriceCents: 1000, feePolicy: "organiser-pays", quantity: 1 },
      ],
    } as OrderRecord;
    expect(ticketEmailLineItems(two)).toEqual([
      { label: "2 × Second release", cents: 5188 },
      { label: "1 × Organiser pays", cents: 1000 },
    ]);
    const { html, text } = buildTicketEmail(two, event, SITE);
    expect(html).toMatch(/>Order reference<\/td><td align="right" valign="top" style="[^"]*font-family:'IBM Plex Mono'[^"]*">#ABC<\/td>/);
    expect(html).toMatch(/>2 × Second release<\/td><td align="right" valign="top" style="[^"]*">A\$51\.88<\/td>/);
    expect(html).toMatch(/>1 × Organiser pays<\/td><td align="right" valign="top" style="[^"]*">A\$10\.00<\/td>/);
    expect(html).toMatch(/>Total paid<\/td><td align="right" valign="top" style="[^"]*font-weight:700[^"]*">A\$61\.88<\/td>/);
    expect(html).toContain(">Incl. booking fees</p>");
    expect(text).toContain("ORDER SUMMARY\nOrder reference: #ABC\n2 × Second release: A$51.88\n1 × Organiser pays: A$10.00\nTotal paid: A$61.88 (incl. booking fees)");
  });

  it("Latte's itemised summary when the order's own figures add up: the order date, each line at its ticket price, the booking fee, the total", () => {
    const { html, text } = buildTicketEmail(mockOrder, mockEvent, SITE, BUILT);
    expect(html).toMatch(/>Order date<\/td><td align="right" valign="top" style="[^"]*">12 Nov 2026, 9:41 pm<\/td>/);
    expect(html).toMatch(/>1 × Second release<\/td><td align="right" valign="top" style="[^"]*">A\$23\.00<\/td>/);
    expect(html).toMatch(/>Booking fee<\/td><td align="right" valign="top" style="[^"]*">A\$2\.94<\/td>/);
    expect(html).not.toContain("Incl. booking fees");
    expect(text).toContain("ORDER SUMMARY\nOrder reference: #A90133C9\nOrder date: 12 Nov 2026, 9:41 pm\n1 × Second release: A$23.00\nBooking fee: A$2.94\nTotal paid: A$25.94\n");
  });

  it("never prints line amounts that don't add up to the total (less Support Sheltüh)", () => {
    const off = { ...mockOrder, totalCents: 2600 } as OrderRecord;
    expect(ticketEmailLineItems(off)).toEqual([{ label: "1 × Second release", cents: null }]);
    const { html, text } = buildTicketEmail(off, mockEvent, SITE);
    expect(html).toMatch(/>1 × Second release<\/td><td align="right" valign="top" style="[^"]*"><\/td>/);
    expect(text).toContain("1 × Second release\nTotal paid: A$26.00 (incl. booking fees)");
    const supported = {
      ...mockOrder,
      lineItems: [{ ticketTypeId: "t2", ticketTypeName: "Second release", unitPriceCents: 2400, feePolicy: "buyer-pays", quantity: 1 }],
      totalCents: 2594 + 500,
      supportCents: 500,
    } as OrderRecord;
    expect(ticketEmailLineItems(supported)[0].cents).toBe(2594);
    expect(ticketEmailLineItems({ ...mockOrder, lineItems: undefined } as unknown as OrderRecord)).toEqual([]);
  });

  it("a free order: Total A$0.00, no tax invoice, no booking-fee note, no refund paragraph", () => {
    const { html, text } = buildTicketEmail({ ...order, totalCents: 0 } as OrderRecord, event, SITE);
    expect(html).toMatch(/>Total<\/td><td align="right" valign="top" style="[^"]*">A\$0\.00<\/td>/);
    expect(html).toContain(">No payment was taken, so there’s no tax invoice for this order.</p>");
    expect(html).toContain(">You’re in. Here are your 2 tickets.</h1>");
    expect(html).not.toContain("booking fees");
    expect(text).toContain("Total: A$0.00");
    for (const body of [html, text]) expect(body).not.toContain("Australian Consumer Law");
  });

  it("Support Sheltüh: its own row before the total, its note after the refund paragraph", () => {
    const withSupport = { ...order, totalCents: 6900, supportCents: 500 } as OrderRecord;
    const { html, text } = buildTicketEmail(withSupport, event, SITE, BUILT);
    const row = html.indexOf(">Support Sheltüh</td>");
    expect(row).toBeGreaterThan(html.indexOf(">Order reference</td>"));
    expect(row).toBeLessThan(html.indexOf(">Total paid</td>"));
    expect(html).toContain(">Incl. booking fees and Support Sheltüh</p>");
    expect(text).toContain("Support Sheltüh: A$5.00\nTotal paid: A$69.00 (incl. booking fees and Support Sheltüh)");
    expect(html.indexOf(`>${SUPPORT_REFUND_NOTE}</p>`)).toBeGreaterThan(html.indexOf("Australian Consumer Law"));
    expect(text).toContain(`${REFUND_ACL_STATEMENT}\n${SUPPORT_REFUND_NOTE}`);
  });
});

describe("refund policy (docs/architecture.md, Refund policy)", () => {
  it("a paid order: the event's policy then the site's shared Australian Consumer Law sentence, under the total", () => {
    const days = { ...event, refundPolicy: "days_before", refundDays: 7 } as EventRecord;
    const { html, text } = buildTicketEmail(order, days, SITE, BUILT);
    const line = "Refunds available until Sat 27 Feb 2027, 8:00 pm (7 days before the event).";
    expect(REFUND_ACL_STATEMENT).toBe("You're always entitled to a refund if the event is cancelled or significantly changed, as the Australian Consumer Law requires.");
    expect(html).toContain(
      `font-family:'Instrument Sans',Arial,Helvetica,sans-serif;font-size:14px;line-height:20px;font-weight:400;color:#5c5c5c;padding-top:8px">${line} ${REFUND_ACL_STATEMENT.replace("'", "&#39;")}</p>`,
    );
    expect(text).toContain(`${line} ${REFUND_ACL_STATEMENT}`);
    expect(html.indexOf(line)).toBeGreaterThan(html.indexOf(">Total paid<"));
  });

  it("no_change_of_mind (also an event without the field), and a closed window", () => {
    for (const e of [{ ...event, refundPolicy: "no_change_of_mind" } as EventRecord, event]) {
      expect(buildTicketEmail(order, e, SITE).text).toContain(`No refunds for change of mind. ${REFUND_ACL_STATEMENT}`);
    }
    const days = { ...event, refundPolicy: "days_before", refundDays: 7 } as EventRecord;
    expect(buildTicketEmail(order, days, SITE, new Date("2027-03-03T09:00:00.000Z")).text).toContain(
      "The refund window for this event has closed. No refunds for change of mind.",
    );
  });

  it("ticketEmailRefundPolicy: dated in the event's zone, against now", () => {
    const days = { ...event, refundPolicy: "days_before", refundDays: 7 } as EventRecord;
    expect(ticketEmailRefundPolicy(order, days, BUILT)).toBe("Refunds available until Sat 27 Feb 2027, 8:00 pm (7 days before the event).");
  });

  it("none for a free order, an event that isn't listed, an external event, or days_before without valid days", () => {
    const cases: [OrderRecord, EventRecord][] = [
      [{ ...order, totalCents: 0 }, event],
      [order, { ...event, status: "draft" } as EventRecord],
      [order, { ...event, ticketingMode: "external" } as EventRecord],
      [order, { ...event, refundPolicy: "days_before" } as EventRecord],
    ];
    for (const [o, e] of cases) {
      const { html, text } = buildTicketEmail(o, e, SITE);
      for (const body of [html, text]) {
        expect(body).not.toMatch(/refunds? (available|for change)/i);
        expect(body).not.toContain("Australian Consumer Law");
      }
    }
  });
});

describe("Going with friends?", () => {
  it("a cream box with WhatsApp · Messages (sms:) · Email (mailto:) · Share page (the event's page), and the same in the plain text", () => {
    const email = buildTicketEmail(mockOrder, mockEvent, SITE);
    const box = email.html.slice(email.html.indexOf('bgcolor="#fffae7"'), email.html.indexOf("Need a hand?"));
    const chips = [
      ...box.matchAll(/<a href="([^"]+)" style="display:inline-block;margin:8px 8px 0 0;padding:8px 16px;border:1\.5px solid #000000;border-radius:8px;[^"]*">([^<]+)<\/a>/g),
    ];
    expect(chips.map((c) => c[2])).toEqual(["WhatsApp", "Messages", "Email", "Share page"]);
    const [whatsapp, sms, mail, page] = chips.map((c) => c[1].replaceAll("&#38;", "&").replaceAll("&#39;", "'"));
    const invite = `I've got tickets to HERE & NOW (Saturday 14 November 2026). Come with me? ${SITE}/events/here-and-now`;
    expect(whatsapp).toBe(`https://wa.me/?text=${encodeURIComponent(invite)}`);
    expect(sms).toBe(`sms:?&body=${encodeURIComponent(invite)}`);
    expect(mail).toMatch(/^mailto:\?subject=Come%20to%20HERE%20%26%20NOW%3F&body=/);
    expect(page).toBe(`${SITE}/events/here-and-now`);
    expect(email.text).toContain(`GOING WITH FRIENDS?\n${invite}\nWhatsApp: ${whatsapp} · Messages: ${sms} · Email: ${mail} · Share page: ${page}`);
  });

  it("left out for an event that isn't listed", () => {
    const { html, text } = buildTicketEmail(order, { ...event, status: "draft" }, SITE);
    expect(html).not.toContain("Going with friends?");
    expect(text).not.toContain("GOING WITH FRIENDS?");
  });
});

describe("the footer", () => {
  it("centred: the small wordmark, the tagline, SHELTÜH · MELBOURNE, Privacy policy · Terms · Help centre and why you got this; no legal line", () => {
    const { html, text } = buildTicketEmail(order, event, SITE);
    const footer = html.slice(html.lastIndexOf(`<img src="cid:${WORDMARK_CID}"`));
    expect(footer).toContain(">Find your place, find your people.</p>");
    expect(footer).toContain(">SHELT&Uuml;H &middot; MELBOURNE</p>");
    for (const [href, label] of [
      ["/privacy", "Privacy policy"],
      ["/terms", "Terms"],
      ["/help", "Help centre"],
    ]) {
      expect(footer).toContain(`<a href="${SITE}${href}" style="color:#5c5c5c;text-decoration:underline;text-underline-offset:2px">${label}</a>`);
    }
    expect(footer).toContain(">You’re getting this email because you bought a ticket on Sheltüh.</p>");
    expect(html).not.toMatch(/ABN|Pty Ltd|sheltuh-email-footer/);
    // "Need a hand?" sits above the footer.
    expect(html.indexOf("Need a hand?")).toBeLessThan(html.lastIndexOf(`<img src="cid:${WORDMARK_CID}"`));
    expect(html).toContain(
      'Need a hand? <a href="mailto:support@sheltuh.com.au" style="color:#000000;text-decoration:underline;text-underline-offset:2px">support@sheltuh.com.au</a>',
    );
    expect(text).toContain(
      `Need a hand? support@sheltuh.com.au\n\nFind your place, find your people.\nSheltüh · Melbourne\nPrivacy policy: ${SITE}/privacy · Terms: ${SITE}/terms · Help centre: ${SITE}/help\nYou’re getting this email because you bought a ticket on Sheltüh.`,
    );
    expect(text.toLowerCase()).not.toContain("reply");
  });
});

describe("an event that's no longer listed", () => {
  it("sends the tickets (title, TICKET, QR, code, note) but no image, venue line, DATE, TIME, address, links or wallet buttons", () => {
    for (const status of ["draft", "pending_review", "rejected"] as const) {
      const email = buildTicketEmail(order, { ...withImage, status }, SITE, BUILT, BOTH);
      for (const body of [email.text, email.html]) {
        for (const detail of ["Saturday 6 March", "Sat 6 Mar", "8:00 pm", "AEDT", "Studio 5", "Smith St", "Fitzroy", "/events/paint-and-sip", "google.com/maps", "calendar", "/wallet/"]) {
          expect(body, detail).not.toContain(detail);
        }
        expect(body).toContain("ABCD-EFGH");
        expect(body).toContain("JKLM-NPQR");
        expect(body).toContain(`${SITE}/checkout/success?session_id=ord_abc`);
      }
      const [card] = cardsOf(email.html);
      expect(card).toContain(">Paint &#38; &#60;Sip&#62;</p>");
      expect(card).toContain(">Ticket</p>");
      expect(card).not.toContain(">Date</p>");
      expect(card).not.toContain(">Time</p>");
      expect(card).not.toContain('class="tv"');
      expect(email.text).toContain(EVENT_UNLISTED_TEXT);
      expect(email.html).toContain(
        'This event is no longer listed. Contact <a href="mailto:support@sheltuh.com.au" style="color:#000000;text-decoration:underline;text-underline-offset:2px">support@sheltuh.com.au</a> if you have questions.',
      );
      expect(qrImages(email)).toHaveLength(2);
    }
    // A published event never gets the line.
    expect(buildTicketEmail(order, event, SITE).text).not.toContain("no longer listed");
  });
});

describe("plain text (docs/design/ticket-email.md §9)", () => {
  it("follows the design's order, with every link and code, and no HTML", () => {
    const { text } = buildTicketEmail(mockOrder, mockEvent, SITE, BUILT, BOTH);
    const page = ticketPageLink(SITE, mockOrder.orderId);
    expect(
      text.startsWith(
        [
          "SHELTÜH",
          "",
          "Order #A90133C9 · Confirmed",
          "Hi, you're in. Here's your ticket.",
          "",
          "HERE & NOW",
          "Interconnect Studio · Coburg North",
          "Date: Sat 14 Nov · Time: 5–9 pm · Ticket: Second release",
          "",
          "Ticket 1 of 1 — Entry code: BPT7-7P6W (show this at the door; the QR code is in the full email)",
          `Add to Apple Wallet: ${walletPassLink(SITE, mockOrder.orderId, "apple", 1)}`,
          `Add to Google Wallet: ${walletPassLink(SITE, mockOrder.orderId, "google", 1)}`,
          "",
          "To add your ticket to Apple Wallet, open this email on your iPhone or Mac.",
          "",
          `View your ticket: ${page}`,
          `Manage order: ${page}`,
          "(Button not working? Use the links above.)",
          "",
          "Saturday 14 November 2026, 5:00 – 9:00 pm AEDT",
        ].join("\n"),
      ),
    ).toBe(true);
    expect(text).toContain(
      `ORDER SUMMARY\nOrder reference: #A90133C9\nOrder date: 12 Nov 2026, 9:41 pm\n1 × Second release: A$23.00\nBooking fee: A$2.94\nTotal paid: A$25.94\nNo refunds for change of mind. ${REFUND_ACL_STATEMENT}`,
    );
    expect(text).not.toMatch(/<\/?(?:td|tr|table|img|a|br|p|h1|span|div)\b|cid:|&#|&rsquo;|&middot;/i);
  });
});

describe("escaping", () => {
  it("escapes every dynamic value: title, venue, ticket type, code, image alt and links", () => {
    const { html } = buildTicketEmail(
      { ...order, tickets: [{ ticketCode: 'A<B>"1"&', ticketTypeId: "t", ticketTypeName: "<i>VIP</i>" }] } as OrderRecord,
      { ...withImage, title: '<script>alert("x")</script>', venueName: "<b>Venue</b>", venueAddress: "<u>1 St</u>" } as EventRecord,
      SITE,
    );
    for (const raw of ["<script", "<b>Venue", "<u>1 St", "<i>VIP", 'A<B>"1"&', 'alert("x")']) expect(html).not.toContain(raw);
    expect(html).toContain(">&#60;script&#62;alert(&#34;x&#34;)&#60;/script&#62;</p>");
    expect(html).toContain('alt="Event image for &#60;script&#62;alert(&#34;x&#34;)&#60;/script&#62;"');
    expect(html).toContain("A&#60;B&#62;&#34;1&#34;&#38;");
    expect(html).toContain("destination=%3Cb%3EVenue%3C%2Fb%3E%2C%20%3Cu%3E1%20St%3C%2Fu%3E");
  });

  it("shows no internal ids or buyer data outside links", () => {
    const shown = buildTicketEmail(order, event, SITE).html.replace(/href="[^"]*"/g, "");
    expect(shown).not.toContain("ord_abc");
    expect(shown).not.toContain("fan@example.com");
  });
});

describe("the size budget (Gmail clips HTML over 102KB)", () => {
  it("the largest order checkout allows (20 ticket types of 20 people) stays under 90KB, every code still in the HTML and the text", () => {
    const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    const code = (n: number) => {
      const chars = [Math.floor(n / 32) % 32, n % 32, 3, 5, 7, 11, (n * 7) % 32, (n * 13) % 32].map((i) => alphabet[i]);
      return `${chars.slice(0, 4).join("")}-${chars.slice(4).join("")}`;
    };
    const tickets = Array.from({ length: 400 }, (_, n) => ({ ticketCode: code(n), ticketTypeId: `t${Math.floor(n / 20)}`, ticketTypeName: `Release ${Math.floor(n / 20) + 1}` }));
    expect(new Set(tickets.map((t) => t.ticketCode)).size).toBe(400);
    const lineItems = Array.from({ length: 20 }, (_, t) => ({ ticketTypeId: `t${t}`, ticketTypeName: `Release ${t + 1}`, unitPriceCents: 2400, feePolicy: "buyer-pays", quantity: 20 }));
    const big = { ...mockOrder, totalCents: 2594 * 400, lineItems, tickets } as OrderRecord;
    const email = buildTicketEmail(big, { ...mockEvent, imageUrl: IMAGE_PATH } as EventRecord, SITE, BUILT, BOTH);
    expect(Buffer.byteLength(email.html)).toBeLessThanOrEqual(TICKET_EMAIL_HTML_BUDGET);
    const cards = cardsOf(email.html).length;
    expect(cards).toBeGreaterThan(0);
    expect(cards).toBeLessThan(400);
    // The cards shown have their QR attached; the rest are listed with their codes, pointing at the ticket page.
    expect(qrImages(email)).toHaveLength(cards);
    expect(email.html).toContain(`Tickets ${cards + 1}&ndash;400: their QR codes are on <a href="${ticketPageLink(SITE, big.orderId)}"`);
    for (const t of tickets) {
      expect(email.html).toContain(t.ticketCode);
      expect(email.text).toContain(`Entry code: ${t.ticketCode}`);
    }
    // The text says a ticket's QR code is in the email only if its card (and QR) is; the listed ones point at the ticket page.
    const lines = email.text.split("\n").filter((line) => line.startsWith("Ticket ") && line.includes("Entry code: "));
    expect(lines).toHaveLength(400);
    for (const [i, line] of lines.entries()) {
      expect(line, line).toMatch(i < cards ? /; the QR code is in the full email\)$/ : /; its QR code is on your ticket page\)$/);
    }
    expect(email.text).toContain(`View your tickets: ${ticketPageLink(SITE, big.orderId)}`);
  });

  it("a usual order (8 tickets, both wallets) is all full cards, well under the budget", () => {
    const codes = ["K7QM-2XPD", "R4TN-9WJC", "B8VF-3HLZ", "M2GD-6SYA", "A2B3-C4D5", "E6F7-G8H9", "J2K3-L4M5", "N6P7-Q8R9"];
    const eight = {
      ...mockOrder,
      totalCents: 2594 * 8,
      lineItems: [{ ...mockOrder.lineItems[0], quantity: 8 }],
      tickets: codes.map((c) => ({ ticketCode: c, ticketTypeId: "t2", ticketTypeName: "Second release" })),
    } as OrderRecord;
    const email = buildTicketEmail(eight, { ...mockEvent, imageUrl: IMAGE_PATH } as EventRecord, SITE, BUILT, BOTH);
    expect(cardsOf(email.html)).toHaveLength(8);
    expect(Buffer.byteLength(email.html)).toBeLessThan(TICKET_EMAIL_HTML_BUDGET);
    expect(email.html).not.toContain("their QR codes are on");
  });
});

describe("times, dates and places", () => {
  it("formatStubTime writes the design's short times", () => {
    const at = (h: number, m = 0) => new Date(Date.UTC(2026, 10, 14, h - 11, m)).toISOString(); // AEDT is UTC+11
    expect(formatStubTime(at(17), at(21))).toBe("5–9 pm");
    expect(formatStubTime(at(19, 30), at(23))).toBe("7:30–11 pm");
    expect(formatStubTime(at(11), at(14))).toBe("11 am–2 pm");
    expect(formatStubTime(at(17))).toBe("5 pm");
    expect(formatStubTime(at(21), at(26))).toBe("9 pm–2 am");
    expect(formatStubTime(at(20), at(24))).toBe("8 pm–12 am");
  });

  it("formatInfoTime drops the first meridiem when both times share it, else formatTicketTime", () => {
    expect(formatInfoTime("2026-11-14T06:00:00.000Z", "2026-11-14T10:00:00.000Z")).toBe("5:00 – 9:00 pm AEDT");
    expect(formatInfoTime("2026-11-14T00:00:00.000Z", "2026-11-14T03:00:00.000Z")).toBe("11:00 am – 2:00 pm AEDT");
    expect(formatInfoTime("2026-11-14T06:00:00.000Z")).toBe("5:00 pm AEDT");
    expect(formatInfoTime("2027-03-06T09:00:00.000Z", "2027-03-06T11:00:00.000Z", { timeZone: "Australia/Perth", state: "WA" })).toBe(
      "5:00 – 7:00 pm Perth time (AWST)",
    );
  });

  it("formatTicketDate / formatTicketTime / ticketWhen keep their meaning", () => {
    expect(formatTicketTime("2027-07-10T09:00:00.000Z", "2027-07-10T11:00:00.000Z")).toBe("7:00 pm – 9:00 pm AEST");
    expect(formatTicketDate("2027-03-05T12:00:00.000Z", "2027-03-05T16:30:00.000Z")).toBe("Friday 5 March – Saturday 6 March 2027");
    expect(formatTicketTime("2027-03-05T12:00:00.000Z", "2027-03-05T16:30:00.000Z")).toBe("11:00 pm (Fri) – 3:30 am (Sat) AEDT");
    expect(ticketWhen("2027-03-06T09:00:00.000Z", "2027-03-06T13:00:00.000Z")).toEqual({ date: "Saturday 6 March 2027", lines: ["8:00 pm – 12:00 am AEDT"] });
    expect(orderReference("ord_9f86d081884c7d659a2feaa0c55ad015")).toBe("#9F86D081");
  });

  it("the venue line and the address line", () => {
    expect(ticketVenueLine(mockEvent)).toBe("Interconnect Studio · Coburg North");
    expect(ticketVenueLine({ venueName: "Studio 5", suburb: "" })).toBe("Studio 5");
    expect(ticketVenueLine({ venueName: "", suburb: "" })).toBe("");
    expect(ticketAddressLine(mockEvent)).toBe("16 Catherine St, Coburg North VIC");
    expect(ticketAddressLine({ venueAddress: "5 Smith St, Fitzroy", suburb: "Fitzroy", state: "VIC" })).toBe("5 Smith St, Fitzroy VIC");
    expect(ticketAddressLine({ venueAddress: "88 Smith Street, Collingwood VIC 3066", suburb: "Collingwood", state: "VIC" })).toBe("88 Smith Street, Collingwood VIC 3066");
    // No street address: "Suburb, STATE" (owner decision D4).
    expect(ticketAddressLine({ venueAddress: "", suburb: "Fremantle", state: "WA" })).toBe("Fremantle, WA");
  });

  it("only builds an event image URL from a same-origin path on an https site", () => {
    expect(eventImageEmailUrl(SITE, IMAGE_PATH)).toBe(`${SITE}${IMAGE_PATH}`);
    for (const p of [undefined, "", "https://evil.test/x.png", "//evil.test/x.png", "/\\evil.test/x.png", "javascript:alert(1)", "api/x"]) {
      expect(eventImageEmailUrl(SITE, p)).toBeNull();
    }
    expect(eventImageEmailUrl("http://sheltuh.com.au", IMAGE_PATH)).toBeNull();
  });

  it("the subject and the preheader", () => {
    const email = buildTicketEmail(order, event, SITE);
    expect(email.to).toBe("fan@example.com");
    // Latte's "for dev" table: "Your ticket to …", "Your 2 tickets to …", "You’re in: …" (free).
    expect(email.subject).toBe("Your 2 tickets to Paint & <Sip>");
    expect(buildTicketEmail({ ...order, tickets: [order.tickets[0]] }, event, SITE).subject).toBe("Your ticket to Paint & <Sip>");
    expect(buildTicketEmail({ ...order, totalCents: 0 }, event, SITE).subject).toBe("You’re in: Paint & <Sip>");
    const preheader = email.html.match(/<body[^>]*>\n<div style="([^"]*)">([^<]*)</);
    expect(preheader?.[2]).toContain("Sat 6 Mar · Studio 5 · Order #ABC");
    expect(buildTicketEmail({ ...order, totalCents: 0 }, event, SITE).html).toContain(">Free entry · Sat 6 Mar · Studio 5 · Order #ABC&nbsp;");
    for (const rule of ["display:none", "mso-hide:all", "max-height:0", "overflow:hidden", "opacity:0"]) expect(preheader?.[1]).toContain(rule);
  });
});
