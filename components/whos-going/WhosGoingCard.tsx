"use client";

import type { MouseEvent } from "react";
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
 * themselves and hasn't (`me.eligible`, not going), which focuses the opt-in control itself; "See who's
 * going" signed out (the panel's sign-in), "View attendees" for everyone else.
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
  // The rules' Secondary button: 40px from 768px, 48px on phones (touch targets of at least 48 at 390). Content-wide
  // beside the words; the whole width once it wraps under them (the words take the row's free space first).
  const action = buttonClass("outline", "sm", "grow max-md:min-h-12");
  // Signed out, the panel's way in is signing in to see the names; signed in (or the demo's samples), the list itself.
  const viewLabel = data.viewer.kind === "signed-out" && mode === "live" ? "See who’s going" : "View attendees";

  return (
    <section
      aria-label="Who’s going?"
      data-whos-going-card=""
      className={`flex flex-wrap items-center gap-x-4 gap-y-2 rounded-card bg-hover p-4 ${className}`.trim()}
    >
      <GoingFaces
        attendees={attendees}
        youName={youName}
        getToken={mode === "live" ? getToken : undefined}
        max={FACES_MAX}
        look="row"
      />
      <div className="min-w-0 grow-999 basis-40">
        {countShown && (
          <p data-going-count="" className="body-m font-semibold tabular-nums">
            {data.count} going{mode === "demo" ? " (sample)" : ""}
          </p>
        )}
        <p className="body-s text-muted">Ticket holders opt in</p>
      </div>
      {optIn ? (
        // Straight to the opt-in itself (Show me as going, or Add yourself) in the panel further down.
        <a href="#whos-going" onClick={focusOptIn} className={action}>
          I&rsquo;m going
        </a>
      ) : (
        <a href="#whos-going" aria-label={`${viewLabel} for ${event.title}`} className={action}>
          {viewLabel}
        </a>
      )}
    </section>
  );
}

/** "I'm going": focus moves to the panel's opt-in control (data-opt-in), not just the panel; the link's own jump otherwise. */
function focusOptIn(event: MouseEvent<HTMLAnchorElement>) {
  const control = document.querySelector<HTMLElement>("#whos-going [data-opt-in]");
  if (!control) return;
  event.preventDefault();
  control.focus();
  control.scrollIntoView?.({ block: "center" });
}
