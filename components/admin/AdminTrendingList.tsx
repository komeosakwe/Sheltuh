"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Button, buttonClass } from "@/components/ui/Button";
import { LoadingState } from "@/components/ui/ProgressLoader";
import { EmptyState, Notice } from "@/components/ui/Section";
import { getTrendingEvents, type TrendingEvent } from "@/lib/api/trending";
import { formatEventWhen } from "@/lib/format";
import { actionErrorText } from "./OrganiserItem";
import { TRENDING_PANEL_ID } from "./TrendingPanel";

type LoadState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; items: TrendingEvent[] };

/** Why it's trending, as the home page says it. */
export function trendingReason(item: TrendingEvent): string {
  if (item.label === "going" && item.goingCount) return `${item.goingCount.toLocaleString("en-AU")} going`;
  if (item.label === "just-announced") return "Just announced";
  return "Popular";
}

/**
 * /admin/trending: the public Trending list as the home page shows it now
 * (GET /api/events/trending, cached for a few minutes), best first, each
 * linking to its Trending panel on the admin edit page. Events kept out of
 * Trending aren't here: they're found under Events.
 */
export default function AdminTrendingList() {
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState<{ attempt: number; state: LoadState } | null>(null);
  const state: LoadState = result?.attempt === attempt ? result.state : { status: "loading" };

  useEffect(() => {
    let cancelled = false;
    getTrendingEvents().then(
      (response) => {
        if (!cancelled) setResult({ attempt, state: { status: "ready", items: response.items } });
      },
      (err: unknown) => {
        if (!cancelled) {
          setResult({ attempt, state: { status: "error", message: actionErrorText(err, "Couldn’t load Trending. Try again.") } });
        }
      },
    );
    return () => {
      cancelled = true;
    };
  }, [attempt]);

  return (
    <section aria-labelledby="trending-list-heading" aria-busy={state.status === "loading" ? true : undefined}>
      <h2 id="trending-list-heading" className="display-md !text-2xl">
        Trending now
        {state.status === "ready" && state.items.length > 0 && (
          <span className="text-muted"> ({state.items.length.toLocaleString("en-AU")})</span>
        )}
      </h2>
      <div className="mt-4">
        {state.status === "loading" && <LoadingState text="Loading…" />}
        {state.status === "error" && (
          <div className="flex flex-col items-start gap-3">
            <Notice tone="danger" role="alert">
              {state.message}
            </Notice>
            <Button variant="outline" size="sm" className="min-h-11" onClick={() => setAttempt((n) => n + 1)}>
              Try again
            </Button>
          </div>
        )}
        {state.status === "ready" && state.items.length === 0 && (
          <EmptyState title="Trending is hidden right now">
            Fewer than 3 events qualify, so the home page leaves the section out. Boosting an event under Events can
            change that.
          </EmptyState>
        )}
        {state.status === "ready" && state.items.length > 0 && (
          <ol className="flex flex-col border-b border-foreground">
            {state.items.map((item, index) => (
              <li
                key={item.event.eventId}
                className="flex flex-wrap items-center justify-between gap-3 border-t border-foreground py-3"
              >
                <div className="min-w-0">
                  <p className="font-semibold break-words">
                    <span className="meta mr-2 text-muted tabular-nums">{index + 1}.</span>
                    {item.event.title}
                  </p>
                  <p className="text-sm text-muted">
                    {item.event.organiserName} &middot; {formatEventWhen(item.event.startsAt, item.event.endsAt, item.event.timeZone, item.event.state)}{" "}
                    &middot; {trendingReason(item)}
                  </p>
                </div>
                <Link
                  href={`/admin/events/${encodeURIComponent(item.event.eventId)}/edit#${TRENDING_PANEL_ID}`}
                  aria-label={`Curate ${item.event.title}`}
                  className={buttonClass("outline", "sm", "min-h-11")}
                >
                  Curate
                </Link>
              </li>
            ))}
          </ol>
        )}
      </div>
    </section>
  );
}
