import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { buildEventReviewEmail, buildOrganiserJoinedEmail, buildOrganiserReviewEmail } from "@/lib/server/admin-review-email";
import type { EmailMessage } from "@/lib/server/email";
import { buildEventReminderEmail } from "@/lib/server/event-reminder-email";
import { button, EMAIL_COLOURS, emailFooterImageUrl, escapeHtml, INK, SIGNAL, supportFooter, WORDMARK_CID } from "@/lib/server/email-layout";
import { MODERN_COLOURS, ICON_PATHS } from "@/lib/server/email-modern-layout";
import { buildFollowerNewEventsEmail } from "@/lib/server/follower-email";
import { buildFreeConfirmationEmail } from "@/lib/server/free-confirmation-email";
import { buildHolderMessageEmail } from "@/lib/server/holder-message-email";
import { buildInviteEmail } from "@/lib/server/invite-email";
import { buildTicketEmail, ticketWhen } from "@/lib/server/ticket-email";
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
// shared column, and every other email stays exactly as it was.

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
      organiserId: "org_1",
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

/** The ticket email's orange label, the only other orange fill: black text on it. */
const YOURE_IN_CELL = /<td bgcolor="#ff4800" style="background-color:#ff4800;border-radius:4px;[^"]*color:#000000[^"]*">YOU&rsquo;RE IN<\/td>/;
const TICKET_EMAILS = ["ticketPaid", "ticketFreeOne", "ticketSeated"];
/** Emails with the inline wordmark header and the branded footer (emailFooter). */
const BRANDED = [...TICKET_EMAILS, "freeConfirmation", "freeConfirmationSeated"];
/** The two emails in the modern look: hosted https logo (no cid), compact footer, MODERN_COLOURS. */
const MODERN = ["eventReminder", "holderMessage"];
const classic = Object.entries(emails).filter(([name]) => !MODERN.includes(name));

describe("every transactional email uses the shared brand layout", () => {
  it.each(Object.entries(emails))("%s: no old palette colour, and only its look's tokens", (name, build) => {
    const { html } = build();
    for (const old of OLD_PALETTE) expect(html.toLowerCase()).not.toContain(old);
    const allowed = new Set<string>(Object.values(MODERN.includes(name) ? MODERN_COLOURS : EMAIL_COLOURS).map((c) => c.toLowerCase()));
    const used = coloursIn(html);
    expect(used.length).toBeGreaterThan(0);
    for (const colour of used) expect(allowed).toContain(colour);
  });

  it.each(classic)("%s: Signal Orange only as a fill with black text: its one button (and the ticket email's label)", (name, build) => {
    const { html } = build();
    // Exactly one call-to-action.
    expect(html.split(BUTTON_CELL)).toHaveLength(2);
    let rest = html.replace(BUTTON_CELL, "");
    if (TICKET_EMAILS.includes(name)) {
      expect(rest).toMatch(YOURE_IN_CELL);
      rest = rest.replace(YOURE_IN_CELL, "");
    }
    expect(rest).not.toContain(SIGNAL); // no orange anywhere else
    const label = html.slice(html.indexOf(BUTTON_CELL)).match(/<a [^>]*style="([^"]*)"/)![1];
    expect(label).toContain(`color:${INK}`);
    expect(html).not.toMatch(/(?<![-\w])color:\s*(#fff\b|#ffffff|white)/i); // no white text, on orange or anywhere
  });

  // The modern look's one orange is its primary button's fill, with ink text (5.5:1). The reminder is the one email
  // with two buttons (the primary "View your tickets", plus an outlined, full-width "Get directions" when it has
  // somewhere to route to); the announcement is an organiser's own words, with no button and no orange at all.
  it.each(Object.entries(emails).filter(([name]) => MODERN.includes(name)))("%s: orange only as the primary button's fill, with ink text", (name, build) => {
    const { html } = build();
    const accent = MODERN_COLOURS.accent;
    expect(html).not.toContain(SIGNAL.toUpperCase());
    expect(html).not.toContain(SIGNAL);
    expect(html).not.toMatch(/(?<![-\w])color:\s*(#fff\b|#ffffff|white)/i);
    if (name === "holderMessage") {
      expect(html.toUpperCase()).not.toContain(accent);
      return;
    }
    // Every use of the orange is in the one primary cell: bgcolor, background and its own border.
    const cells = html.match(/<td [^>]*>/g)!.filter((tag) => tag.toUpperCase().includes(accent));
    expect(cells).toHaveLength(1);
    expect(cells[0]).toMatch(new RegExp(`bgcolor="${accent}" style="background-color:${accent};border:1px solid ${accent};border-radius:12px`));
    // bgcolor, background-color, border in that cell, and the time's underline (a decoration, never text colour).
    expect(html.toUpperCase().split(accent)).toHaveLength(5);
    expect(html).toContain(`text-decoration-color:${accent}`);
    expect(html).not.toMatch(new RegExp(`(?<![-\\w])color:\\s*${accent}`, "i"));
    const label = html.slice(html.indexOf(cells[0])).match(/<a [^>]*style="([^"]*)"/)![1];
    expect(label).toContain(`color:${MODERN_COLOURS.ink}`);
  });

  it.each(classic)("%s: the shared page, column, heading and support line", (name, build) => {
    const { html } = build();
    expect(html).toContain('<meta name="color-scheme" content="light only">');
    expect(html).toContain(`bgcolor="${EMAIL_COLOURS.page}" style="background-color:${EMAIL_COLOURS.page}"`);
    expect(html).toContain(
      `bgcolor="${EMAIL_COLOURS.card}" class="column" style="width:100%;max-width:600px;background-color:${EMAIL_COLOURS.card}"`,
    );
    // One h1: the shared 36/44 heading at weight 600 (30/36 on a phone), or the ticket email's event name (32px).
    expect(html.match(/<h1 /g)).toHaveLength(1);
    expect(html).toMatch(
      TICKET_EMAILS.includes(name)
        ? /<h1 class="h1" style="margin:0;font-family:[^"]*;font-size:32px;line-height:38px;color:#000000;font-weight:bold/
        : /<h1 class="h1" style="margin:0 0 \d+px 0;font-family:[^"]*;font-size:36px;line-height:44px;font-weight:600;letter-spacing:normal;color:#000000">/,
    );
    // The support address as a mailto link, and the disclosure line, in every email.
    expect(html).toContain('href="mailto:support@sheltuh.com.au"');
    expect(html).toContain("Sheltüh &middot; Melbourne");
    if (!BRANDED.includes(name)) expect(html).toContain(supportFooter);
  });

  it.each(MODERN)("%s: the modern page: ivory, a 600px column, light colour scheme, one h1, the support address", (name) => {
    const { html } = emails[name]();
    const { bg, ink } = MODERN_COLOURS;
    expect(html).toContain('<meta name="color-scheme" content="light">');
    expect(html).toContain(":root { color-scheme: light;");
    expect(html).toContain(`<body bgcolor="${bg}" style="margin:0;padding:0;background-color:${bg}`);
    expect(html).toContain(`bgcolor="${bg}" class="column" style="width:100%;max-width:600px;background-color:${bg}`);
    expect(html.match(/<h1 /g)).toHaveLength(1);
    expect(html).toMatch(new RegExp(`<h1 class="h1" style="margin:0;[^"]*font-weight:600;[^"]*color:${ink}`));
    // Table based, inline styled: no gradients, shadows or backgrounds images, no flex or grid, and no script.
    expect(html).not.toMatch(/gradient|box-shadow|text-shadow|background-image|display:\s*(flex|grid)|<script/i);
    expect(html).toContain('href="mailto:support@sheltuh.com.au"');
    expect(html).toContain('href="https://sheltuh.test/privacy"');
    expect(html).toContain("Creative event discovery");
    expect(html).toContain("Sheltüh &middot; Melbourne");
  });

  it.each(MODERN)("%s: the https wordmark (header and footer), no inline wordmark, no footer banner", (name) => {
    const email = emails[name]();
    const logo = /<img src="https:\/\/sheltuh\.test\/brand\/sheltuh-wordmark-email\.png" width="(\d+)" height="(\d+)" alt="Sheltüh"/g;
    const sizes = [...email.html.matchAll(logo)].map((m) => [Number(m[1]), Number(m[2])]);
    // The header's (2x of 106 x 24, the PNG is 212 x 48) and the footer's small one, both with explicit sizes.
    expect(sizes).toEqual([
      [106, 24],
      [80, 18],
    ]);
    expect(email.html).not.toContain("cid:");
    expect(email.html).not.toContain("SHELT&Uuml;H");
    expect(email.inlineImages ?? []).toEqual([]);
    expect(email.html).not.toContain(emailFooterImageUrl(site)!);
  });

  it("still uses the wordmark's https URL on a local http site", () => {
    const local = buildHolderMessageEmail({
      to: "fan@example.com",
      messageId: "00000000-0000-4000-8000-000000000002",
      eventTitle: "T",
      organiserName: "O",
      organiserId: "org_1",
      subject: "S",
      body: "Body",
      siteUrl: "http://localhost:3000",
      stopToken: "t".repeat(43),
    });
    expect(local.html).toContain('<img src="http://localhost:3000/brand/sheltuh-wordmark-email.png" width="106" height="24" alt="Sheltüh"');
    expect(local.inlineImages ?? []).toEqual([]);
  });

  it.each(BRANDED)("%s: the wordmark header (inline) and one branded footer banner", (name) => {
    const email = emails[name]();
    expect(email.html.split(`<img src="cid:${WORDMARK_CID}"`)).toHaveLength(2);
    expect(email.inlineImages?.[0]?.cid).toBe(WORDMARK_CID);
    expect(email.html.split(`<img src="${emailFooterImageUrl(site)}"`)).toHaveLength(2);
    expect(email.html.match(/<img src="https:[^"]*"/g)?.filter((tag) => tag.includes("/brand/"))).toHaveLength(1);
  });

  it("the other emails carry no images", () => {
    for (const [name, build] of Object.entries(emails)) {
      if (BRANDED.includes(name) || MODERN.includes(name)) continue;
      const email = build();
      expect(email.html, name).not.toContain("<img");
      expect(email.inlineImages ?? [], name).toEqual([]);
    }
  });

  it("sets the event title in black in the ticket, free-confirmation and waitlist emails", () => {
    const title = `font-size:20px;line-height:26px;font-weight:bold;color:${INK}">${escapeHtml(event.title)}</p>`;
    for (const name of ["freeConfirmation", "waitlistConfirmation", "waitlistAvailable"]) {
      expect(emails[name]().html).toContain(title);
    }
    // The ticket email's heading is the event title.
    expect(emails.ticketPaid().html).toContain(`color:${INK};font-weight:bold;overflow-wrap:break-word;word-wrap:break-word">${escapeHtml(event.title)}</h1>`);
  });

  it("the reminder and the holder message: escaped text, an automatic message, who it is from and why; only the message has a stop link", () => {
    const reminder = emails.eventReminder();
    expect(reminder.html).toContain("Cellar Door &#60;Sound&#62;");
    expect(reminder.html).not.toContain("<Sound>");
    expect(reminder.html).toContain("View your tickets");
    expect(reminder.text).toContain("Tomorrow, you’re in.");
    expect(reminder.text).toContain("You’re getting this one-off reminder because you have tickets for this event on Sheltüh.");
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
    // One inline QR per ticket, plus the inline wordmark header (the only other cid image).
    expect(paid.html.match(/<img src="cid:ticket-qr-/g)).toHaveLength(2);
    expect(paid.html.match(/<img src="cid:/g)).toHaveLength(3);
    expect(paid.html).toContain('<img src="cid:sheltuh-wordmark@sheltuh.com.au"');
    expect(paid.html).toContain("incl. booking fees");
    expect(paid.html).toContain('src="https://sheltuh.test/brand/sheltuh-email-footer.png"');
    expect(paid.html).toContain("Get directions");
    expect(emails.ticketSeated().html).toContain("Stalls · Row A · Seat 2");
    const seated = emails.freeConfirmationSeated();
    expect(seated.html).toContain("Stalls · Row A · Seat 2");
    expect(seated.html).toContain("only held once you confirm");
    expect(emails.freeConfirmation().html).toContain("Tickets: 2 × General admission");
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

const reminderOf = (overrides: Partial<EventRecord> = {}, siteUrl = site, now = new Date("2027-03-05T09:00:00.000Z")) =>
  buildEventReminderEmail({
    to: "fan@example.com",
    orderId: "ord_abc",
    event: { ...event, organiserName: "Static Collective", imageUrl: IMAGE_PATH, ...overrides } as EventRecord,
    organiserId: "org_1",
    siteUrl,
    now,
  });

const announcementOf = (overrides: { eventImageUrl?: string; siteUrl?: string; body?: string } = {}) =>
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
    ...(overrides.eventImageUrl ? { eventImageUrl: overrides.eventImageUrl } : {}),
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

describe("the event reminder", () => {
  it("the header is the logo with an Event Reminder label; then the heading, in order down to the footer", () => {
    const { html: page } = reminderOf();
    const html = page.slice(page.indexOf("<body")); // not the <title>, which has the event's name too
    expect(html).toContain(">Event Reminder</td>");
    const order = [
      "brand/sheltuh-wordmark-email.png",
      IMAGE_PATH.replace(/&/g, "&#38;"),
      "Tomorrow, you’re in.",
      "A reminder about an event you have tickets for.",
      ">Neon &#38; &#60;Static&#62;</td>", // the details card's title (the alt text has it too)
      "View your tickets",
      "Get directions",
      "Hosted by",
      "Tell a friend:",
      "Need help?",
    ].map((part) => html.indexOf(part));
    expect(order.every((i) => i > 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  it("says it's today when it is", () => {
    const { html, text } = reminderOf({}, site, new Date("2027-03-05T21:30:00.000Z"));
    expect(html).toContain("Today’s the day.");
    expect(text).toContain("Today’s the day.");
  });

  it("shows the artwork across the column, rounded, when the event has one; leaves it out cleanly otherwise", () => {
    const { html } = reminderOf();
    expect(html).toContain(
      `<img src="${site}${IMAGE_PATH}" width="552" alt="Event image for Neon &#38; &#60;Static&#62;" style="display:block;border:0;border-radius:16px;width:100%;max-width:100%;height:auto;`,
    );
    for (const gone of [
      reminderOf({ imageUrl: undefined }),
      reminderOf({}, "http://localhost:3000"), // not https
      reminderOf({ imageUrl: "https://evil.example/x.png" }), // not the site's own
      reminderOf({ imageUrl: "//evil.example/x.png" }),
    ]) {
      expect(gone.html).not.toContain("Event image for");
      expect(gone.html).not.toContain("evil.example");
      expect(gone.html.match(/<img /g)).toHaveLength(2 + 5); // the two logos, three detail icons and two button icons
    }
  });

  it("lists the date, the start-end time, the venue and its address (muted) as rows with a 20px hosted icon each", () => {
    const { html } = reminderOf();
    for (const [name, alt] of [
      ["calendar", "Date"],
      ["clock", "Time"],
      ["pin", "Venue"],
    ] as const) {
      expect(html).toContain(`<img src="${site}/email/icons/${name}.png" width="20" height="20" alt="${alt}" style="display:block;border:0;width:20px;height:20px;`);
    }
    expect(html.indexOf("/icons/calendar.png")).toBeLessThan(html.indexOf("/icons/clock.png"));
    expect(html.indexOf("/icons/clock.png")).toBeLessThan(html.indexOf("/icons/pin.png"));
    const when = ticketWhen(event.startsAt, event.endsAt, event);
    expect(html).toContain(`>${escapeHtml(when.date)}</p>`);
    for (const line of when.lines) expect(html).toContain(`>${escapeHtml(line)}</p>`);
    expect(when.lines[0]).toMatch(/–|-/); // start and end
    expect(html).toContain('font-weight:600;color:#171411">The Cellar Door</p>');
    expect(html).toContain(`color:${MODERN_COLOURS.muted}">12 Hosier Lane, Melbourne VIC 3000</p>`);
    // The row's hairlines are the card's subtle border.
    expect(html).toContain(`border-top:1px solid ${MODERN_COLOURS.border}`);
    expect(html).toContain(`border:1px solid ${MODERN_COLOURS.border};border-radius:16px`);
  });

  it("leaves out the venue row when there is no venue or address", () => {
    const { html } = reminderOf({ venueName: undefined, venueAddress: undefined, suburb: undefined });
    expect(html).not.toContain("/icons/pin.png");
    expect(html).toContain("/icons/calendar.png");
  });

  it("has a full-width orange 'View your tickets' button and an outlined 'Get directions' one, each with its icon", () => {
    const { html, text } = reminderOf();
    const tickets = `href="${site}/checkout/success?session_id=ord_abc" style="display:block;padding:16px 24px;`;
    expect(html).toContain(tickets);
    // A decorative 20 x 20 icon on the label's line: the label names the action.
    expect(html).toMatch(/<img src="[^"]*\/email\/icons\/ticket\.png" width="20" height="20" alt="" [^>]*>View your tickets<\/a>/);
    expect(html).toMatch(/<img src="[^"]*\/email\/icons\/navigate\.png" width="20" height="20" alt="" [^>]*>Get directions<\/a>/);
    const primary = html.slice(0, html.indexOf(tickets)).match(/<table [^>]*>(?:(?!<table)[\s\S])*$/)![0];
    expect(primary).toContain('width="100%"');
    expect(primary).toContain(`bgcolor="${MODERN_COLOURS.accent}"`);
    const directions = html.match(/<td align="center" bgcolor="#FFF9E8" style="[^"]*border:1px solid #171411;[^"]*"><a href="(https:\/\/[^"]*)"[^>]*>(?:<img [^>]*>)?Get directions<\/a>/);
    expect(directions).not.toBeNull();
    expect(text).toContain(`Get directions: ${directions![1].replace(/&#38;/g, "&")}`);
    // Without anywhere to route to, there's no second button.
    const none = reminderOf({ venueAddress: undefined, suburb: undefined });
    expect(none.html).not.toContain("Get directions");
    expect(none.text).not.toContain("Get directions");
    expect(none.html).toContain("View your tickets");
    expect(none.html).not.toContain("/icons/navigate.png");
  });

  it("underlines the time in the accent", () => {
    const { html } = reminderOf();
    const time = html.slice(html.indexOf("/icons/clock.png"));
    expect(time.slice(0, time.indexOf("</td></tr>"))).toContain(
      `text-decoration:underline;text-decoration-color:${MODERN_COLOURS.accent};text-decoration-thickness:2px`,
    );
  });

  it("says who hosts it with a link to the organiser, then Tell a friend (small), then the compact footer", () => {
    const { html, text } = reminderOf();
    expect(html).toContain('Hosted by <a href="https://sheltuh.test/organisers/org_1" style="color:#171411;text-decoration:underline">Static Collective</a>');
    for (const label of ["WhatsApp", "Messages", "Email"]) expect(html).toContain(`>${label}</a>`);
    expect(html).toContain("font-size:13px;line-height:20px;font-weight:400;color:#6A6256\">Tell a friend: ");
    expect(text).toContain("TELL A FRIEND");
    expect(html).not.toContain("Tell a friend:".toUpperCase());
    const noShare = reminderOf({ slug: "" });
    expect(noShare.html).not.toContain("Tell a friend");
    // The footer: support, the reason, privacy, small wordmark and tagline, city.
    const footer = html.slice(html.indexOf("Need help?"));
    const parts = ["support@sheltuh.com.au", "one-off reminder because you have tickets", "Privacy policy", 'width="80" height="18"', "Creative event discovery", "Sheltüh &middot; Melbourne"];
    const at = parts.map((part) => footer.indexOf(part));
    expect(at.every((i) => i >= 0)).toBe(true);
    expect([...at].sort((a, b) => a - b)).toEqual(at);
  });

  it("is only an automatic message: no cid images, no unsubscribe, the plain text complete", () => {
    const email = reminderOf();
    expect(email.inlineImages ?? []).toEqual([]);
    expect(email.headers).toEqual({ "Auto-Submitted": "auto-generated" });
    expect(email.text).toContain("Tomorrow, you’re in.");
    expect(email.text).toContain("Venue: The Cellar Door");
    expect(email.text).toContain("Address: 12 Hosier Lane, Melbourne VIC 3000");
    expect(email.text).toContain("View your tickets: https://sheltuh.test/checkout/success?session_id=ord_abc");
    expect(email.text).toContain("Hosted by Static Collective: https://sheltuh.test/organisers/org_1");
  });

  it("escapes organiser text", () => {
    const { html } = reminderOf({ title: "<b>Hi</b>", venueName: "<i>V</i>", venueAddress: "1 <u>St</u>", organiserName: "<s>O</s>" });
    expect(html).not.toMatch(/<(b|i|u|s)>/);
    expect(html).toContain("&#60;b&#62;Hi&#60;/b&#62;");
  });
});

describe("the organiser announcement", () => {
  it("has the Event Update header, the event name and 'From {organiser}'", () => {
    const { html } = announcementOf();
    expect(html).toContain(">Event Update</td>");
    expect(html).toMatch(/<h1 class="h1" style="[^"]*">Neon Static<\/h1>/);
    expect(html).toContain('color:#6A6256">From Static Collective</p>');
  });

  it("shows the message as a tinted, bordered, rounded card: label, a 24px title at weight 600, then the message", () => {
    const { html } = announcementOf({ body: "Line one.\nLine <two> & a verylongwordwithoutanybreaks" });
    const { tint, tintBorder } = MODERN_COLOURS;
    expect(html).toContain(`bgcolor="${tint}" style="background-color:${tint};border:1px solid ${tintBorder};border-radius:16px`);
    expect(html).toContain("padding:32px 24px");
    const card = html.slice(html.indexOf(`bgcolor="${tint}"`), html.indexOf("About Static Collective"));
    const at = ["Message from Static Collective", "font-size:24px;line-height:30px;font-weight:600", ">Doors now open at 7pm</h2>", "Line one.<br>Line &#60;two&#62; &#38; a verylong"].map((p) => card.indexOf(p));
    expect(at.every((i) => i >= 0)).toBe(true);
    expect([...at].sort((a, b) => a - b)).toEqual(at);
    expect(card).toContain("word-break:break-word"); // a long word can't break the layout
    expect(card).not.toContain("<two>");
  });

  it("keeps About, Report and Stop links, and a compact footer with the reason", () => {
    const { html } = announcementOf();
    expect(html).toContain('>About Static Collective</a> &middot; <a href="mailto:support@sheltuh.com.au?subject=');
    expect(html).toContain(">Report this message</a> &middot; ");
    expect(html).toContain(`href="https://sheltuh.test/holder-messages/stop#token=${"t".repeat(43)}"`);
    expect(html).toContain(">Stop messages from Static Collective</a>");
    expect(html).toContain("Sheltüh sent this for Static Collective. You’re getting it because you have tickets for");
    expect(html).toContain('href="https://sheltuh.test/privacy"');
  });

  it("shows the artwork when the outbox passes it (the site's own, https); leaves it out otherwise", () => {
    const withImage = announcementOf({ eventImageUrl: IMAGE_PATH });
    expect(withImage.html).toContain(`<img src="${site}${IMAGE_PATH.replace("&", "&#38;")}" width="552" alt="Event image for Neon Static"`);
    expect(withImage.html.indexOf("Event image for")).toBeLessThan(withImage.html.indexOf("<h1 "));
    for (const gone of [
      announcementOf(),
      announcementOf({ eventImageUrl: IMAGE_PATH, siteUrl: "http://localhost:3000" }),
      announcementOf({ eventImageUrl: "https://evil.example/x.png" }),
    ]) {
      expect(gone.html).not.toContain("Event image for");
      expect(gone.html).not.toContain("evil.example");
      expect(gone.html.match(/<img /g)).toHaveLength(2);
    }
  });

  it("is still an automatic message with one-click stop headers, and no cid images", () => {
    const email = announcementOf();
    expect(email.inlineImages ?? []).toEqual([]);
    expect(email.headers).toMatchObject({ "Auto-Submitted": "auto-generated", "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" });
    expect(email.subject).toBe("Neon Static: Doors now open at 7pm");
    expect(email.text).toContain("Doors open at 7pm.\nBring ID.");
  });
});
