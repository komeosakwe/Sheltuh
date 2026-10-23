import { describe, expect, it } from "vitest";
import type { EmailMessage } from "@/lib/server/email";
import { button, EMAIL_COLOURS, escapeHtml, INK, SIGNAL, supportFooter } from "@/lib/server/email-layout";
import { buildFollowerNewEventsEmail } from "@/lib/server/follower-email";
import { buildFreeConfirmationEmail } from "@/lib/server/free-confirmation-email";
import { buildTicketEmail } from "@/lib/server/ticket-email";
import type { EventRecord, OrderLineItem, OrderRecord, TicketSeat } from "@/lib/server/types";
import { buildWaitlistAvailableEmail, buildWaitlistConfirmationEmail } from "@/lib/server/waitlist-email";

// Every transactional email is built on lib/server/email-layout.ts (Brand
// Direction One): the same colours, card, heading, event title, button and
// support line, so the ticket emails can't drift from the waitlist and
// follower emails again.

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
};

/** Every colour value in the markup: style properties and bgcolor attributes. */
function coloursIn(html: string): string[] {
  return [...html.matchAll(/(?:bgcolor="|color:\s*|solid\s+)(#[0-9a-f]{3,8}\b|[a-z]+\b)/gi)].map((m) => m[1].toLowerCase());
}

/** The button's cell, exactly as the shared helper writes it. */
const BUTTON_CELL = button("x", "https://x").match(/<td [^>]*>/)![0];

const OLD_PALETTE = ["#2b3cff", "#f3f0e8", "#0b0b0b", "#5b574e", "#e3ded1"];

describe("every transactional email uses the shared brand layout", () => {
  it.each(Object.entries(emails))("%s: no old palette colour, and only the shared tokens", (_name, build) => {
    const { html } = build();
    for (const old of OLD_PALETTE) expect(html.toLowerCase()).not.toContain(old);
    const allowed = new Set<string>(Object.values(EMAIL_COLOURS));
    const used = coloursIn(html);
    expect(used.length).toBeGreaterThan(0);
    for (const colour of used) expect(allowed).toContain(colour);
  });

  it.each(Object.entries(emails))("%s: Signal Orange only on its one button, with black text on it", (_name, build) => {
    const { html } = build();
    expect(html.split(BUTTON_CELL)).toHaveLength(2); // exactly one call-to-action
    expect(html.replace(BUTTON_CELL, "")).not.toContain(SIGNAL); // no orange anywhere else
    const label = html.slice(html.indexOf(BUTTON_CELL)).match(/<a [^>]*style="([^"]*)"/)![1];
    expect(label).toContain(`color:${INK}`);
    expect(html).not.toMatch(/(?<![-\w])color:\s*(#fff\b|#ffffff|white)/i); // no white text, on orange or anywhere
  });

  it.each(Object.entries(emails))("%s: the shared page, card, heading and support line", (_name, build) => {
    const { html } = build();
    expect(html).toContain('<meta name="color-scheme" content="light only">');
    expect(html).toContain(`bgcolor="${EMAIL_COLOURS.page}" style="background-color:${EMAIL_COLOURS.page}"`);
    expect(html).toContain(
      `bgcolor="${EMAIL_COLOURS.card}" class="px" style="background-color:${EMAIL_COLOURS.card};border:1px solid ${INK};border-radius:12px`,
    );
    expect(html).toMatch(/<h1 style="margin:0 0 \d+px 0;font-family:[^"]*;font-size:28px;line-height:34px;font-weight:bold;color:#000000">/);
    expect(html).toContain(supportFooter);
  });

  it("sets the event title in black in the ticket, free-confirmation and waitlist emails", () => {
    const title = `font-size:20px;line-height:26px;font-weight:bold;color:${INK}">${escapeHtml(event.title)}</p>`;
    for (const name of ["ticketPaid", "freeConfirmation", "waitlistConfirmation", "waitlistAvailable"]) {
      expect(emails[name]().html).toContain(title);
    }
  });

  it("keeps each email's own content: QR tickets, seat lines, totals with booking fees, footer banner", () => {
    const paid = emails.ticketPaid();
    // One inline QR per ticket, plus the inline wordmark header (the only other cid image).
    expect(paid.html.match(/<img src="cid:ticket-qr-/g)).toHaveLength(2);
    expect(paid.html.match(/<img src="cid:/g)).toHaveLength(3);
    expect(paid.html).toContain('<img src="cid:sheltuh-wordmark@sheltuh.com.au"');
    expect(paid.html).toContain("incl. booking fees");
    expect(paid.html).toContain('src="https://sheltuh.com.au/images/email-footer.png"');
    expect(emails.ticketSeated().html).toContain("Stalls · Row A · Seat 2");
    const seated = emails.freeConfirmationSeated();
    expect(seated.html).toContain("Stalls · Row A · Seat 2");
    expect(seated.html).toContain("only held once you confirm");
    expect(emails.freeConfirmation().html).toContain("Tickets: 2 × General admission");
  });
});
