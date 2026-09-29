"use client";

import { COUNT_THRESHOLD, useWhosGoing } from "./WhosGoingProvider";

/**
 * Phone and tablet only: "14 going" under the event title, jumping to the
 * panel (which sits below the buy bar there). Hidden whenever the panel shows
 * no number: loading, error, closed, or fewer than three people.
 */
export default function WhosGoingSummaryLink() {
  const { state } = useWhosGoing();
  if (state.status !== "ready" || state.data.closed || state.data.count < COUNT_THRESHOLD) return null;
  return (
    <a
      href="#whos-going"
      className="mt-1 inline-flex min-h-11 items-center text-sm leading-5 text-foreground underline underline-offset-4 hover:decoration-2"
    >
      {state.data.count} going
    </a>
  );
}
