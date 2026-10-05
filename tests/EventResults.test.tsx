// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import EventResults from "@/components/EventResults";
import { sampleEvents } from "@/lib/sample-events";
import type { SheltuhEvent } from "@/lib/types";

afterEach(cleanup);

/** n distinct events, cloned from the samples with unique ids/slugs/titles. */
function events(n: number): SheltuhEvent[] {
  return Array.from({ length: n }, (_, i) => {
    const base = sampleEvents[i % sampleEvents.length];
    return { ...base, id: `t-${i}`, slug: `t-${i}`, title: `Test event ${i}` };
  });
}

describe("EventResults", () => {
  it("shows every event exactly once, however many there are", () => {
    render(<EventResults events={events(30)} />);
    for (let i = 0; i < 30; i += 1) {
      expect(screen.getAllByText(`Test event ${i}`)).toHaveLength(1);
    }
  });

  it("puts the first 24 in the carousel and the rest in the grid below it", () => {
    render(<EventResults events={events(30)} />);
    const carousel = screen.getByRole("region", { name: "Events" });
    expect(within(carousel).getAllByRole("heading", { level: 3 })).toHaveLength(24);
    expect(within(carousel).queryByText("Test event 24")).not.toBeInTheDocument();
    expect(screen.getByText("Test event 24")).toBeInTheDocument();
    expect(screen.getByText("Test event 29")).toBeInTheDocument();
  });

  it("renders a short list wholly in the carousel, with no grid", () => {
    render(<EventResults events={events(3)} />);
    const carousel = screen.getByRole("region", { name: "Events" });
    expect(within(carousel).getAllByRole("heading", { level: 3 })).toHaveLength(3);
  });

  it("copes with no events at all", () => {
    render(<EventResults events={[]} />);
    expect(screen.getByRole("region", { name: "Events" })).toBeInTheDocument();
  });
});
