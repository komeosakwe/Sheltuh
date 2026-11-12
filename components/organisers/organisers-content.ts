/**
 * The For organisers page's copy (redesign PR 6): word for word from the owner's mock
 * (owner-mocks/organisers-dark.png, the proposal p.3), reworded only where a line wasn't true of
 * the product (the redesign plan's §7 and §11):
 * - "Every organiser and event is checked by a person" → "Every organiser is checked by a person":
 *   an admin approves every organiser, but an approved organiser's events go live at once.
 * - Reach: "…people who follow your scene — with who's going on every card." → "…people who
 *   follow you.": there's no scene following, but members do follow organisers
 *   (organiser_follows; "From organisers you follow" on the home), and cards show who's going only
 *   for some events.
 * - Grow: organisers never see saves, and who's going isn't on the dashboard: ticket sales only.
 * - "Who's going and communities…" → "Who's going…": there's no communities feature.
 * - "You can save and finish later." is dropped: the application has no draft.
 * - "87% of event-goers…" → "13 of 15 people we spoke to…": the source is 15 interviews
 *   (docs/PROJECT_CONTEXT.md), not event-goers at large.
 * - "Clear pricing" is true as drawn: free tickets carry no fee, paid tickets one booking fee each
 *   (lib/fees.ts), and organisers are paid out through Stripe Connect.
 */

export const ORGANISERS_EYEBROW = "For organisers";
/** The h1, read as one line; drawn on two. */
export const ORGANISERS_TITLE_LINES = ["Your event.", "Your community."] as const;
export const ORGANISERS_LEDE = "Bring your creative events to the people who want to be there.";

export type OrganiserPillarIcon = "create" | "reach" | "grow";

export const ORGANISER_PILLARS: readonly { icon: OrganiserPillarIcon; title: string; strap: string; body: string }[] = [
  {
    icon: "create",
    title: "Create",
    strap: "Publish your event",
    body: "Set up tickets, times and venue in minutes. Every organiser is checked by a person.",
  },
  {
    icon: "reach",
    title: "Reach",
    strap: "Find your audience",
    body: "Your event shows to people who follow you.",
  },
  {
    icon: "grow",
    title: "Grow",
    strap: "Manage and improve",
    body: "See ticket sales in one place, then plan your next one.",
  },
];

export const STEPS_EYEBROW = "How Sheltüh works";
export const STEPS_TITLE = "Publish your first event in four steps";
export const PUBLISH_STEPS: readonly { title: string; body: string }[] = [
  { title: "Apply", body: "Sign in and tell us about you and your events." },
  { title: "Get checked", body: "A person reviews every organiser before you go live." },
  { title: "Publish", body: "Add tickets, times, venue and photos." },
  { title: "Sell & connect", body: "Fans buy tickets, save your event and see who’s going." },
];

export const WHY_EYEBROW = "Why Sheltüh?";
export const WHY_TITLE = "Creative audiences, not everyone.";
/** The interviews' figure (docs/PROJECT_CONTEXT.md, "Stage and validation"): 13 of 15 is 87%. */
export const WHY_STAT = {
  figure: "13 of 15",
  caption: "people we spoke to skipped an event because they didn’t know anyone going",
} as const;
export const WHY_ROWS: readonly { title: string; body: string }[] = [
  {
    title: "Creative audiences",
    body: "Music, art, fashion and culture — niche events reach people who are looking for them.",
  },
  { title: "Curated discovery", body: "Only the good stuff. Every organiser is checked by a person." },
  { title: "Community connections", body: "Who’s going turns a ticket into a night with your people." },
  { title: "Clear pricing", body: "Free events are free. Paid events: a small fee per ticket, paid out via Stripe." },
];

export const START_EYEBROW = "Start organising";
/** The id of the Start organising panel ("Get started" goes here) and of its h2 (ApplyPageContent's). */
export const START_ID = "start";
export const START_TITLE_ID = "start-title";
export const HOW_IT_WORKS_ID = "how-it-works";

/** The hero's licensed photo (public/events/README.md): festoon lights and CBD towers at the Queen Victoria night market. */
export const ORGANISERS_HERO_PHOTO = "/events/street-market.jpg";
