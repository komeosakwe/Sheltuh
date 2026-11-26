"use client";

import Link from "next/link";
import { useState, type ReactNode } from "react";
import type { OrganiserEventSummary } from "@/lib/api/types";
import { eventMeta, nothingTakenYet, salesLine, soldLine } from "@/lib/organiser-dashboard";
import { manageEventHref } from "@/lib/organiser-nav";
import { responsivePhoto } from "@/lib/responsive-image";
import { continuesStage, STAGE_PILL } from "./event-stage";
import ProgressBar from "./ui/ProgressBar";
import StatusPill from "./ui/StatusPill";

/**
 * The event's photo, 140px tall with radius 16, cropped to fill around its focus point; without one
 * (or if it fails to load) the cream block Latte draws for a draft with no image. Decorative: the
 * title beside it names the event.
 */
function CardImage({ event }: { event: Pick<OrganiserEventSummary, "imageUrl" | "imageFocus"> }) {
  const [failed, setFailed] = useState<string | null>(null);
  const url = event.imageUrl && failed !== event.imageUrl ? event.imageUrl : null;
  // The Events tab's one, two and three columns; the Overview's two at most.
  const photo = url ? responsivePhoto(url, "(min-width: 1280px) 33vw, (min-width: 640px) 50vw, 100vw") : null;
  return (
    <div data-card-image={url ? "photo" : "none"} className="h-35 w-full shrink-0 overflow-clip rounded-card bg-hover">
      {url && photo && (
        // eslint-disable-next-line @next/next/no-img-element -- the event's own same-origin photo; sized by its box
        <img
          src={photo.src}
          srcSet={photo.srcSet}
          sizes={photo.sizes}
          alt=""
          loading="lazy"
          decoding="async"
          onError={() => setFailed(url)}
          className="size-full object-cover"
          style={event.imageFocus ? { objectPosition: `${event.imageFocus.x}% ${event.imageFocus.y}%` } : undefined}
        />
      )}
    </div>
  );
}

/**
 * "Org / Event card" (Latte's dashboard frames, 466:8162: the Overview's Upcoming events and the
 * Events tab's grid): white, a 1px border/subtle edge, radius 16, 12px in (16 below); the photo; the
 * title (SemiBold 16/24) with its status pill; the date and place in Mono/S text/secondary; the
 * sales bar; and a foot of "86 / 120 sold · A$2,230" (Label/Tag, text/secondary) with "Manage →",
 * or "Continue →" for one still being made. The whole card takes a press (Latte draws it as one
 * link): "Manage →" is the link, named with the event ("Manage Here & Now"), and its hit area covers
 * the card, so the target is the card's size, and keyboard focus rings the whole card (as the site's event cards). `details` (the Events tab's next-step lines) sit above
 * the foot; `menu` (its other actions) beside the link, above the card's hit area.
 *
 * The bar is decorative (the foot says the same in words); an event sold on another site has no
 * Sheltüh sales, so no bar.
 */
export default function OrgEventCard({
  event,
  now,
  headingLevel = 3,
  details,
  menu,
}: {
  event: OrganiserEventSummary;
  now: Date;
  headingLevel?: 2 | 3;
  details?: ReactNode;
  menu?: ReactNode;
}) {
  const Heading = headingLevel === 2 ? "h2" : "h3";
  const title = event.title.trim() || "Untitled event";
  const pill = STAGE_PILL[event.stage];
  const action = continuesStage(event.stage) ? "Continue" : "Manage";
  const meta = eventMeta(event, now);
  return (
    <article
      data-org-event-card={event.eventId}
      data-stage={event.stage}
      className="relative flex w-full min-w-0 flex-col gap-3 rounded-card border border-surface-border bg-card px-3 pt-3 pb-4 text-left has-[[data-card-link]:focus-visible]:outline-2 has-[[data-card-link]:focus-visible]:outline-offset-3 has-[[data-card-link]:focus-visible]:outline-foreground"
    >
      <CardImage event={event} />
      <div className="flex flex-wrap items-start justify-between gap-2 px-1">
        <Heading className="label-button min-w-0 wrap-anywhere">{title}</Heading>
        <StatusPill tone={pill.tone}>{pill.label}</StatusPill>
      </div>
      {meta && <p className="font-mono text-xs leading-4 break-words text-muted">{meta}</p>}
      {event.ticketingMode !== "external" && <ProgressBar value={event.ticketsSold} max={event.capacity} />}
      {/* Above the card's hit area, so its words can be selected and its links pressed. */}
      {details && <div className="relative z-10">{details}</div>}
      <div className="label-tag flex flex-wrap items-center justify-between gap-x-3 gap-y-2 px-1">
        <p className="min-w-0 break-words text-muted tabular-nums">
          {nothingTakenYet(event) ? (
            <>
              {soldLine(event)} · <span aria-hidden="true">—</span>
              <span className="sr-only">nothing sold yet</span>
            </>
          ) : (
            salesLine(event)
          )}
        </p>
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          {menu && <div className="relative z-10">{menu}</div>}
          {/* data-card-link: the card draws the focus ring around itself (globals.css), so the link's own is dropped. */}
          <Link
            href={manageEventHref(event.eventId)}
            aria-label={`${action} ${title}`}
            data-card-action={action.toLowerCase()}
            data-card-link=""
            className="inline-flex items-center gap-1 text-foreground underline-offset-4 after:absolute after:inset-0 after:rounded-card after:content-[''] hover:underline"
          >
            {action}
            <span aria-hidden="true">→</span>
          </Link>
        </div>
      </div>
    </article>
  );
}
