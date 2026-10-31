// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { isValidElement, type ReactElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import EventsPage from "@/app/events/page";
import EventFeed from "@/components/EventFeed";
import { isUpcomingEvent } from "@/lib/data";
import { isRecentlyEnded } from "@/lib/recent-events";
import { sampleEvents } from "@/lib/sample-events";

// The demo feed lists events that haven't ended, then those that ended in the last 14 days (as
// upcoming=1&recent=1 does live), so the sample data is read as of a fixed day.
const NOW = new Date("2026-09-30T02:00:00.000Z");
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const upcoming = sampleEvents.filter((e) => isUpcomingEvent(e, NOW) || isRecentlyEnded(e, NOW));

/** The visible count line. The feed's polite status says the same sentence; that's what's announced. */
const countLine = (text: string | RegExp) => screen.getByText(text, { selector: "p:not([role='status'])" });

async function renderPage(searchParams: Record<string, string | string[] | undefined>) {
  const page = await EventsPage({ params: Promise.resolve({}), searchParams: Promise.resolve(searchParams) });
  render(page);
  await screen.findByText(/^Showing \d+ of \d+ events$/, { selector: "p:not([role='status'])" });
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
    expect(countLine(`Showing ${artCount} of ${upcoming.length} events`)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Filters/ })).toHaveTextContent("· 1");
  });

  it("starts on free events from ?pricing=free", async () => {
    await renderPage({ pricing: "free" });
    expect(screen.getByRole("radio", { name: "Free" })).toBeChecked();
    // The API's rule (lib/data.ts isFreeEvent): Sheltüh ticket types all free, or an external event marked free.
    const free = upcoming.filter((e) =>
      e.ticketingMode === "external"
        ? e.externalFree === true
        : e.ticketTypes.length > 0 && e.ticketTypes.every((t) => t.priceCents === 0),
    ).length;
    expect(countLine(`Showing ${free} of ${upcoming.length} events`)).toBeInTheDocument();
  });

  it("ignores unknown values and shows everything", async () => {
    await renderPage({ category: "nightlife", pricing: "cheap" });
    expect(screen.getByLabelText("Category")).toHaveValue("all");
    expect(screen.getByRole("radio", { name: "All" })).toBeChecked();
    expect(countLine(`Showing ${upcoming.length} of ${upcoming.length} events`)).toBeInTheDocument();
  });

  it("lists events that haven't ended, then those ended in the last 14 days, like the live feed's upcoming=1&recent=1", async () => {
    await renderPage({});
    const recent = sampleEvents.filter((e) => isRecentlyEnded(e, NOW));
    expect(recent.length).toBeGreaterThan(0);
    expect(upcoming.length).toBeGreaterThan(0);
    expect(countLine(`Showing ${upcoming.length} of ${upcoming.length} events`)).toBeInTheDocument();
    expect(screen.getAllByText(upcoming[0].title).length).toBeGreaterThan(0);
    // The recently ended come after every upcoming one, marked Ended, and still link to their page.
    const cards = Array.from(document.querySelectorAll("[data-event-card]"));
    const states = cards.map((card) => card.getAttribute("data-card-state") === "ended");
    expect(states.filter(Boolean)).toHaveLength(recent.length);
    expect(states.indexOf(true)).toBe(states.length - recent.length);
    for (const event of recent) {
      expect(screen.getByRole("link", { name: event.title })).toHaveAttribute("href", `/events/${event.slug}`);
    }
  });

  it("announces the result in the feed's persistent status, and the count line isn't a second live region", async () => {
    await renderPage({ category: "art" });
    const sentence = `Showing ${artCount} of ${upcoming.length} events`;
    // It's filled in the render after the results mount.
    const status = await waitFor(() => {
      const found = screen.getAllByRole("status").find((el) => el.textContent === sentence);
      expect(found).toBeDefined();
      return found;
    });
    expect(status).toHaveClass("sr-only");
    const line = countLine(sentence);
    expect(line).not.toHaveAttribute("aria-live");
    expect(line).not.toHaveAttribute("role");
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
