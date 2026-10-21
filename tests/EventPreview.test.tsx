// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import EventPreview, { PREVIEW_COUNT } from "@/components/EventPreview";
import { isUpcomingEvent } from "@/lib/data";
import { sampleEvents } from "@/lib/sample-events";

// The home page lists only events that haven't ended, so the sample data is
// read as of a fixed day.
const NOW = new Date("2026-09-30T02:00:00.000Z");
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function stubViewport(phone: boolean) {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: phone,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
}

const soonest = sampleEvents
  .filter((e) => isUpcomingEvent(e, NOW))
  .sort((a, b) => a.startsAt.localeCompare(b.startsAt));

describe("EventPreview (demo mode)", () => {
  it("on a phone shows only the first few events, soonest first, with a link to the rest", async () => {
    stubViewport(true);
    render(<EventPreview />);
    expect(await screen.findByRole("link", { name: "See all events" })).toHaveAttribute("href", "/events");
    expect(await screen.findAllByText(soonest[0].title)).toHaveLength(1);
    expect(screen.queryByText(soonest[PREVIEW_COUNT].title)).not.toBeInTheDocument();
    expect(soonest.length).toBeGreaterThan(PREVIEW_COUNT);
  });

  it("on wider screens shows the full set for the drifting carousel", async () => {
    stubViewport(false);
    render(<EventPreview />);
    expect(await screen.findAllByText(soonest[PREVIEW_COUNT].title)).toHaveLength(1);
    expect(screen.getByRole("link", { name: "See all events" })).toBeInTheDocument();
  });

  it("leaves out events that have already ended", async () => {
    stubViewport(false);
    render(<EventPreview />);
    expect(await screen.findAllByText(soonest[0].title)).toHaveLength(1);
    const ended = sampleEvents.filter((e) => !isUpcomingEvent(e, NOW));
    expect(ended.length).toBeGreaterThan(0);
    for (const event of ended) expect(screen.queryByText(event.title)).not.toBeInTheDocument();
  });
});
