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
  recordOutboundClick.mockReset();
  for (const fn of Object.values(going)) fn.mockReset();
});
afterEach(cleanup);

function sample(slug: string): SheltuhEvent {
  const event = sampleEvents.find((e) => e.slug === slug);
  if (!event) throw new Error(`Fixture event not found: ${slug}`);
  return event;
}
const HUMANITIX = sample("thornbury-dub-session"); // paid, Humanitix
const OWN_SITE = sample("footscray-open-studios"); // free, the organiser's own site

function parts(container: HTMLElement) {
  const tickets = container.querySelector<HTMLElement>("#tickets");
  const bar = container.querySelector<HTMLElement>("[data-buy-bar]");
  if (!tickets) throw new Error("#tickets not rendered");
  return { tickets, bar };
}

describe("external event: the tickets section", () => {
  it("links out to the provider in a new tab, safely, and says so in the link's name", () => {
    const { container } = render(<EventDetailsView event={HUMANITIX} demo />);
    const link = within(parts(container).tickets).getByRole("link", {
      name: "Get tickets on Humanitix (opens in a new tab)",
    });
    expect(link).toHaveAttribute("href", "https://events.humanitix.com/thornbury-dub-session-demo");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
    // Checkout stays black: the section's link is solid, not orange.
    expect(link).toHaveClass("btn-solid", "btn-lg");
  });

  it("says the other site sells and prices the tickets, with no Sheltüh booking fee", () => {
    const { container } = render(<EventDetailsView event={HUMANITIX} demo />);
    expect(parts(container).tickets).toHaveTextContent(
      "Tickets for this event are sold and priced by Humanitix, not Sheltüh, so there’s no Sheltüh booking fee.",
    );
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
    expect(tickets).toHaveTextContent("Their terms apply.");
    expect(within(container).getAllByRole("link", { name: /^Get directions to / })).toHaveLength(1);
  });

  it("counts the click with the beacon, without stopping the link", () => {
    const { container } = render(<EventDetailsView event={HUMANITIX} demo={false} />);
    const link = within(parts(container).tickets).getByRole("link", { name: /^Get tickets on Humanitix/ });
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

  it("names 'the organiser's site' for an unknown provider, and says entry is free when listed so", () => {
    const { container } = render(<EventDetailsView event={OWN_SITE} demo />);
    const { tickets } = parts(container);
    expect(
      within(tickets).getByRole("link", { name: "Get tickets on the organiser's site (opens in a new tab)" }),
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
  it("shows where tickets are sold (no empty note line) and is the outbound link itself, with the beacon", () => {
    const { container } = render(<EventDetailsView event={HUMANITIX} demo={false} />);
    const { bar } = parts(container);
    if (!bar) throw new Error("buy bar not rendered");
    expect(bar).toHaveClass("lg:hidden");
    expect(bar).toHaveAttribute("data-surface", "ink");
    expect(within(bar).getByText("Tickets on Humanitix")).toBeInTheDocument();
    // Only the provider line: no empty note paragraph under it.
    for (const p of bar.querySelectorAll("p")) expect(p.textContent?.trim()).not.toBe("");
    // Not a jump to #tickets: the bar's button is the outbound link.
    expect(bar.querySelector('a[href="#tickets"]')).toBeNull();
    const cta = within(bar).getByRole("link", { name: "Get tickets on Humanitix (opens in a new tab)" });
    expect(cta).toHaveTextContent(/^Get tickets/);
    expect(cta).toHaveAttribute("href", HUMANITIX.externalTicketUrl);
    expect(cta).toHaveAttribute("target", "_blank");
    expect(cta).toHaveAttribute("rel", "noopener noreferrer");
    expect(cta).toHaveClass("btn-signal");
    fireEvent.click(cta);
    expect(recordOutboundClick).toHaveBeenCalledWith(HUMANITIX.id);
  });

  it("free external event: 'Free' over where tickets are", () => {
    const { container } = render(<EventDetailsView event={OWN_SITE} demo />);
    const { bar } = parts(container);
    if (!bar) throw new Error("buy bar not rendered");
    expect(within(bar).getByText("Free")).toBeInTheDocument();
    expect(within(bar).getByText("Tickets on the organiser's site")).toBeInTheDocument();
    expect(within(bar).getByRole("link", { name: /^Get tickets on the organiser's site/ })).toHaveAttribute(
      "href",
      OWN_SITE.externalTicketUrl,
    );
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
