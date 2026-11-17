// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import EventDetailsView from "@/components/EventDetailsView";
import { releasesHint } from "@/components/checkout/BuyBar";
import { ORGANISER_PROFILE_EVENT_LIMIT, upcomingLabel } from "@/lib/similar-events";
import { PROFILE_EVENT_LIMIT } from "@/lib/server/handlers/public-organisers";
import { sampleEvents } from "@/lib/sample-events";
import type { SheltuhEvent } from "@/lib/types";
import { typeName } from "./test-utils/buyerName";

/**
 * The desktop ticket panel (redesign PR 4 review): it never checks out. Before anything is chosen, its orange
 * "Buy tickets →" moves focus to the tickets heading and says how many releases there are; once tickets are
 * chosen it shows "Total A$X · N tickets" and an outline Review order, to the first field still to fill in, or
 * to Checkout, the one orange checkout.
 */
vi.mock("@/lib/api/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api/client")>()),
  isApiConfigured: true,
}));
vi.mock("@/lib/api/orders", () => ({ createCheckoutSession: vi.fn() }));
vi.mock("@/lib/api/going", () => ({
  getGoingSummary: vi.fn().mockResolvedValue({ count: 0, closed: true, countHidden: false }),
  getMyGoingStatus: vi.fn(),
  listGoingAttendees: vi.fn(),
  setGoing: vi.fn(),
  unsetGoing: vi.fn(),
}));
vi.mock("@/lib/api/organisers", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api/organisers")>()),
  getOrganiserProfile: vi.fn().mockRejectedValue(Object.assign(new Error("no"), { status: 404 })),
}));
vi.mock("@/lib/api/public-events", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api/public-events")>()),
  listPublicEvents: vi.fn().mockResolvedValue({ items: [] }),
}));

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-09-01T00:00:00.000Z"));
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function live(slug: string): SheltuhEvent {
  const event = sampleEvents.find((e) => e.slug === slug);
  if (!event) throw new Error(`no sample ${slug}`);
  return { ...event, organiserId: "org-1" };
}

function panel(): HTMLElement {
  const element = document.querySelector<HTMLElement>("[data-buy-panel]");
  if (!element) throw new Error("no panel");
  return element;
}

describe("the desktop ticket panel", () => {
  it("before a choice: Buy tickets → takes focus to the tickets heading, with a ring, and says how many releases", () => {
    const event = live("neon-static");
    render(<EventDetailsView event={event} demo={false} />);
    const heading = screen.getByRole("heading", { level: 2, name: "Choose your tickets" });
    expect(heading).toHaveAttribute("tabindex", "-1");
    expect(heading).toHaveClass("focus:outline-2");
    const buy = within(panel()).getByRole("link", { name: "Buy tickets" });
    expect(buy).toHaveClass("btn-signal");
    expect(buy.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
    fireEvent.click(buy);
    expect(heading).toHaveFocus();
    const releases = event.ticketTypes.filter((t) => !t.seated).length;
    expect(releases).toBeGreaterThan(1);
    expect(within(panel()).getByRole("status")).toHaveTextContent(releasesHint(releases));
    // Pressed again: the same words are said again (the region's text changes).
    const before = within(panel()).getByRole("status").textContent;
    fireEvent.click(buy);
    expect(within(panel()).getByRole("status").textContent).not.toBe(before);
  });

  it("with one release it moves focus but says nothing extra", () => {
    const event = live("fitzroy-poetry-and-noise");
    expect(event.ticketTypes).toHaveLength(1);
    render(<EventDetailsView event={event} demo={false} />);
    fireEvent.click(within(panel()).getByRole("link", { name: "Buy tickets" }));
    expect(screen.getByRole("heading", { level: 2, name: "Choose your tickets" })).toHaveFocus();
    expect(within(panel()).getByRole("status")).toBeEmptyDOMElement();
  });

  it("counts only the ticket types that can be chosen now: not sold out, not waiting for the one above", () => {
    const event = live("cinder-warehouse-sessions");
    const [first, second, third] = event.ticketTypes;
    // Three tiers: the first sold out, the second on sale, the third on sale too.
    render(
      <EventDetailsView
        event={{
          ...event,
          ticketTypes: [
            { ...first, soldOut: true, remaining: 0 },
            { ...second, opensAfter: undefined, opensAfterPrevious: undefined },
            { ...third, opensAfter: undefined, opensAfterPrevious: undefined },
          ],
        }}
        demo={false}
      />,
    );
    fireEvent.click(within(panel()).getByRole("link", { name: "Buy tickets" }));
    expect(within(panel()).getByRole("status")).toHaveTextContent(releasesHint(2));
    cleanup();
    // As released: only the first is on sale (the others wait for it), so there's no choice to explain.
    render(<EventDetailsView event={event} demo={false} />);
    fireEvent.click(within(panel()).getByRole("link", { name: "Buy tickets" }));
    expect(within(panel()).getByRole("status")).toBeEmptyDOMElement();
  });

  it("after a choice: the total and the ticket count, and Review order (outline) to the name, then to Checkout", () => {
    render(<EventDetailsView event={live("neon-static")} demo={false} />);
    fireEvent.click(screen.getByRole("button", { name: "Increase quantity for General admission" }));
    fireEvent.click(screen.getByRole("button", { name: "Increase quantity for General admission" }));
    expect(panel()).toHaveTextContent("Total A$64.60 · 2 tickets");
    // The panel never checks out: no orange button, and no Buy tickets link now.
    expect(panel().querySelector(".btn-signal")).toBeNull();
    const review = within(panel()).getByRole("button", { name: "Review order" });
    expect(review).toHaveClass("btn-outline");
    fireEvent.click(review);
    expect(screen.getByLabelText("Your name")).toHaveFocus();
    typeName("Mia Tran");
    fireEvent.click(review);
    const checkout = screen.getByRole("button", { name: "Checkout" });
    expect(checkout).toHaveFocus();
    // Checkout is the one orange checkout.
    expect(checkout).toHaveClass("btn-signal");
  });

  it("says one ticket in the singular", () => {
    render(<EventDetailsView event={live("neon-static")} demo={false} />);
    fireEvent.click(screen.getByRole("button", { name: "Increase quantity for General admission" }));
    expect(panel()).toHaveTextContent("Total A$32.30 · 1 ticket");
    expect(panel()).not.toHaveTextContent("1 tickets");
  });

  it("has a hidden Price and tickets heading, inside the part hidden below lg", async () => {
    render(<EventDetailsView event={live("neon-static")} demo={false} />);
    await act(async () => {});
    const heading = screen.getByRole("heading", { name: "Price and tickets" });
    expect(heading).toHaveClass("sr-only");
    expect(heading.parentElement).toHaveClass("max-lg:hidden");
  });
});

describe("the organiser's upcoming count", () => {
  it("is capped where the profile's list is (the API's own limit)", () => {
    expect(ORGANISER_PROFILE_EVENT_LIMIT).toBe(PROFILE_EVENT_LIMIT);
    expect(upcomingLabel(4)).toBe("4 upcoming");
    expect(upcomingLabel(23)).toBe("23 upcoming");
    expect(upcomingLabel(PROFILE_EVENT_LIMIT)).toBe("24+ upcoming");
  });
});
