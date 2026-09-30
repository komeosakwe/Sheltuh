// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { isValidElement, type ReactElement } from "react";
import { afterEach, describe, expect, it } from "vitest";
import EventsPage from "@/app/events/page";
import EventFeed from "@/components/EventFeed";
import { sampleEvents } from "@/lib/sample-events";

afterEach(cleanup);

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

const artCount = sampleEvents.filter((e) => e.category === "art").length;

describe("/events query params (demo)", () => {
  it("starts on the category from ?category=", async () => {
    await renderPage({ category: "art" });
    expect(screen.getByLabelText("Category")).toHaveValue("art");
    expect(screen.getByText(`Showing ${artCount} of ${sampleEvents.length} events`)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Filters/ })).toHaveTextContent("· 1");
  });

  it("starts on free events from ?pricing=free", async () => {
    await renderPage({ pricing: "free" });
    expect(screen.getByRole("radio", { name: "Free" })).toBeChecked();
    const free = sampleEvents.filter((e) => e.ticketTypes.every((t) => t.priceCents === 0)).length;
    expect(screen.getByText(`Showing ${free} of ${sampleEvents.length} events`)).toBeInTheDocument();
  });

  it("ignores unknown values and shows everything", async () => {
    await renderPage({ category: "nightlife", pricing: "cheap" });
    expect(screen.getByLabelText("Category")).toHaveValue("all");
    expect(screen.getByRole("radio", { name: "All" })).toBeChecked();
    expect(screen.getByText(`Showing ${sampleEvents.length} of ${sampleEvents.length} events`)).toBeInTheDocument();
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
