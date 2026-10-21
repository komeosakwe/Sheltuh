// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import EventDetailsView from "@/components/EventDetailsView";
import { describeBookingFee } from "@/lib/fees";
import { sampleEvents } from "@/lib/sample-events";
import type { SheltuhEvent } from "@/lib/types";

afterEach(cleanup);

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
    expect(within(bar).getByRole("link", { name: "See tickets" })).toHaveAttribute("href", "#tickets");
  });

  it("says 'Get tickets' for a live event", () => {
    const { container } = render(<EventDetailsView event={findEvent("fitzroy-poetry-and-noise")} demo={false} />);
    const bar = buyBar(container);
    if (!bar) throw new Error("buy bar not rendered");
    expect(within(bar).getByText("A$21.30")).toBeInTheDocument();
    expect(within(bar).getByRole("link", { name: "Get tickets" })).toHaveAttribute("href", "#tickets");
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

  it("keeps the organiser as plain text when there's no organiserId (demo events)", () => {
    const event = findEvent("neon-static");
    render(<EventDetailsView event={event} demo />);
    expect(screen.getByText(`Organised by ${event.organiserName}`).tagName).toBe("DD");
    expect(screen.queryByRole("link", { name: event.organiserName })).not.toBeInTheDocument();
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
