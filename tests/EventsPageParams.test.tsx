// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { isValidElement, type ReactElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import EventsPage from "@/app/events/page";
import EventFeed from "@/components/EventFeed";
import { isUpcomingEvent } from "@/lib/data";
import { sampleEvents } from "@/lib/sample-events";

// The demo feed lists only events that haven't ended (as upcoming=1 does live),
// so the sample data is read as of a fixed day.
const NOW = new Date("2026-09-30T02:00:00.000Z");
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const upcoming = sampleEvents.filter((e) => isUpcomingEvent(e, NOW));

async function renderPage(searchParams: Record<string, string | string[] | undefined>) {
  const page = await EventsPage({ params: Promise.resolve({}), searchParams: Promise.resolve(searchParams) });
  render(page);
  await screen.findByText(/^Showing \d+ of \d+ events$/);
  return page;
}

function findFeed(node: unknown): ReactElement | undefined {
  if (Array.isArray(node)) return node.map(findFeed).find(Boolean);
  if (!isValidElement(node)) return undefined;
  if (node.type === EventFeed) return node;
  return findFeed((node.props as { children?: unknown }).children);
}

const artCount = upcoming.filter((e) => e.category === "art").length;

describe("/events query params (demo)", () => {
  it("starts on the category from ?category=", async () => {
    await renderPage({ category: "art" });
    expect(screen.getByLabelText("Category")).toHaveValue("art");
    expect(screen.getByText(`Showing ${artCount} of ${upcoming.length} events`)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Filters/ })).toHaveTextContent("· 1");
  });

  it("starts on free events from ?pricing=free", async () => {
    await renderPage({ pricing: "free" });
    expect(screen.getByRole("radio", { name: "Free" })).toBeChecked();
    const free = upcoming.filter((e) => e.ticketTypes.every((t) => t.priceCents === 0)).length;
    expect(screen.getByText(`Showing ${free} of ${upcoming.length} events`)).toBeInTheDocument();
  });

  it("ignores unknown values and shows everything", async () => {
    await renderPage({ category: "nightlife", pricing: "cheap" });
    expect(screen.getByLabelText("Category")).toHaveValue("all");
    expect(screen.getByRole("radio", { name: "All" })).toBeChecked();
    expect(screen.getByText(`Showing ${upcoming.length} of ${upcoming.length} events`)).toBeInTheDocument();
  });

  it("lists only events that haven't ended, like the live feed's upcoming=1", async () => {
    await renderPage({});
    const ended = sampleEvents.filter((e) => !isUpcomingEvent(e, NOW));
    expect(ended.length).toBeGreaterThan(0);
    expect(upcoming.length).toBeGreaterThan(0);
    expect(screen.getByText(`Showing ${upcoming.length} of ${upcoming.length} events`)).toBeInTheDocument();
    for (const event of ended) expect(screen.queryByText(event.title)).not.toBeInTheDocument();
    expect(screen.getAllByText(upcoming[0].title).length).toBeGreaterThan(0);
  });

  it("plain /events is unchanged", async () => {
    await renderPage({});
    expect(screen.getByLabelText("Category")).toHaveValue("all");
    expect(screen.getByRole("button", { name: "Filters" })).not.toHaveTextContent("·");
  });

  it("keys the feed on its filters, so changing the params starts a fresh feed", async () => {
    const page = await EventsPage({
      params: Promise.resolve({}),
      searchParams: Promise.resolve({ category: ["theatre", "art"], pricing: "paid" }),
    });
    const feed = findFeed(page);
    expect(feed?.key).toBe("theatre|paid");
    expect(feed?.props).toMatchObject({ initialCategory: "theatre", initialPricing: "paid" });
  });
});
