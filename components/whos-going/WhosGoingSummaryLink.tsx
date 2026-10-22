"use client";

import { COUNT_THRESHOLD, useWhosGoing } from "./WhosGoingProvider";

/**
 * Phone and tablet only: "14 going" under the event's facts, jumping to the
 * panel (which comes after the tickets there). Hidden whenever the panel
 * shows no number: loading, error, closed, or fewer than three people. No
 * faces here: the first screen stays short (docs/design/mobile-redesign.md
 * §6.4.2). A demo count is labelled as a sample.
 */
export default function WhosGoingSummaryLink() {
  const { mode, state } = useWhosGoing();
  if (state.status !== "ready" || state.data.closed || state.data.countHidden || state.data.count < COUNT_THRESHOLD) return null;
  return (
    <a
      href="#whos-going"
      className="inline-flex min-h-11 items-center text-sm leading-5 font-semibold text-foreground underline underline-offset-4 hover:decoration-2"
    >
      {state.data.count} going{mode === "demo" ? " (sample)" : ""}
    </a>
  );
}
