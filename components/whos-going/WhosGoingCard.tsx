"use client";

import { buttonClass } from "@/components/ui/Button";
import GoingFaces, { FACES_MAX } from "./GoingFaces";
import { COUNT_THRESHOLD, useWhosGoing, type GoingData } from "./WhosGoingProvider";

/** The viewer's own name when they're shown as going (a suspended member never is), as the panel works it out. */
function youNameOf(data: GoingData): string | undefined {
  const viewer = data.viewer.kind === "signed-in" ? data.viewer : null;
  if (!viewer || viewer.profile?.suspended || !viewer.me.going) return undefined;
  return viewer.profile?.displayName ?? viewer.self?.displayName ?? "";
}

/** A signed-in ticket holder who could add themselves and hasn't: the row's button is "I'm going" for them. */
function canOptIn(data: GoingData): boolean {
  const viewer = data.viewer.kind === "signed-in" ? data.viewer : null;
  return Boolean(viewer && !viewer.profile?.suspended && viewer.me.eligible && !viewer.me.going);
}

/**
 * The Who's going row under the organiser (the owner's event mock): a cream panel with up to five round
 * faces, "{N} going", "Ticket holders opt in", and one secondary button to the Who's Going panel further
 * down (#whos-going), where the existing opt-in is. "I'm going" for a signed-in ticket holder who can add
 * themselves and hasn't (`me.eligible`, not going); "View attendees" for everyone else.
 *
 * Only what WhosGoingProvider already holds, so nothing is invented: the count is the API's thresholded
 * one (none under three), and the faces are the names this viewer was already sent (signed-in members;
 * the demo's samples), the viewer's own first when they're going (GoingFaces: a photo only for a member
 * with a visible profile, linked to it; initials otherwise). Signed out, the API sends no names, so it's
 * the count alone. Shown when there's a count to show, or when the viewer can opt in (then without a
 * number); hidden while loading, on a load error (the panel says so, with Try again), and when the list
 * is closed (ended, external). A demo count is labelled as a sample.
 */
export default function WhosGoingCard({ className = "" }: { className?: string }) {
  const { mode, event, state, getToken } = useWhosGoing();
  if (state.status !== "ready") return null;
  const data = state.data;
  if (data.closed) return null;
  const countShown = !data.countHidden && data.count >= COUNT_THRESHOLD;
  const optIn = canOptIn(data);
  if (!countShown && !optIn) return null;

  const youName = youNameOf(data);
  const attendees = data.attendees ?? [];
  // The rules' Secondary button: 40px from 768px, 48px on phones (touch targets of at least 48 at 390).
  const action = buttonClass("outline", "sm", "shrink-0 max-md:min-h-12");

  return (
    <section
      aria-labelledby="whos-going-card-title"
      data-whos-going-card=""
      className={`flex flex-wrap items-center gap-x-4 gap-y-2 rounded-card bg-hover p-4 ${className}`.trim()}
    >
      {/* The page's words for it, for screen readers: the row itself leads with the count. */}
      <h2 id="whos-going-card-title" className="sr-only">
        Who&rsquo;s going?
      </h2>
      <GoingFaces
        attendees={attendees}
        youName={youName}
        getToken={mode === "live" ? getToken : undefined}
        max={FACES_MAX}
        look="row"
      />
      <div className="min-w-0 flex-1">
        {countShown && (
          <p data-going-count="" className="body-m font-semibold tabular-nums">
            {data.count} going{mode === "demo" ? " (sample)" : ""}
          </p>
        )}
        <p className="body-s text-muted">Ticket holders opt in</p>
      </div>
      {optIn ? (
        <a href="#whos-going" className={action}>
          I&rsquo;m going
        </a>
      ) : (
        <a href="#whos-going" aria-label={`View attendees for ${event.title}`} className={action}>
          View attendees
        </a>
      )}
    </section>
  );
}
