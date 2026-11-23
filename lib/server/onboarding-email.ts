import { DETAILS_VISIBLE_MONTHS } from "@/lib/buyer-details";
import { SUPPORT_EMAIL } from "@/lib/contact";
import { describeBookingFee, describeBookingFeeShort } from "@/lib/fees";
import { WHOS_GOING_SUMMARY } from "@/lib/whos-going-copy";
import { subjectLine, type EmailMessage } from "./email";
import {
  type EmailTone,
  kitBody,
  kitButtons,
  kitFooter,
  kitFooterText,
  kitHeader,
  kitHelp,
  kitHelpText,
  kitHero,
  kitNotice,
  kitPage,
  kitSignOff,
  kitStack,
  kitStats,
  type KitStep,
  kitSteps,
  kitStepsText,
} from "./email-kit";
import { escapeHtml } from "./email-layout";
import { ticketWordmarkImage } from "./email-ticket-layout";

/**
 * The welcome and onboarding emails, on the shared layout
 * (lib/server/email-kit.ts) as Latte's 1120 organiser frames draw them: the
 * black hero, the greeting and body, the orange call to action, numbered
 * steps on cream cards with black badges, the sign-off, "Need help?" and the
 * footer. They are sent once and carry no marketing, so there's no
 * unsubscribe link; each says why the reader got it.
 *
 * Flow A (self sign-up): A1 application received (the pending organiser's
 * welcome), A2 approved + onboarding (the approved organiser's welcome), A3
 * before your first event (the next-steps note), A4 beyond tickets and A5
 * after your event (built, not sent yet: their triggers need new onboarding
 * and outbox kinds, a migration). Flow B: B1, the note our team sends after
 * a meeting (a template for the team; nothing sends it automatically). The
 * member welcome has no frame of its own and keeps its copy on the same
 * pieces, on the customer page colour.
 */

export type OrganiserWelcomeStatus = "approved" | "pending";

const DASHBOARD_BUTTON = "Open organiser dashboard";
const SIGN_OFF: [string, string] = ["Here’s to bringing people together,", "The Sheltüh team"];
/** Latte's placeholder "[2 business days]", filled with its suggested value (logged for the owner). */
export const ORGANISER_REVIEW_TIME = "2 business days";

/** "Hi Sam," (or "Hey …"), or "Hi there," without a usable name. */
function greeting(firstName: string | null | undefined, word: "Hi" | "Hey" = "Hi"): string {
  const name = subjectLine(firstName ?? "");
  return `${word} ${name === "" ? "there" : name},`;
}

function link(siteUrl: string, path: string): string {
  return new URL(path, siteUrl).href;
}

interface StepSection {
  eyebrow?: string;
  heading?: string;
  steps: KitStep[];
}

interface Layout {
  siteUrl: string;
  tone: EmailTone;
  title: string;
  preheader: string;
  hero: { eyebrow: string; line1: string; line2: string };
  greeting: string;
  paragraphs: string[];
  /** A5's stat tiles, under the body. */
  stats?: { value: string; label: string }[];
  button: { label: string; href: string };
  /** B1: the button after the steps, not before. */
  buttonLast?: boolean;
  sections: StepSection[];
  /** A closing box (the member welcome's "See who's going"). */
  extra?: { title: string; text: string };
  signOff: [string, string];
  reason: string;
}

function render(l: Layout): string {
  const button = kitButtons([{ label: l.button.label, href: l.button.href, kind: "primary" }], { hug: true });
  return kitPage({
    title: l.title,
    preheader: l.preheader,
    siteUrl: l.siteUrl,
    tone: l.tone,
    body: kitStack([
      kitHeader(),
      kitHero(l.hero),
      kitBody(l.greeting, l.paragraphs),
      l.stats ? kitStats(l.stats) : "",
      l.buttonLast ? "" : button,
      ...l.sections.map((section) => kitSteps(section)),
      l.extra ? kitNotice(l.extra.title, [escapeHtml(l.extra.text)]) : "",
      l.buttonLast ? button : "",
      kitStack([kitSignOff(...l.signOff), kitHelp(l.tone)], 32),
      kitFooter({ siteUrl: l.siteUrl, tone: l.tone, reason: l.reason }),
    ]),
  });
}

function renderText(l: Layout): string {
  const button = [`${l.button.label}: ${l.button.href}`, ""];
  return [
    l.hero.eyebrow.toUpperCase(),
    `${l.hero.line1} ${l.hero.line2}`,
    "",
    l.greeting,
    "",
    ...l.paragraphs.flatMap((p) => [p, ""]),
    ...(l.stats ? [...l.stats.map((s) => `${s.label}: ${s.value}`), ""] : []),
    ...(l.buttonLast ? [] : button),
    ...l.sections.flatMap((section) => [kitStepsText(section), ""]),
    ...(l.extra ? [l.extra.title, l.extra.text, ""] : []),
    ...(l.buttonLast ? button : []),
    l.signOff.join("\n"),
    "",
    kitHelpText(l.tone),
    "",
    kitFooterText({ siteUrl: l.siteUrl, tone: l.tone, reason: l.reason }),
  ].join("\n");
}

function build(to: string, subject: string, l: Layout): EmailMessage {
  return {
    to,
    subject: subjectLine(subject),
    text: renderText(l),
    html: render(l),
    inlineImages: [ticketWordmarkImage()],
  };
}

/** The welcome to a new member (no Latte frame: its own copy on the 1120 pieces, customer page colour). */
export function buildMemberWelcomeEmail(input: { to: string; firstName?: string | null; siteUrl: string }): EmailMessage {
  const { to, siteUrl } = input;
  return build(to, "Welcome to Sheltüh — find your people", {
    siteUrl,
    tone: "customer",
    title: "Welcome to Sheltüh",
    preheader: "Find something you love. Meet people who love it too.",
    hero: { eyebrow: "Welcome to Sheltüh", line1: "Find your room.", line2: "Find your people." },
    greeting: greeting(input.firstName, "Hey"),
    paragraphs: [
      "A good night starts with something you’re into—and gets better with people who get it.",
      "Sheltüh helps you discover creative events and the spaces bringing people together. Whether you’re bringing a friend or trying somewhere new, find something that feels like you.",
    ],
    button: { label: "Find your next event", href: link(siteUrl, "/events") },
    sections: [
      {
        heading: "Your kind of thing. Your kind of people.",
        steps: [
          { title: "Follow what you love", description: "From live music and art to film nights and hands-on workshops." },
          { title: "Find a place to connect", description: "Explore the spaces and events bringing your creative community together." },
          { title: "Make the first move", description: "Find an event that catches your eye and make a plan to be there." },
        ],
      },
    ],
    extra: { title: "See who’s going", text: WHOS_GOING_SUMMARY },
    signOff: ["See you out there,", "The Sheltüh team"],
    reason: "You’re receiving this because you created a Sheltüh account.",
  });
}

/**
 * The organiser's welcome, as soon as they set up a profile: A1 "Application
 * received" while it waits for review (`pending`), A2 "Approved +
 * onboarding" when it's approved already (an invite or a trusted link).
 */
export function buildOrganiserWelcomeEmail(input: {
  to: string;
  firstName?: string | null;
  status: OrganiserWelcomeStatus;
  siteUrl: string;
}): EmailMessage {
  const { to, status, siteUrl } = input;
  const dashboard = link(siteUrl, "/dashboard");
  if (status === "pending") {
    return build(to, "We’ve got your application", {
      siteUrl,
      tone: "organiser",
      title: "We’ve got your application",
      preheader: `A person on our team will review it within ${ORGANISER_REVIEW_TIME}.`,
      hero: { eyebrow: "Application received", line1: "Thanks for applying.", line2: "We’ll be in touch soon." },
      greeting: greeting(input.firstName),
      paragraphs: [
        "Thanks for applying to organise on Sheltüh. A person on our team reviews every organiser, so your events sit alongside work people can trust.",
        `We usually reply within ${ORGANISER_REVIEW_TIME}. Here’s what happens next.`,
      ],
      button: { label: "View your application", href: dashboard },
      sections: [
        {
          eyebrow: "What happens next",
          heading: "From application to your first event.",
          steps: [
            { title: "We review your application", description: "We look at who you are, the events you run and the community you’re building." },
            { title: "You hear back from us", description: "Once you’re approved, we’ll email you everything you need to get started." },
            { title: "You set up your first event", description: "Add tickets, times, venue and photos, then publish when you’re ready." },
          ],
        },
      ],
      signOff: SIGN_OFF,
      reason: "You’re getting this email because you applied to organise on Sheltüh.",
    });
  }
  return build(to, "You’re in. Let’s get your first event live", {
    siteUrl,
    tone: "organiser",
    title: "You’re in. Let’s get your first event live",
    preheader: "Three steps to your first event on Sheltüh.",
    hero: { eyebrow: "You’re approved", line1: "You make the space.", line2: "Bring your people together." },
    greeting: greeting(input.firstName),
    paragraphs: [
      "Good news: your organiser profile is approved.",
      "Sheltüh helps people discover what you’re creating and find a place in it. Here’s how to get your first event live.",
    ],
    button: { label: DASHBOARD_BUTTON, href: dashboard },
    sections: [
      {
        eyebrow: "Get started",
        heading: "Your first event in three steps.",
        steps: [
          { title: "Introduce yourself", description: "Add a photo, a short bio and your links, so people know who’s behind the event." },
          {
            title: "Shape your first event",
            description: "Add the details that help someone picture being there: the space, the experience and what to expect.",
          },
          { title: "Set up payouts", description: "Paid tickets need payouts set up before you publish. Free events can go live straight away." },
        ],
      },
    ],
    signOff: SIGN_OFF,
    reason: "You’re getting this email because your organiser profile was approved.",
  });
}

/** A3 "Before your first event": listings, prices, refunds, payouts and attendee privacy, an hour after approval. */
export function buildOrganiserNextStepsEmail(input: { to: string; firstName?: string | null; siteUrl: string }): EmailMessage {
  const { to, siteUrl } = input;
  return build(to, "Before you publish: a few things to know", {
    siteUrl,
    tone: "organiser",
    title: "Before you publish: a few things to know",
    preheader: "Listings, pricing, refunds, payouts and attendee privacy.",
    hero: { eyebrow: "Before your first event", line1: "A few things to know.", line2: "Then you’re ready to publish." },
    greeting: greeting(input.firstName, "Hey"),
    paragraphs: ["Here’s how listing, pricing, refunds and attendee privacy work on Sheltüh."],
    button: { label: DASHBOARD_BUTTON, href: link(siteUrl, "/dashboard") },
    sections: [
      {
        eyebrow: "The essentials",
        steps: [
          {
            title: "Your listings",
            description:
              "You need the right to list your event and use its photos and text, and Sheltüh can remove listings that don’t fit.",
            link: { label: "Terms", href: link(siteUrl, "/terms") },
          },
          {
            title: "Prices",
            description: `Buyers see one all-inclusive total. You choose whether buyers pay the booking fee (${describeBookingFee()}) or you absorb it. If you advertise elsewhere, quote the total price.`,
            link: { label: "Purchase terms", href: link(siteUrl, "/purchase-terms") },
          },
          {
            title: "Refunds",
            description:
              "Set your event’s refund policy before you publish. Sheltüh handles refund requests, and Australian Consumer Law still applies.",
            link: { label: "Refunds", href: link(siteUrl, "/refunds") },
          },
          {
            title: "Payouts",
            description: "Paid tickets need payouts set up before you publish.",
            link: { label: "Set up payouts", href: link(siteUrl, "/dashboard/payouts") },
          },
          {
            title: "Attendee privacy",
            description: `For orders placed after buyers were shown the sharing notice at checkout, names and emails are in your Orders tab for ${DETAILS_VISIBLE_MONTHS} months after each event ends. Use them only for the event, and only email people who have agreed to hear from you (Spam Act). Handle them under the Privacy Act.`,
            link: { label: "Privacy", href: link(siteUrl, "/privacy") },
          },
        ],
      },
    ],
    signOff: SIGN_OFF,
    reason: "You’re getting this email because your organiser profile was approved.",
  });
}

/**
 * A4 "Beyond tickets", for 7 days after approval. Built and previewed, not
 * sent: its trigger needs a new onboarding kind (a migration), and the owner's
 * go-ahead (QUESTIONS-FOR-OWNER 8).
 */
export function buildOrganiserBeyondTicketsEmail(input: { to: string; firstName?: string | null; siteUrl: string }): EmailMessage {
  const { to, siteUrl } = input;
  return build(to, "More than tickets: what Sheltüh does for your events", {
    siteUrl,
    tone: "organiser",
    title: "More than tickets: what Sheltüh does for your events",
    preheader: "Discovery, promotion, insights and what’s coming next.",
    hero: { eyebrow: "Beyond tickets", line1: "More than a ticketing platform.", line2: "Here’s what’s included." },
    greeting: greeting(input.firstName),
    paragraphs: ["Selling tickets is only part of it. Here’s what else Sheltüh does to help your events find the right crowd."],
    button: { label: "Explore your dashboard", href: link(siteUrl, "/dashboard") },
    sections: [
      {
        eyebrow: "What’s included",
        steps: [
          {
            title: "Curated discovery",
            description: "Your events reach people browsing Sheltüh for creative experiences, not just the people who already follow you.",
            link: { label: "How discovery works", href: link(siteUrl, "/help") },
          },
          {
            title: "Marketing and promotion",
            description: "As one of our founding organisers, promotion is included: social posts, EDM features and content coverage for your events.",
            link: { label: "Talk to our team", href: `mailto:${SUPPORT_EMAIL}` },
          },
          {
            title: "Event insights",
            description: "Page views, conversion, ticket sales and check-ins in one place, so every event teaches you something.",
            link: { label: "See your insights", href: link(siteUrl, "/dashboard/analytics") },
          },
          { title: "Creative connections", description: "Meet other organisers, venues and collaborators building the creative scene with you." },
          {
            title: "Organiser plans · coming soon",
            description: "Reduced fees, deeper analytics and more promotion for organisers who run events often. We’ll email you when they launch.",
          },
        ],
      },
    ],
    signOff: SIGN_OFF,
    reason: "You’re getting this email because you organise events on Sheltüh.",
  });
}

/** What A5 reports about one event: its figures as the analytics tab counts them. */
export interface AfterEventStats {
  eventTitle: string;
  /** The event's analytics page (the dashboard's Analytics tab). */
  analyticsHref: string;
  pageViews: number;
  ticketsSold: number;
  /** Orders over page views, 0..1, or null when there were no views. */
  orderConversion: number | null;
  checkedIn: number;
}

/**
 * A5 "After your event", for the morning after each event ends. Built and
 * previewed, not sent: its trigger needs a new outbox kind (a migration). The
 * payout line leaves out the timing Latte marked "to be confirmed".
 */
export function buildOrganiserAfterEventEmail(input: {
  to: string;
  firstName?: string | null;
  siteUrl: string;
  stats: AfterEventStats;
}): EmailMessage {
  const { to, siteUrl, stats } = input;
  const title = subjectLine(stats.eventTitle);
  const count = (n: number) => Math.max(0, Math.round(n)).toLocaleString("en-AU");
  const conversion = stats.orderConversion === null ? "–" : `${(Math.round(stats.orderConversion * 1000) / 10).toLocaleString("en-AU")}%`;
  return build(to, `That’s a wrap on ${title}`, {
    siteUrl,
    tone: "organiser",
    title: `That’s a wrap on ${title}`,
    preheader: "Your page views, ticket sales and check-ins, plus next steps.",
    hero: { eyebrow: "After your event", line1: `That’s a wrap on ${title}.`, line2: "Here’s how it went." },
    greeting: greeting(input.firstName),
    paragraphs: [`Thanks for bringing people together. Here’s how ${title} went.`],
    stats: [
      { value: count(stats.pageViews), label: "Page views" },
      { value: count(stats.ticketsSold), label: "Tickets sold" },
      { value: conversion, label: "Order conversion" },
      { value: count(stats.checkedIn), label: "Checked in" },
    ],
    button: { label: "View analytics", href: stats.analyticsHref },
    sections: [
      {
        eyebrow: "Next steps",
        steps: [
          {
            title: "Your payout",
            description: "Ticket revenue, minus fees, is paid to your account.",
            link: { label: "Payout details", href: link(siteUrl, "/dashboard/payouts") },
          },
          {
            title: "Say thanks",
            description: "Share photos from the night, and email attendees who agreed to hear from you.",
            link: { label: "Attendee list", href: link(siteUrl, "/dashboard") },
          },
          {
            title: "Plan your next one",
            description: "Start your next event from the dashboard while the night is still fresh.",
            link: { label: "Create an event", href: link(siteUrl, "/dashboard/new") },
          },
        ],
      },
    ],
    signOff: SIGN_OFF,
    reason: `You’re getting this email because you organised ${title} on Sheltüh.`,
  });
}

/**
 * B1, the note our team sends after a meeting with an organiser (Flow B).
 * A template the team fills in (their own name, the organiser's first name
 * and event; `to` is the email the organiser gave); nothing sends it
 * automatically. The organiser then joins Flow A at A3 once approved.
 */
export function buildOrganiserMeetingEmail(input: {
  to: string;
  firstName: string;
  /** "[Event]" / "[Event / organisation]" in the frame. */
  eventName: string;
  teamMemberName: string;
  siteUrl: string;
}): EmailMessage {
  const { to, siteUrl } = input;
  const first = subjectLine(input.firstName);
  const eventName = subjectLine(input.eventName);
  const host = new URL(siteUrl).host;
  return build(to, `Great to meet you, ${first}: next steps for ${eventName}`, {
    siteUrl,
    tone: "organiser",
    title: `Great to meet you, ${first}`,
    preheader: "How to sign up on any device, and what you get with Sheltüh.",
    hero: { eyebrow: "Great to meet you", line1: `Let’s bring ${eventName} to Sheltüh.`, line2: "Here’s how to get started." },
    greeting: greeting(first),
    paragraphs: [
      `Great chatting with you and learning more about what you’re building with ${eventName}.`,
      "As discussed, we’d love to bring your upcoming events onto Sheltüh and connect them with people actively looking for creative experiences.",
    ],
    button: { label: "Apply as an organiser", href: link(siteUrl, "/organisers/apply") },
    buttonLast: true,
    sections: [
      {
        eyebrow: "What you get",
        heading: "Everything we talked about.",
        steps: [
          {
            title: "Curated discovery",
            description: "Reach new audiences through a curated platform that connects people with events that match what they love.",
          },
          {
            title: "Marketing and promotion",
            description: "As one of our founding organisers, promotion is included: social posts, EDM features and content coverage.",
          },
          {
            title: "Simple ticketing",
            description: `Sell tickets and check guests in from one dashboard. ${describeBookingFeeShort()} per paid ticket, and free events are free.`,
          },
          { title: "Event insights", description: "See page views, conversion, ticket sales and check-ins for every event." },
        ],
      },
      {
        eyebrow: "How to sign up",
        heading: "Set up on any device in about five minutes.",
        steps: [
          { title: "On a computer", description: `Go to ${host}/organisers/apply. Sign in with Google, Apple or your email.` },
          {
            title: "On your phone",
            description: `Open ${host} in your browser, tap the menu, then For organisers → Apply. Same steps, same account.`,
          },
          { title: "Use the email you gave us", description: `Sign up with ${to} so we can match you to our chat and fast-track your review.` },
          { title: "Go live", description: "Once you’re approved, set up payouts and publish your first event from the dashboard." },
        ],
      },
    ],
    signOff: ["Speak soon,", `${subjectLine(input.teamMemberName)}, Sheltüh`],
    reason: "You’re getting this email because you met with the Sheltüh team.",
  });
}
