/**
 * Honest, estimated loading progress (owner request, 21 Oct 2026). Fetches
 * don't report real progress, so the percentage is an estimate that eases
 * toward a ceiling below 100 and only reaches 100 once the data has arrived:
 * it never claims to be finished before it is.
 *
 * The curve is exponential: half of the remaining way to the ceiling every
 * `halfLifeMs`, so it moves quickly at first and slows as it nears the
 * ceiling, without ever getting there.
 */
export const PROGRESS_CEILING = 90;
export const PROGRESS_HALF_LIFE_MS = 800;

export interface ProgressOptions {
  /** Where the estimate levels off while still loading (below 100). */
  ceiling?: number;
  /** Time to cover half the remaining distance to the ceiling. */
  halfLifeMs?: number;
  /** Round down to this step (reduced motion: 10, so it changes in visible steps). */
  step?: number;
}

/** The estimated percentage after `elapsedMs` of loading; 100 once `done`. Always a whole number. */
export function estimatedProgress(elapsedMs: number, done: boolean, options: ProgressOptions = {}): number {
  if (done) return 100;
  const ceiling = Math.min(Math.max(options.ceiling ?? PROGRESS_CEILING, 0), 99);
  const halfLife = Math.max(options.halfLifeMs ?? PROGRESS_HALF_LIFE_MS, 1);
  const step = Math.max(Math.floor(options.step ?? 1), 1);
  const elapsed = Number.isFinite(elapsedMs) ? Math.max(elapsedMs, 0) : 0;
  const raw = ceiling * (1 - 2 ** (-elapsed / halfLife));
  // Floor (never round up toward the ceiling), then to the step.
  return Math.floor(Math.floor(raw) / step) * step;
}
