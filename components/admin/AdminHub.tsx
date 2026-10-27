"use client";

import Link from "next/link";
import { useId, type ReactNode } from "react";
import { Button } from "@/components/ui/Button";
import { Notice } from "@/components/ui/Section";
import { countText, hoursText } from "@/lib/admin-summary";
import type { AdminSummary } from "@/lib/api/types";
import { formatDayWithYear } from "@/lib/format";
import { useAdminSummary } from "./AdminSummaryProvider";
import { DOOR_EVENTS_HREF, RECENTLY_PUBLISHED_HREF } from "./event-queue-filters";

/**
 * White cards with a black border (brand-direction-one.md §2.4). The link is
 * the title and status; its ::after covers the card, so the whole card is
 * still one click target, while the to-do line stays out of the link's name
 * (it's the link's description instead).
 */
const cardClass =
  "group relative flex h-full flex-col gap-2 rounded-card border border-foreground bg-card p-4 hover:bg-surface";
const cardLinkClass = "flex flex-col gap-2 after:absolute after:inset-0 after:rounded-card after:content-['']";
const cardTitleClass =
  "font-heading text-xl leading-6 text-foreground underline-offset-4 group-hover:underline";

interface HubCard {
  href: string;
  title: string;
  /** What's waiting, in words ("3 open · oldest from Mon 20 Oct"); null while the counts load. */
  status: string | null;
  /** Something is waiting: the status line is set in the text colour, not muted. */
  waiting: boolean;
  /** What to do there. */
  todo: string;
  /** Its status line is a count from the summary: "Checking…" while that loads. */
  counted?: boolean;
}

function since(iso: string | null): string {
  return iso ? ` · oldest from ${formatDayWithYear(iso)}` : "";
}

/** The four "Needs you" cards, in a fixed order (most urgent first), whatever the counts. */
function needsYouCards(summary: AdminSummary | null): HubCard[] {
  const reports = summary?.reportsOpen;
  const events = summary?.eventsPending;
  const organisers = summary?.organisersPending;
  const failed = summary?.emailsFailed.count ?? 0;
  const retrying = summary?.emailsRetrying.count ?? 0;
  return [
    {
      href: "/admin/reports",
      title: "Member reports",
      status: reports ? (reports.count ? `${countText(reports.count, "open", "open")}${since(reports.oldestAt)}` : "All clear") : null,
      waiting: Boolean(reports?.count),
      todo: "Read each report, then dismiss it or suspend the member.",
    },
    {
      href: "/admin/events",
      title: "Event submissions",
      status: events
        ? events.count
          ? `${countText(events.count, "waiting", "waiting")}${
              events.startingSoon
                ? ` · ${countText(events.startingSoon, "starts", "start")} within ${hoursText(events.startingSoonHours)}`
                : ""
            }`
          : "All clear"
        : null,
      waiting: Boolean(events?.count),
      todo: "Check the details and ticket prices, then approve to publish, or reject with a reason.",
    },
    {
      href: "/admin/organisers",
      title: "Organiser applications",
      status: organisers
        ? organisers.count
          ? `${countText(organisers.count, "waiting", "waiting")}${since(organisers.oldestAt)}`
          : "All clear"
        : null,
      waiting: Boolean(organisers?.count),
      todo: "Check their links, then approve, or reject with a reason they’ll see.",
    },
    {
      href: "/admin/emails",
      title: "Failed ticket emails",
      status: summary
        ? `${failed ? countText(failed, "failed", "failed") : "All clear"}${
            retrying ? ` · ${countText(retrying, "retrying", "retrying")} automatically` : ""
          }`
        : null,
      waiting: failed > 0,
      todo: "A buyer didn’t get their tickets. Check the error, then resend.",
    },
  ];
}

/**
 * "3 by organisers in the last 3 days": events organisers published themselves
 * (summary.eventsPublishedByOrganisers; an older server may not send it, and
 * then the card has no status line).
 */
function selfPublishedStatus(summary: AdminSummary | null): string | null {
  const published = summary?.eventsPublishedByOrganisers;
  if (!published) return null;
  const period = `in the last ${hoursText(published.windowHours)}`;
  return published.count
    ? `${countText(published.count, "by an organiser", "by organisers")} ${period}`
    : `None by organisers ${period}`;
}

function manageCards(summary: AdminSummary | null): HubCard[] {
  const door = summary?.doorEvents;
  return [
    {
      href: "/admin/events?status=published",
      title: "Find an event",
      status: null,
      waiting: false,
      todo: "Search by title or organiser to edit, unpublish, change a seat map or curate Trending.",
    },
    {
      href: RECENTLY_PUBLISHED_HREF,
      title: "Recently published",
      status: selfPublishedStatus(summary),
      waiting: Boolean(summary?.eventsPublishedByOrganisers?.count),
      todo: "Approved organisers publish without review. Check what went live, and unpublish anything that shouldn’t be on Sheltüh.",
      counted: true,
    },
    {
      href: "/admin/organisers?status=approved",
      title: "Find an organiser",
      status: null,
      waiting: false,
      todo: "Search approved organisers by name, email or handle: suspend one, or remove a logo or video.",
    },
    {
      href: "/admin/events/new",
      title: "Create an event",
      status: null,
      waiting: false,
      todo: "For any approved organiser, or a Sheltüh-run (platform-managed) organiser with no account of its own.",
    },
    {
      href: "/admin/invites",
      title: "Invite someone",
      status: null,
      waiting: false,
      todo: "Invite a person who asked to join, as an organiser (approved when they accept) or a member.",
    },
    {
      href: "/admin/trending",
      title: "Trending",
      status: null,
      waiting: false,
      todo: "See what the home page’s Trending shows now, and boost an event or keep it out.",
    },
    {
      href: DOOR_EVENTS_HREF,
      title: "Door check-in",
      status: door
        ? door.count
          ? `${countText(door.count, "event", "events")} in the next ${hoursText(door.windowHours)}`
          : `None in the next ${hoursText(door.windowHours)}`
        : null,
      waiting: Boolean(door?.count),
      todo: "Check tickets in at Sheltüh-run events. Organisers run their own doors.",
      counted: true,
    },
  ];
}

function Card({ card, loading }: { card: HubCard; loading: boolean }) {
  const todoId = useId();
  return (
    <li className={cardClass}>
      <Link href={card.href} aria-describedby={todoId} className={cardLinkClass}>
        <h3 className={cardTitleClass}>{card.title}</h3>
        {(card.status !== null || loading) && (
          <p className={`text-sm font-semibold ${card.waiting ? "text-foreground" : "text-muted"}`}>
            {card.status ?? "Checking…"}
          </p>
        )}
      </Link>
      <p id={todoId} className="text-sm text-muted">
        {card.todo}
      </p>
    </li>
  );
}

function HubSection({ id, title, intro, children }: { id: string; title: string; intro?: string; children: ReactNode }) {
  return (
    <section aria-labelledby={id} className="flex flex-col gap-4 border-t border-foreground pt-5">
      <div>
        <h2 id={id} className="display-md !text-2xl">
          {title}
        </h2>
        {intro && <p className="mt-1 text-sm text-muted">{intro}</p>}
      </div>
      {children}
    </section>
  );
}

/** Jobs with no screen here, and where they're done instead. */
const OUTSIDE: { title: string; where: string }[] = [
  {
    title: "Refunds and disputes",
    where: "In the Stripe dashboard. A full refund there voids the order’s tickets on Sheltüh; a partial refund doesn’t.",
  },
  {
    title: "Who’s Going suspensions and switches",
    where:
      "Suspending a member without a report, lifting a suspension, switching Who’s Going off for one event, or removing one person from a list: SQL in Supabase, as in the Supabase setup guide.",
  },
  {
    title: "Making someone an admin",
    where: "The promote-admin script (npm run promote-admin), on purpose: no button here can grant it.",
  },
  {
    title: "Moving a seat, or removing personal details from logs",
    where: "SQL in Supabase, as in the Supabase setup guide. After moving a seat, resend the ticket email from Emails.",
  },
];

/**
 * /admin: what needs an admin now, then the tools, then what's done
 * elsewhere. The cards keep a fixed order (most urgent first) whatever the
 * counts, so they're always where the admin last found them; a card with
 * nothing waiting says "All clear" and stays a link. Without counts (still
 * loading, or the summary failed) every link still works.
 */
export default function AdminHub() {
  const context = useAdminSummary();
  const summary = context?.summary ?? null;
  const failed = context?.failed ?? false;
  const denied = context?.denied ?? false;
  const loading = !summary && !failed && !denied && Boolean(context);

  return (
    <div className="flex flex-col gap-10">
      <HubSection id="hub-needs-you" title="Needs you" intro="Waiting for an admin, most urgent first.">
        {denied && (
          <Notice tone="danger" role="alert">
            Sheltüh says this account no longer has admin access, so what’s waiting can’t be shown. Sign out and in
            again; if it still says so, ask another admin.
          </Notice>
        )}
        {failed && (
          <div className="flex flex-col items-start gap-3">
            <Notice tone="danger" role="alert">
              Couldn’t check what’s waiting{summary ? ", so these counts may be out of date" : ""}. The links still work.
            </Notice>
            <Button variant="outline" size="sm" className="min-h-11" onClick={() => context?.refresh()}>
              Check again
            </Button>
          </div>
        )}
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {needsYouCards(summary).map((card) => (
            <Card key={card.title} card={card} loading={loading} />
          ))}
        </ul>
      </HubSection>

      <HubSection id="hub-manage" title="Manage">
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {manageCards(summary).map((card) => (
            <Card key={card.title} card={card} loading={loading && card.counted === true} />
          ))}
        </ul>
      </HubSection>

      <HubSection
        id="hub-outside"
        title="Done outside Sheltüh admin"
        intro="There’s no screen for these here; this is where they’re done."
      >
        <ul className="grid gap-x-6 gap-y-4 sm:grid-cols-2">
          {OUTSIDE.map((item) => (
            <li key={item.title} className="border-t border-surface-border pt-3">
              <h3 className="text-base leading-6 font-semibold">{item.title}</h3>
              <p className="mt-1 text-sm text-muted">{item.where}</p>
            </li>
          ))}
        </ul>
      </HubSection>
    </div>
  );
}
