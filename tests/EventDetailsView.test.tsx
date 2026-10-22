// @vitest-environment jsdom
import { act, cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import EventDetailsView from "@/components/EventDetailsView";
import { FavouritesProvider } from "@/components/favourites/FavouritesProvider";
import { describeBookingFee } from "@/lib/fees";
import { sampleEvents } from "@/lib/sample-events";
import type { SheltuhEvent } from "@/lib/types";
import { FakeAuthProvider, fakeAuthValue } from "./test-utils/fakeAuth";

// The sample events are dated Sept–Nov 2026, and an ended event has nothing to buy: read them before then.
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-09-01T00:00:00.000Z"));
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function findEvent(slug: string): SheltuhEvent {
  const event = sampleEvents.find((e) => e.slug === slug);
  if (!event) throw new Error(`Fixture event not found: ${slug}`);
  return event;
}

function buyBar(container: HTMLElement): HTMLElement | null {
  return container.querySelector<HTMLElement>("[data-buy-bar]");
}

describe("EventDetailsView buy bar (phones and tablets)", () => {
  it("shows the all-inclusive 'From' price and jumps to the tickets", () => {
    const { container } = render(<EventDetailsView event={findEvent("neon-static")} demo />);
    const bar = buyBar(container);
    if (!bar) throw new Error("buy bar not rendered");
    expect(bar).toHaveClass("lg:hidden"); // never on desktop
    expect(within(bar).getByText("From A$31.70")).toBeInTheDocument();
    expect(within(bar).getByText("incl. booking fee")).toBeInTheDocument();
    // "Buy tickets" in the demo too (owner, 21 Oct 2026); the tickets section says nothing's bookable.
    expect(within(bar).getByRole("link", { name: "Buy tickets" })).toHaveAttribute("href", "#tickets");
    expect(within(bar).queryByRole("link", { name: /See tickets|Get tickets/ })).toBeNull();
  });

  it("says 'Buy tickets' for a live paid event", () => {
    const { container } = render(<EventDetailsView event={findEvent("fitzroy-poetry-and-noise")} demo={false} />);
    const bar = buyBar(container);
    if (!bar) throw new Error("buy bar not rendered");
    expect(within(bar).getByText("A$21.30")).toBeInTheDocument();
    expect(within(bar).getByRole("link", { name: "Buy tickets" })).toHaveAttribute("href", "#tickets");
  });

  it("says 'Get free tickets' when every ticket is free, live or demo", () => {
    for (const demo of [true, false]) {
      const { container, unmount } = render(<EventDetailsView event={findEvent("brunswick-zine-fair")} demo={demo} />);
      const bar = buyBar(container);
      if (!bar) throw new Error("buy bar not rendered");
      expect(within(bar).getByRole("link", { name: "Get free tickets" })).toHaveAttribute("href", "#tickets");
      unmount();
    }
  });

  it("shows 'Free' with no booking fee for a free event", () => {
    const { container } = render(<EventDetailsView event={findEvent("brunswick-zine-fair")} demo />);
    const bar = buyBar(container);
    if (!bar) throw new Error("buy bar not rendered");
    expect(within(bar).getByText("Free")).toBeInTheDocument();
    expect(within(bar).getByText("No booking fee")).toBeInTheDocument();
  });

  it("isn't rendered when the event has no ticket types", () => {
    const { container } = render(
      <EventDetailsView event={{ ...findEvent("neon-static"), ticketTypes: [] }} demo />,
    );
    expect(buyBar(container)).toBeNull();
  });

  it("targets a focusable tickets section, so the jump moves focus there too", () => {
    const { container } = render(<EventDetailsView event={findEvent("neon-static")} demo />);
    const tickets = container.querySelector<HTMLElement>("#tickets");
    if (!tickets) throw new Error("#tickets not rendered");
    expect(tickets).toHaveAttribute("tabindex", "-1");
    expect(within(tickets).getByRole("heading", { name: "Tickets" })).toBeInTheDocument();
    // Arriving there shows the (global) focus-visible ring: nothing removes it.
    expect(tickets.className).not.toMatch(/outline-none/);
  });
});

describe("EventDetailsView once the event has ended (mobile-redesign.md §6.5, §10.3 #2)", () => {
  it("the buy bar says the event has ended, with its date and no price or action; the tickets section says so too", () => {
    vi.setSystemTime(new Date("2026-12-01T00:00:00.000Z"));
    // Demo favourites (accounts not configured), so the bar's Save heart renders.
    const { container } = render(
      <FakeAuthProvider value={fakeAuthValue({ configured: false, status: "signed-out" })}>
        <FavouritesProvider>
          <EventDetailsView event={findEvent("neon-static")} demo={false} />
        </FavouritesProvider>
      </FakeAuthProvider>,
    );
    const bar = buyBar(container);
    if (!bar) throw new Error("buy bar not rendered");
    expect(within(bar).getByText("This event has ended.")).toBeInTheDocument();
    // When it was, never what it cost: nothing's for sale (coordinator, 22 Oct 2026).
    expect(within(bar).getByText(/^Fri 25 Sept?$/)).toBeInTheDocument();
    expect(bar).not.toHaveTextContent("A$");
    expect(bar).not.toHaveTextContent("booking fee");
    expect(within(bar).queryByRole("link")).toBeNull();
    // Save stays.
    expect(within(bar).getByRole("button", { name: "Save Neon Static" })).toBeInTheDocument();
    const tickets = container.querySelector<HTMLElement>("#tickets");
    if (!tickets) throw new Error("#tickets not rendered");
    expect(within(tickets).getByText("This event has ended.")).toBeInTheDocument();
    expect(within(tickets).queryByRole("button", { name: /Increase quantity|Checkout/ })).toBeNull();
  });

  it("a free event too: no Get free tickets once it's over", () => {
    vi.setSystemTime(new Date("2026-12-01T00:00:00.000Z"));
    const { container } = render(<EventDetailsView event={findEvent("brunswick-zine-fair")} demo />);
    const bar = buyBar(container);
    if (!bar) throw new Error("buy bar not rendered");
    expect(within(bar).queryByRole("link", { name: /tickets/i })).toBeNull();
    expect(within(bar).getByText("This event has ended.")).toBeInTheDocument();
    expect(bar).not.toHaveTextContent("Free");
  });

  it("sold out and ended: See tickets, to the closed waitlist", () => {
    vi.setSystemTime(new Date("2026-12-01T00:00:00.000Z"));
    const soldOut = findEvent("dead-letter-office");
    const { container } = render(<EventDetailsView event={soldOut} demo />);
    const bar = buyBar(container);
    if (!bar) throw new Error("buy bar not rendered");
    expect(within(bar).getByRole("link", { name: "See tickets" })).toHaveAttribute("href", "#tickets");
    expect(within(bar).queryByRole("link", { name: "Join waitlist" })).toBeNull();
    expect(bar).not.toHaveTextContent("A$");
    // The tickets panel says it has ended too, above the sold-out tiers and the closed waitlist.
    const tickets = container.querySelector<HTMLElement>("#tickets");
    if (!tickets) throw new Error("#tickets not rendered");
    expect(within(tickets).getByText("This event has ended.")).toBeInTheDocument();
  });

  it("a seated event that's ended (not sold out): the same words in the panel, no seat picking", () => {
    vi.setSystemTime(new Date("2026-12-01T00:00:00.000Z"));
    const seated = sampleEvents.find((e) => e.seating && !e.soldOut);
    if (!seated) throw new Error("no seated sample");
    const { container } = render(<EventDetailsView event={seated} demo />);
    const tickets = container.querySelector<HTMLElement>("#tickets");
    if (!tickets) throw new Error("#tickets not rendered");
    expect(within(tickets).getByText("This event has ended.")).toBeInTheDocument();
    expect(within(tickets).queryByRole("link", { name: /Choose seats/ })).toBeNull();
  });
});

describe("EventDetailsView photo", () => {
  it("keeps an organiser's portrait poster whole on the event page (fit auto), never cropped to a strip", () => {
    const { container } = render(<EventDetailsView event={{ ...findEvent("neon-static"), imageUrl: "/poster.jpg" }} demo />);
    const img = container.querySelector("img");
    if (!img) throw new Error("no photo");
    expect(img).toHaveClass("object-cover");
    Object.defineProperty(img, "naturalWidth", { value: 800 });
    Object.defineProperty(img, "naturalHeight", { value: 1131 });
    act(() => {
      img.dispatchEvent(new Event("load"));
    });
    expect(img).toHaveClass("object-contain");
    expect(img.parentElement).toHaveStyle({ backgroundColor: "var(--ink)" });
  });
});

describe("EventDetailsView key facts under the title", () => {
  it("shows the date range and venue · suburb (hidden from lg, where the aside has them)", () => {
    const event = findEvent("neon-static");
    render(<EventDetailsView event={event} demo />);
    const venue = screen.getByText(`${event.venueName} · ${event.suburb}`);
    expect(venue.closest("p")).toHaveClass("lg:hidden");
  });
});

describe("EventDetailsView organiser", () => {
  it("links 'Organised by' to the organiser's profile for a live event", () => {
    const event = { ...findEvent("neon-static"), organiserId: "org 1", organiserName: "Northside Noise" };
    render(<EventDetailsView event={event} demo={false} />);
    const link = screen.getByRole("link", { name: "Northside Noise" });
    expect(link).toHaveAttribute("href", "/organisers/org%201");
    expect(link.closest("dd")).toHaveTextContent("Organised by Northside Noise");
  });

  it("in the demo, links a sample event's organiser to the sample organiser's profile", () => {
    const event = findEvent("dead-letter-office");
    expect(event.organiserId).toBeUndefined();
    render(<EventDetailsView event={event} demo />);
    const link = screen.getByRole("link", { name: "Small Hours Theatre" });
    expect(link).toHaveAttribute("href", "/organisers/small-hours-theatre");
    expect(link.closest("dd")).toHaveTextContent("Organised by Small Hours Theatre");
  });

  it("keeps the organiser as plain text when there's no profile to link to", () => {
    const event = { ...findEvent("neon-static"), organiserName: "Nobody In The Samples" };
    render(<EventDetailsView event={event} demo />);
    expect(screen.getByText("Organised by Nobody In The Samples").tagName).toBe("DD");
    expect(screen.queryByRole("link", { name: "Nobody In The Samples" })).not.toBeInTheDocument();
  });
});

describe("EventDetailsView tickets panel", () => {
  function ticketsPanel(container: HTMLElement): HTMLElement {
    const tickets = container.querySelector<HTMLElement>("#tickets");
    if (!tickets) throw new Error("#tickets not rendered");
    return tickets;
  }

  it("states the booking fee from lib/fees.ts, so the copy can't drift from what's charged", () => {
    const { container } = render(<EventDetailsView event={findEvent("neon-static")} demo />);
    const tickets = ticketsPanel(container);
    const sentence = `Booking fee: ${describeBookingFee()}. Free tickets never carry a fee.`;
    expect(within(tickets).getByText(sentence)).toBeInTheDocument();
    // And it says what's actually charged today.
    expect(sentence).toBe("Booking fee: 4% of ticket face value + A$0.50 per paid ticket. Free tickets never carry a fee.");
  });

  it("says tickets are coming soon when there are no ticket types, with no fee copy and nothing to select", () => {
    const { container } = render(<EventDetailsView event={{ ...findEvent("neon-static"), ticketTypes: [] }} demo />);
    const tickets = ticketsPanel(container);
    expect(within(tickets).getByText("Tickets coming soon.")).toBeInTheDocument();
    expect(within(tickets).queryByText(/Booking fee/)).not.toBeInTheDocument();
    expect(within(tickets).queryByRole("button")).not.toBeInTheDocument();
    expect(within(tickets).queryByRole("textbox")).not.toBeInTheDocument();
  });
});

describe("EventDetailsView brand layout (brand-direction-one.md §6.10)", () => {
  it("puts the buy bar on an ink surface with the one orange Buy tickets", () => {
    const { container } = render(<EventDetailsView event={findEvent("neon-static")} demo />);
    const bar = buyBar(container);
    if (!bar) throw new Error("buy bar not rendered");
    expect(bar).toHaveAttribute("data-surface", "ink");
    expect(bar.className).not.toMatch(/bg-foreground|text-background/);
    expect(within(bar).getByRole("link", { name: "Buy tickets" })).toHaveClass("btn-signal", "btn-lg");
    // Checkout itself stays black.
    const tickets = container.querySelector<HTMLElement>("#tickets");
    if (!tickets) throw new Error("#tickets not rendered");
    expect(tickets.querySelector(".btn-signal")).toBeNull();
  });

  it("has a category · suburb strap with Save and Share, then the title", () => {
    const event = findEvent("neon-static");
    render(<EventDetailsView event={event} demo />);
    const heading = screen.getByRole("heading", { level: 1, name: event.title });
    const share = screen.getByRole("button", { name: `Share ${event.title}` });
    expect(screen.getByText(`Live music · ${event.suburb}`)).toBeInTheDocument();
    expect(share.compareDocumentPosition(heading) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("names the Tickets and Good to know sections by their headings (region landmarks)", () => {
    render(<EventDetailsView event={findEvent("neon-static")} demo />);
    expect(screen.getByRole("region", { name: "Tickets" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Good to know" })).toBeInTheDocument();
  });

  it("says the time is Melbourne time with the zone in effect, and midnight in words", () => {
    // Neon Static: 8:00 pm Fri 25 Sep to midnight, Melbourne time (AEST: daylight saving starts 4 Oct).
    render(<EventDetailsView event={findEvent("neon-static")} demo />);
    const when = screen.getByText("When").closest("div");
    if (!when) throw new Error("When row not rendered");
    // (Node's ICU writes September as "Sep" or "Sept".)
    expect(within(when).getAllByRole("definition")[0]).toHaveTextContent(
      /^Fri 25 Sept?, 8:00 pm – Sat 26 Sept?, midnightMelbourne time \(AEST\)$/,
    );
    expect(document.body).not.toHaveTextContent("12:00 am");
  });

  it("offers Add to calendar under When", () => {
    render(<EventDetailsView event={findEvent("neon-static")} demo />);
    const when = screen.getByText("When").closest("div");
    if (!when) throw new Error("When row not rendered");
    expect(within(when).getByRole("button", { name: "Add to calendar" })).toHaveAttribute("aria-expanded", "false");
  });
});

describe("EventDetailsView Where: Get directions (mobile-redesign.md §6.5)", () => {
  it("makes the address one link to directions, opening Google Maps in a new tab with a clear name", () => {
    const event = findEvent("neon-static");
    render(<EventDetailsView event={event} demo />);
    const where = screen.getByText("Where").closest("div");
    if (!where) throw new Error("Where row not rendered");
    const links = within(where).getAllByRole("link");
    expect(links).toHaveLength(1);
    const link = links[0];
    const address = `${event.venueName}, ${event.venueAddress}`;
    expect(link).toHaveAccessibleName(`Get directions to ${address} (opens Google Maps in a new tab)`);
    expect(link).toHaveTextContent(`${address}Get directions`);
    expect(link).toHaveAttribute(
      "href",
      `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(address)}`,
    );
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
    // The action itself is a 44px target.
    expect(within(link).getByText("Get directions")).toHaveClass("min-h-11");
  });
});

describe("EventDetailsView More from the organiser", () => {
  it("live: links to the organiser profile's upcoming events", () => {
    const event = { ...findEvent("neon-static"), organiserId: "org 1", organiserName: "Northside Noise" };
    render(<EventDetailsView event={event} demo={false} />);
    expect(screen.getByRole("link", { name: "More from Northside Noise" })).toHaveAttribute(
      "href",
      "/organisers/org%201#organiser-upcoming",
    );
  });

  it("demo: links to the sample organiser's page", () => {
    render(<EventDetailsView event={findEvent("dead-letter-office")} demo />);
    expect(screen.getByRole("link", { name: "More from Small Hours Theatre" })).toHaveAttribute(
      "href",
      "/organisers/small-hours-theatre#organiser-upcoming",
    );
  });

  it("isn't offered when there's no profile to link to", () => {
    render(<EventDetailsView event={{ ...findEvent("neon-static"), organiserName: "Nobody In The Samples" }} demo />);
    expect(screen.queryByRole("link", { name: /^More from/ })).toBeNull();
  });
});

describe("EventDetailsView booking info beside the tickets", () => {
  it("links the existing refund and purchase-terms pages (no invented policy), and repeats an age restriction", () => {
    const { container } = render(
      <EventDetailsView event={{ ...findEvent("neon-static"), ageRestriction: "18+ (ID checked)" }} demo />,
    );
    const tickets = container.querySelector<HTMLElement>("#tickets");
    if (!tickets) throw new Error("#tickets not rendered");
    expect(within(tickets).getByRole("link", { name: "Request a refund" })).toHaveAttribute("href", "/refunds");
    expect(within(tickets).getByRole("link", { name: "Purchase Terms" })).toHaveAttribute("href", "/purchase-terms");
    const age = within(tickets).getByText("Age restriction");
    expect(age.tagName).toBe("DT");
    expect(age.nextElementSibling).toHaveTextContent("18+ (ID checked)");
  });

  it("has no age line without a restriction", () => {
    const { container } = render(<EventDetailsView event={{ ...findEvent("neon-static"), ageRestriction: undefined }} demo />);
    const tickets = container.querySelector<HTMLElement>("#tickets");
    if (!tickets) throw new Error("#tickets not rendered");
    expect(within(tickets).queryByText("Age restriction")).toBeNull();
    expect(within(tickets).getByText("Refunds")).toBeInTheDocument();
  });
});
