import nodemailer from "nodemailer";
import { describe, expect, it } from "vitest";
import { buildEventReviewEmail, buildOrganiserReviewEmail } from "@/lib/server/admin-review-email";
import { mailOptions, subjectLine } from "@/lib/server/email";
import { buildFollowerNewEventsEmail } from "@/lib/server/follower-email";
import { buildFreeConfirmationEmail } from "@/lib/server/free-confirmation-email";
import { buildInviteEmail } from "@/lib/server/invite-email";
import { buildTicketEmail } from "@/lib/server/ticket-email";
import type { EventRecord, OrderLineItem, OrderRecord } from "@/lib/server/types";
import { buildWaitlistAvailableEmail, buildWaitlistConfirmationEmail } from "@/lib/server/waitlist-email";

// Every email subject goes through subjectLine (lib/server/email.ts): an
// organiser's event title or name can't reorder, hide or break the subject.

/**
 * An organiser-supplied title with a right-to-left override, a zero-width
 * space, an isolate and its pop, a line separator, a paragraph separator, a
 * soft hyphen, a BOM, CR/LF and a tab.
 */
const HOSTILE_TITLE = "Neon\u202E citatS\u200B\u2066 Night\u2069\u2028Two\u2029\u00ADThree\uFEFF\r\nBcc: x@evil.test\tEnd";
const CLEAN_TITLE = "Neon citatS Night Two Three Bcc: x@evil.test End";
const HOSTILE_NAME = "Rogue\u202E Records\u200F\nX";
const CLEAN_NAME = "Rogue Records X";

const UNSAFE = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u;

const event = {
  eventId: "00000000-0000-4000-8000-000000000001",
  slug: "neon-night",
  title: HOSTILE_TITLE,
  venueName: "Studio 5",
  venueAddress: "5 Smith St, Fitzroy",
  startsAt: "2027-03-06T09:00:00.000Z",
  endsAt: "2027-03-06T11:00:00.000Z",
} as EventRecord;

const lineItems: OrderLineItem[] = [
  { ticketTypeId: "ga", ticketTypeName: "GA", unitPriceCents: 0, feePolicy: "buyer-pays", quantity: 1 },
];

const order = {
  orderId: "ord_abc",
  buyerEmail: "fan@example.com",
  totalCents: 0,
  tickets: [{ ticketCode: "ABCD-EFGH", ticketTypeId: "ga", ticketTypeName: "GA" }],
} as OrderRecord;

const site = "https://sheltuh.test";

describe("subjectLine", () => {
  it("turns control, format and separator characters into single spaces and trims", () => {
    expect(subjectLine(HOSTILE_TITLE)).toBe(CLEAN_TITLE);
    expect(subjectLine("  a\u200B\u200Bb  ")).toBe("a b");
    expect(subjectLine("Paint & <Sip> — Café ü")).toBe("Paint & <Sip> — Café ü");
  });
});

describe("every email's subject is cleaned", () => {
  const emails = {
    ticket: () => buildTicketEmail(order, event, site),
    freeConfirmation: () => buildFreeConfirmationEmail("fan@example.com", event, lineItems, `${site}/confirm#token=x`, 24),
    waitlistConfirmation: () => buildWaitlistConfirmationEmail("fan@example.com", event, `${site}/w#token=x`, 24),
    waitlistAvailable: () => buildWaitlistAvailableEmail("fan@example.com", event, `${site}/e`, `${site}/leave#token=x`),
    followerOne: () =>
      buildFollowerNewEventsEmail({
        to: "fan@example.com",
        organiserName: HOSTILE_NAME,
        organiserId: "org_1",
        events: [event],
        total: 1,
        siteUrl: site,
        unsubscribeLink: `${site}/u#token=x`,
      }),
    followerMany: () =>
      buildFollowerNewEventsEmail({
        to: "fan@example.com",
        organiserName: HOSTILE_NAME,
        organiserId: "org_1",
        events: [event, event],
        total: 3,
        siteUrl: site,
        unsubscribeLink: `${site}/u#token=x`,
      }),
    eventReview: () =>
      buildEventReviewEmail({
        to: "ops@sheltuh.test",
        title: HOSTILE_TITLE,
        organiserName: HOSTILE_NAME,
        startsAt: event.startsAt,
        resubmitted: false,
        siteUrl: site,
      }),
    organiserReview: () => buildOrganiserReviewEmail({ to: "ops@sheltuh.test", organiserName: HOSTILE_NAME, siteUrl: site }),
    inviteOrganiser: () =>
      buildInviteEmail({
        to: "fan@example.com",
        kind: "organiser",
        organiserName: HOSTILE_NAME,
        link: `${site}/invite#token=x`,
        daysValid: 14,
        siteUrl: site,
      }),
    inviteMember: () =>
      buildInviteEmail({ to: "fan@example.com", kind: "member", link: `${site}/invite#token=x`, daysValid: 14, siteUrl: site }),
  };

  it.each(Object.entries(emails))("%s", (_name, build) => {
    const { subject } = build();
    expect(subject).not.toMatch(UNSAFE);
    expect(subject).not.toMatch(/ {2}/);
    expect(subject).toBe(subject.trim());
  });

  it("keeps the words, in order", () => {
    expect(emails.ticket().subject).toBe(`Your tickets: ${CLEAN_TITLE}`);
    expect(emails.freeConfirmation().subject).toBe(`Confirm your free tickets: ${CLEAN_TITLE}`);
    expect(emails.waitlistConfirmation().subject).toBe(`Confirm the waitlist: ${CLEAN_TITLE}`);
    expect(emails.waitlistAvailable().subject).toBe(`Tickets are available again: ${CLEAN_TITLE}`);
    expect(emails.followerOne().subject).toBe(`New from ${CLEAN_NAME}: ${CLEAN_TITLE}`);
    expect(emails.followerMany().subject).toBe(`3 new events from ${CLEAN_NAME}`);
    expect(emails.eventReview().subject).toBe("Event submitted for review");
    expect(emails.organiserReview().subject).toBe("Organiser application to review");
    expect(emails.inviteOrganiser().subject).toBe(`You're invited to Sheltüh: ${CLEAN_NAME}`);
    expect(emails.inviteMember().subject).toBe("You're invited to Sheltüh");
  });

  it("mailOptions cleans a subject again, and the header that goes out has one line and no injected header", async () => {
    const options = mailOptions("Sheltüh <support@sheltuh.test>", {
      to: "fan@example.com",
      subject: `Your tickets: ${HOSTILE_TITLE}`,
      text: "t",
      html: "<p>h</p>",
    });
    expect(options.subject).toBe(`Your tickets: ${CLEAN_TITLE}`);
    const transport = nodemailer.createTransport({ streamTransport: true, buffer: true, newline: "unix" });
    const info = await transport.sendMail(options);
    const headers = (info.message as Buffer).toString("utf8").split("\n\n")[0];
    expect(headers).not.toMatch(/^bcc:/im);
    expect(headers).not.toMatch(/[\u202E\u200B\u2066\u2028]/);
  });
});
