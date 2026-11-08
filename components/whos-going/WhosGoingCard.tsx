"use client";

import Image from "next/image";
import { ChevronRightIcon } from "@/components/home/icons";
// At most three faces, then "+N" for everyone else going (owner's mockup, 8 Nov 2026), as on the This weekend cards.
import { CARD_FACES_MAX } from "@/lib/event-card";
import GoingFaces, { facesShown } from "./GoingFaces";
import { COUNT_THRESHOLD, useWhosGoing, type GoingData } from "./WhosGoingProvider";


/**
 * The backdrop behind the card: one of the licensed sample-event photos (public/events/README.md),
 * a red-lit DJ deck, the warmest of them, standing in for the mockup's concert crowd. Decorative.
 */
export const CARD_PHOTO = "/events/record-shop-dj.jpg";

/** Three people, the one in front whole (decorative: the heading beside it says what it is). */
function PeopleIcon({ className }: { className?: string }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <circle cx="12" cy="8.5" r="3.25" />
      <path d="M6.5 19.5v-.75a5.5 5.5 0 0 1 11 0v.75" />
      <path d="M7.2 5.6a2.6 2.6 0 0 0-.7 5.1" />
      <path d="M2.5 18.5v-.4a4.3 4.3 0 0 1 3.1-4.1" />
      <path d="M16.8 5.6a2.6 2.6 0 0 1 .7 5.1" />
      <path d="M21.5 18.5v-.4a4.3 4.3 0 0 0-3.1-4.1" />
    </svg>
  );
}

/** The viewer's own name when they're shown as going (a suspended member never is), as the panel works it out. */
function youNameOf(data: GoingData): string | undefined {
  const viewer = data.viewer.kind === "signed-in" ? data.viewer : null;
  if (!viewer || viewer.profile?.suspended || !viewer.me.going) return undefined;
  return viewer.profile?.displayName ?? viewer.self?.displayName ?? "";
}

/**
 * "Who's going?" under the event's Save and Share (owner's mockup, 8 Nov 2026): a dark card with a
 * crowd photo fading in from the right, the count ("42 people are going"), up to three faces and
 * "+N" for the rest, and "View attendees", which goes to the Who's Going panel further down (the
 * jump the "14 going" link under the facts made before it).
 *
 * Only what WhosGoingProvider already holds, so nothing is invented: the count is the API's
 * thresholded one (none under three, so the card isn't shown then, as the link wasn't), and the
 * faces are the names this viewer was already sent (signed-in members; the demo's samples), the
 * viewer's own first when they're going. A face is a photo only for a member with a visible profile
 * who has one, and links to that profile (GoingFaces); everyone else is initials. Signed out, the
 * API sends no names, so there are no faces and no "+N", just the count. Hidden while loading, on a
 * load error (the panel says so, with Try again), and when the list is closed (ended, external).
 * A demo count is labelled as a sample.
 */
export default function WhosGoingCard({ className = "" }: { className?: string }) {
  const { mode, event, state, getToken } = useWhosGoing();
  if (state.status !== "ready") return null;
  const data = state.data;
  if (data.closed || data.countHidden || data.count < COUNT_THRESHOLD) return null;

  const youName = youNameOf(data);
  const attendees = data.attendees ?? [];
  const faces = facesShown(attendees, youName, CARD_FACES_MAX);
  // Everyone going (the viewer included) less the faces drawn.
  const rest = Math.max(0, data.count - faces);

  return (
    <section
      aria-labelledby="whos-going-card-title"
      data-whos-going-card=""
      className={`relative isolate overflow-hidden rounded-card bg-night text-paper ${className}`.trim()}
    >
      {/* The crowd, over the right of the card, dimmed, under a gradient that keeps the words on solid ground. */}
      <div aria-hidden="true" className="absolute inset-y-0 right-0 -z-10 w-3/5">
        <Image src={CARD_PHOTO} alt="" fill sizes="(min-width: 1024px) 24rem, 60vw" className="object-cover object-center" />
        <div className="absolute inset-0 bg-night/60" />
      </div>
      <div
        aria-hidden="true"
        className="absolute inset-0 -z-10 bg-linear-to-r from-night from-40% via-night/70 via-60% to-night/0"
      />
      <div className="ps-3.5 pe-2.5 pt-1.5 pb-2">
        <div className="flex items-start gap-2.5">
          <PeopleIcon className="mt-0.5 size-6 shrink-0 text-signal" />
          <div className="min-w-0">
            <h2 id="whos-going-card-title" className="text-lg leading-6 font-bold tracking-tight">
              Who&rsquo;s going?
            </h2>
            <p data-going-count="" className="-mt-0.5 text-xs leading-4 text-paper/80">
              {data.count} people are going{mode === "demo" ? " (sample)" : ""}
            </p>
          </div>
        </div>
        <div className="mt-1 flex flex-wrap items-center justify-between gap-x-3">
          {faces > 0 ? (
            <div className="flex items-center ps-0.5">
              <GoingFaces
                attendees={attendees}
                youName={youName}
                getToken={mode === "live" ? getToken : undefined}
                max={CARD_FACES_MAX}
                look="card"
              />
              {rest > 0 && (
                // The count above says it in words; this is its picture.
                <span
                  aria-hidden="true"
                  data-going-rest=""
                  className="ml-0.5 flex size-9 shrink-0 items-center justify-center rounded-full bg-night text-sm leading-5 font-medium tabular-nums ring-1 ring-paper/60"
                >
                  +{rest}
                </span>
              )}
            </div>
          ) : (
            <span aria-hidden="true" />
          )}
          {/* A 44px target around the mockup's slimmer pill. */}
          <a
            href="#whos-going"
            aria-label={`View attendees for ${event.title}`}
            className="group/view ml-auto inline-flex min-h-11 items-center rounded-full focus-visible:outline-paper"
          >
            <span className="inline-flex h-7 items-center gap-1 rounded-full border border-paper ps-3.5 pe-2.5 text-xs leading-4 font-semibold whitespace-nowrap group-hover/view:bg-paper/10">
              View attendees
              <ChevronRightIcon className="size-4 shrink-0" />
            </span>
          </a>
        </div>
      </div>
    </section>
  );
}
