import { describe, expect, it } from "vitest";
import { isApiConfigured } from "@/lib/api/client";
import { loadHomeEvents, loadHomeRecent, loadHomeTrending } from "@/lib/home-events";
import { getSampleGoing } from "@/lib/sample-going";

// Tests run without Supabase settings, so this is demo mode: sample data, no requests.
const NOW = new Date("2026-10-21T01:00:00.000Z");

describe("home loaders (demo)", () => {
  it("runs in demo mode", () => {
    expect(isApiConfigured).toBe(false);
  });

  it("loadHomeEvents: the sample events that haven't ended, soonest first", async () => {
    const events = await loadHomeEvents(NOW);
    expect(events.length).toBeGreaterThan(0);
    for (const e of events) expect(Date.parse(e.endsAt ?? e.startsAt)).toBeGreaterThan(NOW.getTime());
    const starts = events.map((e) => e.startsAt);
    expect(starts).toEqual([...starts].sort());
  });

  it("loadHomeRecent: the sample events that ended in the last 14 days, most recently ended first", async () => {
    const events = await loadHomeRecent(NOW);
    for (const e of events) {
      const ended = Date.parse(e.endsAt ?? e.startsAt);
      expect(ended).toBeLessThanOrEqual(NOW.getTime());
      expect(ended).toBeGreaterThan(NOW.getTime() - 14 * 86_400_000);
    }
    const ends = events.map((e) => Date.parse(e.endsAt ?? e.startsAt));
    expect(ends).toEqual([...ends].sort((a, b) => b - a));
    // Late enough that nothing is within the window; early enough that nothing has started.
    expect(await loadHomeRecent(new Date("2030-01-01T00:00:00Z"))).toEqual([]);
    expect(await loadHomeRecent(new Date("2020-01-01T00:00:00Z"))).toEqual([]);
  });

  it("loadHomeTrending: upcoming samples by going count (ties soonest first), top 12, labelled with that count", async () => {
    const trending = await loadHomeTrending(NOW);
    expect(trending.length).toBeLessThanOrEqual(12);
    expect(trending.length).toBeGreaterThanOrEqual(3);
    const counts = trending.map(({ event, signal }) => {
      expect(signal).toEqual({ kind: "going", count: getSampleGoing(event.id).count });
      return getSampleGoing(event.id).count;
    });
    expect(counts).toEqual([...counts].sort((a, b) => b - a));
    for (const { event } of trending) expect(Date.parse(event.endsAt ?? event.startsAt)).toBeGreaterThan(NOW.getTime());
  });
});
