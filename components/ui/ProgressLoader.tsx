"use client";

import { useEffect, useState } from "react";
import DotsMark from "@/components/brand/DotsMark";
import { estimatedProgress } from "@/lib/progress";
import { usePrefersReducedMotion } from "@/lib/use-reduced-motion";

/** How often the estimate moves on: smoothly, or in 10% steps under reduced motion. */
const TICK_MS = 100;
const REDUCED_TICK_MS = 500;
/** A load slower than this shows its 100% for `HOLD_MS` before the content replaces it. */
export const SHOW_COMPLETION_AFTER_MS = 400;
export const HOLD_MS = 250;

export interface LoadingProgress {
  /** Show the loader: while loading, and briefly at 100% after a slow load. */
  visible: boolean;
  /** 0–99 while loading (an estimate), 100 once done. */
  percent: number;
  done: boolean;
}

/**
 * Estimated progress for a load in flight (lib/progress.ts): eases toward
 * 90% and reaches 100% only when `loading` turns false. A slow load then
 * holds its 100% for a moment so it visibly completes; a quick one (under
 * 400ms) simply gives way to the content, with no extra wait.
 */
export function useLoadingProgress(loading: boolean): LoadingProgress {
  const reduced = usePrefersReducedMotion();
  const [elapsed, setElapsed] = useState(0);
  const [wasLoading, setWasLoading] = useState(loading);
  const [holding, setHolding] = useState(false);

  // Adjusting state to a changed prop during render (React's documented pattern), so the
  // hold starts in the same render the load ends: the content never flashes in first.
  if (wasLoading !== loading) {
    setWasLoading(loading);
    if (loading) {
      setElapsed(0);
      setHolding(false);
    } else {
      setHolding(elapsed >= SHOW_COMPLETION_AFTER_MS);
    }
  }

  useEffect(() => {
    if (!loading) return;
    const start = performance.now();
    const id = setInterval(() => setElapsed(performance.now() - start), reduced ? REDUCED_TICK_MS : TICK_MS);
    return () => clearInterval(id);
  }, [loading, reduced]);

  useEffect(() => {
    if (!holding) return;
    const id = setTimeout(() => setHolding(false), HOLD_MS);
    return () => clearTimeout(id);
  }, [holding]);

  return {
    visible: loading || holding,
    percent: estimatedProgress(elapsed, !loading, { step: reduced ? 10 : 1 }),
    done: !loading,
  };
}

/**
 * The branded loading indicator (owner request, 21 Oct 2026): the two-dot
 * motif moving together and apart, and "Loading 42%" ("Loaded 100%" at the
 * end). It's a progressbar named by `label` (what's loading, e.g. "Loading
 * events") with the current value; the visible text is hidden from
 * screen readers, so they aren't read every percent. Announcing the start
 * and end is the host's job (a polite status it already owns), or set
 * `announce` for a status that says `label` once while loading.
 *
 * Reduced motion: the dots hold still (the `.dots-loader` animation only
 * exists without that preference) and the percentage moves in 10% steps.
 */
export function ProgressLoader({
  percent,
  label = "Loading",
  done = false,
  announce = false,
  className = "",
}: {
  percent: number;
  /** The progressbar's accessible name: what's loading. */
  label?: string;
  done?: boolean;
  announce?: boolean;
  className?: string;
}) {
  const value = Math.min(Math.max(Math.round(percent), 0), 100);
  return (
    <div className={`flex items-center gap-3 ${className}`.trim()}>
      <div
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={value}
        aria-valuetext={`${value}%`}
        className="flex items-center gap-3"
      >
        <DotsMark size="md" joined={done} className={`text-foreground ${done ? "" : "dots-loader"}`.trim()} />
        {/* "Loading" alone until there's a number worth showing (no "Loading 0%"). */}
        <span aria-hidden="true" className="text-sm text-muted tabular-nums">
          {done ? "Loaded" : "Loading"}
          {done || value >= 1 ? ` ${value}%` : ""}
        </span>
      </div>
      {announce && (
        <span role="status" className="sr-only">
          {done ? "" : `${label}…`}
        </span>
      )}
    </div>
  );
}

/** `ProgressLoader` driven by `useLoadingProgress`, for hosts that show it only while loading. */
export function LoadingIndicator({
  loading = true,
  label,
  announce,
  className,
}: {
  loading?: boolean;
  label?: string;
  announce?: boolean;
  className?: string;
}) {
  const progress = useLoadingProgress(loading);
  if (!progress.visible) return null;
  return (
    <ProgressLoader
      percent={progress.percent}
      done={progress.done}
      label={label}
      announce={announce}
      className={className}
    />
  );
}

/**
 * A view's whole loading state: the branded loader, named by the view's own
 * loading sentence ("Loading your account…" names the progressbar "Loading
 * your account"), so screen readers hear what's loading once, from the
 * progressbar, rather than twice. Shown only while loading.
 */
export function LoadingState({ text, className = "" }: { text: string; className?: string }) {
  return (
    <div className={className || undefined}>
      <LoadingIndicator label={text.replace(/…$/, "")} />
    </div>
  );
}
