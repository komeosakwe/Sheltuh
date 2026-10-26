import { readFileSync } from "node:fs";
import path from "node:path";
import nodemailer from "nodemailer";
import { describe, expect, it } from "vitest";
import { mailOptions } from "@/lib/server/email";
import { EMAIL_COLOURS, EMAIL_FOOTER_IMAGE_HEIGHT, EMAIL_FOOTER_IMAGE_WIDTH, emailFooterImageUrl } from "@/lib/server/email-layout";
import { EMAIL_WORDMARK } from "@/lib/server/email-wordmark";
import { encodePng } from "@/lib/server/png";
import {
  buildTicketEmail,
  eventImageEmailUrl,
  EVENT_UNLISTED_TEXT,
  formatTicketDate,
  formatTicketTime,
  orderReference,
  ticketPageLink,
  ticketDirectionsLink,
  ticketEmailRefundPolicy,
  ticketQrAlt,
  ticketWalletLinks,
  ticketWhen,
  walletPassLink,
} from "@/lib/server/ticket-email";
import type { EventRecord, OrderRecord } from "@/lib/server/types";
import { ticketQrMatrix } from "@/lib/ticket-qr";

const event = {
  title: "Paint & <Sip>",
  venueName: "Studio 5",
  venueAddress: "5 Smith St, Fitzroy",
  suburb: "Fitzroy",
  startsAt: "2027-03-06T09:00:00.000Z",
  endsAt: "2027-03-06T11:00:00.000Z",
  status: "published",
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

/** The email's colours (lib/server/email-layout.ts), lower case as the email writes them. */
const BRAND = { black: "#000000", white: "#ffffff", page: "#f1ede1", ivory: "#fdf9e6", orange: "#ff4800" };
/** Each ticket panel's opening, so panels can be counted and split. */
const CARD = 'class="ticket" style="background-color:#ffffff;border:1px solid #000000;border-radius:8px';
/** A published event with an image, as the API maps it (records.ts EVENT_COLUMNS). */
const IMAGE_PATH = "/api/events/00000000-0000-4000-8000-000000000001/image?v=1730000000";
const withImage = { ...event, imageUrl: IMAGE_PATH } as EventRecord;
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

  it("is one 600px-max centred ivory column on a warm page: black type, an orange YOU'RE IN label and button, both with black text", () => {
    const { html } = buildTicketEmail(order, event, "https://sheltuh.com.au");
    expect(html).toContain("max-width:600px");
    expect(html).toContain(`<body bgcolor="${BRAND.page}" style="margin:0;padding:0;background-color:${BRAND.page}`);
    expect(html).toContain(`bgcolor="${BRAND.ivory}" class="column" style="width:100%;max-width:600px;background-color:${BRAND.ivory}"`);
    // Responsive: the column fills a phone with 20px sides, the heading steps down to 26px.
    expect(html).toMatch(/@media only screen and \(max-width: 620px\)[^}]*\.outer \{ padding: 0 !important; \}/);
    expect(html).toContain(".h1 { font-size: 26px !important; line-height: 32px !important; }");
    // The orange label: black text on Signal Orange, 14px bold, barely tracked (no tiny, widely spaced caps).
    const label = html.match(/<td bgcolor="#ff4800" style="([^"]*)">YOU&rsquo;RE IN<\/td>/);
    expect(label?.[1]).toContain(`color:${BRAND.black}`);
    expect(label?.[1]).toContain("font-size:14px");
    expect(label?.[1]).toContain("letter-spacing:0.5px");
    expect(html).toMatch(/<td bgcolor="#ff4800" style="background-color:#ff4800;border:1px solid #000000[^"]*"><a href="[^"]*checkout\/success/);
    const button = html.match(/<a href="[^"]*checkout\/success[^"]*" style="([^"]*)"/)?.[1] ?? "";
    expect(button).toContain("padding:14px 28px"); // 20px line + 28px padding + border = 50px tall (>= 44px)
    expect(button).toContain("font-size:16px");
    expect(button).toContain("color:#000000"); // black on orange (6.18:1), never white
    // System fonts only: no web font is loaded or named; Outlook is pinned to Segoe UI / Arial.
    expect(html).not.toMatch(/@import|@font-face|fonts\.googleapis|Instrument Sans/);
    expect(html).toContain("<!--[if mso]><style>body, table, td, p, a, h1, span { font-family: 'Segoe UI', Arial, sans-serif !important; }</style><![endif]-->");
    // No layout that email clients drop.
    expect(html).not.toMatch(/display:\s*(flex|grid)|<script|background-image|url\(/i);
  });

  it("has the official wordmark at the top, left aligned, before the label and heading, as an inline image with SHELTÜH as its alt text", () => {
    const { html } = buildTicketEmail(order, event, "https://x");
    const header = html.slice(html.indexOf("<body"), html.indexOf("YOU&rsquo;RE IN"));
    expect(header).toMatch(new RegExp(`<img src="cid:${WORDMARK_CID}"[^>]* alt="SHELT&Uuml;H"`));
    expect(header).not.toContain("icon-192.png");
    expect(html).not.toContain("/icons/");
  });

  it("uses only the shared brand colours, with backgrounds as bgcolor attributes too", () => {
    const { html } = buildTicketEmail(order, event, "https://sheltuh.com.au");
    const colours = new Set(html.match(/#[0-9a-fA-F]{6}\b/g)?.map((c) => c.toLowerCase()));
    for (const colour of colours) expect(Object.values<string>(EMAIL_COLOURS)).toContain(colour);
    for (const colour of Object.values(BRAND)) expect(colours).toContain(colour);
    // Backgrounds are set as bgcolor attributes as well as inline styles (clients that drop one keep the other).
    expect(html).toContain(`<body bgcolor="${BRAND.page}"`);
    expect(html).toContain(`bgcolor="${BRAND.ivory}" class="column"`);
    expect(html).toContain(`bgcolor="${BRAND.white}" class="ticket"`);
    // The old palette is gone.
    for (const old of ["#f3f0e8", "#2b3cff", "#0b0b0b", "#5b574e", "#e3ded1"]) expect(html).not.toContain(old);
  });

  it("opens with the YOU'RE IN label, then the event name as the one heading (32px, 26px on a phone, wrapping)", () => {
    const { html } = buildTicketEmail(order, event, "https://sheltuh.com.au");
    expect(html.match(/<h1/g)).toHaveLength(1);
    const h1 = html.match(/<h1 class="h1" style="([^"]*)">([^<]*)<\/h1>/);
    expect(h1?.[2]).toBe("Paint &#38; &#60;Sip&#62;");
    expect(h1?.[1]).toContain("font-size:32px;line-height:38px");
    expect(h1?.[1]).toContain("overflow-wrap:break-word");
    expect(html.indexOf("YOU&rsquo;RE IN")).toBeLessThan(html.indexOf("<h1"));
  });

  it("has one full-width button, labelled by what the page shows: black text on Signal Orange, at least 44px tall, Outlook-safe, to the order's ticket page, with a text fallback link", () => {
    for (const [tickets, buttonLabel, noun] of [
      [[order.tickets[0]], "View your ticket", "ticket"],
      [order.tickets, "View your tickets", "tickets"],
    ] as const) {
      const { html, text } = buildTicketEmail({ ...order, tickets: [...tickets] }, event, "https://x");
      const buttons = [...html.matchAll(/<td bgcolor="([^"]+)"[^>]*style="([^"]*)"><a href="([^"]+)" style="([^"]*)">([^<]+)<\/a><\/td>/g)];
      expect(buttons).toHaveLength(1);
      const [, bg, cellStyle, href, style, label] = buttons[0];
      expect(label).toBe(`${buttonLabel} →`);
      expect(bg).toBe(BRAND.orange);
      // Outlook for Windows ignores padding on an <a>: the cell carries it there, so the button keeps its size.
      expect(cellStyle).toContain("mso-padding-alt:14px 28px");
      expect(cellStyle).toContain(`background-color:${BRAND.orange}`);
      expect(style).toContain(`color:${BRAND.black}`); // 6.18:1; white on orange would fail for 16px text
      expect(style).toContain("padding:14px 28px"); // 20px line + 28px padding + border = 50px tall (>= 44px)
      expect(style).toContain("display:block");
      // The order's existing ticket link, unchanged: the same URL earlier emails carried.
      expect(href).toBe("https://x/checkout/success?session_id=ord_abc");
      expect(href).toBe(ticketPageLink("https://x", "ord_abc"));
      expect(text).toContain(`${buttonLabel}: https://x/checkout/success?session_id=ord_abc`);
      expect(text).not.toContain("View your order");
      expect(html).toContain('<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:4px 0 12px 0"><tr><td bgcolor="#ff4800"');
      // The discreet fallback: the same link as plain underlined text, without printing the order id.
      expect(html).toContain(
        `Button not working? <a href="https://x/checkout/success?session_id=ord_abc" style="color:#000000;text-decoration:underline">Open your ${noun} here</a>.`,
      );
      expect(html.replace(/href="[^"]*"/g, "")).not.toContain("ord_abc");
    }
  });

  it("gives every ticket its own panel: Your ticket, its type and Ticket n of N, its QR and its code (none dropped)", () => {
    const four = {
      ...order,
      tickets: ["K7QM-2XPD", "R4TN-9WJC", "B8VF-3HLZ", "M2GD-6SYA"].map((code, i) => ({
        ticketCode: code,
        ticketTypeId: "t",
        ticketTypeName: i === 3 ? "VIP" : "GA",
      })),
    } as OrderRecord;
    const { html, text } = buildTicketEmail(four, event, "https://x");
    for (const code of ["K7QM-2XPD", "R4TN-9WJC", "B8VF-3HLZ", "M2GD-6SYA"]) {
      expect(html).toContain(code);
      expect(text).toContain(`Entry code: ${code}`);
    }
    const panels = html.split(CARD).slice(1);
    expect(panels).toHaveLength(4);
    for (const [i, panel] of panels.entries()) {
      expect(panel).toContain(">Your ticket</p>");
      expect(panel).toContain(`>${i === 3 ? "VIP" : "GA"} · Ticket ${i + 1} of 4</p>`);
      expect(panel).toContain(">Show this code at the door.</td>");
      // The backup code: selectable text, secondary to the QR (18px, not the old 28px tile).
      expect(panel).toMatch(new RegExp(`font-size:18px;[^"]*">${["K7QM-2XPD", "R4TN-9WJC", "B8VF-3HLZ", "M2GD-6SYA"][i]}</td>`));
      // The dashed perforation, above the QR.
      expect(panel).toContain("border-top:1px dashed #6b675e");
      expect(panel.indexOf("border-top:1px dashed")).toBeLessThan(panel.indexOf(`cid:ticket-qr-${i + 1}@`));
      expect(panel.match(/<img src="cid:ticket-qr-/g)).toHaveLength(1);
    }
    expect(text).toContain("Ticket 1 of 4 - GA");
    expect(text).toContain("Ticket 4 of 4 - VIP");
  });

  it("numbers a single ticket Ticket 1 of 1, and leaves the type out when there isn't one", () => {
    const { html } = buildTicketEmail({ ...order, tickets: [order.tickets[0]] }, event, "https://x");
    expect(html.split(CARD)).toHaveLength(2);
    expect(html).toContain(">GA · Ticket 1 of 1</p>");
    const untyped = buildTicketEmail({ ...order, tickets: [{ ...order.tickets[0], ticketTypeName: "" }] }, event, "https://x");
    expect(untyped.html).toContain(">Ticket 1 of 1</p>");
    expect(untyped.text).toContain("Ticket 1 of 1\nEntry code: ABCD-EFGH");
  });

  it("never carries placeholder or sample content", () => {
    for (const { html, text } of [buildTicketEmail(order, withImage, "https://x"), buildTicketEmail({ ...order, totalCents: 0 }, event, "https://x")]) {
      for (const body of [html, text]) expect(body).not.toMatch(/DEMO-|SAMPLE QR|NOT VALID FOR ENTRY|lorem/i);
    }
  });

  // Updated deliberately for QR check-in: each ticket now has a QR image, but
  // it encodes only the code printed beneath it, so the rule still holds that
  // nothing is carried by an image alone (and there's still no barcode).
  it("keeps the essentials as real text (images: the wordmark and a QR per ticket inline, plus the footer banner)", () => {
    const { html } = buildTicketEmail(order, { ...event, suburb: "" } as EventRecord, "https://x");
    const FOOTER = "https://x/brand/sheltuh-email-footer.png";
    expect(html.match(/<img /g)).toHaveLength(1 + order.tickets.length + 1);
    expect(html.match(/<img src="cid:/g)).toHaveLength(1 + order.tickets.length);
    // The only remote image is the decorative footer banner on our own domain: no hosted QR, no third-party QR service.
    const remote = [...html.matchAll(/(?:src|background)=["']?((?:https?:)?\/\/[^"' >]+)/g)].map((m) => m[1]);
    expect(remote).toEqual([FOOTER]);
    // Each image has its size as attributes, and alt text.
    for (const tag of html.match(/<img [^>]*>/g) ?? []) {
      expect(tag).toMatch(/ width="\d+" height="\d+" alt="[^"]+"/);
    }
    expect(html).not.toMatch(/ barcode/i);
    const withoutImages = html.replace(/<img[^>]*>/g, "");
    for (const needle of ["Paint &#38; &#60;Sip&#62;", "Studio 5", "5 Smith St, Fitzroy", "ABCD-EFGH", "JKLM-NPQR", "A$64", "#ABC"]) {
      expect(withoutImages).toContain(needle);
    }
  });

  it("shows the date, the time range, the venue and its address, in Melbourne time with its zone name (no tiny caps labels)", () => {
    const { html, text } = buildTicketEmail(order, event, "https://x");
    expect(html).toMatch(/font-size:17px;line-height:24px;color:#000000;font-weight:bold">Saturday 6 March 2027<\/p>/);
    expect(html).toMatch(/font-size:16px;line-height:24px;color:#6b675e">8:00 pm – 10:00 pm AEDT<\/p>/);
    expect(html).toContain(">Studio 5</p>");
    expect(html).toContain(">5 Smith St, Fitzroy</p>");
    expect(html).not.toContain("text-transform:uppercase");
    for (const label of ["Date", "Time", "Venue", "Address"]) expect(html).not.toContain(`>${label}</td>`);
    expect(text).toContain("Date: Saturday 6 March 2027");
    expect(text).toContain("Time: 8:00 pm – 10:00 pm AEDT");
    expect(text).toContain("Venue: Studio 5");
    expect(text).toContain("Address: 5 Smith St, Fitzroy");
  });

  it("gives an overnight or multi-day event its start and end on their own lines, each in its own zone across a daylight-saving change", () => {
    // 11:00 pm Fri to 3:30 am Sat AEDT.
    expect(ticketWhen("2027-03-05T12:00:00.000Z", "2027-03-05T16:30:00.000Z")).toEqual({
      date: "Friday 5 March – Saturday 6 March 2027",
      lines: ["Starts Friday 5 March, 11:00 pm AEDT", "Ends Saturday 6 March, 3:30 am AEDT"],
    });
    // Daylight saving ends 3:00 am Sunday 4 April 2027.
    expect(ticketWhen("2027-04-02T09:00:00.000Z", "2027-04-04T06:00:00.000Z")).toEqual({
      date: "Friday 2 April – Sunday 4 April 2027",
      lines: ["Starts Friday 2 April, 8:00 pm AEDT", "Ends Sunday 4 April, 4:00 pm AEST"],
    });
    // A same-day event (also one ending at exactly midnight) keeps one date and a range.
    expect(ticketWhen("2027-03-06T09:00:00.000Z", "2027-03-06T13:00:00.000Z")).toEqual({
      date: "Saturday 6 March 2027",
      lines: ["8:00 pm – 12:00 am AEDT"],
    });
    const { html, text } = buildTicketEmail(order, { ...event, startsAt: "2027-04-02T09:00:00.000Z", endsAt: "2027-04-04T06:00:00.000Z" } as EventRecord, "https://x");
    expect(html).toContain(">Starts Friday 2 April, 8:00 pm AEDT</p>");
    expect(html).toContain(">Ends Sunday 4 April, 4:00 pm AEST</p>");
    expect(text).toContain("Date: Friday 2 April – Sunday 4 April 2027\nStarts: Friday 2 April, 8:00 pm AEDT\nEnds: Sunday 4 April, 4:00 pm AEST");
    expect(text).not.toContain("Time:");
  });

  // --- Directions ---

  it("links Get directions to Google Maps for the venue and address, encoded", () => {
    const hostile = { ...event, venueName: `Bar "&" <Co>`, venueAddress: "1 Rue & Co #2, Fitzroy" } as EventRecord;
    const link = ticketDirectionsLink(hostile);
    expect(link).toBe(`https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(`Bar "&" <Co>, 1 Rue & Co #2, Fitzroy`)}`);
    const { html, text } = buildTicketEmail(order, hostile, "https://x");
    expect(html).toContain(`<a href="${link!.replaceAll("&", "&#38;")}" style="color:#000000;text-decoration:underline">Get directions&nbsp;&#8599;</a>`);
    expect(text).toContain(`Get directions: ${link}`);
    // Falls back to the suburb when there's no street address.
    expect(ticketDirectionsLink({ venueName: "Studio 5", venueAddress: "", suburb: "Fitzroy" })).toBe(
      "https://www.google.com/maps/dir/?api=1&destination=Studio%205%2C%20Fitzroy",
    );
  });

  it("leaves Get directions out when there's no address or suburb to route to, or the event isn't listed", () => {
    for (const where of [{ venueAddress: "", suburb: "" }, { venueName: "", venueAddress: " ", suburb: "" }]) {
      const e = { ...event, ...where } as EventRecord;
      expect(ticketDirectionsLink(e)).toBeNull();
      const { html, text } = buildTicketEmail(order, e, "https://x");
      expect(html).not.toContain("Get directions");
      expect(html).not.toContain("google.com/maps");
      expect(text).not.toContain("Get directions");
    }
    const unlisted = buildTicketEmail(order, { ...event, status: "draft" }, "https://x");
    expect(unlisted.html).not.toContain("google.com/maps");
    expect(unlisted.text).not.toContain("google.com/maps");
  });

  // --- The event image ---

  it("shows the event's own image full width under the heading, from the site's https origin, with alt text and its proportions kept", () => {
    const { html } = buildTicketEmail(order, withImage, "https://sheltuh.com.au");
    const tag = html.match(/<img src="https:\/\/sheltuh\.com\.au\/api\/events\/[^"]+"[^>]*>/)?.[0] ?? "";
    expect(tag).toContain(`src="https://sheltuh.com.au${IMAGE_PATH}"`);
    expect(tag).toContain('width="600"');
    expect(tag).toContain('alt="Event image for Paint &#38; &#60;Sip&#62;"');
    expect(tag).toContain("width:100%;max-width:600px;height:auto");
    expect(tag).not.toContain("height=");
    // After the heading, before the date; in its own full-width row (no side padding).
    expect(html.indexOf(tag)).toBeGreaterThan(html.indexOf("</h1>"));
    expect(html.indexOf(tag)).toBeLessThan(html.indexOf("Saturday 6 March 2027"));
    expect(html).toContain(`<tr><td style="padding:24px 0 0 0">${tag}</td></tr>`);
    // The two remote images: the event's and the banner. Nothing about the order or buyer in either URL.
    const remote = [...html.matchAll(/src="(https:[^"]+)"/g)].map((m) => m[1]);
    expect(remote).toEqual([`https://sheltuh.com.au${IMAGE_PATH}`, "https://sheltuh.com.au/brand/sheltuh-email-footer.png"]);
    for (const url of remote) expect(url).not.toMatch(/ord_|fan@|ABCD|JKLM/);
  });

  it("leaves the image section out cleanly when there's no image, the site isn't https, or the event isn't listed", () => {
    for (const [e, site] of [
      [event, "https://sheltuh.com.au"],
      [withImage, "http://127.0.0.1:3000"],
      [{ ...withImage, status: "draft" }, "https://sheltuh.com.au"],
    ] as const) {
      const { html } = buildTicketEmail(order, e as EventRecord, site);
      expect(html).not.toContain("/api/events/");
      expect(html).not.toContain("Event image");
      expect(html).not.toContain('<tr><td style="padding:24px 0 0 0">');
    }
  });

  it("only builds an event image URL from a same-origin path on an https site", () => {
    expect(eventImageEmailUrl("https://sheltuh.com.au", IMAGE_PATH)).toBe(`https://sheltuh.com.au${IMAGE_PATH}`);
    expect(eventImageEmailUrl("https://sheltuh.com.au/", IMAGE_PATH)).toBe(`https://sheltuh.com.au${IMAGE_PATH}`);
    for (const path of [undefined, "", "https://evil.test/x.png", "//evil.test/x.png", "/\\evil.test/x.png", "javascript:alert(1)", "api/x"]) {
      expect(eventImageEmailUrl("https://sheltuh.com.au", path)).toBeNull();
    }
    expect(eventImageEmailUrl("http://sheltuh.com.au", IMAGE_PATH)).toBeNull();
    expect(eventImageEmailUrl("not a url", IMAGE_PATH)).toBeNull();
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

  it("omits a venue and address that are empty, and an empty ticket type", () => {
    const { html, text } = buildTicketEmail(
      { ...order, tickets: [{ ticketCode: "ZZZZ-9999", ticketTypeId: "t", ticketTypeName: "" }] } as OrderRecord,
      { ...event, venueName: "", venueAddress: "", suburb: "" } as EventRecord,
      "https://x",
    );
    expect(html).not.toContain("Studio 5");
    expect(html).not.toContain("Smith St");
    expect(html).not.toContain(">Address</td>");
    expect(text).not.toContain("Venue:");
    expect(text).not.toContain("Address:");
    expect(html).toContain("ZZZZ-9999");
    expect(html).not.toContain(" · Ticket");
  });

  it("for an event that's no longer published, sends no date, time, venue or address: a no-longer-listed line instead, and the tickets", () => {
    for (const status of ["draft", "pending_review", "rejected"] as const) {
      const email = buildTicketEmail(order, { ...event, status }, "https://x");
      for (const body of [email.text, email.html]) {
        for (const detail of ["Saturday 6 March", "8:00 pm", "AEDT", "Studio 5", "Smith St", "Fitzroy"]) expect(body).not.toContain(detail);
        expect(body).toContain("ABCD-EFGH");
        expect(body).toContain("JKLM-NPQR");
        expect(body).toContain("https://x/checkout/success?session_id=ord_abc");
      }
      for (const label of ["Date", "Time", "Venue", "Address"]) expect(email.html).not.toContain(`>${label}</td>`);
      expect(email.text).not.toMatch(/^(Date|Time|Venue|Address):/m);
      expect(email.text).toContain(EVENT_UNLISTED_TEXT);
      expect(EVENT_UNLISTED_TEXT).toBe("This event is no longer listed. Contact support@sheltuh.com.au if you have questions.");
      expect(email.html).toContain(
        'This event is no longer listed. Contact <a href="mailto:support@sheltuh.com.au" style="color:#000000;text-decoration:underline">support@sheltuh.com.au</a> if you have questions.',
      );
      expect(qrImages(email)).toHaveLength(2);
    }
    // A published event never gets the line.
    const listed = buildTicketEmail(order, event, "https://x");
    expect(listed.text).not.toContain("no longer listed");
    expect(listed.html).not.toContain("no longer listed");
  });

  it("escapes every dynamic value, including ticket codes and the venue", () => {
    const { html } = buildTicketEmail(
      { ...order, tickets: [{ ticketCode: 'A<B>"1"&', ticketTypeId: "t", ticketTypeName: "<i>VIP</i>" }] } as OrderRecord,
      { ...withImage, title: '<script>alert("x")</script>', venueName: "<b>Venue</b>", venueAddress: "<u>1 St</u>" } as EventRecord,
      "https://x",
    );
    for (const raw of ["<script", "<b>Venue", "<u>1 St", "<i>VIP", 'A<B>"1"&', 'alert("x")']) expect(html).not.toContain(raw);
    expect(html).toContain("&#60;script&#62;");
    // In the heading, the image's alt text and the directions link alike.
    expect(html).toContain(">&#60;script&#62;alert(&#34;x&#34;)&#60;/script&#62;</h1>");
    expect(html).toContain('alt="Event image for &#60;script&#62;alert(&#34;x&#34;)&#60;/script&#62;"');
    expect(html).toContain("destination=%3Cb%3EVenue%3C%2Fb%3E%2C%20%3Cu%3E1%20St%3C%2Fu%3E");
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
    // The summary rows: the reference, and Total paid as currency or Free.
    expect(free).toMatch(/>Total paid<\/td><td align="right" valign="top" style="[^"]*">Free<\/td>/);
    expect(paid).toMatch(/>Total paid<\/td><td align="right" valign="top" style="[^"]*">A\$64<br><span[^>]*>incl\. booking fees<\/span><\/td>/);
    expect(paid).toMatch(/>Order reference<\/td><td align="right" style="[^"]*">#ABC<\/td>/);
    // No internal ids or buyer data in what's shown (the order id only inside the ticket page links).
    for (const html of [free, paid]) {
      const shown = html.replace(/href="[^"]*"/g, "");
      expect(shown).not.toContain("ord_abc");
      expect(shown).not.toContain("fan@example.com");
    }
  });

  describe("refund policy (docs/architecture.md, Refund policy)", () => {
    const ACL = "You're always entitled to a refund if the event is cancelled or significantly changed, as the Australian Consumer Law requires.";
    const ACL_HTML = ACL.replace("'", "&#39;");

    // The event starts Sat 6 Mar 2027, 8:00 pm AEDT; the email is built on 1 Nov 2026.
    const BUILT = new Date("2026-11-01T00:00:00.000Z");

    it("a paid order: the event's policy and the ACL line, under the order summary, in the HTML and the plain text", () => {
      const days = { ...event, refundPolicy: "days_before", refundDays: 7 } as EventRecord;
      const { html, text } = buildTicketEmail(order, days, "https://x", BUILT);
      const line = "Refunds available until Sat 27 Feb 2027, 8:00 pm (7 days before the event).";
      expect(text).toContain(`Refund policy: ${line}\n` + ACL);
      expect(html).toContain(`<span style="font-weight:bold">Refund policy:</span> ${line}</p>`);
      expect(html).toContain(`>${ACL_HTML}</p>`);
      // After the reference and total, before the footer's "Need a hand?".
      const at = html.indexOf("Refund policy:");
      expect(at).toBeGreaterThan(html.indexOf(">Total paid<"));
      expect(at).toBeLessThan(html.indexOf("Need a hand?"));
      expect(text.indexOf("Refund policy:")).toBeGreaterThan(text.indexOf("Total paid:"));
      expect(text.indexOf("Refund policy:")).toBeLessThan(text.indexOf("Need a hand?"));
    });

    it("1 day, and no_change_of_mind (also what an event without the field has)", () => {
      const one = { ...event, refundPolicy: "days_before", refundDays: 1 } as EventRecord;
      expect(buildTicketEmail(order, one, "https://x", BUILT).text).toContain(
        "Refund policy: Refunds available until Fri 5 Mar 2027, 8:00 pm (1 day before the event).",
      );
      const none = { ...event, refundPolicy: "no_change_of_mind" } as EventRecord;
      for (const e of [none, event]) {
        expect(buildTicketEmail(order, e, "https://x").text).toContain("Refund policy: No refunds for change of mind.");
      }
    });

    it("bought (or resent) after the deadline: the refund window has closed, in both parts", () => {
      const days = { ...event, refundPolicy: "days_before", refundDays: 7 } as EventRecord;
      // Three days before the event.
      const { html, text } = buildTicketEmail(order, days, "https://x", new Date("2027-03-03T09:00:00.000Z"));
      const closed = "The refund window for this event has closed. No refunds for change of mind.";
      expect(text).toContain(`Refund policy: ${closed}\n` + ACL);
      expect(html).toContain(`<span style="font-weight:bold">Refund policy:</span> ${closed}</p>`);
      expect(text).not.toContain("up to 7 days");
    });

    it("ticketEmailRefundPolicy: dated in Melbourne time, against now by default", () => {
      const days = { ...event, refundPolicy: "days_before", refundDays: 7 } as EventRecord;
      expect(ticketEmailRefundPolicy(order, days, BUILT)).toBe(
        "Refunds available until Sat 27 Feb 2027, 8:00 pm (7 days before the event).",
      );
      // An event long past: closed, whenever the test runs.
      const past = { ...days, startsAt: "2020-01-10T09:00:00.000Z", endsAt: "2020-01-10T11:00:00.000Z" } as EventRecord;
      expect(ticketEmailRefundPolicy(order, past)).toBe("The refund window for this event has closed. No refunds for change of mind.");
    });

    it("none for a free order, an event that isn't listed, an external event, or days_before without valid days", () => {
      const cases: [OrderRecord, EventRecord][] = [
        [{ ...order, totalCents: 0 }, event],
        [order, { ...event, status: "draft" } as EventRecord],
        [order, { ...event, ticketingMode: "external" } as EventRecord],
        [order, { ...event, refundPolicy: "days_before" } as EventRecord],
      ];
      for (const [o, e] of cases) {
        const { html, text } = buildTicketEmail(o, e, "https://x");
        for (const body of [html, text]) {
          expect(body).not.toContain("Refund policy");
          expect(body).not.toContain("Australian Consumer Law");
        }
      }
    });
  });

  it("includes a plain-text alternative, a preheader and support contact, without inviting replies", () => {
    const { html, text } = buildTicketEmail(order, event, "https://x");
    expect(text).toContain("YOU'RE IN");
    expect(text).toContain("support@sheltuh.com.au");
    // "Need a hand?", the same in both parts, with the address as a mailto link.
    expect(text).toContain("Need a hand? Email support@sheltuh.com.au");
    expect(html).toContain('Need a hand? <a href="mailto:support@sheltuh.com.au" style="color:#000000;text-decoration:underline">support@sheltuh.com.au</a>');
    expect(text.toLowerCase()).not.toContain("reply");
    expect(html.toLowerCase()).not.toContain("just reply");
    // The preheader: hidden everywhere, Outlook desktop included (it ignores display:none alone).
    const preheader = html.match(/<body[^>]*>\n<div style="([^"]*)">([^<]*)</);
    expect(preheader?.[2]).toContain("Your tickets for Paint &#38; &#60;Sip&#62;.");
    for (const rule of ["display:none", "mso-hide:all", "max-height:0", "overflow:hidden", "opacity:0"]) {
      expect(preheader?.[1]).toContain(rule);
    }
    expect(html).toContain('lang="en-AU"');
  });

  it("plain text: every fact in the HTML, in reading order, with no HTML or image references", () => {
    const { text } = buildTicketEmail(order, event, "https://x");
    const lines = [
      "SHELTÜH",
      "YOU'RE IN",
      "Paint & <Sip>",
      "Date: Saturday 6 March 2027",
      "Time: 8:00 pm – 10:00 pm AEDT",
      "Venue: Studio 5",
      "Address: 5 Smith St, Fitzroy",
      "Get directions: https://www.google.com/maps/dir/?api=1&destination=Studio%205%2C%205%20Smith%20St%2C%20Fitzroy",
      "YOUR TICKETS",
      "Ticket 1 of 2 - GA",
      "Entry code: ABCD-EFGH",
      "Ticket 2 of 2 - GA",
      "Entry code: JKLM-NPQR",
      "View your tickets: https://x/checkout/success?session_id=ord_abc",
      "Order reference: #ABC",
      "Total paid: A$64 (incl. booking fees)",
      "Refund policy: No refunds for change of mind.",
      "You're always entitled to a refund if the event is cancelled or significantly changed, as the Australian Consumer Law requires.",
      "Need a hand? Email support@sheltuh.com.au",
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

  it("ends with one branded footer: the owner's footer image from the site's https origin, once, inside the column, after the support line", () => {
    const email = buildTicketEmail(order, event, "https://sheltuh.com.au");
    const { html } = email;
    const url = "https://sheltuh.com.au/brand/sheltuh-email-footer.png";
    expect(emailFooterImageUrl("https://sheltuh.com.au")).toBe(url);
    // Exactly once, and the old banner is gone: a second logo in a received email isn't from this template.
    expect(html.split(url)).toHaveLength(2);
    expect(html).not.toContain("sheltuh_email_signature_logo");
    expect(html).not.toMatch(/MUSIC\. ART\. FASHION\. CULTURE\./i);
    const tag = html.match(/<img src="https:\/\/sheltuh\.com\.au\/brand\/sheltuh-email-footer\.png"[^>]*>/)?.[0] ?? "";
    // 300px wide, its own 600:337 ratio, shrinking with the screen.
    expect([EMAIL_FOOTER_IMAGE_WIDTH, EMAIL_FOOTER_IMAGE_HEIGHT]).toEqual([300, 169]);
    expect(tag).toContain('width="300" height="169"');
    expect(tag).toContain('alt="Sheltüh — Creative event discovery"');
    expect(tag).toContain("width:300px;max-width:100%;height:auto");
    // After the support line, centred under a thin rule, then the footer disclosure line; all inside the column.
    expect(html.indexOf(tag)).toBeGreaterThan(html.indexOf("Need a hand?"));
    expect(html).toContain(`<tr><td align="center" style="border-top:1px solid #dedcd5;padding:24px 0 8px 0">${tag}</td></tr>`);
    expect(html.slice(html.indexOf(tag))).toMatch(/^<img[^>]*><\/td><\/tr><tr><td align="center"[^>]*>Sheltüh &middot; Melbourne<\/td><\/tr><\/table><\/td><\/tr>\n<\/table>\n<!--\[if mso\]>/);
    // Not an attachment, and the URL carries nothing about the order.
    expect(email.inlineImages?.some((i) => i.filename?.includes("footer"))).toBe(false);
    expect(url).not.toMatch(/ord_|\?/);
  });

  it("the footer image is the asset shipped in public/brand (600 x 337: shown at half size)", () => {
    const png = readFileSync(path.join(process.cwd(), "public/brand/sheltuh-email-footer.png"));
    expect(png.subarray(1, 4).toString("ascii")).toBe("PNG");
    expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([EMAIL_FOOTER_IMAGE_WIDTH * 2, 337]);
    expect(Math.round((EMAIL_FOOTER_IMAGE_WIDTH * 337) / 600)).toBe(EMAIL_FOOTER_IMAGE_HEIGHT);
  });

  it("on a non-https site (local dev) the footer shows its name as text, and no image URL is built", () => {
    expect(emailFooterImageUrl("http://127.0.0.1:3000")).toBeNull();
    expect(emailFooterImageUrl("not a url")).toBeNull();
    const { html } = buildTicketEmail(order, event, "http://127.0.0.1:3000");
    expect(html).not.toContain("sheltuh-email-footer.png");
    expect(html).toContain(">Sheltüh — Creative event discovery</span>");
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
    // With images off, the alt text shows in black on the white page (Signal Orange is only for the button).
    expect(tag).toContain(`color:${BRAND.black}`);
    expect(tag).toContain("font-size:20px");
    // Shown at the brand's 24px header height (docs/design/brand-direction-one.md §11 #6).
    expect(EMAIL_WORDMARK.displayHeight).toBe(24);
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

  it("gives each real ticket code a ~220px QR on white, attached inline under a matching cid, with alt text pointing at the backup code", () => {
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
      // 29 modules x 8px = 232px, shrinking only when the screen is narrower; on a white cell, no overlay.
      expect(tag).toContain('width="232" height="232"');
      expect(tag).toContain("width:232px;max-width:100%;height:auto");
      expect(email.html).toMatch(new RegExp(`<td align="center" bgcolor="#ffffff" style="padding:24px 16px 0 16px;background-color:#ffffff">${tag.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}</td>`));
      expect(images[i].contentType).toBe("image/png");
      // Numbered, never named after the code (the code is the ticket; file names leak into previews and downloads).
      expect(images[i].filename).toBe(`ticket-${i + 1}-qr.png`);
      expect(images[i].filename).not.toContain(code);
      // The PNG is this ticket's own QR (encodePng's pixels are tested in png.test.ts).
      expect(images[i].content.equals(encodePng(ticketQrMatrix(code)!, 16, 4))).toBe(true);
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

  it("a seated ticket's card has its seat under the type, before the QR and backup code (HTML and plain text)", () => {
    const seated = {
      ...order,
      tickets: [{ ...order.tickets[0], seat: { section: "Stalls", row: "F", seat: "12", kind: "standard" } }],
    } as OrderRecord;
    const { html, text } = buildTicketEmail(seated, event, "https://x");
    const card = html.split(CARD)[1];
    const seatAt = card.indexOf(">Stalls · Row F · Seat 12</p>");
    expect(seatAt).toBeGreaterThan(card.indexOf(">GA · Ticket 1 of 1</p>"));
    expect(card.indexOf(">GA · Ticket 1 of 1</p>")).toBeGreaterThan(-1);
    expect(card.indexOf("cid:ticket-qr-1@")).toBeGreaterThan(seatAt);
    expect(card.indexOf(">Backup code</td>")).toBeGreaterThan(seatAt);
    expect(text).toContain("Ticket 1 of 1 - GA\nSeat: Stalls, Row F, Seat 12\nEntry code: ABCD-EFGH");
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
      expect(images[i].content.equals(encodePng(ticketQrMatrix(code)!, 16, 4))).toBe(true);
      expect(email.html).toContain(`alt="QR code for ticket ${code}.`);
    }
    expect(email.html.split(CARD)).toHaveLength(5);
  });

  it("tells the buyer how to use the QR, in the HTML and the plain text", () => {
    const one = buildTicketEmail({ ...order, tickets: [order.tickets[0]] }, event, "https://x");
    expect(one.html).toContain(">Show this code at the door.</td>");
    expect(one.html).toContain("Turn your screen brightness up. If the QR code won&rsquo;t scan, door staff can type in the backup code.");
    expect(one.html).toContain("Show your QR code at the door."); // preheader
    // The plain text can't show a QR: it points at the entry code, and at the full email for the QR.
    expect(one.text).toContain("YOUR TICKET\nShow your entry code at the door (the QR code is in the full email).");
    expect(one.text).not.toMatch(/QR code in this email/i);
    expect(one.text).toContain("Entry code: ABCD-EFGH");
    const many = buildTicketEmail(order, event, "https://x");
    expect(many.html.split(">Show this code at the door.</td>")).toHaveLength(3);
    expect(many.html).toContain("Turn your screen brightness up. If a QR code won&rsquo;t scan, door staff can type in its backup code.");
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
    expect(raw.match(/Content-Disposition: inline/g)?.length).toBe(1 + order.tickets.length);
    expect(raw).not.toMatch(/Content-Disposition: attachment/);
  });

  it("a message without inline images has no attachments (other emails are unchanged)", () => {
    const options = mailOptions("tickets@sheltuh.com.au", { to: "a@example.com", subject: "s", text: "t", html: "<p>h</p>" });
    expect(options.attachments).toBeUndefined();
  });
});

describe("wallet links (ticketWalletLinks; the outbox passes which wallets are on)", () => {
  const paid = { ...order, status: "paid" } as OrderRecord;
  const BOTH = { google: true, apple: true };
  const link = (provider: "apple" | "google", n: number) => `https://x/api/orders/by-session/ord_abc/wallet/${provider}?ticket=${n}`;
  const panelsOf = (html: string) => html.split(CARD).slice(1);

  it("none by default (no wallet on), so the email is as before", () => {
    const { html, text } = buildTicketEmail(paid, event, "https://x");
    for (const body of [html, text]) {
      expect(body).not.toContain("/wallet/");
      expect(body).not.toMatch(/Add to (Apple|Google) Wallet/);
    }
  });

  it("each ticket, right after its entry code, links its own number's route (1-based, the route's ?ticket=)", () => {
    const { html, text } = buildTicketEmail(paid, event, "https://x", new Date(), BOTH);
    expect(text).toContain(
      [
        "Ticket 1 of 2 - GA",
        "Entry code: ABCD-EFGH",
        `Add to Apple Wallet: ${link("apple", 1)}`,
        `Add to Google Wallet: ${link("google", 1)}`,
        "",
        "Ticket 2 of 2 - GA",
        "Entry code: JKLM-NPQR",
        `Add to Apple Wallet: ${link("apple", 2)}`,
        `Add to Google Wallet: ${link("google", 2)}`,
      ].join("\n"),
    );
    const panels = panelsOf(html);
    expect(panels).toHaveLength(2);
    for (const [i, panel] of panels.entries()) {
      const n = i + 1;
      expect(panel).toContain(order.tickets[i].ticketCode);
      expect(panel).toContain(`<a href="${link("apple", n)}" style="color:#000000;text-decoration:underline">Add to Apple Wallet</a>`);
      expect(panel).toContain(`<a href="${link("google", n)}" style="color:#000000;text-decoration:underline">Add to Google Wallet</a>`);
      // Under the code, inside the panel.
      expect(panel.indexOf("Add to Apple Wallet")).toBeGreaterThan(panel.indexOf(order.tickets[i].ticketCode));
      expect(panel.match(/\?ticket=(\d+)/g)).toEqual([`?ticket=${n}`, `?ticket=${n}`]);
    }
    expect(walletPassLink("https://x", "ord_abc", "google", 2)).toBe(link("google", 2));
  });

  it("only the wallets that are on", () => {
    const google = buildTicketEmail(paid, event, "https://x", new Date(), { google: true, apple: false });
    expect(google.text).toContain(`Add to Google Wallet: ${link("google", 1)}`);
    expect(google.text).not.toContain("Apple Wallet");
    expect(google.html).not.toContain("Apple Wallet");
    const apple = buildTicketEmail(paid, event, "https://x", new Date(), { google: false, apple: true });
    expect(apple.html).toContain(">Add to Apple Wallet</a>");
    expect(apple.html).not.toContain("Google Wallet");
    const none = buildTicketEmail(paid, event, "https://x", new Date(), { google: false, apple: false });
    expect(none.html).not.toContain("/wallet/");
    expect(none.text).not.toContain("/wallet/");
  });

  it("none for an event that isn't listed, or an order that isn't paid (the routes would 404)", () => {
    for (const status of ["draft", "pending_review", "rejected"] as const) {
      const { html, text } = buildTicketEmail(paid, { ...event, status }, "https://x", new Date(), BOTH);
      expect(html).not.toContain("/wallet/");
      expect(text).not.toContain("/wallet/");
      expect(ticketWalletLinks(paid, { status }, "https://x", BOTH, 0)).toEqual([]);
    }
    for (const status of ["pending", "refunded"] as const) {
      expect(ticketWalletLinks({ ...paid, status }, event, "https://x", BOTH, 0)).toEqual([]);
    }
  });

  it("keeps the refund policy and the summary as they were, and encodes the order id in the link", () => {
    const days = { ...event, refundPolicy: "days_before", refundDays: 7 } as EventRecord;
    const BUILT = new Date("2026-11-01T00:00:00.000Z");
    const without = buildTicketEmail(paid, days, "https://x", BUILT);
    const withWallet = buildTicketEmail(paid, days, "https://x", BUILT, BOTH);
    const line = "Refund policy: Refunds available until Sat 27 Feb 2027, 8:00 pm (7 days before the event).";
    expect(withWallet.text).toContain(line);
    // Everything after the tickets is unchanged.
    const tail = (t: string) => t.slice(t.indexOf("View your tickets:"));
    expect(tail(withWallet.text)).toBe(tail(without.text));
    const htmlTail = (h: string) => h.slice(h.lastIndexOf("</table>", h.indexOf("View your tickets")));
    expect(htmlTail(withWallet.html)).toBe(htmlTail(without.html));
    const odd = buildTicketEmail({ ...paid, orderId: "ord_a/b&c" }, event, "https://x", new Date(), BOTH);
    expect(odd.html).toContain('href="https://x/api/orders/by-session/ord_a%2Fb%26c/wallet/apple?ticket=1"');
  });
});
