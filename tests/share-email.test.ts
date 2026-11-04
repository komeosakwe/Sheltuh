import { describe, expect, it } from "vitest";
import { buildTicketEmail } from "@/lib/server/ticket-email";
import { eventPublicLink, inviteText, tellAFriendHtml, tellAFriendLinks } from "@/lib/server/share-email";
import type { EventRecord, OrderRecord } from "@/lib/server/types";

const LINK = "https://sheltuh.com.au/events/neon-static";

describe("Tell a friend (lib/server/share-email.ts)", () => {
  it("links the event's public page and writes a short invite", () => {
    expect(eventPublicLink("https://sheltuh.com.au/", "neon static")).toBe("https://sheltuh.com.au/events/neon%20static");
    expect(inviteText("Neon Static", "Saturday 7 November", LINK)).toBe(
      `I've got tickets to Neon Static (Saturday 7 November). Come with me? ${LINK}`,
    );
  });

  it("opens WhatsApp, Messages and email with the invite filled in, and names no address", () => {
    const links = tellAFriendLinks("Paint & <Sip>", "Sat 6 Mar", LINK);
    expect(links.map((l) => l.label)).toEqual(["WhatsApp", "Messages", "Email"]);
    const invite = encodeURIComponent(inviteText("Paint & <Sip>", "Sat 6 Mar", LINK));
    expect(links[0].href).toBe(`https://wa.me/?text=${invite}`);
    expect(links[1].href).toBe(`sms:?&body=${invite}`);
    expect(links[2].href).toBe(`mailto:?subject=${encodeURIComponent("Come to Paint & <Sip>?")}&body=${invite}`);
    for (const l of links) expect(l.href).not.toContain("@");
  });

  it("escapes the HTML block", () => {
    const html = tellAFriendHtml(tellAFriendLinks("<b>x</b>", "Sat", LINK));
    expect(html).toContain("Tell a friend:");
    expect(html).not.toContain("<b>x</b>");
  });
});

describe("the ticket email's Tell a friend", () => {
  const order = {
    orderId: "ord_abc",
    buyerEmail: "fan@example.com",
    totalCents: 0,
    tickets: [{ ticketCode: "ABCD-EFGH", ticketTypeId: "ga", ticketTypeName: "GA" }],
  } as OrderRecord;
  const event = {
    slug: "paint-and-sip",
    title: "Paint & Sip",
    venueName: "Studio 5",
    suburb: "Fitzroy",
    startsAt: "2027-03-06T09:00:00.000Z",
    endsAt: "2027-03-06T11:00:00.000Z",
    status: "published",
  } as EventRecord;

  it("is in a published event's email, html and text, linking its page", () => {
    const email = buildTicketEmail(order, event, "https://sheltuh.com.au");
    expect(email.html).toContain("Tell a friend:");
    expect(email.html).toContain(encodeURIComponent("https://sheltuh.com.au/events/paint-and-sip"));
    expect(email.text).toContain("TELL A FRIEND");
    expect(email.text).toContain("https://sheltuh.com.au/events/paint-and-sip");
  });

  it("isn't in an unlisted event's email (no public page to share)", () => {
    const email = buildTicketEmail(order, { ...event, status: "draft" } as EventRecord, "https://sheltuh.com.au");
    expect(email.html).not.toContain("Tell a friend:");
    expect(email.text).not.toContain("TELL A FRIEND");
  });
});

describe("the reminder's Tell a friend", () => {
  it("is in the day-before reminder, html and text", async () => {
    const { buildEventReminderEmail } = await import("@/lib/server/event-reminder-email");
    const email = buildEventReminderEmail({
      to: "fan@example.com",
      orderId: "22222222-2222-4222-8222-222222222222",
      organiserId: "33333333-3333-4333-8333-333333333333",
      siteUrl: "https://sheltuh.com.au",
      now: new Date("2027-03-05T21:00:00.000Z"),
      event: {
        slug: "paint-and-sip",
        title: "Paint & Sip",
        organiserName: "Studio Co",
        venueName: "Studio 5",
        suburb: "Fitzroy",
        startsAt: "2027-03-06T09:00:00.000Z",
        endsAt: "2027-03-06T11:00:00.000Z",
        timeZone: "Australia/Melbourne",
        status: "published",
      } as EventRecord,
    });
    expect(email.html).toContain("Tell a friend:");
    expect(email.text).toContain("TELL A FRIEND");
    expect(email.text).toContain("https://sheltuh.com.au/events/paint-and-sip");
  });
});
