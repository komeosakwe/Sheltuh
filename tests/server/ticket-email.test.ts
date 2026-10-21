import { readFileSync } from "node:fs";
import path from "node:path";
import nodemailer from "nodemailer";
import { describe, expect, it } from "vitest";
import { mailOptions } from "@/lib/server/email";
import { EMAIL_WORDMARK } from "@/lib/server/email-wordmark";
import { encodePng } from "@/lib/server/png";
import {
  buildTicketEmail,
  EMAIL_FOOTER_IMAGE_URL,
  formatTicketDate,
  formatTicketTime,
  orderReference,
  ticketPageLink,
  ticketQrAlt,
} from "@/lib/server/ticket-email";
import type { EventRecord, OrderRecord } from "@/lib/server/types";
import { ticketQrMatrix } from "@/lib/ticket-qr";

const event = {
  title: "Paint & <Sip>",
  venueName: "Studio 5",
  venueAddress: "5 Smith St, Fitzroy",
  startsAt: "2027-03-06T09:00:00.000Z",
  endsAt: "2027-03-06T11:00:00.000Z",
} as EventRecord;

const order = {
  orderId: "ord_abc",
  buyerEmail: "fan@example.com",
  totalCents: 6400,
  tickets: [
    { ticketCode: "ABCD-EFGH", ticketTypeId: "ga", ticketTypeName: "GA" },
    { ticketCode: "JKLM-NPQR", ticketTypeId: "ga", ticketTypeName: "GA" },
  ],
} as OrderRecord;

/** The brand's four colours (docs/design/brand-direction-one.md), lower case as the email writes them. */
const BRAND = { black: "#000000", white: "#ffffff", cream: "#fffae7", orange: "#ff4800" };
/** Each ticket card's border, so cards can be counted and split. */
const CARD = "border:2px solid #000000;border-radius:12px";
const WORDMARK_CID = "sheltuh-wordmark@sheltuh.com.au";

/** Every QR (not the wordmark) the email attaches. */
const qrImages = (email: ReturnType<typeof buildTicketEmail>) =>
  (email.inlineImages ?? []).filter((image) => image.cid.startsWith("ticket-qr-"));

describe("buildTicketEmail", () => {
  it("lists every ticket code, the Melbourne time, the venue and a link back to the order", () => {
    const email = buildTicketEmail(order, event, "https://sheltuh.com.au");
    expect(email.to).toBe("fan@example.com");
    expect(email.subject).toBe("Your tickets: Paint & <Sip>");
    for (const body of [email.text, email.html]) {
      expect(body).toContain("ABCD-EFGH");
      expect(body).toContain("JKLM-NPQR");
      expect(body).toContain("8:00 pm"); // 9am UTC is 8pm AEDT
      expect(body).toContain("https://sheltuh.com.au/checkout/success?session_id=ord_abc");
    }
    expect(email.text).toContain("A$64 (incl. booking fees)");
  });

  it("escapes organiser-supplied text in the HTML version", () => {
    const { html } = buildTicketEmail(order, event, "https://sheltuh.com.au");
    expect(html).not.toContain("<Sip>");
    expect(html).toContain("&#60;Sip&#62;");
  });

  it("says Free for a free order", () => {
    expect(buildTicketEmail({ ...order, totalCents: 0 }, event, "https://x").text).toContain("Total paid: Free");
  });

  // --- redesign: layout, content and edge cases ---

  it("uses only the brand's colours: cream page, black wordmark band, white card, orange button", () => {
    const { html } = buildTicketEmail(order, event, "https://sheltuh.com.au");
    expect(html).toContain("max-width:600px");
    const colours = new Set(html.match(/#[0-9a-fA-F]{6}\b/g)?.map((c) => c.toLowerCase()));
    expect([...colours].sort()).toEqual(Object.values(BRAND).sort());
    // Backgrounds are set as bgcolor attributes as well as inline styles (clients that drop one keep the other).
    expect(html).toContain(`<body bgcolor="${BRAND.cream}"`);
    expect(html).toMatch(new RegExp(`<td class="px" bgcolor="${BRAND.black}"[^>]*>\\s*<img src="cid:${WORDMARK_CID}"`));
    expect(html).toContain(`<td class="px" bgcolor="${BRAND.white}"`);
    // The old palette is gone.
    for (const old of ["#f3f0e8", "#2b3cff", "#0b0b0b", "#5b574e", "#e3ded1"]) expect(html).not.toContain(old);
  });

  it("opens with YOU'RE IN. in uppercase, then the event name", () => {
    const { html } = buildTicketEmail(order, event, "https://sheltuh.com.au");
    const h1 = html.match(/<h1[^>]*style="([^"]*)"[^>]*>([^<]*)<\/h1>/);
    expect(h1?.[2]).toBe("You&rsquo;re in.");
    expect(h1?.[1]).toContain("text-transform:uppercase");
    const h1End = html.indexOf("</h1>");
    expect(html.slice(h1End, h1End + 400)).toContain(">Paint &#38; &#60;Sip&#62;</p>");
  });

  it("has one VIEW MY TICKETS button: black text on Signal Orange, at least 44px tall, to the order's ticket page", () => {
    for (const tickets of [[order.tickets[0]], order.tickets]) {
      const { html, text } = buildTicketEmail({ ...order, tickets }, event, "https://x");
      const buttons = [...html.matchAll(/<td bgcolor="([^"]+)"[^>]*><a href="([^"]+)" style="([^"]*)">([^<]+)<\/a><\/td>/g)];
      expect(buttons).toHaveLength(1);
      const [, bg, href, style, label] = buttons[0];
      expect(label).toBe("VIEW MY TICKETS");
      expect(bg).toBe(BRAND.orange);
      expect(style).toContain(`color:${BRAND.black}`); // 6.18:1; white on orange would fail for 16px text
      expect(style).toContain("padding:16px 24px"); // 20px line + 32px padding = 52px tall (>= 44px)
      expect(style).toContain("display:block");
      // The order's existing ticket link, unchanged: the same URL earlier emails carried.
      expect(href).toBe("https://x/checkout/success?session_id=ord_abc");
      expect(href).toBe(ticketPageLink("https://x", "ord_abc"));
      expect(text).toContain("View my tickets: https://x/checkout/success?session_id=ord_abc");
    }
  });

  it("gives every ticket its own card with a numbered label, type and code (none dropped)", () => {
    const four = {
      ...order,
      tickets: ["AAAA-1111", "BBBB-2222", "CCCC-3333", "DDDD-4444"].map((code, i) => ({
        ticketCode: code,
        ticketTypeId: "t",
        ticketTypeName: i === 3 ? "VIP" : "GA",
      })),
    } as OrderRecord;
    const { html, text } = buildTicketEmail(four, event, "https://x");
    for (const code of ["AAAA-1111", "BBBB-2222", "CCCC-3333", "DDDD-4444"]) {
      expect(html).toContain(code);
      expect(text).toContain(`Entry code: ${code}`);
    }
    expect(html.split(CARD)).toHaveLength(5);
    expect(html).toContain("Ticket 1 of 4");
    expect(html).toContain("Ticket 4 of 4");
    expect(html).toContain("VIP");
    expect(html).toMatch(/font-size:28px[^"]*letter-spacing:3px/); // large readable code
  });

  // Updated deliberately for QR check-in: each ticket now has a QR image, but
  // it encodes only the code printed beneath it, so the rule still holds that
  // nothing is carried by an image alone (and there's still no barcode).
  it("keeps the essentials as real text (images: the wordmark and a QR per ticket inline, plus the footer banner)", () => {
    const { html } = buildTicketEmail(order, event, "https://x");
    expect(html.match(/<img /g)).toHaveLength(1 + order.tickets.length + 1);
    expect(html.match(/<img src="cid:/g)).toHaveLength(1 + order.tickets.length);
    // The only remote image is the decorative footer banner on our own domain: no hosted QR, no third-party QR service.
    const remote = [...html.matchAll(/(?:src|background)=["']?((?:https?:)?\/\/[^"' >]+)/g)].map((m) => m[1]);
    expect(remote).toEqual([EMAIL_FOOTER_IMAGE_URL]);
    expect(html).not.toMatch(/ barcode/i);
    const withoutImages = html.replace(/<img[^>]*>/g, "");
    for (const needle of ["Paint &#38; &#60;Sip&#62;", "Studio 5", "5 Smith St, Fitzroy", "ABCD-EFGH", "JKLM-NPQR", "A$64", "#ABC"]) {
      expect(withoutImages).toContain(needle);
    }
  });

  it("separates date, time, venue and address, in Melbourne time with its zone name", () => {
    const { html, text } = buildTicketEmail(order, event, "https://x");
    expect(html).toContain("Saturday 6 March 2027");
    expect(html).toContain("8:00 pm &#8211; 10:00 pm AEDT".replace("&#8211;", "–"));
    for (const label of ["Date", "Time", "Venue", "Address"]) expect(html).toContain(`>${label}</td>`);
    expect(text).toContain("Date: Saturday 6 March 2027");
    expect(text).toContain("Time: 8:00 pm – 10:00 pm AEDT");
    expect(text).toContain("Venue: Studio 5");
    expect(text).toContain("Address: 5 Smith St, Fitzroy");
  });

  it("uses AEST (not AEDT) outside daylight saving", () => {
    expect(formatTicketTime("2027-07-10T09:00:00.000Z", "2027-07-10T11:00:00.000Z")).toBe("7:00 pm – 9:00 pm AEST");
  });

  it("names the days for an event that crosses midnight in Melbourne time, not UTC", () => {
    // 12:00Z Fri = 11:00 pm Fri AEDT; 16:30Z = 3:30 am Sat AEDT.
    expect(formatTicketDate("2027-03-05T12:00:00.000Z", "2027-03-05T16:30:00.000Z")).toBe("Friday 5 March – Saturday 6 March 2027");
    expect(formatTicketTime("2027-03-05T12:00:00.000Z", "2027-03-05T16:30:00.000Z")).toBe("11:00 pm (Fri) – 3:30 am (Sat) AEDT");
    // A UTC date change that is NOT a Melbourne date change stays one day.
    expect(formatTicketDate("2027-03-05T20:00:00.000Z", "2027-03-05T23:00:00.000Z")).toBe("Saturday 6 March 2027");
  });

  it("treats an end at exactly 12:00 am as the same evening", () => {
    // 9:00 am UTC = 8:00 pm AEDT; 13:00Z = 12:00 am Sunday AEDT.
    expect(formatTicketDate("2027-03-06T09:00:00.000Z", "2027-03-06T13:00:00.000Z")).toBe("Saturday 6 March 2027");
    expect(formatTicketTime("2027-03-06T09:00:00.000Z", "2027-03-06T13:00:00.000Z")).toBe("8:00 pm – 12:00 am AEDT");
  });

  it("handles multi-day events and a year boundary", () => {
    expect(formatTicketDate("2027-03-05T10:00:00.000Z", "2027-03-07T05:00:00.000Z")).toBe("Friday 5 March – Sunday 7 March 2027");
    expect(formatTicketTime("2027-03-05T10:00:00.000Z", "2027-03-07T05:00:00.000Z")).toBe("9:00 pm (Fri) – 4:00 pm (Sun) AEDT");
    expect(formatTicketDate("2027-12-31T10:00:00.000Z", "2028-01-01T14:00:00.000Z")).toBe("Friday 31 December 2027 – Sunday 2 January 2028".replace("Sunday 2 January", "Sunday 2 January"));
  });

  it("omits venue and address rows that are empty, and an empty ticket type", () => {
    const { html, text } = buildTicketEmail(
      { ...order, tickets: [{ ticketCode: "ZZZZ-9999", ticketTypeId: "t", ticketTypeName: "" }] } as OrderRecord,
      { ...event, venueName: "", venueAddress: "" } as EventRecord,
      "https://x",
    );
    expect(html).not.toContain(">Venue</td>");
    expect(html).not.toContain(">Address</td>");
    expect(text).not.toContain("Venue:");
    expect(text).not.toContain("Address:");
    expect(html).toContain("ZZZZ-9999");
    expect(html).not.toContain("&middot; </td>");
  });

  it("escapes every dynamic value, including ticket codes and the venue", () => {
    const { html } = buildTicketEmail(
      { ...order, tickets: [{ ticketCode: 'A<B>"1"&', ticketTypeId: "t", ticketTypeName: "<i>VIP</i>" }] } as OrderRecord,
      { ...event, title: '<script>alert("x")</script>', venueName: "<b>Venue</b>", venueAddress: "<u>1 St</u>" } as EventRecord,
      "https://x",
    );
    for (const raw of ["<script", "<b>Venue", "<u>1 St", "<i>VIP", 'A<B>"1"&']) expect(html).not.toContain(raw);
    expect(html).toContain("&#60;script&#62;");
  });

  it("shows an order reference derived from the order id, and a Free total without fees note", () => {
    expect(orderReference("7c1f2e0a-5b3d-4f6e-9a18-2d4c6b8e0f13")).toBe("#7C1F2E0A");
    // Real ids are `ord_` + 32 hex: the prefix must not eat the reference.
    expect(orderReference("ord_9f86d081884c7d659a2feaa0c55ad015")).toBe("#9F86D081");
    const free = buildTicketEmail({ ...order, totalCents: 0 }, event, "https://x").html;
    expect(free).toContain("Total paid");
    expect(free).not.toContain("incl. booking fees");
    const paid = buildTicketEmail(order, event, "https://x").html;
    expect(paid).toContain("A$64");
    expect(paid).toContain("incl. booking fees");
  });

  it("includes a plain-text alternative, a preheader and support contact, without inviting replies", () => {
    const { html, text } = buildTicketEmail(order, event, "https://x");
    expect(text).toContain("YOU'RE IN.");
    expect(text).toContain("support@sheltuh.com.au");
    expect(text).toContain("Need help? Email support@sheltuh.com.au and quote your order reference.");
    expect(html).toContain('href="mailto:support@sheltuh.com.au"');
    expect(text.toLowerCase()).not.toContain("reply");
    expect(html.toLowerCase()).not.toContain("just reply");
    expect(html).toContain("display:none"); // preheader
    expect(html).toContain('lang="en-AU"');
  });

  it("plain text: every fact in the HTML, in reading order, with no HTML or image references", () => {
    const { text } = buildTicketEmail(order, event, "https://x");
    const lines = [
      "SHELTÜH",
      "YOU'RE IN.",
      "Paint & <Sip>",
      "Date: Saturday 6 March 2027",
      "Time: 8:00 pm – 10:00 pm AEDT",
      "Venue: Studio 5",
      "Address: 5 Smith St, Fitzroy",
      "YOUR TICKETS",
      "Ticket 1 of 2 - GA",
      "Entry code: ABCD-EFGH",
      "Ticket 2 of 2 - GA",
      "Entry code: JKLM-NPQR",
      "View my tickets: https://x/checkout/success?session_id=ord_abc",
      "Order reference: #ABC",
      "Total paid: A$64 (incl. booking fees)",
      "Sheltüh, Melbourne",
    ];
    let at = -1;
    for (const line of lines) {
      const next = text.indexOf(line, at + 1);
      expect(next, line).toBeGreaterThan(at);
      at = next;
    }
    // (The title's own "<Sip>" is the organiser's text, shown as written.)
    expect(text).not.toMatch(/<\/?(?:td|tr|table|img|a|br|p|h1|span|div)\b|cid:|&#|&rsquo;|&middot;/i);
  });

  it("ends with the brand banner from sheltuh.com.au, after the support info, full width with alt text", () => {
    const email = buildTicketEmail(order, event, "https://x");
    const { html } = email;
    expect(EMAIL_FOOTER_IMAGE_URL).toBe("https://sheltuh.com.au/images/email-footer.png");
    const tag = html.match(/<img src="https:\/\/sheltuh\.com\.au\/images\/email-footer\.png"[^>]*>/)?.[0] ?? "";
    expect(tag).toContain('width="600"');
    expect(tag).toContain('alt="Sheltüh. Music. Art. Fashion. Culture."');
    expect(tag).toContain('style="display:block;border:0;width:100%;max-width:600px;height:auto"');
    // The last row of the email, after the support line.
    expect(html.indexOf(tag)).toBeGreaterThan(html.indexOf("mailto:support@sheltuh.com.au"));
    expect(html.slice(html.indexOf(tag))).toMatch(/^<img[^>]*><\/td><\/tr>\n<\/table>\n<!--\[if mso\]><\/td><\/tr><\/table><!\[endif\]-->/);
    // Not an attachment, and the URL carries nothing about the order.
    expect(email.inlineImages?.some((i) => i.filename?.includes("footer"))).toBe(false);
    expect(EMAIL_FOOTER_IMAGE_URL).not.toMatch(/ord_|\?/);
  });

  // --- The wordmark ---

  it("shows the official wordmark as an inline PNG (cid), with SHELTÜH as alt text styled for blocked images", () => {
    const email = buildTicketEmail(order, event, "https://x");
    const wordmark = email.inlineImages?.[0];
    expect(wordmark?.cid).toBe(WORDMARK_CID);
    expect(wordmark?.contentType).toBe("image/png");
    expect(wordmark?.filename).toBe("sheltuh.png");
    expect(wordmark?.content.equals(Buffer.from(EMAIL_WORDMARK.pngBase64, "base64"))).toBe(true);
    const tag = email.html.match(new RegExp(`<img src="cid:${WORDMARK_CID}"[^>]*>`))?.[0] ?? "";
    expect(tag).toContain('alt="SHELT&Uuml;H"');
    expect(tag).toContain(`width="${EMAIL_WORDMARK.displayWidth}" height="${EMAIL_WORDMARK.displayHeight}"`);
    // With images off, the alt text shows in orange on the black band (6.18:1).
    expect(tag).toContain(`color:${BRAND.orange}`);
    expect(tag).toContain("font-size:28px");
  });

  it("the wordmark is the PNG shipped in public/brand (rendered from the official SVG), at 2x its shown size", () => {
    const shipped = readFileSync(path.join(process.cwd(), "public/brand/sheltuh-wordmark-email.png"));
    const png = Buffer.from(EMAIL_WORDMARK.pngBase64, "base64");
    expect(png.equals(shipped)).toBe(true);
    expect(png.subarray(1, 4).toString("ascii")).toBe("PNG");
    // IHDR: width and height, big-endian, at bytes 16 and 20.
    expect(png.readUInt32BE(16)).toBe(EMAIL_WORDMARK.displayWidth * 2);
    expect(png.readUInt32BE(20)).toBe(EMAIL_WORDMARK.displayHeight * 2);
    // The SVG's aspect ratio (435.523 x 98.749), and the brand's 16px minimum height.
    expect(EMAIL_WORDMARK.displayWidth / EMAIL_WORDMARK.displayHeight).toBeCloseTo(435.523 / 98.749, 1);
    expect(EMAIL_WORDMARK.displayHeight).toBeGreaterThanOrEqual(16);
    expect(png.length).toBeLessThan(16 * 1024);
  });

  // --- QR codes ---

  it("gives each real ticket code a ~180px QR, attached inline under a matching cid, with alt text pointing at the backup code", () => {
    const email = buildTicketEmail(order, event, "https://x");
    const images = qrImages(email);
    expect(images.map((i) => i.cid)).toEqual(["ticket-qr-1@sheltuh.com.au", "ticket-qr-2@sheltuh.com.au"]);
    const tags = [...email.html.matchAll(/<img src="cid:(ticket-qr-[^"]+)"[^>]*>/g)];
    expect(tags.map((t) => t[1])).toEqual(images.map((i) => i.cid));
    for (const [i, code] of ["ABCD-EFGH", "JKLM-NPQR"].entries()) {
      const tag = tags[i][0];
      expect(tag).toContain(`alt="QR code for ticket ${code}. If it doesn&#39;t show, use the backup code below."`);
      expect(ticketQrAlt(code)).toBe(`QR code for ticket ${code}. If it doesn't show, use the backup code below.`);
      // Alt text styled to be readable in the image's box when images are blocked.
      expect(tag).toMatch(/font-size:13px;line-height:18px;color:#000000/);
      expect(tag).toContain('width="174" height="174"');
      expect(images[i].contentType).toBe("image/png");
      // Numbered, never named after the code (the code is the ticket; file names leak into previews and downloads).
      expect(images[i].filename).toBe(`ticket-${i + 1}-qr.png`);
      expect(images[i].filename).not.toContain(code);
      // The PNG is this ticket's own QR (encodePng's pixels are tested in png.test.ts).
      expect(images[i].content.equals(encodePng(ticketQrMatrix(code)!, 12, 4))).toBe(true);
      expect(images[i].content.length).toBeLessThan(1024);
    }
  });

  it("keeps each code as text beneath its QR, labelled as the backup code, inside the same card", () => {
    const { html } = buildTicketEmail(order, event, "https://x");
    const cards = html.split(CARD).slice(1);
    expect(cards).toHaveLength(2);
    for (const [i, code] of ["ABCD-EFGH", "JKLM-NPQR"].entries()) {
      const qrAt = cards[i].indexOf(`cid:ticket-qr-${i + 1}@`);
      expect(qrAt).toBeGreaterThan(-1);
      const labelAt = cards[i].indexOf(">Backup code</td>");
      expect(labelAt).toBeGreaterThan(qrAt);
      expect(cards[i].indexOf(`>${code}</td>`)).toBeGreaterThan(labelAt);
      // Each card holds exactly its own QR.
      expect(cards[i].match(/<img src="cid:ticket-qr-/g)).toHaveLength(1);
    }
  });

  it("multiple tickets: one QR each, each a different image of its own code", () => {
    const codes = ["K7QM-2XPD", "R4TN-9WJC", "B8VF-3HLZ", "M2GD-6SYA"];
    const many = {
      ...order,
      tickets: codes.map((code) => ({ ticketCode: code, ticketTypeId: "ga", ticketTypeName: "GA" })),
    } as OrderRecord;
    const email = buildTicketEmail(many, event, "https://x");
    const images = qrImages(email);
    expect(images).toHaveLength(4);
    expect(new Set(images.map((i) => i.content.toString("base64"))).size).toBe(4);
    expect(new Set(images.map((i) => i.cid)).size).toBe(4);
    for (const [i, code] of codes.entries()) {
      expect(images[i].content.equals(encodePng(ticketQrMatrix(code)!, 12, 4))).toBe(true);
      expect(email.html).toContain(`alt="QR code for ticket ${code}.`);
    }
    expect(email.html.split(CARD)).toHaveLength(5);
  });

  it("tells the buyer how to use the QR, in the HTML and the plain text", () => {
    const one = buildTicketEmail({ ...order, tickets: [order.tickets[0]] }, event, "https://x");
    expect(one.html).toContain("Show this QR code at the door. Turn your screen brightness up.");
    expect(one.html).toContain("door staff can type in the backup code.");
    expect(one.html).toContain("Show your QR code at the door."); // preheader
    // The plain text can't show a QR: it points at the entry code, and at the full email for the QR.
    expect(one.text).toContain("YOUR TICKET\nShow your entry code at the door (the QR code is in the full email).");
    expect(one.text).not.toMatch(/QR code in this email/i);
    expect(one.text).toContain("Entry code: ABCD-EFGH");
    const many = buildTicketEmail(order, event, "https://x");
    expect(many.html).toContain("Show these QR codes at the door. Turn your screen brightness up.");
    expect(many.text).toContain("YOUR TICKETS\nShow your entry codes at the door (the QR codes are in the full email).");
    expect(many.text).not.toMatch(/in this email/i);
  });

  it("gives a malformed code no QR, no attachment and the old wording", () => {
    const bad = { ...order, tickets: [{ ticketCode: "abcd-efgh", ticketTypeId: "t", ticketTypeName: "GA" }] } as OrderRecord;
    const email = buildTicketEmail(bad, event, "https://x");
    expect(email.inlineImages?.map((i) => i.cid)).toEqual([WORDMARK_CID]); // the wordmark only
    expect(email.html).not.toContain("cid:ticket-qr");
    expect(email.html).not.toMatch(/qr code/i);
    expect(email.html).toContain(">Entry code</td>");
    expect(email.html).not.toContain(">Backup code</td>");
    expect(email.html).toContain("Show this code at the door.");
    expect(email.text).toContain("YOUR TICKETS (show these codes at the door)");
    expect(email.html).toContain("abcd-efgh");
  });

  it("only gives QR codes to the real codes in a mixed order", () => {
    const mixed = {
      ...order,
      tickets: [
        { ticketCode: "AAAA-1111", ticketTypeId: "t", ticketTypeName: "GA" }, // 1 isn't in the alphabet
        { ticketCode: "BBBB-2222", ticketTypeId: "t", ticketTypeName: "GA" },
      ],
    } as OrderRecord;
    const email = buildTicketEmail(mixed, event, "https://x");
    expect(qrImages(email).map((i) => i.cid)).toEqual(["ticket-qr-2@sheltuh.com.au"]);
    expect(email.html).not.toContain("QR code for ticket AAAA-1111");
    expect(email.html).toContain('alt="QR code for ticket BBBB-2222. If it doesn&#39;t show, use the backup code below."');
  });

  it("an escaped hostile code still gets no QR (only real codes are encoded)", () => {
    const email = buildTicketEmail(
      { ...order, tickets: [{ ticketCode: 'A<B>"1"&', ticketTypeId: "t", ticketTypeName: "GA" }] } as OrderRecord,
      event,
      "https://x",
    );
    expect(qrImages(email)).toEqual([]);
    expect(email.html).not.toContain('A<B>"1"&');
    expect(email.html).toContain("A&#60;B&#62;&#34;1&#34;&#38;");
  });

  it("builds identical images every time, so an outbox retry (which rebuilds the email) sends the same QR", () => {
    const first = buildTicketEmail(order, event, "https://x");
    const second = buildTicketEmail(order, event, "https://x");
    expect(second.html).toBe(first.html);
    expect(second.inlineImages).toEqual(first.inlineImages);
  });

  it("sends the wordmark and the QR codes as inline parts of a multipart/related message", async () => {
    const transport = nodemailer.createTransport({ streamTransport: true, buffer: true, newline: "\n" });
    const email = buildTicketEmail(order, event, "https://x");
    const info = await transport.sendMail(mailOptions("tickets@sheltuh.com.au", email));
    const raw = (info.message as Buffer).toString("utf8");
    expect(raw).toMatch(/Content-Type: multipart\/related/);
    for (const image of email.inlineImages ?? []) {
      expect(raw).toContain(`Content-ID: <${image.cid}>`);
      expect(raw).toContain(image.content.toString("base64").slice(0, 60));
    }
    expect(raw).toContain(`Content-ID: <${WORDMARK_CID}>`);
    expect(raw.match(/Content-Disposition: inline/g)?.length).toBe(3);
    expect(raw).not.toMatch(/Content-Disposition: attachment/);
  });

  it("a message without inline images has no attachments (other emails are unchanged)", () => {
    const options = mailOptions("tickets@sheltuh.com.au", { to: "a@example.com", subject: "s", text: "t", html: "<p>h</p>" });
    expect(options.attachments).toBeUndefined();
  });
});
