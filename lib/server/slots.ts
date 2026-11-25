import { HttpError } from "./http";

/** How many jobs may run at once on one server instance, and how many more may wait for a slot. */
export interface SlotLimits {
  running: number;
  waiting: number;
}

/**
 * A per-instance limit on heavy work (image decoding, card rendering): `limits.running` jobs at
 * once, `limits.waiting` more queued in order, and beyond that an HttpError 503 with
 * `busyMessage`. Each limiter has its own slots. A finishing job hands its slot straight to the
 * next in line; a job that throws frees its slot all the same.
 */
export function slotLimiter(limits: SlotLimits, busyMessage: string): <T>(work: () => Promise<T>) => Promise<T> {
  let running = 0;
  const waiting: (() => void)[] = [];
  return async function inSlot<T>(work: () => Promise<T>): Promise<T> {
    if (running < limits.running) {
      running += 1;
    } else {
      if (waiting.length >= limits.waiting) throw new HttpError(503, busyMessage);
      // The slot is handed over by the finishing job (running stays the same).
      await new Promise<void>((resolve) => waiting.push(resolve));
    }
    try {
      return await work();
    } finally {
      const next = waiting.shift();
      if (next) next();
      else running -= 1;
    }
  };
}
