// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import EventDetailsView from "@/components/EventDetailsView";
import FeaturedEventCard from "@/components/home/FeaturedEventCard";
import HomeEventCard from "@/components/home/HomeEventCard";
import SceneEventRow from "@/components/SceneEventRow";
import SceneMapEventCard from "@/components/map/SceneMapEventCard";
import EventTile from "@/components/ui/EventTile";
import { sampleEvents } from "@/lib/sample-events";
import type { SheltuhEvent } from "@/lib/types";

vi.mock("next/navigation", () => ({
  usePathname: () => "/",
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("@/lib/api/going", () => ({ getGoingSummary: vi.fn(() => new Promise(() => {})) }));

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-21T00:00:00.000Z"));
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

/** The demo's sold-out event (lib/sample-events.ts): every tier sold out, 14 Nov 2026. */
const soldOut = sampleEvents.find((e) => e.slug === "off-kilter-a-new-play") as SheltuhEvent;

function expectSoldOutCard() {
  // The price line says it in words (§6.5 sold-out variant), black and in the price's weight.
  const price = screen.getByText("Sold out");
  expect(price).toHaveClass("font-semibold");
  expect(screen.queryByText(/incl\. booking fee/)).toBeNull();
  // Quick buy: "Join waitlist", still orange (owner decision 6), to the tickets section.
  const join = screen.getByRole("link", { name: `Join waitlist for ${soldOut.title}` });
  expect(join).toHaveAttribute("href", `/events/${soldOut.slug}#tickets`);
  expect(join).toHaveClass("btn-signal");
  return join;
}

describe("sold-out cards (brand-direction-one.md §6.5)", () => {
  it("EventTile", () => {
    render(<EventTile event={soldOut} showSave={false} />);
    expectSoldOutCard();
    // The card link's name carries the price line, so "Sold out" is heard with the title.
    expect(screen.getByRole("link", { name: /^Off-Kilter: A New Play .*Sold out/ })).toBeInTheDocument();
  });

  it.each(["standard", "wide", "compact"] as const)("HomeEventCard %s", (variant) => {
    render(<HomeEventCard event={soldOut} variant={variant} mode="demo" />);
    expectSoldOutCard();
  });

  it("FeaturedEventCard says Sold out on its price line", () => {
    render(<FeaturedEventCard event={soldOut} mode="demo" />);
    expect(screen.getByText("Sold out")).toBeInTheDocument();
  });

  it("the map list row and the map card", () => {
    const { unmount } = render(
      <SceneEventRow event={soldOut} selected={false} onLocate={() => {}} hasLocation detailsHref="/events/x" />,
    );
    expectSoldOutCard();
    unmount();
    render(
      <SceneMapEventCard event={soldOut} detailsHref="/events/x" onDismiss={() => {}} variant="overlay" className="relative" />,
    );
    expectSoldOutCard();
  });

  it("no badge on the media (no colour-only signal): it says nothing about selling out", () => {
    const { container } = render(<EventTile event={soldOut} showSave={false} />);
    const media = container.querySelector(".rounded-card");
    expect(media).not.toHaveTextContent(/sold out/i);
    expect(media).toHaveTextContent("Theatre");
  });

  it("an ended sold-out event has no Join waitlist", () => {
    vi.setSystemTime(new Date("2026-12-01T00:00:00.000Z"));
    render(<EventTile event={soldOut} showSave={false} />);
    expect(screen.getByText("Sold out")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /Join waitlist/ })).toBeNull();
  });

  it("an external event never reads Sold out", () => {
    const external: SheltuhEvent = {
      ...soldOut,
      ticketTypes: [],
      ticketingMode: "external",
      externalTicketUrl: "https://events.humanitix.com/x",
      externalProvider: "Humanitix",
    };
    render(<EventTile event={external} showSave={false} />);
    expect(screen.queryByText("Sold out")).toBeNull();
    expect(screen.getByText("Tickets on Humanitix")).toBeInTheDocument();
  });
});

describe("the event page's buy bar when sold out (§6.10)", () => {
  it("reads Sold out and Join waitlist, to #tickets, orange", () => {
    const { container } = render(<EventDetailsView event={soldOut} demo />);
    const bar = container.querySelector("[data-buy-bar]") as HTMLElement;
    expect(within(bar).getByText("Sold out")).toBeInTheDocument();
    const cta = within(bar).getByRole("link", { name: "Join waitlist" });
    expect(cta).toHaveAttribute("href", "#tickets");
    expect(cta).toHaveClass("btn-signal");
    // The ticket card has the (demo, disabled) waitlist.
    expect(screen.getByRole("heading", { name: "Sold out. Join the waitlist." })).toBeInTheDocument();
  });
});
