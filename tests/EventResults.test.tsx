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

describe("EventResults (brand-direction-one.md §7: one grid of 4:5 tiles)", () => {
  it("shows every event exactly once, however many there are, in the order given", () => {
    render(<EventResults events={events(30)} />);
    const list = screen.getByRole("list", { name: "Events" });
    const titles = within(list).getAllByRole("heading", { level: 3 }).map((h) => h.textContent);
    expect(titles).toEqual(Array.from({ length: 30 }, (_, i) => `Test event ${i}`));
  });

  it("is a two-column grid on phones, three from 640px and four from 1024px, with no carousel", () => {
    render(<EventResults events={events(3)} />);
    const list = screen.getByRole("list", { name: "Events" });
    expect(list).toHaveClass("grid", "grid-cols-2", "sm:grid-cols-3", "lg:grid-cols-4");
    expect(within(list).getAllByRole("listitem")).toHaveLength(3);
    expect(screen.queryByRole("region", { name: "Events" })).toBeNull();
    expect(screen.queryByRole("button", { name: /Pause|Play|Next events|Previous events/ })).toBeNull();
  });

  it("marks the grid for the staggered scroll entrance", () => {
    render(<EventResults events={events(2)} />);
    expect(screen.getByRole("list", { name: "Events" })).toHaveAttribute("data-reveal-stagger");
  });

  it("gives each tile its orange Buy tickets link to the event's tickets", () => {
    const [paid] = events(1);
    render(<EventResults events={[paid]} />);
    expect(screen.getByRole("link", { name: `Buy tickets for ${paid.title}` })).toHaveAttribute(
      "href",
      `/events/${paid.slug}#tickets`,
    );
  });

  it("copes with no events at all", () => {
    render(<EventResults events={[]} />);
    expect(within(screen.getByRole("list", { name: "Events" })).queryAllByRole("listitem")).toHaveLength(0);
  });
});
