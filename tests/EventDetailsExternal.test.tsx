// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import EventDetailsView from "@/components/EventDetailsView";
import { sampleEvents } from "@/lib/sample-events";
import type { SheltuhEvent } from "@/lib/types";

/**
 * An external event's page (docs/architecture.md, "External ticketing"):
 * tickets are sold on another site, so the page links out with a click
 * beacon, and shows no price, booking fee, ticket selector or Who's Going.
 * Live mode is on for the file (a live event has an organiserId; a demo
 * sample event doesn't), so the Who's Going API must not be called for one.
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
const going = { getGoingSummary: vi.fn(), getMyGoingStatus: vi.fn(), listGoingAttendees: vi.fn() };
vi.mock("@/lib/api/going", () => ({
  getGoingSummary: (...a: unknown[]) => going.getGoingSummary(...a),
  getMyGoingStatus: (...a: unknown[]) => going.getMyGoingStatus(...a),
  listGoingAttendees: (...a: unknown[]) => going.listGoingAttendees(...a),
  setGoing: vi.fn(),
  unsetGoing: vi.fn(),
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

function parts(container: HTMLElement) {
  const tickets = container.querySelector<HTMLElement>("#tickets");
  const bar = container.querySelector<HTMLElement>("[data-buy-bar]");
  if (!tickets) throw new Error("#tickets not rendered");
  return { tickets, bar };
}

describe("external event: the tickets section", () => {
  it("links out in a new tab, safely, and says so in the link's name (never naming the site)", () => {
    const { container } = render(<EventDetailsView event={HUMANITIX} demo />);
    const link = within(parts(container).tickets).getByRole("link", {
      name: "Get tickets (opens in a new tab)",
    });
    expect(link).toHaveTextContent(/^Get tickets$/);
    expect(link).toHaveAttribute("href", "https://events.humanitix.com/thornbury-dub-session-demo");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
    // Checkout stays black: the section's link is solid, not orange.
    expect(link).toHaveClass("btn-solid", "btn-lg");
  });

  it("never names the ticketing site anywhere on the page, nor says who sells the tickets", () => {
    for (const event of [HUMANITIX, PRICED, OWN_SITE]) {
      const { container, unmount } = render(<EventDetailsView event={event} demo={false} />);
      const { tickets, bar } = parts(container);
      for (const region of [tickets, bar ?? tickets]) {
        expect(region).not.toHaveTextContent(/Humanitix|Eventbrite|organiser.s site|Tickets on|Sold by|tickets on /i);
      }
      for (const link of container.querySelectorAll('a[href*="humanitix"], a[href*="example.com"]')) {
        expect(link.getAttribute("aria-label")).toBe("Get tickets (opens in a new tab)");
        expect(link.textContent).toBe("Get tickets");
      }
      unmount();
    }
  });

  it("never shows 'Tickets coming soon', a price, the booking-fee rule or a ticket selector", () => {
    const { container } = render(<EventDetailsView event={HUMANITIX} demo={false} />);
    const { tickets } = parts(container);
    expect(within(tickets).queryByText("Tickets coming soon.")).toBeNull();
    expect(tickets).not.toHaveTextContent(/A\$/);
    expect(tickets).not.toHaveTextContent(/Booking fee:/);
    expect(within(tickets).queryByRole("button")).toBeNull();
    expect(within(tickets).queryByRole("group")).toBeNull();
    expect(container).not.toHaveTextContent(/incl\. booking fee/);
  });

  it("has no Sheltüh booking info (their terms apply), but still offers directions once", () => {
    const { container } = render(<EventDetailsView event={HUMANITIX} demo={false} />);
    const { tickets } = parts(container);
    expect(within(tickets).queryByRole("link", { name: "Request a refund" })).toBeNull();
    expect(within(tickets).queryByRole("link", { name: "Purchase Terms" })).toBeNull();
    expect(within(container).getAllByRole("link", { name: /^Get directions to / })).toHaveLength(1);
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
    const link = within(parts(container).tickets).getByRole("link", { name: /^Get tickets/ });
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

  it("an unknown provider reads the same ('Get tickets'), and says entry is free when listed so", () => {
    const { container } = render(<EventDetailsView event={OWN_SITE} demo />);
    const { tickets } = parts(container);
    expect(
      within(tickets).getByRole("link", { name: "Get tickets (opens in a new tab)" }),
    ).toHaveAttribute("href", "https://www.example.com/footscray-open-studios/rsvp");
    expect(within(tickets).getByText("Free entry")).toBeInTheDocument();
  });

  it.each([
    ["plain http", "http://events.humanitix.com/x"],
    ["javascript:", "javascript:alert(1)"],
    ["protocol-relative", "//events.humanitix.com/x"],
    ["missing", undefined],
  ])("renders no link (and no buy bar) for a %s ticket link", (_label, url) => {
    const { container } = render(<EventDetailsView event={{ ...HUMANITIX, externalTicketUrl: url }} demo={false} />);
    const { tickets, bar } = parts(container);
    expect(screen.queryByRole("link", { name: /^Get tickets/ })).toBeNull();
    expect(bar).toBeNull();
    expect(within(tickets).getByText("The ticket link isn’t available right now.")).toBeInTheDocument();
    expect(within(tickets).queryByText("Tickets coming soon.")).toBeNull();
  });
});

describe("external event: the phone buy bar", () => {
  it("shows no price or site name when the organiser gave none, and is the outbound link itself, with the beacon", () => {
    const { container } = render(<EventDetailsView event={HUMANITIX} demo={false} />);
    const { bar } = parts(container);
    if (!bar) throw new Error("buy bar not rendered");
    expect(bar).toHaveClass("lg:hidden");
    expect(bar).toHaveAttribute("data-surface", "ink");
    expect(bar).not.toHaveTextContent(/Humanitix|Tickets on/);
    // No price line at all: just the button. No empty paragraph either.
    expect(bar.querySelectorAll("p")).toHaveLength(0);
    // Not a jump to #tickets: the bar's button is the outbound link.
    expect(bar.querySelector('a[href="#tickets"]')).toBeNull();
    const cta = within(bar).getByRole("link", { name: "Get tickets (opens in a new tab)" });
    expect(cta).toHaveTextContent(/^Get tickets$/);
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
    expect(within(bar).getByRole("link", { name: "Get tickets (opens in a new tab)" })).toHaveAttribute(
      "href",
      OWN_SITE.externalTicketUrl,
    );
  });
});

describe("external event: the organiser's price", () => {
  it("tickets section: 'From A$35' and who set it; still no booking-fee talk", () => {
    const { container } = render(<EventDetailsView event={PRICED} demo={false} />);
    const { tickets } = parts(container);
    expect(within(tickets).getByText("From A$35")).toBeInTheDocument();
    expect(within(tickets).getByText("Price set by the organiser.")).toBeInTheDocument();
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

describe("external event: Who's Going is closed", () => {
  it("demo: no panel, no count under the title, even though the sample has names", () => {
    render(<EventDetailsView event={HUMANITIX} demo />);
    expect(screen.queryByRole("heading", { name: /who.s going/i })).toBeNull();
    expect(screen.queryByRole("link", { name: /going$/ })).toBeNull();
    expect(going.getGoingSummary).not.toHaveBeenCalled();
  });

  it("live: no panel and no request", () => {
    render(<EventDetailsView event={{ ...HUMANITIX, id: "evt-live-ext", organiserId: "org-1" }} demo={false} />);
    expect(screen.queryByRole("heading", { name: /who.s going/i })).toBeNull();
    expect(going.getGoingSummary).not.toHaveBeenCalled();
    expect(going.listGoingAttendees).not.toHaveBeenCalled();
  });

  it("a Sheltüh-ticketed demo event still shows its sample Who's Going (control)", () => {
    render(<EventDetailsView event={sample("neon-static")} demo />);
    expect(screen.getByRole("heading", { name: /who.s going/i })).toBeInTheDocument();
  });
});
