import { describe, expect, it } from "vitest";
import { concurrencyLimit, POOL_MAX } from "@/lib/server/db";

/**
 * lib/server/db.ts: never more queries in flight than pool connections, so
 * postgres.js never pipelines onto a busy connection (which stalled organiser
 * analytics behind Supabase's transaction pooler).
 */
describe("concurrencyLimit", () => {
  it("runs at most `max` tasks at once, starts the rest in order, and returns each result", async () => {
    const run = concurrencyLimit(POOL_MAX);
    let active = 0;
    let peak = 0;
    const started: number[] = [];
    const tasks = Array.from({ length: 14 }, (_, i) =>
      run(async () => {
        started.push(i);
        active += 1;
        peak = Math.max(peak, active);
        await new Promise((resolve) => setTimeout(resolve, 5 + (i % 3)));
        active -= 1;
        return i * 2;
      }),
    );
    expect(await Promise.all(tasks)).toEqual(Array.from({ length: 14 }, (_, i) => i * 2));
    expect(peak).toBe(POOL_MAX);
    expect(started).toEqual(Array.from({ length: 14 }, (_, i) => i));
  });

  it("frees the slot when a task fails, so later tasks still run", async () => {
    const run = concurrencyLimit(1);
    const failed = run(() => Promise.reject(new Error("boom")));
    const next = run(async () => "ok");
    await expect(failed).rejects.toThrow("boom");
    await expect(next).resolves.toBe("ok");
  });
});
