// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import FeaturedEventCard from "@/components/home/phone/FeaturedEventCard";
import HomeEventCard from "@/components/home/phone/HomeEventCard";
import { formatDateBadge } from "@/lib/format";
import { formatFeedPrice } from "@/lib/pricing";
import { getSampleGoing } from "@/lib/sample-going";
import type { SheltuhEvent } from "@/lib/types";

const getGoingSummary = vi.fn();
vi.mock("@/lib/api/going", () => ({
  getGoingSummary: (...args: unknown[]) => getGoingSummary(...args),
}));

afterEach(cleanup);
beforeEach(() => {
  getGoingSummary.mockReset();
});

const event: SheltuhEvent = {
  id: "evt-1",
  slug: "glass-sessions",
  title: "Glasshouse Sessions",
  description: "Acoustic sets among the ferns. Bring a blanket.",
  category: "live-music",
  suburb: "Carlton",
  venueName: "The Conservatory",
  venueAddress: "1 Garden Rd",
  startsAt: "2026-10-18T08:00:00.000Z",
  endsAt: "2026-10-18T11:00:00.000Z",
  organiserName: "Org",
  poster: { pattern: "waves", background: "#000", primary: "#fff", secondary: "#f00" },
  ticketTypes: [{ id: "t", name: "GA", priceCents: 3500, feePolicy: "buyer-pays", quantityAvailable: 10 }],
};

describe("FeaturedEventCard", () => {
  it("is one link to the event with its title, date, venue and all-inclusive price", () => {
    render(<FeaturedEventCard event={event} mode="demo" />);
    const link = screen.getByRole("link");
    expect(link).toHaveAttribute("href", "/events/glass-sessions");
    expect(screen.getByRole("heading", { level: 3, name: "Glasshouse Sessions" })).toBeInTheDocument();
    expect(link).toHaveTextContent("The Conservatory · Carlton");
    expect(link).toHaveTextContent(formatFeedPrice(event));
    expect(link).toHaveTextContent("incl. booking fee");
  });

  it("demo: shows the sample going count and makes no request", () => {
    render(<FeaturedEventCard event={event} mode="demo" />);
    expect(screen.getByText(`${getSampleGoing(event.id).count} going`)).toBeInTheDocument();
    expect(getGoingSummary).not.toHaveBeenCalled();
  });

  it("live: shows a real count at or above the threshold, from one request", async () => {
    getGoingSummary.mockResolvedValue({ count: 12, closed: false, countHidden: false });
    render(<FeaturedEventCard event={event} mode="live" />);
    expect(await screen.findByText("12 going")).toBeInTheDocument();
    expect(getGoingSummary).toHaveBeenCalledTimes(1);
    expect(getGoingSummary).toHaveBeenCalledWith("evt-1");
  });

  it.each([
    // The API sends 0 in these cases; a stray number must still never show.
    ["the count is hidden", { count: 12, closed: false, countHidden: true }],
    ["the list is closed", { count: 12, closed: true, countHidden: false }],
    ["the count is below three", { count: 2, closed: false, countHidden: false }],
  ])("live: shows no going row when %s", async (_label, summary) => {
    getGoingSummary.mockResolvedValue(summary);
    render(<FeaturedEventCard event={event} mode="live" />);
    await waitFor(() => expect(getGoingSummary).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 0));
    expect(screen.queryByText(/going/)).not.toBeInTheDocument();
  });

  it("live: shows nothing while loading or when the request fails", async () => {
    let reject!: (err: Error) => void;
    getGoingSummary.mockImplementation(() => new Promise((_, r) => (reject = r)));
    render(<FeaturedEventCard event={event} mode="live" />);
    expect(getGoingSummary).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(/going/)).not.toBeInTheDocument();
    reject(new Error("down"));
    await new Promise((r) => setTimeout(r, 0));
    expect(screen.queryByText(/going/)).not.toBeInTheDocument();
    expect(screen.getByRole("link")).toHaveTextContent("Glasshouse Sessions");
  });
});

describe("HomeEventCard", () => {
  it("standard: links to the event, with category, date and time, venue and price", () => {
    render(<HomeEventCard event={event} variant="standard" mode="demo" />);
    const link = screen.getByRole("link");
    expect(link).toHaveAttribute("href", "/events/glass-sessions");
    expect(screen.getByRole("heading", { level: 3, name: "Glasshouse Sessions" })).toBeInTheDocument();
    expect(link).toHaveTextContent("Live music");
    expect(link).toHaveTextContent("Sun 18 Oct · 7:00 pm");
    expect(link).toHaveTextContent("The Conservatory");
    expect(link).toHaveTextContent(formatFeedPrice(event));
    expect(link).toHaveTextContent(`${getSampleGoing(event.id).count} going`);
  });

  it("live cards show no going count (the list API has none yet) and make no requests", () => {
    render(<HomeEventCard event={event} variant="standard" mode="live" />);
    expect(screen.queryByText(/going/)).not.toBeInTheDocument();
    expect(getGoingSummary).not.toHaveBeenCalled();
  });

  it("wide: a readable date badge and the first sentence of the description", () => {
    render(<HomeEventCard event={event} variant="wide" mode="demo" />);
    const { range, month } = formatDateBadge(event.startsAt, event.endsAt);
    const link = screen.getByRole("link");
    expect(link).toHaveTextContent(`${range} ${month}`);
    expect(link).toHaveTextContent("Acoustic sets among the ferns.");
    expect(link).not.toHaveTextContent("Bring a blanket");
  });

  it.each([
    ["free", "Free"],
    ["low-cost", "Under A$20"],
  ] as const)("compact: the %s badge, the exact price, and no going row", (badge, label) => {
    render(<HomeEventCard event={event} variant="compact" mode="demo" badge={badge} />);
    const link = screen.getByRole("link");
    expect(screen.getByText(label)).toBeInTheDocument();
    expect(link).toHaveTextContent(formatFeedPrice(event));
    expect(screen.queryByText(/going/)).not.toBeInTheDocument();
  });
});
