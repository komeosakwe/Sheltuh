// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import EventDetailsView from "@/components/EventDetailsView";
import SceneEventRow from "@/components/SceneEventRow";
import SceneMapEventCard from "@/components/map/SceneMapEventCard";
import EventCard from "@/components/ui/EventCard";
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

/** The demo's sold-out event (lib/sample-events-more.ts): every tier sold out, 24 Oct 2026. */
const soldOut = sampleEvents.find((e) => e.slug === "dead-letter-office") as SheltuhEvent;

function expectSoldOutCard() {
  // The price line says it in words (§6.5 sold-out variant), black and in the price's weight.
  const price = screen.getByText("Sold out");
  expect(price).toHaveClass("font-semibold");
  expect(screen.queryByText(/incl\. booking fee/)).toBeNull();
  // Quick buy: "Join waitlist", to the tickets section. The outline button, not orange: a
  // waitlist isn't a purchase (mobile-redesign.md §6.2.3, manager decision 22 Oct 2026).
  const join = screen.getByRole("link", { name: `Join waitlist for ${soldOut.title}` });
  expect(join).toHaveAttribute("href", `/events/${soldOut.slug}#tickets`);
  expect(join).toHaveClass("btn-outline");
  expect(join).not.toHaveClass("btn-signal");
  return join;
}

describe("sold-out cards (brand-direction-one.md §6.5)", () => {
  it.each(["grid", "rail"] as const)("EventCard %s", (variant) => {
    render(<EventCard event={soldOut} variant={variant} showSave={false} />);
    expectSoldOutCard();
    // The card link is named by the title alone; "Sold out" is the foot's text beside it.
    expect(screen.getByRole("link", { name: "Dead Letter Office" })).toBeInTheDocument();
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

  it("no badge on the media (no colour-only signal): only the art is there; the category is in the small line below", () => {
    const { container } = render(<EventCard event={soldOut} variant="grid" showSave={false} />);
    const media = container.querySelector(".rounded-card");
    expect(media?.children).toHaveLength(1);
    expect(media?.firstElementChild).toHaveAttribute("aria-hidden", "true");
    expect(container.querySelector("[data-card-secondary]")).toHaveTextContent(/^Theatre/);
  });

  it("an ended sold-out event has no Join waitlist: its price line says Ended (§6.2.3 row 1)", () => {
    vi.setSystemTime(new Date("2026-12-01T00:00:00.000Z"));
    render(<EventCard event={soldOut} variant="grid" showSave={false} />);
    expect(screen.getByText("Ended")).toBeInTheDocument();
    expect(screen.queryByText("Sold out")).toBeNull();
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
    render(<EventCard event={external} variant="grid" showSave={false} />);
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
