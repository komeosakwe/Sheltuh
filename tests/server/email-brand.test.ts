import { describe, expect, it } from "vitest";
import { buildEventReviewEmail, buildOrganiserJoinedEmail, buildOrganiserReviewEmail } from "@/lib/server/admin-review-email";
import type { EmailMessage } from "@/lib/server/email";
import { button, EMAIL_COLOURS, emailFooterImageUrl, escapeHtml, INK, SIGNAL, supportFooter, WORDMARK_CID } from "@/lib/server/email-layout";
import { buildFollowerNewEventsEmail } from "@/lib/server/follower-email";
import { buildFreeConfirmationEmail } from "@/lib/server/free-confirmation-email";
import { buildInviteEmail } from "@/lib/server/invite-email";
import { buildTicketEmail } from "@/lib/server/ticket-email";
import type { EventRecord, OrderLineItem, OrderRecord, TicketSeat } from "@/lib/server/types";
import { buildWaitlistAvailableEmail, buildWaitlistConfirmationEmail } from "@/lib/server/waitlist-email";

// Every transactional email is built on lib/server/email-layout.ts: the same
// colours, ivory column, button and support line, so the ticket emails can't
// drift from the waitlist and follower emails again. The ticket and
// free-ticket confirmation emails (the two a buyer gets in a row) also share
// the wordmark header and the branded footer.

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
const BRANDED = [...TICKET_EMAILS, "freeConfirmation", "freeConfirmationSeated"];

describe("every transactional email uses the shared brand layout", () => {
  it.each(Object.entries(emails))("%s: no old palette colour, and only the shared tokens", (_name, build) => {
    const { html } = build();
    for (const old of OLD_PALETTE) expect(html.toLowerCase()).not.toContain(old);
    const allowed = new Set<string>(Object.values(EMAIL_COLOURS));
    const used = coloursIn(html);
    expect(used.length).toBeGreaterThan(0);
    for (const colour of used) expect(allowed).toContain(colour);
  });

  it.each(Object.entries(emails))("%s: Signal Orange only as a fill with black text: its one button (and the ticket email's label)", (name, build) => {
    const { html } = build();
    expect(html.split(BUTTON_CELL)).toHaveLength(2); // exactly one call-to-action
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

  it.each(Object.entries(emails))("%s: the shared page, column, heading and support line", (name, build) => {
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

  it.each(BRANDED)("%s: the wordmark header (inline) and one branded footer banner", (name) => {
    const email = emails[name]();
    expect(email.html.split(`<img src="cid:${WORDMARK_CID}"`)).toHaveLength(2);
    expect(email.inlineImages?.[0]?.cid).toBe(WORDMARK_CID);
    expect(email.html.split(`<img src="${emailFooterImageUrl(site)}"`)).toHaveLength(2);
    expect(email.html.match(/<img src="https:[^"]*"/g)?.filter((tag) => tag.includes("/brand/"))).toHaveLength(1);
  });

  it("the other emails carry no images", () => {
    for (const [name, build] of Object.entries(emails)) {
      if (BRANDED.includes(name)) continue;
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
