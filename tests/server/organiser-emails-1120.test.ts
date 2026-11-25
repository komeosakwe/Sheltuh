import { describe, expect, it } from "vitest";
import { describeBookingFee, describeBookingFeeShort } from "@/lib/fees";
import { KIT } from "@/lib/server/email-kit";
import {
  buildMemberWelcomeEmail,
  buildOrganiserAfterEventEmail,
  buildOrganiserBeyondTicketsEmail,
  buildOrganiserMeetingEmail,
  buildOrganiserNextStepsEmail,
  buildOrganiserWelcomeEmail,
} from "@/lib/server/onboarding-email";

/*
 * The organiser emails as Latte's "1120 final- organiser email" page draws
 * them (A1 to A5, B1), and the member welcome on the same pieces: subjects and
 * preview text from the page's triggers table, the black hero, the black
 * step badges, the orange call to action and the shared footer.
 */

const SITE = "https://sheltuh.test";
const WORDMARK = '<img src="cid:sheltuh-wordmark@sheltuh.com.au"';

const visible = (html: string) =>
  html
    .replace(/<style[\s\S]*?<\/style>/g, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&#38;/g, "&")
    .replace(/&#60;/g, "<")
    .replace(/&#62;/g, ">")
    .replace(/&nbsp;/g, " ")
    .replace(/&middot;/g, "·")
    .replace(/&rarr;/g, "→")
    .replace(/&Uuml;/g, "Ü")
    .replace(/\s+/g, " ");

/** The preheader: the hidden first div of the body. */
const preheaderOf = (html: string) => /<body[^>]*>\n<div style="[^"]*">([^&<]*)/.exec(html)?.[1];

function inOrder(text: string, pieces: string[]) {
  let at = -1;
  for (const piece of pieces) {
    const next = text.indexOf(piece, at + 1);
    expect(next, piece).toBeGreaterThan(at);
    at = next;
  }
}

const a1 = () => buildOrganiserWelcomeEmail({ to: "org@example.com", firstName: "Sam", status: "pending", siteUrl: SITE });
const a2 = () => buildOrganiserWelcomeEmail({ to: "org@example.com", firstName: "Sam", status: "approved", siteUrl: SITE });
const a3 = () => buildOrganiserNextStepsEmail({ to: "org@example.com", siteUrl: SITE });
const a4 = () => buildOrganiserBeyondTicketsEmail({ to: "org@example.com", firstName: "Sam", siteUrl: SITE });
const a5 = (conversion: number | null = 0.0871) =>
  buildOrganiserAfterEventEmail({
    to: "org@example.com",
    firstName: "Sam",
    siteUrl: SITE,
    stats: {
      eventTitle: "Here & <Now>",
      analyticsHref: `${SITE}/dashboard/events/e1/analytics`,
      pageViews: 1595,
      ticketsSold: 64,
      orderConversion: conversion,
      checkedIn: 45,
    },
  });
const b1 = () =>
  buildOrganiserMeetingEmail({ to: "sam@example.com", firstName: "Sam", eventName: "Here & Now", teamMemberName: "Kome", siteUrl: SITE });

describe("subjects and preview text (Latte's organiser triggers table)", () => {
  it.each([
    ["A1", a1, "We’ve got your application", "A person on our team will review it within 2 business days."],
    ["A2", a2, "You’re in. Let’s get your first event live", "Three steps to your first event on Sheltüh."],
    ["A3", a3, "Before you publish: a few things to know", "Listings, pricing, refunds, payouts and attendee privacy."],
    ["A4", a4, "More than tickets: what Sheltüh does for your events", "Discovery, promotion, insights and what’s coming next."],
    ["A5", () => a5(), "That’s a wrap on Here & <Now>", "Your page views, ticket sales and check-ins, plus next steps."],
    ["B1", b1, "Great to meet you, Sam: next steps for Here & Now", "How to sign up on any device, and what you get with Sheltüh."],
  ] as const)("%s", (_name, build, subject, preheader) => {
    const email = build();
    expect(email.subject).toBe(subject);
    expect(preheaderOf(email.html)).toBe(preheader);
  });
});

describe("the organiser look", () => {
  it.each([
    ["A1", a1],
    ["A2", a2],
    ["A3", a3],
    ["A4", a4],
    ["A5", () => a5()],
    ["B1", b1],
  ] as const)("%s: warm grey page, the black hero (white then orange line), black step badges, the wordmark inline, Need help?, no company line", (_name, build) => {
    const { html, inlineImages } = build();
    expect(html).toContain(`<body bgcolor="${KIT.surface}"`);
    expect(html).toContain(`bgcolor="${KIT.black}" style="background-color:${KIT.black};border-radius:16px`);
    expect(html).toMatch(/<h1 style="[^"]*color:#ffffff[^"]*">[^<]+<br><span style="color:#ff4800">[^<]+<\/span><\/h1>/);
    // Step badges: black, white IBM Plex Mono number (handoff 4.3: were orange).
    const badges = [...html.matchAll(/bgcolor="#000000" style="width:48px;height:48px;border-radius:8px;background-color:#000000;[^"]*color:#ffffff">(\d\d)<\/td>/g)];
    expect(badges.length).toBeGreaterThanOrEqual(3);
    expect(badges[0][1]).toBe("01");
    expect(html).not.toMatch(/bgcolor="#ff4800" style="width:48px/);
    expect(html.split(WORDMARK)).toHaveLength(3);
    expect((inlineImages ?? []).map((i) => i.cid)).toEqual(["sheltuh-wordmark@sheltuh.com.au"]);
    expect(visible(html)).toContain("Need help? support@sheltuh.com.au");
    expect(html).not.toMatch(/Pty Ltd|\bABN\s/);
    // The organiser call to action hugs its label on a desktop, full width on a phone.
    expect(html).toContain('<table role="presentation" cellpadding="0" cellspacing="0" border="0" class="kw">');
  });
});

describe("A1 application received (the pending welcome)", () => {
  it("reads as the frame, top to bottom", () => {
    const { html, text } = a1();
    inOrder(visible(html), [
      "Application received",
      "Thanks for applying. We’ll be in touch soon.",
      "Hi Sam,",
      "Thanks for applying to organise on Sheltüh. A person on our team reviews every organiser",
      "We usually reply within 2 business days. Here’s what happens next.",
      "View your application →",
      "What happens next",
      "From application to your first event.",
      "01 We review your application",
      "02 You hear back from us",
      "03 You set up your first event",
      "Here’s to bringing people together, The Sheltüh team",
      "Need help?",
      "You’re getting this email because you applied to organise on Sheltüh.",
    ]);
    expect(html).toContain(`href="${SITE}/dashboard"`);
    expect(text).toContain(`View your application: ${SITE}/dashboard`);
    expect(text).toContain("01 We review your application");
  });

  it("greets 'Hi there,' without a usable name", () => {
    const email = buildOrganiserWelcomeEmail({ to: "o@example.com", firstName: " ​ ", status: "pending", siteUrl: SITE });
    expect(email.text).toContain("Hi there,");
  });
});

describe("A2 approved + onboarding", () => {
  it("reads as the frame", () => {
    inOrder(visible(a2().html), [
      "You’re approved",
      "You make the space. Bring your people together.",
      "Hi Sam,",
      "Good news: your organiser profile is approved.",
      "Open organiser dashboard →",
      "Get started",
      "Your first event in three steps.",
      "01 Introduce yourself",
      "02 Shape your first event",
      "03 Set up payouts",
      "Paid tickets need payouts set up before you publish. Free events can go live straight away.",
      "You’re getting this email because your organiser profile was approved.",
    ]);
  });
});

describe("A3 before your first event", () => {
  it("five essentials with their links, and the booking fee from lib/fees.ts", () => {
    const { html, text } = a3();
    inOrder(visible(html), [
      "Before your first event",
      "A few things to know. Then you’re ready to publish.",
      "Hey there,",
      "The essentials",
      "01 Your listings",
      "Terms",
      "02 Prices",
      `(${describeBookingFee()})`,
      "Purchase terms",
      "03 Refunds",
      "04 Payouts",
      "Set up payouts",
      "05 Attendee privacy",
      "Privacy",
    ]);
    expect(describeBookingFee()).toBe("6% of ticket face value + A$0.50 per paid ticket");
    expect(text).toContain(`   Set up payouts: ${SITE}/dashboard/payouts`);
  });
});

describe("A4 beyond tickets (built, not sent yet)", () => {
  it("five what's-included cards, the last coming soon", () => {
    inOrder(visible(a4().html), [
      "Beyond tickets",
      "More than a ticketing platform. Here’s what’s included.",
      "Explore your dashboard →",
      "What’s included",
      "01 Curated discovery",
      "02 Marketing and promotion",
      "Talk to our team",
      "03 Event insights",
      "04 Creative connections",
      "05 Organiser plans · coming soon",
      "You’re getting this email because you organise events on Sheltüh.",
    ]);
  });
});

describe("A5 after your event (built, not sent yet)", () => {
  it("four stat tiles, View analytics, next steps; the event's title escaped", () => {
    const { html, text } = a5();
    inOrder(visible(html), [
      "After your event",
      "That’s a wrap on Here & <Now>. Here’s how it went.",
      "1,595 Page views",
      "64 Tickets sold",
      "8.7% Order conversion",
      "45 Checked in",
      "View analytics →",
      "Next steps",
      "01 Your payout",
      "02 Say thanks",
      "03 Plan your next one",
      "You’re getting this email because you organised Here & <Now> on Sheltüh.",
    ]);
    expect(html).not.toContain("<Now>");
    expect(html).toContain(`href="${SITE}/dashboard/events/e1/analytics"`);
    expect(html).toContain(`bgcolor="${KIT.cream}" style="background-color:${KIT.cream};border-radius:16px;border-collapse:separate"><tr><td style="padding:20px">`);
    expect(text).toContain("Page views: 1,595\nTickets sold: 64\nOrder conversion: 8.7%\nChecked in: 45");
    expect(text).not.toContain("View full report");
    expect(visible(a5(null).html)).toContain("– Order conversion");
  });
});

describe("B1 after a meeting (a template for the team; not sent automatically)", () => {
  it("what you get, how to sign up, then Apply as an organiser; the fee from lib/fees.ts", () => {
    const { html, text } = b1();
    inOrder(visible(html), [
      "Great to meet you",
      "Let’s bring Here & Now to Sheltüh. Here’s how to get started.",
      "Hi Sam,",
      "What you get",
      "Everything we talked about.",
      `${describeBookingFeeShort()} per paid ticket, and free events are free.`,
      "How to sign up",
      "Set up on any device in about five minutes.",
      "Sign up with sam@example.com so we can match you",
      "Apply as an organiser →",
      "Speak soon, Kome, Sheltüh",
      "You’re getting this email because you met with the Sheltüh team.",
    ]);
    expect(describeBookingFeeShort()).toBe("6% + A$0.50");
    expect(html).toContain(`href="${SITE}/organisers/apply"`);
    expect(text).toContain(`Apply as an organiser: ${SITE}/organisers/apply`);
  });
});

describe("the member welcome (no frame: its copy on the 1120 pieces)", () => {
  it("cream page, the hero, three steps, See who's going, the sign-off", () => {
    const { html, subject } = buildMemberWelcomeEmail({ to: "fan@example.com", siteUrl: SITE });
    expect(subject).toBe("Welcome to Sheltüh — find your people");
    expect(html).toContain(`<body bgcolor="${KIT.cream}"`);
    inOrder(visible(html), [
      "Welcome to Sheltüh",
      "Find your room. Find your people.",
      "Hey there,",
      "Find your next event →",
      "Your kind of thing. Your kind of people.",
      "01 Follow what you love",
      "See who’s going",
      "See you out there, The Sheltüh team",
      "You’re receiving this because you created a Sheltüh account.",
    ]);
  });
});
