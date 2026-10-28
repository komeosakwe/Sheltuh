import { describeBookingFee } from "@/lib/fees";
import { WHOS_GOING_SUMMARY } from "@/lib/whos-going-copy";
import { subjectLine, type EmailMessage } from "./email";
import {
  button,
  displayHeading,
  divider,
  emailFooter,
  emailFooterText,
  numberedSteps,
  numberedStepsText,
  type NumberedStep,
  page,
  paragraph,
  sectionHeading,
  wordmarkHtml,
  wordmarkImage,
} from "./email-layout";

/**
 * The welcome emails: a member who has just created an account, an organiser
 * who has just set up a profile (approved, or still waiting for review), and
 * an approved organiser's "before your first event" note on listings, prices,
 * refunds, payouts and attendee privacy. All on the shared brand layout
 * (lib/server/email-layout.ts). They are sent once and carry no marketing, so
 * there's no unsubscribe link; each says why the reader got it.
 */

export type OrganiserWelcomeStatus = "approved" | "pending";

const ORGANISER_SUBJECT = "Bring your people together with Sheltüh";
const ORGANISER_PREHEADER = "Make space for your ideas—and the people who connect with them.";
const ORGANISER_HEADING = ["You make the space.", "Bring your people together."];
const ORGANISER_INTRO = "You bring the idea, the atmosphere and the reason to show up.";
const ORGANISER_BUTTON = "Open organiser dashboard";

/** "Hey Sam," or, with no usable name, "Hey there,". Plain text (escape it for HTML). */
function greeting(firstName: string | null | undefined): string {
  const name = subjectLine(firstName ?? "");
  return `Hey ${name === "" ? "there" : name},`;
}

function link(siteUrl: string, path: string): string {
  return new URL(path, siteUrl).href;
}

interface Layout {
  siteUrl: string;
  title: string;
  preheader: string;
  heading: string[];
  greeting: string;
  paragraphs: string[];
  buttonLabel: string;
  buttonHref: string;
  /** The heading over the numbered steps ("" for none). */
  sectionTitle: string;
  steps: NumberedStep[];
  /** Extra section after the steps (heading and plain text), optional. */
  extra?: { title: string; text: string };
  signOff: string;
  reason: string;
}

function render(l: Layout): string {
  const body =
    displayHeading(l.heading, 24) +
    paragraph(l.greeting) +
    l.paragraphs.map((p) => paragraph(p)).join("") +
    button(l.buttonLabel, l.buttonHref, "8px 0 0 0") +
    divider(32) +
    (l.sectionTitle ? sectionHeading(l.sectionTitle, 20) : "") +
    numberedSteps(l.steps) +
    (l.extra ? divider(12) + sectionHeading(l.extra.title) + paragraph(l.extra.text, 0) : "") +
    divider(12) +
    paragraph(l.signOff.split("\n")[0], 4) +
    paragraph(l.signOff.split("\n")[1], 0);
  return page({
    title: l.title,
    preheader: l.preheader,
    header: wordmarkHtml,
    siteUrl: l.siteUrl,
    body,
    footer: emailFooter({ reason: l.reason, siteUrl: l.siteUrl }),
  });
}

function renderText(l: Layout): string {
  return [
    l.heading.join(" "),
    "",
    l.greeting,
    "",
    ...l.paragraphs.flatMap((p) => [p, ""]),
    `${l.buttonLabel}: ${l.buttonHref}`,
    "",
    ...(l.sectionTitle ? [l.sectionTitle, ""] : []),
    numberedStepsText(l.steps),
    "",
    ...(l.extra ? [l.extra.title, l.extra.text, ""] : []),
    l.signOff,
    "",
    emailFooterText({ reason: l.reason, siteUrl: l.siteUrl }),
  ].join("\n");
}

function build(to: string, subject: string, l: Layout): EmailMessage {
  return {
    to,
    subject: subjectLine(subject),
    text: renderText(l),
    html: render(l),
    inlineImages: [wordmarkImage()],
  };
}

/** Welcome to a member who has just created an account. */
export function buildMemberWelcomeEmail(input: { to: string; firstName?: string | null; siteUrl: string }): EmailMessage {
  const { to, siteUrl } = input;
  return build(to, "Welcome to Sheltüh — find your people", {
    siteUrl,
    title: "Welcome to Sheltüh",
    preheader: "Find something you love. Meet people who love it too.",
    heading: ["Find your room.", "Find your people."],
    greeting: greeting(input.firstName),
    paragraphs: [
      "A good night starts with something you’re into—and gets better with people who get it.",
      "Sheltüh helps you discover creative events and the spaces bringing people together. Whether you’re bringing a friend or trying somewhere new, find something that feels like you.",
    ],
    buttonLabel: "Find your next event",
    buttonHref: link(siteUrl, "/events"),
    sectionTitle: "Your kind of thing. Your kind of people.",
    steps: [
      { title: "Follow what you love", description: "From live music and art to film nights and hands-on workshops." },
      { title: "Find a place to connect", description: "Explore the spaces and events bringing your creative community together." },
      { title: "Make the first move", description: "Find an event that catches your eye and make a plan to be there." },
    ],
    extra: { title: "See who’s going", text: WHOS_GOING_SUMMARY },
    signOff: "See you out there,\nThe Sheltüh team",
    reason: "You’re receiving this because you created a Sheltüh account.",
  });
}

/** Welcome to an organiser who has just set up a profile: `approved`, or `pending` review. */
export function buildOrganiserWelcomeEmail(input: {
  to: string;
  firstName?: string | null;
  status: OrganiserWelcomeStatus;
  siteUrl: string;
}): EmailMessage {
  const { to, status, siteUrl } = input;
  const approved = status === "approved";
  return build(to, ORGANISER_SUBJECT, {
    siteUrl,
    title: ORGANISER_SUBJECT,
    preheader: ORGANISER_PREHEADER,
    heading: ORGANISER_HEADING,
    greeting: greeting(input.firstName),
    paragraphs: [
      ORGANISER_INTRO,
      approved
        ? "Sheltüh helps people discover what you’re creating and find a place in it. Start setting up your organiser profile and shaping your first event."
        : "Thanks for applying. A person checks every organiser before they can publish. Your dashboard shows your application’s status.",
    ],
    buttonLabel: ORGANISER_BUTTON,
    buttonHref: link(siteUrl, "/dashboard"),
    sectionTitle: "Start with an idea. Make room for people.",
    steps: approved
      ? [
          { title: "Introduce yourself", description: "Tell people who you are and what you’re bringing to the community." },
          {
            title: "Shape your first event",
            description: "Add the details that help someone picture being there: the space, the experience and what to expect.",
          },
          { title: "Get ready to welcome people", description: "Your dashboard shows the next steps before publishing or taking payments." },
        ]
      : [
          { title: "We check your application", description: "We’ll email you when there’s an update." },
          { title: "Shape your first event", description: "Once you’re approved, finish your profile and create your first event." },
          {
            title: "Get ready to welcome people",
            description: "Set up payouts before you publish paid tickets; free events don’t need them.",
          },
        ],
    signOff: "Here’s to bringing people together,\nThe Sheltüh team",
    reason: approved
      ? "You’re receiving this because you set up an organiser profile."
      : "You’re receiving this because you applied to be an organiser on Sheltüh.",
  });
}

/** "How it works" for a newly approved organiser: listings, prices, refunds, payouts and attendee privacy. */
export function buildOrganiserNextStepsEmail(input: { to: string; firstName?: string | null; siteUrl: string }): EmailMessage {
  const { to, siteUrl } = input;
  return build(to, "Before your first event on Sheltüh", {
    siteUrl,
    title: "Before your first event on Sheltüh",
    preheader: "How listing, pricing, refunds and attendee privacy work.",
    heading: ["A few things to know."],
    greeting: greeting(input.firstName),
    paragraphs: ["Here’s how listing, pricing, refunds and attendee privacy work on Sheltüh."],
    buttonLabel: ORGANISER_BUTTON,
    buttonHref: link(siteUrl, "/dashboard"),
    sectionTitle: "",
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
        description:
          "We don’t share buyers’ names or emails with organisers. If you collect people’s details yourself, handle them under the Privacy Act and only email people with their consent.",
        link: { label: "Privacy", href: link(siteUrl, "/privacy") },
      },
    ],
    signOff: "Here’s to bringing people together,\nThe Sheltüh team",
    reason: "You’re receiving this because your organiser profile was approved.",
  });
}
