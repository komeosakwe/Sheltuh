import { readFileSync } from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { buildEventReviewEmail, buildOrganiserJoinedEmail, buildOrganiserReviewEmail } from "@/lib/server/admin-review-email";
import type { EmailMessage } from "@/lib/server/email";
import { buildEventReminderEmail } from "@/lib/server/event-reminder-email";
import { button, EMAIL_COLOURS, emailFooterImageUrl, escapeHtml, INK, SIGNAL, supportFooter, WORDMARK_CID, wordmarkImage } from "@/lib/server/email-layout";
import { MODERN_COLOURS, ICON_PATHS } from "@/lib/server/email-modern-layout";
import { EMAIL_WORDMARK } from "@/lib/server/email-wordmark";
import { KIT } from "@/lib/server/email-kit";
import { TICKET_EMAIL_COLOURS } from "@/lib/server/email-ticket-layout";
import { buildFollowerNewEventsEmail } from "@/lib/server/follower-email";
import { DETAILS_NOTICE } from "@/lib/buyer-details";
import { buildFreeConfirmationEmail } from "@/lib/server/free-confirmation-email";
import { buildHolderMessageEmail } from "@/lib/server/holder-message-email";
import { buildInviteEmail } from "@/lib/server/invite-email";
import { buildTicketEmail } from "@/lib/server/ticket-email";
import type { EventRecord, OrderLineItem, OrderRecord, TicketSeat } from "@/lib/server/types";
import { buildWaitlistAvailableEmail, buildWaitlistConfirmationEmail } from "@/lib/server/waitlist-email";

// Every transactional email is built on lib/server/email-layout.ts: the same
// colours, ivory column, button and support line, so the ticket emails can't
// drift from the waitlist and follower emails again. The ticket and
// free-ticket confirmation emails (the two a buyer gets in a row) also share
// the wordmark header and the branded footer. The day-before reminder and the
// organiser's announcement have their own, newer look (lib/server/
// email-modern-layout.ts: ivory, one orange accent, hosted logo and icons), so
// they're held to that look's rules below, not to EMAIL_COLOURS and the
// shared column. The tickets email has its own design too
// (lib/server/email-ticket-layout.ts, docs/design/ticket-email.md: white,
// Instrument Sans, the orange-framed ticket card), held to TICKET_EMAIL_COLOURS.
// Every other email stays exactly as it was.

const site = "https://sheltuh.test";

const event = {
  eventId: "00000000-0000-4000-8000-000000000001",
  slug: "neon-static",
  title: "Neon & <Static>",
  venueName: "The Cellar Door",
  suburb: "Melbourne",
  venueAddress: "12 Hosier Lane, Melbourne VIC 3000",
  startsAt: "2027-03-06T09:00:00.000Z",
  endsAt: "2027-03-06T13:00:00.000Z",
  // Published, so the ticket email shows its date and venue (an unlisted event's would say it's no longer listed).
  status: "published",
} as EventRecord;

const lineItems: OrderLineItem[] = [
  { ticketTypeId: "ga", ticketTypeName: "General admission", unitPriceCents: 0, feePolicy: "buyer-pays", quantity: 2 },
];

const seat: TicketSeat = { section: "Stalls", row: "A", seat: "2", kind: "standard" };

const order = {
  orderId: "ord_abc",
  buyerEmail: "fan@example.com",
  totalCents: 6400,
  tickets: [
    { ticketCode: "ABCD-EFGH", ticketTypeId: "ga", ticketTypeName: "GA" },
    { ticketCode: "JKLM-NPQR", ticketTypeId: "ga", ticketTypeName: "GA" },
  ],
} as OrderRecord;

const follower = (total: number, events: EventRecord[]) =>
  buildFollowerNewEventsEmail({
    to: "fan@example.com",
    organiserName: "Cellar Door Sound",
    organiserId: "org_1",
    events,
    total,
    siteUrl: site,
    unsubscribeLink: `${site}/following/unsubscribe#token=x`,
  });

const emails: Record<string, () => EmailMessage> = {
  ticketPaid: () => buildTicketEmail(order, event, site),
  ticketFreeOne: () => buildTicketEmail({ ...order, totalCents: 0, tickets: [order.tickets[0]] }, event, site),
  ticketSeated: () => buildTicketEmail({ ...order, tickets: [{ ...order.tickets[0], seat }] }, event, site),
  freeConfirmation: () => buildFreeConfirmationEmail("fan@example.com", event, lineItems, `${site}/checkout/confirm#token=x`, 24),
  freeConfirmationSeated: () =>
    buildFreeConfirmationEmail("fan@example.com", event, lineItems, `${site}/checkout/confirm#token=x`, 24, [seat]),
  waitlistConfirmation: () => buildWaitlistConfirmationEmail("fan@example.com", event, `${site}/waitlist/confirm#token=x`, 24),
  waitlistAvailable: () =>
    buildWaitlistAvailableEmail("fan@example.com", event, `${site}/events/neon-static#tickets`, `${site}/waitlist/leave#token=x`),
  followerOne: () => follower(1, [event]),
  followerMany: () => follower(9, [event, { ...event, slug: "second" } as EventRecord]),
  eventReview: () =>
    buildEventReviewEmail({
      to: "ops@sheltuh.test",
      title: event.title,
      organiserName: "Cellar Door Sound",
      startsAt: event.startsAt,
      resubmitted: false,
      siteUrl: site,
    }),
  eventReviewResubmitted: () =>
    buildEventReviewEmail({
      to: "ops@sheltuh.test",
      title: event.title,
      organiserName: "Cellar Door Sound",
      startsAt: event.startsAt,
      resubmitted: true,
      siteUrl: site,
    }),
  organiserReview: () => buildOrganiserReviewEmail({ to: "ops@sheltuh.test", organiserName: "Cellar Door Sound", siteUrl: site }),
  organiserJoined: () => buildOrganiserJoinedEmail({ to: "ops@sheltuh.test", organiserName: "Cellar Door <Sound>", siteUrl: site }),
  inviteOrganiser: () =>
    buildInviteEmail({
      to: "fan@example.com",
      kind: "organiser",
      organiserName: "Cellar Door <Sound>",
      link: `${site}/invite#token=x`,
      daysValid: 14,
      siteUrl: site,
    }),
  inviteMember: () =>
    buildInviteEmail({ to: "fan@example.com", kind: "member", link: `${site}/invite#token=x`, daysValid: 14, siteUrl: site }),
  eventReminder: () =>
    buildEventReminderEmail({
      to: "fan@example.com",
      orderId: "ord_abc",
      event: { ...event, organiserName: "Cellar Door <Sound>" } as EventRecord,
      siteUrl: site,
      now: new Date("2027-03-05T09:00:00.000Z"),
    }),
  holderMessage: () =>
    buildHolderMessageEmail({
      to: "fan@example.com",
      messageId: "00000000-0000-4000-8000-000000000002",
      eventTitle: event.title,
      organiserName: "Cellar Door <Sound>",
      organiserId: "org_1",
      subject: "Doors now open at 7pm",
      body: "Doors open at 7pm & not 8pm.\nBring <ID>.",
      siteUrl: site,
      stopToken: "t".repeat(43),
    }),
};

/** Every colour value in the markup: style properties and bgcolor attributes. */
function coloursIn(html: string): string[] {
  return [...html.matchAll(/(?:bgcolor="|color:\s*|solid\s+)(#[0-9a-f]{3,8}\b|[a-z]+\b)/gi)].map((m) => m[1].toLowerCase());
}

/** The button's cell, exactly as the shared helper writes it. */
const BUTTON_CELL = button("x", "https://x").match(/<td [^>]*>/)![0];

const OLD_PALETTE = ["#2b3cff", "#f3f0e8", "#0b0b0b", "#5b574e", "#e3ded1"];

/** The tickets email: the shared 1120 layout around its own orange-framed card (TICKET_EMAIL_COLOURS). */
const TICKET_EMAILS = ["ticketPaid", "ticketFreeOne", "ticketSeated"];
/** Emails on the shared 1120 layout (lib/server/email-kit.ts, Latte's frames), with their tone. */
const KIT_EMAILS: Record<string, "customer" | "organiser"> = {
  ticketPaid: "customer",
  ticketFreeOne: "customer",
  ticketSeated: "customer",
  eventReminder: "customer",
  holderMessage: "customer",
  freeConfirmation: "customer",
  freeConfirmationSeated: "customer",
  waitlistConfirmation: "customer",
  waitlistAvailable: "customer",
  followerOne: "customer",
  followerMany: "customer",
  inviteMember: "customer",
  inviteOrganiser: "organiser",
};
const isKit = (name: string) => name in KIT_EMAILS;
/** Emails with the inline wordmark header and the old branded footer banner: none now (every customer email is on the 1120 layout). */
const BRANDED: string[] = [];
/** The two emails in the modern look: hosted https logo (no cid), compact footer, MODERN_COLOURS. */
const MODERN: string[] = [];
const classic = Object.entries(emails).filter(([name]) => !MODERN.includes(name) && !isKit(name));
const coloursOf = (name: string): Record<string, string> =>
  TICKET_EMAILS.includes(name) ? { ...KIT, ...TICKET_EMAIL_COLOURS } : isKit(name) ? KIT : MODERN.includes(name) ? MODERN_COLOURS : EMAIL_COLOURS;

describe("every transactional email uses the shared brand layout", () => {
  it.each(Object.entries(emails))("%s: no old palette colour, and only its look's tokens", (name, build) => {
    const { html } = build();
    for (const old of OLD_PALETTE) expect(html.toLowerCase()).not.toContain(old);
    const allowed = new Set<string>(Object.values(coloursOf(name)).map((c) => c.toLowerCase()));
    const used = coloursIn(html);
    expect(used.length).toBeGreaterThan(0);
    for (const colour of used) expect(allowed).toContain(colour);
  });

  it.each(classic)("%s: Signal Orange only as a fill with black text: its one button", (name, build) => {
    const { html } = build();
    // Exactly one call-to-action.
    expect(html.split(BUTTON_CELL)).toHaveLength(2);
    const rest = html.replace(BUTTON_CELL, "");
    expect(rest).not.toContain(SIGNAL); // no orange anywhere else
    const label = html.slice(html.indexOf(BUTTON_CELL)).match(/<a [^>]*style="([^"]*)"/)![1];
    expect(label).toContain(`color:${INK}`);
    expect(html).not.toMatch(/(?<![-\w])color:\s*(#fff\b|#ffffff|white)/i); // no white text, on orange or anywhere
  });

  it.each(classic)("%s: the shared page, column, heading and support line", (name, build) => {
    const { html } = build();
    expect(html).toContain('<meta name="color-scheme" content="light only">');
    expect(html).toContain(`bgcolor="${EMAIL_COLOURS.page}" style="background-color:${EMAIL_COLOURS.page}"`);
    expect(html).toContain(
      `bgcolor="${EMAIL_COLOURS.card}" class="column" style="width:100%;max-width:600px;background-color:${EMAIL_COLOURS.card}"`,
    );
    // One h1: the shared 36/44 heading at weight 600 (30/36 on a phone).
    expect(html.match(/<h1 /g)).toHaveLength(1);
    expect(html).toMatch(/<h1 class="h1" style="margin:0 0 \d+px 0;font-family:[^"]*;font-size:36px;line-height:44px;font-weight:600;letter-spacing:normal;color:#000000">/);
    // The support address as a mailto link, and the disclosure line, in every email.
    expect(html).toContain('href="mailto:support@sheltuh.com.au"');
    expect(html).toContain("Sheltüh &middot; Melbourne");
    if (!BRANDED.includes(name)) expect(html).toContain(supportFooter);
  });

  it.each(Object.keys(KIT_EMAILS))("%s: Latte's 1120 layout: a white 600px column on the tone's page, one h1, the inline wordmark top and bottom, the shared footer", (name) => {
    const { html } = emails[name]();
    const pageColour = KIT_EMAILS[name] === "customer" ? KIT.cream : KIT.surface;
    expect(html).toContain('<meta name="color-scheme" content="light">');
    expect(html).toContain(`<body bgcolor="${pageColour}"`);
    expect(html).toContain(`bgcolor="${KIT.white}" style="width:100%;max-width:600px;background-color:${KIT.white}"`);
    expect(html).toContain(".kp{padding:32px 16px!important}");
    expect(html.match(/<h1 /g)).toHaveLength(1);
    expect(html).toContain('href="mailto:support@sheltuh.com.au"');
    expect(html.split(`<img src="cid:${WORDMARK_CID}"`)).toHaveLength(3);
    expect(html).toContain(">SHELT&Uuml;H &middot; MELBOURNE</p>");
    for (const page of ["/privacy", "/terms", "/help"]) expect(html).toContain(`href="${site}${page}"`);
    // The frames' company line waits for the owner's company details.
    expect(html).not.toMatch(/Pty Ltd|ABN/);
    expect(html).not.toContain(emailFooterImageUrl(site)!);
    expect(html).not.toMatch(/gradient|box-shadow|text-shadow|background-image|display:\s*(flex|grid)|<script/i);
    // Every orange call to action carries a black label.
    for (const cta of html.match(/<a class="kbp" [^>]*style="[^"]*"/g) ?? []) expect(cta).toContain(`color:${INK}`);
  });

  it.each(TICKET_EMAILS)("%s: the ticket keeps its orange-framed card (owner rule 21 Nov) and the orange call to action", (name) => {
    const { html } = emails[name]();
    expect(html).toContain(`bgcolor="${SIGNAL}" class="ticket"`);
    expect(html).toMatch(new RegExp(`<td align="center" bgcolor="${SIGNAL}" [^>]*><a class="kbp" [^>]*style="[^"]*color:${INK}`));
    expect(html).toMatch(new RegExp(`color:${TICKET_EMAIL_COLOURS.signalText};letter-spacing:0\\.12em`));
  });

  it("the other emails carry no images", () => {
    for (const [name, build] of Object.entries(emails)) {
      if (BRANDED.includes(name) || MODERN.includes(name) || isKit(name)) continue;
      const email = build();
      expect(email.html, name).not.toContain("<img");
      expect(email.inlineImages ?? [], name).toEqual([]);
    }
  });

  it("the follower and waitlist emails name the town and state under each event card, even with no venue name or a generic one", () => {
    const townHall = { ...event, venueName: "Town Hall", venueAddress: "", suburb: "Castlemaine", state: "VIC" } as EventRecord;
    const noVenue = { ...event, slug: "no-venue", title: "Open Studio", venueName: "", venueAddress: "", suburb: "Ballarat", state: "VIC" } as EventRecord;
    const emails = [
      follower(2, [townHall, noVenue]),
      buildWaitlistConfirmationEmail("fan@example.com", townHall, `${site}/waitlist/confirm#token=x`, 24),
      buildWaitlistAvailableEmail("fan@example.com", noVenue, `${site}/events/no-venue#tickets`, `${site}/waitlist/leave#token=x`),
    ];
    const [followed, confirm, available] = emails.map((e) => e.html);
    expect(followed).toContain("Town Hall, Castlemaine, VIC</p>");
    expect(followed).toContain("Ballarat, VIC</p>");
    expect(confirm).toContain("Town Hall, Castlemaine, VIC</p>");
    expect(available).toContain("Ballarat, VIC</p>");
    // The plain text says the same.
    expect(emails[0].text).toContain("Town Hall, Castlemaine, VIC");
    expect(emails[0].text).toContain("Ballarat, VIC");
  });

  it("sets the event title in black in the ticket, free-confirmation, waitlist and follower emails (the 1120 Ticket card's title)", () => {
    const title = `font-size:20px;line-height:28px;font-weight:600;color:${INK};overflow-wrap:break-word;word-wrap:break-word">${escapeHtml(event.title)}</p>`;
    for (const name of ["freeConfirmation", "waitlistConfirmation", "waitlistAvailable"]) {
      expect(emails[name]().html).toContain(title);
    }
    expect(emails.followerOne().html).toContain(`>${escapeHtml(event.title)}</a></p>`);
    // The ticket card's title.
    expect(emails.ticketPaid().html).toContain(`font-size:32px;line-height:38px;font-weight:700;color:${INK};overflow-wrap:break-word;word-wrap:break-word">${escapeHtml(event.title)}</p>`);
  });

  it("the reminder and the holder message: escaped text, an automatic message, why it came; only the message names its sender and has a stop link", () => {
    const reminder = emails.eventReminder();
    expect(reminder.html).toContain("Neon &#38; &#60;Static&#62;");
    expect(reminder.html).not.toContain("<Static>");
    expect(reminder.html).toContain("Open your ticket");
    expect(reminder.text).toContain("See you tomorrow at Neon & <Static>.");
    expect(reminder.text).toContain("You’re getting this email because you have tickets for this event.");
    const message = emails.holderMessage();
    expect(message.html).toContain("Doors open at 7pm &#38; not 8pm.<br>Bring &#60;ID&#62;.");
    expect(message.html).not.toContain("<ID>");
    expect(message.text).toContain("Sheltüh sent this for Cellar Door <Sound>. You’re getting it because you have tickets for");
    expect(message.text).toContain("Report this message: mailto:support@sheltuh.com.au?subject=");
    expect(message.text).toContain("About Cellar Door <Sound>: https://sheltuh.test/organisers/org_1");
    // The reminder is service information about a purchase: no opt-out.
    expect(reminder.headers).toEqual({ "Auto-Submitted": "auto-generated" });
    expect(`${reminder.html}${reminder.text}`.toLowerCase()).not.toContain("unsubscribe");
    // The message offers "Stop messages from {organiser}" (a page with a button) and the one-click headers.
    const token = "t".repeat(43);
    expect(message.text).toContain(`Stop messages from Cellar Door <Sound>: https://sheltuh.test/holder-messages/stop#token=${token}`);
    expect(message.html).toContain(`href="https://sheltuh.test/holder-messages/stop#token=${token}"`);
    expect(message.html).toContain("Stop messages from Cellar Door &#60;Sound&#62;");
    expect(message.headers).toEqual({
      "Auto-Submitted": "auto-generated",
      "List-Unsubscribe": `<https://sheltuh.test/api/holder-messages/stop?token=${token}>`,
      "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
    });
  });

  it("keeps each email's own content: QR tickets, seat lines, totals with booking fees, footer banner", () => {
    const paid = emails.ticketPaid();
    // One inline QR, the first ticket's (the others are rows: their QR codes are on the ticket page), plus the
    // inline wordmark (header and footer, the only other cid image).
    expect(paid.html.match(/<img class="qr" src="cid:ticket-qr-/g)).toHaveLength(1);
    expect(paid.html).toContain(">TICKET 2 of 2</p>");
    expect(paid.html.match(/src="cid:/g)).toHaveLength(3);
    expect(paid.html).toContain('<img src="cid:sheltuh-wordmark@sheltuh.com.au"');
    expect(paid.html).toContain("Incl. booking fees");
    expect(paid.html).toContain("Get directions");
    expect(emails.ticketSeated().html).toContain("Stalls · Row A · Seat 2");
    const seated = emails.freeConfirmationSeated();
    expect(seated.html).toContain("Stalls · Row A · Seat 2");
    expect(seated.html).toContain("only held once you confirm");
    expect(emails.freeConfirmation().html).toContain("Tickets: 2 × General admission");
  });

  it("the free-ticket confirmation repeats the sharing notice, in both parts: confirming is when the organiser can see the guest", () => {
    for (const name of ["freeConfirmation", "freeConfirmationSeated"] as const) {
      const mail = emails[name]();
      expect(mail.text, name).toContain(DETAILS_NOTICE);
      expect(mail.html, name).toContain(DETAILS_NOTICE);
    }
  });
});

// ---------------------------------------------------------------------------
// The two emails in the modern look
// ---------------------------------------------------------------------------

/** WCAG contrast ratio of two #rrggbb colours. */
function contrast(a: string, b: string): number {
  const luminance = (hex: string) => {
    const [r, g, bl] = [1, 3, 5].map((i) => {
      const v = parseInt(hex.slice(i, i + 2), 16) / 255;
      return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
  };
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** The PNG's pixel size, read from its IHDR. */
function pngSize(file: string): [number, number] {
  const png = readFileSync(path.join(process.cwd(), "public", file));
  return [png.readUInt32BE(16), png.readUInt32BE(20)];
}

const IMAGE_PATH = "/api/events/00000000-0000-4000-8000-000000000001/image?v=1700000000";
const TICKET_EMAIL_ICON_PIN = "/email/ticket/pin.png";

const reminderOf = (overrides: Partial<EventRecord> = {}, siteUrl = site, now = new Date("2027-03-05T09:00:00.000Z")) =>
  buildEventReminderEmail({
    to: "fan@example.com",
    orderId: "ord_abc",
    event: { ...event, organiserName: "Static Collective", imageUrl: IMAGE_PATH, ...overrides } as EventRecord,
    siteUrl,
    now,
  });

const announcementOf = (overrides: { siteUrl?: string; body?: string } = {}) =>
  buildHolderMessageEmail({
    to: "fan@example.com",
    messageId: "00000000-0000-4000-8000-000000000002",
    eventTitle: "Neon Static",
    organiserName: "Static Collective",
    organiserId: "org_1",
    subject: "Doors now open at 7pm",
    body: overrides.body ?? "Doors open at 7pm.\nBring ID.",
    siteUrl: overrides.siteUrl ?? site,
    stopToken: "t".repeat(43),
  });

describe("the modern look's assets and colours", () => {
  it("the hosted wordmark and icons exist at the sizes the markup says (2x)", () => {
    expect(pngSize("brand/sheltuh-wordmark-email.png")).toEqual([212, 48]); // shown at 106 x 24
    for (const file of Object.values(ICON_PATHS)) expect(pngSize(file)).toEqual([40, 40]); // shown at 20 x 20
  });

  it("the button's ink on the orange, and the muted text on the ivory and on the tint, pass AA", () => {
    const { ink, accent, muted, bg, tint } = MODERN_COLOURS;
    expect(contrast(ink, accent)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(ink, bg)).toBeGreaterThanOrEqual(7);
    expect(contrast(muted, bg)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(muted, tint)).toBeGreaterThanOrEqual(4.5);
  });
});

describe("the email wordmarks", () => {
  const CLASSIC = "public/brand/sheltuh-wordmark-email.png"; // inline in email-layout.ts, hosted in email-modern-layout.ts
  const TICKET = "public/email/ticket/wordmark.png"; // inline in email-ticket-layout.ts

  it("the inline wordmark is the PNG shipped in public/brand, at 2x", () => {
    const shipped = readFileSync(path.join(process.cwd(), CLASSIC));
    const png = Buffer.from(EMAIL_WORDMARK.pngBase64, "base64");
    expect(png.equals(shipped)).toBe(true);
    expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([EMAIL_WORDMARK.displayWidth * 2, EMAIL_WORDMARK.displayHeight * 2]);
    expect(wordmarkImage().content.equals(shipped)).toBe(true);
  });

  it.each([CLASSIC, TICKET])("%s: Signal Orange on transparent, legible on every ground it sits on", async (file) => {
    const { data, info } = await sharp(path.join(process.cwd(), file)).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const signal = [1, 3, 5].map((i) => parseInt(SIGNAL.slice(i, i + 2), 16));
    let opaque = 0;
    let clear = 0;
    const offColour: string[] = [];
    for (let i = 0; i < info.width * info.height; i += 1) {
      const [r, g, b, a] = data.subarray(i * 4, i * 4 + 4);
      if (a === 0) clear += 1;
      if (a !== 255) continue;
      opaque += 1;
      if (r !== signal[0] || g !== signal[1] || b !== signal[2]) offColour.push(`${i}: ${r},${g},${b}`);
    }
    expect(offColour).toEqual([]); // every solid pixel is the orange: no plate, no black
    expect(opaque).toBeGreaterThan(1000); // the mark is there
    expect(clear).toBeGreaterThan(1000); // and nothing is behind it
    // A logo, so held to the 3:1 for graphics: on each layout's ground, and on a dark page a client may force.
    for (const ground of [TICKET_EMAIL_COLOURS.white, EMAIL_COLOURS.card, MODERN_COLOURS.bg, "#1e1e1e"]) {
      expect(contrast(SIGNAL, ground), ground).toBeGreaterThanOrEqual(3);
    }
  });
});

describe("the event reminder (Latte's 1120 Reminder frame)", () => {
  it("reads in the frame's order: eyebrow, heading, the compact Ticket card, the date and venue rows, Open your ticket, Need a hand?, the footer", () => {
    const { html } = reminderOf();
    const order = [
      ">Tomorrow · Sat 6 Mar</p>",
      ">See you tomorrow at Neon &#38; &#60;Static&#62;.</h1>",
      ">Sat 6 Mar · 8 pm–12 am</p>",
      ">Neon &#38; &#60;Static&#62;</p>",
      ">The Cellar Door</p>",
      ">Saturday 6 March 2027</p>",
      "Add to calendar: ",
      ">12 Hosier Lane, Melbourne VIC 3000</p>",
      "Get directions&nbsp;&#8599;",
      ">Open your ticket&nbsp;&nbsp;",
      "Need a hand? ",
      ">You’re getting this email because you have tickets for this event.",
    ];
    let at = -1;
    for (const piece of order) {
      const next = html.indexOf(piece, at + 1);
      expect(next, piece).toBeGreaterThan(at);
      at = next;
    }
  });

  it("says it's today when it is", () => {
    const { html, subject } = reminderOf({}, site, new Date("2027-03-05T21:30:00.000Z"));
    expect(subject).toBe("Today: Neon & <Static>");
    expect(html).toContain(">See you today at Neon &#38; &#60;Static&#62;.</h1>");
  });

  it("the compact Ticket card: white, 1px border/subtle, radius 16; the event image 88px when the event has one, left out otherwise", () => {
    const { html } = reminderOf();
    expect(html).toContain(`border:1px solid ${KIT.line};border-radius:16px`);
    expect(html).toMatch(new RegExp(`<img src="${site}/api/events/[^"]*" width="88" height="88" alt="Neon &#38; &#60;Static&#62;"`));
    expect(reminderOf({ imageUrl: undefined }).html).not.toContain("/api/events/");
  });

  it("shows only the site's own image, on an https site: never a foreign, protocol-relative or non-https one", () => {
    for (const gone of [
      reminderOf({}, "http://localhost:3000"), // not https
      reminderOf({ imageUrl: "https://evil.example/x.png" }), // not the site's own
      reminderOf({ imageUrl: "//evil.example/x.png" }),
      reminderOf({ imageUrl: "http://evil.example/x.png" }),
    ]) {
      expect(gone.html).not.toContain("evil.example");
      expect(gone.html).not.toContain("/api/events/");
      expect(gone.html).not.toContain('width="88" height="88"');
    }
  });

  it("leaves out the venue row and Get directions when there is no venue or address", () => {
    const { html } = reminderOf({ venueName: "", venueAddress: "", suburb: "" });
    expect(html).not.toContain(TICKET_EMAIL_ICON_PIN);
    expect(html).not.toContain("Get directions");
  });

  it("is only an automatic message: the wordmark inline, no unsubscribe, the plain text complete", () => {
    const email = reminderOf();
    expect((email.inlineImages ?? []).map((i) => i.cid)).toEqual([WORDMARK_CID]);
    expect(email.headers).toEqual({ "Auto-Submitted": "auto-generated" });
    expect(email.text).toContain("Open your ticket: https://sheltuh.test/checkout/success?session_id=ord_abc");
    expect(email.text).toContain("Need a hand? support@sheltuh.com.au");
    expect(email.text.toLowerCase()).not.toContain("unsubscribe");
  });

  it("escapes organiser text: the title, and the venue and address in the Ticket card and the detail rows", () => {
    const { html } = reminderOf({ title: "<b>Hi</b>", venueName: "<i>V</i>", venueAddress: "1 <u>St</u>" });
    expect(html).not.toMatch(/<\/?(b|i|u)>/);
    expect(html).toContain("&#60;b&#62;Hi&#60;/b&#62;");
    // The venue: once in the compact Ticket card, once as the venue row's title.
    expect(html.split(">&#60;i&#62;V&#60;/i&#62;</p>").length - 1).toBe(2);
    expect(html).toContain("1 &#60;u&#62;St&#60;/u&#62;");
    // With no venue name, the address is the venue row's title: still escaped.
    const addressOnly = reminderOf({ venueName: "", venueAddress: "1 <u>St</u>" }).html;
    expect(addressOnly).not.toMatch(/<\/?u>/);
    expect(addressOnly).toContain("1 &#60;u&#62;St&#60;/u&#62;");
  });
});

describe("the organiser announcement (no Latte frame: the shared layout, its copy kept)", () => {
  it("names who it is from and the event, then the message in the outlined message box", () => {
    const { html } = announcementOf();
    expect(html).toContain(">A message from Static Collective</p>");
    expect(html).toContain(">Neon Static</h1>");
    expect(html).toContain(`border:1px solid ${INK};border-radius:8px`);
    expect(html).toContain(">Doors now open at 7pm</p>");
    expect(html).toContain(">Doors open at 7pm.<br>Bring ID.</p>");
  });

  it("keeps About, Report and Stop links, and the footer with the reason", () => {
    const { html, text } = announcementOf();
    expect(html).toContain(">About Static Collective</a>");
    expect(html).toContain(">Report this message</a>");
    expect(html).toContain(">Stop messages from Static Collective</a>");
    expect(html).toContain("Sheltüh sent this for Static Collective. You’re getting it because you have tickets for Neon Static on Sheltüh.");
    expect(text).toContain("Stop messages from Static Collective: https://sheltuh.test/holder-messages/stop#token=");
  });

  it("is still an automatic message with one-click stop headers, and only the wordmark inline", () => {
    const email = announcementOf();
    expect((email.inlineImages ?? []).map((i) => i.cid)).toEqual([WORDMARK_CID]);
    expect(email.headers).toMatchObject({ "Auto-Submitted": "auto-generated", "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" });
    expect(email.subject).toBe("Neon Static: Doors now open at 7pm");
    expect(email.text).toContain("Doors open at 7pm.\nBring ID.");
  });
});
