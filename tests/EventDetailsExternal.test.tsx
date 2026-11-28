// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import EventDetailsView from "@/components/EventDetailsView";
import { sampleEvents } from "@/lib/sample-events";
import type { SheltuhEvent } from "@/lib/types";

/**
 * An external event's page (docs/architecture.md, "External ticketing"):
 * tickets are sold on another site, so the page links out with a click
 * beacon, and shows no price, booking fee, ticket selector or Who's Going
 * (its count-only "Who's going" is tests/ExternalGoing.test.tsx). Live mode is
 * on for the file (a live event has an organiserId; a demo sample event
 * doesn't), so the Who's Going API must not be called for one.
 */
vi.mock("@/lib/api/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api/client")>()),
  isApiConfigured: true,
}));
const recordOutboundClick = vi.fn();
const recordEventView = vi.fn();
vi.mock("@/lib/api/analytics", () => ({
  recordOutboundClick: (...a: unknown[]) => recordOutboundClick(...a),
  recordEventView: (...a: unknown[]) => recordEventView(...a),
}));
const going = { getGoingSummary: vi.fn(), getMyGoingStatus: vi.fn(), listGoingAttendees: vi.fn(), getExternalGoingSummary: vi.fn() };
vi.mock("@/lib/api/going", () => ({
  getGoingSummary: (...a: unknown[]) => going.getGoingSummary(...a),
  getMyGoingStatus: (...a: unknown[]) => going.getMyGoingStatus(...a),
  listGoingAttendees: (...a: unknown[]) => going.listGoingAttendees(...a),
  getExternalGoingSummary: (...a: unknown[]) => going.getExternalGoingSummary(...a),
  getMyExternalGoing: vi.fn(),
  setGoing: vi.fn(),
  unsetGoing: vi.fn(),
  setExternalGoing: vi.fn(),
  unsetExternalGoing: vi.fn(),
}));

beforeEach(() => {
  // The sample events are dated Sept–Nov 2026, and an ended demo event's Who's Going is closed (V4) and
  // has no buy bar (A7): read them before they end, whatever the real clock says. Only Date is faked.
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-09-01T00:00:00.000Z"));
  recordOutboundClick.mockReset();
  for (const fn of Object.values(going)) fn.mockReset();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function sample(slug: string): SheltuhEvent {
  const event = sampleEvents.find((e) => e.slug === slug);
  if (!event) throw new Error(`Fixture event not found: ${slug}`);
  return event;
}
const PRICED = sample("thornbury-dub-session"); // paid, Humanitix, the organiser gave a price
const HUMANITIX: SheltuhEvent = { ...PRICED, externalPriceFromCents: undefined }; // the same, no price given
const OWN_SITE = sample("footscray-open-studios"); // free, the organiser's own site

/**
 * The page's parts: the tickets section (none while an external event is on sale), the desktop panel (only with a
 * price or an action in it: owner, 27 Nov 2026, Option A) and the phone bar.
 */
function parts(container: HTMLElement) {
  const tickets = container.querySelector<HTMLElement>("#tickets");
  const panel = container.querySelector<HTMLElement>("[data-ticket-panel]");
  const bar = container.querySelector<HTMLElement>("[data-buy-bar]");
  return { tickets, panel, bar };
}

/** The desktop panel, which these cases expect (an external event on sale). */
function panelOf(container: HTMLElement) {
  const { panel } = parts(container);
  if (!panel) throw new Error("ticket panel not rendered");
  return panel;
}

function ticketsSection(container: HTMLElement) {
  const { tickets } = parts(container);
  if (!tickets) throw new Error("#tickets not rendered");
  return tickets;
}

describe("external event: the ticket link", () => {
  it("has no tickets section while on sale: the panel and the phone bar already have the price and the link (owner, 15 Nov 2026)", () => {
    for (const event of [HUMANITIX, PRICED, OWN_SITE]) {
      const { container, unmount } = render(<EventDetailsView event={event} demo={false} />);
      expect(container.querySelector("#tickets")).toBeNull();
      expect(screen.queryByRole("heading", { name: "Tickets" })).toBeNull();
      // The price and the link once in the panel and once in the phone bar, never a third time.
      expect(screen.getAllByRole("link", { name: "Buy tickets (opens in a new tab)" })).toHaveLength(2);
      unmount();
    }
  });

  it("links out in a new tab, safely, and says so in the link's name (never naming the site)", () => {
    const { container } = render(<EventDetailsView event={HUMANITIX} demo />);
    const link = within(panelOf(container)).getByRole("link", {
      name: "Buy tickets (opens in a new tab)",
    });
    expect(link).toHaveTextContent(/^Buy tickets$/);
    expect(link).toHaveAttribute("href", "https://events.humanitix.com/thornbury-dub-session-demo");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
    // The panel's one orange action.
    expect(link).toHaveClass("btn-signal", "btn-lg");
  });

  it("never names the ticketing site anywhere on the page, nor says who sells the tickets", () => {
    for (const event of [HUMANITIX, PRICED, OWN_SITE]) {
      const { container, unmount } = render(<EventDetailsView event={event} demo={false} />);
      const { bar } = parts(container);
      const panel = panelOf(container);
      for (const region of [panel, bar ?? panel]) {
        expect(region).not.toHaveTextContent(/Humanitix|Eventbrite|organiser.s site|Tickets on|Sold by|tickets on /i);
      }
      for (const link of container.querySelectorAll('a[href*="humanitix"], a[href*="example.com"]')) {
        expect(link.getAttribute("aria-label")).toBe("Buy tickets (opens in a new tab)");
        expect(link.textContent).toBe("Buy tickets");
      }
      unmount();
    }
  });

  it("never shows 'Tickets coming soon', a price, the booking-fee rule or a ticket selector", () => {
    const { container } = render(<EventDetailsView event={HUMANITIX} demo={false} />);
    const panel = panelOf(container);
    expect(screen.queryByText("Tickets coming soon.")).toBeNull();
    expect(panel).not.toHaveTextContent(/A\$/);
    expect(container).not.toHaveTextContent(/Booking fee:/);
    expect(screen.queryByRole("button", { name: /Increase quantity/ })).toBeNull();
    expect(container).not.toHaveTextContent(/incl\. booking fee/);
  });

  it("has no Sheltüh booking info (their terms apply), but still offers directions once", () => {
    const { container } = render(<EventDetailsView event={HUMANITIX} demo={false} />);
    expect(screen.queryByRole("link", { name: "Request a refund" })).toBeNull();
    expect(screen.queryByRole("link", { name: "Purchase Terms" })).toBeNull();
    expect(within(container).getAllByRole("link", { name: /: get directions \(opens Google Maps in a new tab\)$/ })).toHaveLength(1);
  });

  it("never shows a Sheltüh refund policy, even if one came with the event", () => {
    const { container } = render(
      <EventDetailsView event={{ ...HUMANITIX, refundPolicy: "days_before", refundDays: 7 }} demo={false} />,
    );
    expect(container.querySelector("[data-refund-policy]")).toBeNull();
    expect(container).not.toHaveTextContent(/Refunds available|change of mind|Australian Consumer Law/);
  });

  it("counts the click with the beacon, without stopping the link", () => {
    const { container } = render(<EventDetailsView event={HUMANITIX} demo={false} />);
    const link = within(panelOf(container)).getByRole("link", { name: /^Buy tickets/ });
    const click = new MouseEvent("click", { bubbles: true, cancelable: true });
    link.dispatchEvent(click);
    expect(recordOutboundClick).toHaveBeenCalledTimes(1);
    expect(recordOutboundClick).toHaveBeenCalledWith(HUMANITIX.id);
    expect(click.defaultPrevented).toBe(false);
    // A middle-click (open in a new tab) counts too; a right-click doesn't.
    fireEvent(link, new MouseEvent("auxclick", { bubbles: true, button: 1 }));
    fireEvent(link, new MouseEvent("auxclick", { bubbles: true, button: 2 }));
    expect(recordOutboundClick).toHaveBeenCalledTimes(2);
  });

  it("an unknown provider reads the same ('Buy tickets'), and says it's free when listed so", () => {
    const { container } = render(<EventDetailsView event={OWN_SITE} demo />);
    const panel = panelOf(container);
    expect(
      within(panel).getByRole("link", { name: "Buy tickets (opens in a new tab)" }),
    ).toHaveAttribute("href", "https://www.example.com/footscray-open-studios/rsvp");
    expect(within(panel).getByText("Free")).toBeInTheDocument();
  });

  it.each([
    ["plain http", "http://events.humanitix.com/x"],
    ["javascript:", "javascript:alert(1)"],
    ["protocol-relative", "//events.humanitix.com/x"],
    ["missing", undefined],
  ])("renders no link (and no buy bar) for a %s ticket link", (_label, url) => {
    const { container } = render(<EventDetailsView event={{ ...HUMANITIX, externalTicketUrl: url }} demo={false} />);
    const tickets = ticketsSection(container);
    const { bar, panel } = parts(container);
    expect(screen.queryByRole("link", { name: /^Buy tickets/ })).toBeNull();
    expect(bar).toBeNull();
    // Nothing to put in the desktop panel either, so there's none.
    expect(panel).toBeNull();
    expect(within(tickets).getByText("The ticket link isn’t available right now.")).toBeInTheDocument();
    expect(within(tickets).queryByText("Tickets coming soon.")).toBeNull();
  });
});

describe("external event: once it has ended", () => {
  it("says so, with no price, no link to the other site and no buy bar", () => {
    vi.setSystemTime(new Date("2027-01-01T00:00:00.000Z"));
    for (const event of [PRICED, OWN_SITE]) {
      const { container, unmount } = render(<EventDetailsView event={event} demo={false} />);
      const tickets = ticketsSection(container);
      expect(tickets).toHaveTextContent("This event has ended.");
      expect(tickets).not.toHaveTextContent(/From A\$|Price set by the organiser|Free entry/);
      expect(container).not.toHaveTextContent(/From A\$|Price set by the organiser/);
      expect(screen.queryByRole("link", { name: /^Buy tickets/ })).toBeNull();
      expect(parts(container).bar).toBeNull();
      expect(parts(container).panel).toBeNull();
      unmount();
    }
  });
});

describe("external event: the phone buy bar", () => {
  it("shows no price or site name when the organiser gave none, and is the outbound link itself, with the beacon", () => {
    const { container } = render(<EventDetailsView event={HUMANITIX} demo={false} />);
    const { bar } = parts(container);
    if (!bar) throw new Error("buy bar not rendered");
    expect(bar).toHaveClass("lg:hidden");
    // The page's own surface (the owner's 390 mock), not ink.
    expect(bar).not.toHaveAttribute("data-surface");
    expect(bar).toHaveClass("bg-background", "border-t");
    expect(bar).not.toHaveTextContent(/Humanitix|Tickets on/);
    // No price line at all: just the date line and the button. No empty amount either.
    expect(bar.querySelector("[data-bar-amount]")).toBeNull();
    expect(bar.querySelectorAll("p")).toHaveLength(1);
    expect(bar.querySelector("p")).toHaveClass("mono-s");
    expect(bar.querySelector("p")).not.toHaveClass("uppercase");
    // Not a jump to #tickets: the bar's button is the outbound link.
    expect(bar.querySelector('a[href="#tickets"]')).toBeNull();
    const cta = within(bar).getByRole("link", { name: "Buy tickets (opens in a new tab)" });
    expect(cta).toHaveTextContent(/^Buy tickets$/);
    expect(cta).toHaveAttribute("href", HUMANITIX.externalTicketUrl);
    expect(cta).toHaveAttribute("target", "_blank");
    expect(cta).toHaveAttribute("rel", "noopener noreferrer");
    expect(cta).toHaveClass("btn-signal");
    fireEvent.click(cta);
    expect(recordOutboundClick).toHaveBeenCalledWith(HUMANITIX.id);
  });

  it("free external event: just 'Free' beside the button, no site name", () => {
    const { container } = render(<EventDetailsView event={OWN_SITE} demo />);
    const { bar } = parts(container);
    if (!bar) throw new Error("buy bar not rendered");
    expect(within(bar).getByText("Free")).toBeInTheDocument();
    expect(bar).not.toHaveTextContent(/organiser.s site|Tickets on/);
    for (const p of bar.querySelectorAll("p")) expect(p.textContent?.trim()).not.toBe("");
    expect(within(bar).getByRole("link", { name: "Buy tickets (opens in a new tab)" })).toHaveAttribute(
      "href",
      OWN_SITE.externalTicketUrl,
    );
  });
});

describe("external event: the organiser's price", () => {
  it("panel: 'From A$35' and who set it; still no booking-fee talk", () => {
    const { container } = render(<EventDetailsView event={PRICED} demo={false} />);
    const panel = panelOf(container);
    expect(within(panel).getByText("From A$35")).toBeInTheDocument();
    expect(within(panel).getByText("Price set by the organiser.")).toBeInTheDocument();
    expect(container).not.toHaveTextContent(/incl\. booking fee/);
  });

  it("buy bar: just 'From A$35' beside the button, with no site name and no empty line", () => {
    const { container } = render(<EventDetailsView event={PRICED} demo={false} />);
    const { bar } = parts(container);
    if (!bar) throw new Error("buy bar not rendered");
    expect(within(bar).getByText("From A$35")).toBeInTheDocument();
    expect(bar).not.toHaveTextContent(/Humanitix|Tickets on/);
    expect(bar).not.toHaveTextContent("Price set by the organiser.");
    for (const p of bar.querySelectorAll("p")) expect(p.textContent?.trim()).not.toBe("");
  });

  it("without a price, or when free, nothing about a price shows", () => {
    for (const event of [HUMANITIX, { ...PRICED, externalFree: true }]) {
      const { container, unmount } = render(<EventDetailsView event={event} demo={false} />);
      expect(container).not.toHaveTextContent(/From A\$|Price set by the organiser/);
      unmount();
    }
  });
});

describe("external event: Who's Going is closed (only the count-only signal remains)", () => {
  it("demo: no names panel, no count under the title; the count-only section is disabled", () => {
    render(<EventDetailsView event={HUMANITIX} demo />);
    expect(screen.queryByRole("link", { name: /going$/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /see who.s going/i })).toBeNull();
    expect(screen.queryByText("Sample names.")).toBeNull();
    expect(screen.getByRole("button", { name: "I’m going" })).toBeDisabled();
    expect(going.getGoingSummary).not.toHaveBeenCalled();
    expect(going.getExternalGoingSummary).not.toHaveBeenCalled();
  });

  it("live: no Who's Going requests; only the count-only summary is asked for", () => {
    going.getExternalGoingSummary.mockReturnValue(new Promise(() => {}));
    render(<EventDetailsView event={{ ...HUMANITIX, id: "evt-live-ext", organiserId: "org-1" }} demo={false} />);
    expect(screen.queryByRole("heading", { name: /who.s going/i })).toBeNull();
    expect(going.getGoingSummary).not.toHaveBeenCalled();
    expect(going.listGoingAttendees).not.toHaveBeenCalled();
    expect(going.getExternalGoingSummary).toHaveBeenCalledWith("evt-live-ext");
  });

  it("a Sheltüh-ticketed demo event still shows its sample Who's Going (control)", () => {
    render(<EventDetailsView event={sample("neon-static")} demo />);
    // The panel, and the Who's going row beside the title (the owner's event mock).
    expect(screen.getByRole("heading", { name: /^who.s going$/i })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Who’s going?" })).toBeInTheDocument();
  });
});
