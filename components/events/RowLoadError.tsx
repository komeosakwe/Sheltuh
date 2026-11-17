"use client";

import { Button } from "@/components/ui/Button";

/** A row of events that couldn't load ("More from", "Similar nearby"): said, with Try again. */
export default function RowLoadError({ onRetry, retrying = false }: { onRetry: () => void; retrying?: boolean }) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
      <p role="status" className="body-s text-muted">Couldn&rsquo;t load these events.</p>
      {/* Busy, not disabled, while it tries: focus stays on it. */}
      <Button variant="outline" size="sm" busy={retrying} onClick={onRetry}>
        {retrying ? "Trying again…" : "Try again"}
      </Button>
    </div>
  );
}
