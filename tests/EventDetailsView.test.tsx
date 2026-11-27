// @vitest-environment jsdom
import { act, cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import EventDetailsView from "@/components/EventDetailsView";
import { FavouritesProvider } from "@/components/favourites/FavouritesProvider";
import { describeBookingFeeNote } from "@/lib/fees";
import { REFUND_ACL_STATEMENT } from "@/lib/refund-policy";
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
    expect(within(bar).getByText("From A$32.30")).toBeInTheDocument();
    expect(within(bar).getByText("incl. booking fee")).toBeInTheDocument();
    // "Buy tickets" in the demo too (owner, 21 Oct 2026); the tickets section says nothing's bookable.
    expect(within(bar).getByRole("link", { name: "Buy tickets" })).toHaveAttribute("href", "#tickets");
    expect(within(bar).queryByRole("link", { name: /See tickets|Get tickets/ })).toBeNull();
  });

  it("says 'Buy tickets' for a live paid event", () => {
    const { container } = render(<EventDetailsView event={findEvent("fitzroy-poetry-and-noise")} demo={false} />);
    const bar = buyBar(container);
    if (!bar) throw new Error("buy bar not rendered");
    // One ticket type, and still "From" before a choice: a starting price, never read as a total.
    expect(within(bar).getByText("From A$21.70")).toBeInTheDocument();
    expect(within(bar).getByRole("link", { name: "Buy tickets" })).toHaveAttribute("href", "#tickets");
  });

  it("says 'Free tickets' when every ticket is free, live or demo", () => {
    for (const demo of [true, false]) {
      const { container, unmount } = render(<EventDetailsView event={findEvent("brunswick-zine-fair")} demo={demo} />);
      const bar = buyBar(container);
      if (!bar) throw new Error("buy bar not rendered");
      expect(within(bar).getByRole("link", { name: "Free tickets" })).toHaveAttribute("href", "#tickets");
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
    expect(within(tickets).getByRole("heading", { name: "Choose your tickets" })).toBeInTheDocument();
    expect(within(tickets).getByText("Choose how many tickets you want.")).toBeInTheDocument();
    // Arriving there shows the (global) focus-visible ring: nothing removes it.
    expect(tickets.className).not.toMatch(/outline-none/);
  });
});

describe("EventDetailsView once the event has ended (mobile-redesign.md §6.5, §10.3 #2)", () => {
  // A7 (accessibility review, 22 Oct 2026): the buy bar is gone entirely once an event has ended (it
  // used to say "This event has ended." with Save, or "See tickets" when sold out). Nothing's for sale;
  // the Tickets panel says so, and Save stays in the row under the title.
  it("no buy bar at all; the tickets section says it has ended, and Save stays by the title", () => {
    vi.setSystemTime(new Date("2026-12-01T00:00:00.000Z"));
    // Demo favourites (accounts not configured), so the Save hearts render.
    const { container } = render(
      <FakeAuthProvider value={fakeAuthValue({ configured: false, status: "signed-out" })}>
        <FavouritesProvider>
          <EventDetailsView event={findEvent("neon-static")} demo={false} />
        </FavouritesProvider>
      </FakeAuthProvider>,
    );
    expect(buyBar(container)).toBeNull();
    expect(screen.getAllByRole("button", { name: "Save Neon Static" })).toHaveLength(1);
    const tickets = container.querySelector<HTMLElement>("#tickets");
    if (!tickets) throw new Error("#tickets not rendered");
    expect(within(tickets).getByText("This event has ended.")).toBeInTheDocument();
    expect(within(tickets).queryByRole("button", { name: /Increase quantity|Checkout/ })).toBeNull();
  });

  it("a free event and an external one too: no bar once it's over", () => {
    vi.setSystemTime(new Date("2026-12-01T00:00:00.000Z"));
    const { container } = render(<EventDetailsView event={findEvent("brunswick-zine-fair")} demo />);
    expect(buyBar(container)).toBeNull();
    cleanup();
    const external = sampleEvents.find((e) => e.ticketingMode === "external" && e.externalTicketUrl);
    if (!external) throw new Error("no external sample");
    const other = render(<EventDetailsView event={external} demo />);
    expect(buyBar(other.container)).toBeNull();
  });

  it("sold out and ended: no bar; the panel says it has ended, above the sold-out tiers and the closed waitlist", () => {
    vi.setSystemTime(new Date("2026-12-01T00:00:00.000Z"));
    const soldOut = findEvent("dead-letter-office");
    const { container } = render(<EventDetailsView event={soldOut} demo />);
    expect(buyBar(container)).toBeNull();
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
    expect(buyBar(container)).toBeNull();
  });

  it("before it ends, the bar is there (control)", () => {
    const { container } = render(<EventDetailsView event={findEvent("neon-static")} demo />);
    expect(buyBar(container)).not.toBeNull();
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

describe("EventDetailsView key facts under the title (Refinement, 22 Oct 2026)", () => {
  it("says the date and the venue once, in one facts block straight after the title, at every width", () => {
    const event = findEvent("neon-static");
    const { container } = render(<EventDetailsView event={event} demo />);
    const facts = container.querySelector<HTMLElement>("[data-event-facts]");
    if (!facts) throw new Error("facts not rendered");
    expect(facts.className).not.toMatch(/lg:hidden|hidden/);
    const heading = screen.getByRole("heading", { level: 1, name: event.title });
    expect(heading.compareDocumentPosition(facts) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // No second When/Where further down, and no "venue · suburb" copy under the title.
    expect(screen.getAllByText("When")).toHaveLength(1);
    expect(screen.getAllByText("Where")).toHaveLength(1);
    expect(screen.queryByText(`${event.venueName} · ${event.suburb}`)).toBeNull();
    // The street address is said once on the page above Location (which has its own copy further down).
    expect(within(facts).getAllByText(event.venueAddress)).toHaveLength(1);
    // The time zone, Add to calendar under the date and the venue as the directions link (owner, 27 Nov 2026: Option A;
    // the organiser is the byline between the title and these).
    expect(within(facts).getByText(/^Melbourne time/)).toBeInTheDocument();
    expect(within(facts).getByRole("button", { name: "Add to calendar" })).toBeInTheDocument();
    expect(within(facts).getByRole("link", { name: /: get directions \(opens Google Maps in a new tab\)$/ })).toBeInTheDocument();
    const organiser = container.querySelector<HTMLElement>("[data-event-organiser]");
    if (!organiser) throw new Error("organiser row not rendered");
    expect(organiser.previousElementSibling).toBe(heading);
    expect(organiser.nextElementSibling).toBe(facts);
    expect(organiser).toHaveTextContent(`Hosted by ${event.organiserName}`);
    // Instrument Sans as written: the zone a 14px muted line, never in capitals or mono.
    expect(within(facts).getByText(/^Melbourne time/)).toHaveClass("body-s", "text-muted");
    expect(within(facts).getByText(/^Melbourne time/)).not.toHaveClass("uppercase");
    expect(within(facts).getByRole("link", { name: /: get directions / }).innerHTML).not.toMatch(/\b(uppercase|mono-m|mono-s|font-mono)\b/);
  });

  it("groups the details as When and Where, each with a decorative icon, the lead line 16px 500 and the rest 14px", () => {
    const event = findEvent("neon-static");
    const { container } = render(<EventDetailsView event={event} demo />);
    const groups = [...container.querySelectorAll<HTMLElement>("[data-event-facts] > div")];
    expect(groups.map((g) => g.querySelector("dt")?.textContent)).toEqual(["When", "Where"]);
    for (const group of groups) {
      // The icon is decorative; the term ("When", "Where") is read instead.
      const icon = group.querySelector("dt svg");
      expect(icon).toHaveAttribute("aria-hidden", "true");
      expect(group.querySelector("dt .sr-only")).not.toBeNull();
    }
    const [when, where] = groups;
    expect(when.querySelector("dd p")).toHaveClass("body-m", "font-medium");
    // Where: the venue (16px 500), then its full address (14px, muted), together the directions link.
    const venue = within(where).getByText(event.venueName);
    expect(venue).toHaveClass("body-m", "font-medium", "break-words");
    const address = within(where).getByText(event.venueAddress);
    expect(address).toHaveClass("body-s", "text-muted", "break-words");
    expect(venue.compareDocumentPosition(address) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("shows the suburb under the venue when there's no street address (as the Location section does)", () => {
    const event = { ...findEvent("neon-static"), venueAddress: "", suburb: "Collingwood" };
    const { container } = render(<EventDetailsView event={event} demo />);
    const where = container.querySelector<HTMLElement>("[data-event-where]");
    if (!where) throw new Error("Where not rendered");
    expect(within(where).getByText(event.venueName)).toBeInTheDocument();
    expect(within(where).getByText("Collingwood, VIC")).toBeInTheDocument();
  });

  it("never says the address twice: a venue name that's only its street line leads with the address, then the suburb (Round 2)", () => {
    const event = { ...findEvent("neon-static"), venueName: "170 Russell Street", venueAddress: "170 Russell St", suburb: "Melbourne", state: "VIC" as const };
    const { container } = render(<EventDetailsView event={event} demo />);
    const where = container.querySelector<HTMLElement>("[data-event-where]");
    if (!where) throw new Error("Where not rendered");
    expect(within(where).queryByText("170 Russell Street")).toBeNull();
    const lead = within(where).getByText("170 Russell St");
    expect(lead).toHaveClass("body-m", "font-medium");
    expect(within(where).getByText("Melbourne, VIC")).toHaveAttribute("data-venue-address");
    expect(within(where).getByRole("link", { name: /^170 Russell St, Melbourne, VIC: get directions / })).toBeInTheDocument();
  });

  it("keeps a real venue name that starts like its street ('Brunswick Street Print Hall' over 'Brunswick St')", () => {
    const event = { ...findEvent("neon-static"), venueName: "Brunswick Street Print Hall", venueAddress: "12 Brunswick St" };
    const { container } = render(<EventDetailsView event={event} demo />);
    const where = container.querySelector<HTMLElement>("[data-event-where]");
    if (!where) throw new Error("Where not rendered");
    expect(within(where).getByText("Brunswick Street Print Hall")).toBeInTheDocument();
    expect(within(where).getByText("12 Brunswick St")).toHaveAttribute("data-venue-address");
  });

  it("keeps each time whole ('8:00 pm', 'midnight'), so a narrow screen never splits one, but lets the rest wrap", () => {
    const { container } = render(<EventDetailsView event={findEvent("neon-static")} demo />);
    const parts = Array.from(container.querySelectorAll("[data-event-facts] .whitespace-nowrap")).map((el) => el.textContent);
    expect(parts).toEqual(["8:00 pm", "midnight"]);
  });

  it("shows a Perth event's times in Perth time and says so ('Perth time (AWST)'), refund deadline included", () => {
    // 8:00 pm to midnight AEST is 6:00 pm to 10:00 pm AWST.
    const event: SheltuhEvent = {
      ...findEvent("neon-static"),
      state: "WA",
      timeZone: "Australia/Perth",
      refundPolicy: "days_before",
      refundDays: 7,
    };
    const { container } = render(<EventDetailsView event={event} demo />);
    const facts = container.querySelector<HTMLElement>("[data-event-facts]");
    if (!facts) throw new Error("facts not rendered");
    expect(within(facts).getByText("Perth time (AWST)")).toBeInTheDocument();
    expect(within(facts).queryByText(/Melbourne time/)).toBeNull();
    const parts = Array.from(facts.querySelectorAll(".whitespace-nowrap")).map((el) => el.textContent);
    expect(parts).toEqual(["6:00 pm", "10:00 pm"]);
    expect(facts.textContent).toContain("Fri 25 Sept, 6:00 pm – 10:00 pm");
    expect(container.querySelector("[data-refund-policy]")?.textContent).toBe(
      "Refunds available until Fri 18 Sept, 6:00 pm (7 days before the event).",
    );
  });

  it("a Melbourne event's zone label is unchanged ('Melbourne time (AEST)')", () => {
    const { container } = render(<EventDetailsView event={{ ...findEvent("neon-static"), state: "VIC", timeZone: "Australia/Melbourne" }} demo />);
    const facts = container.querySelector<HTMLElement>("[data-event-facts]");
    if (!facts) throw new Error("facts not rendered");
    expect(within(facts).getByText("Melbourne time (AEST)")).toBeInTheDocument();
    expect(facts.textContent).toContain("Fri 25 Sept, 8:00 pm – Sat 26 Sept, midnight");
  });

  it("puts the tickets before About on phones (reading order: title, facts, tickets, then the description)", () => {
    const event = findEvent("neon-static");
    render(<EventDetailsView event={event} demo />);
    const tickets = screen.getByRole("region", { name: "Choose your tickets" });
    const about = screen.getByRole("region", { name: "About this event" });
    expect(tickets.compareDocumentPosition(about) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(within(about).getByText(event.description)).toBeInTheDocument();
  });

  it("repeats no page-level demo notice (the layout's banner is the one); the ticket panel still says nothing can be booked", () => {
    render(<EventDetailsView event={findEvent("neon-static")} demo />);
    expect(screen.queryByText(/fictional sample data/)).toBeNull();
    expect(within(screen.getByRole("region", { name: "Choose your tickets" })).getByText(/Checkout unavailable in this demo/i)).toBeInTheDocument();
  });
});

describe("EventDetailsView organiser", () => {
  it("says 'Hosted by {name}' straight under the title, the name itself the link to their profile for a live event", () => {
    const event = { ...findEvent("neon-static"), organiserId: "org 1", organiserName: "Northside Noise" };
    const { container } = render(<EventDetailsView event={event} demo={false} />);
    const row = container.querySelector<HTMLElement>("[data-event-organiser]");
    if (!row) throw new Error("organiser row not rendered");
    // A byline: the element right after the h1 (owner, 27 Nov 2026).
    expect(row.previousElementSibling).toBe(screen.getByRole("heading", { level: 1 }));
    expect(within(row).getByText(/^Hosted by/)).toHaveTextContent("Hosted by Northside Noise");
    // The name is the link (its text all of the link's name), underlined and semibold like the page's other text links.
    const link = within(row).getByRole("link", { name: "Northside Noise" });
    expect(link).toHaveAttribute("href", "/organisers/org%201");
    expect(link).toHaveTextContent(/^Northside Noise$/);
    expect(link).toHaveClass("font-semibold", "underline", "underline-offset-4", "hover:decoration-2");
    // A 44px target on phones (10px above and below its 24px line, cancelled in the layout), and it can wrap.
    expect(link).toHaveClass("inline-block", "max-w-full", "max-lg:py-2.5", "max-lg:-my-2.5");
    // No separate View organiser link any more.
    expect(row).not.toHaveTextContent(/View organiser/);
    expect(screen.queryByText(/View organiser/)).toBeNull();
    expect(screen.queryByRole("link", { name: /View organiser/ })).toBeNull();
  });

  it("in the demo, links a sample event's organiser to the sample organiser's profile", () => {
    const event = findEvent("dead-letter-office");
    expect(event.organiserId).toBeUndefined();
    render(<EventDetailsView event={event} demo />);
    const link = screen.getByRole("link", { name: "Small Hours Theatre" });
    expect(link).toHaveAttribute("href", "/organisers/small-hours-theatre");
  });

  it("shows the organiser's avatar beside their name, linked to the profile but out of the tab order", () => {
    const { container } = render(<EventDetailsView event={findEvent("dead-letter-office")} demo />);
    const avatar = container.querySelector("[data-organiser-avatar]");
    expect(avatar).toHaveTextContent("ST");
    expect(avatar).toHaveAttribute("href", "/organisers/small-hours-theatre");
    expect(avatar).toHaveAttribute("aria-hidden", "true");
    expect(avatar).toHaveAttribute("tabindex", "-1");
    // The name stays the one link people reach.
    expect(screen.getAllByRole("link", { name: "Small Hours Theatre" })).toHaveLength(1);
  });

  it("shows the avatar without a link when there's no profile", () => {
    const event = { ...findEvent("neon-static"), organiserName: "Nobody In The Samples" };
    const { container } = render(<EventDetailsView event={event} demo />);
    const avatar = container.querySelector("[data-organiser-avatar]");
    expect(avatar).toHaveTextContent("NS");
    expect(avatar?.tagName).toBe("SPAN");
  });

  it("shows a live organiser's logo in the avatar slot, still decorative and out of the tab order", () => {
    const event = {
      ...findEvent("fitzroy-poetry-and-noise"),
      organiserId: "org-1",
      organiserLogoThumbUrl: "/api/organisers/org-1/logo?size=thumb&v=17",
    };
    const { container } = render(<EventDetailsView event={event} demo={false} />);
    const avatar = container.querySelector("[data-organiser-avatar]");
    if (!avatar) throw new Error("avatar not rendered");
    expect(avatar).toHaveAttribute("aria-hidden", "true");
    expect(avatar).toHaveAttribute("tabindex", "-1");
    const img = avatar.querySelector("img");
    expect(img).toHaveAttribute("src", "/api/organisers/org-1/logo?size=thumb&v=17");
    expect(img).toHaveAttribute("alt", "");
    expect(img).toHaveAttribute("width", "32");
    expect(img).toHaveAttribute("height", "32");
    expect(avatar).not.toHaveTextContent(/\S/); // no initials beside it
    // Decorative: it adds nothing to the accessibility tree, and the name stays the one link.
    expect(screen.queryByRole("img")).toBeNull();
    expect(screen.getAllByRole("link", { name: event.organiserName })).toHaveLength(1);
  });

  it("falls back to the organiser's initials when the logo fails to load", () => {
    const event = {
      ...findEvent("fitzroy-poetry-and-noise"),
      organiserId: "org-1",
      organiserLogoThumbUrl: "/api/organisers/org-1/logo?size=thumb&v=17",
    };
    const { container } = render(<EventDetailsView event={event} demo={false} />);
    const img = container.querySelector("[data-organiser-avatar] img");
    if (!img) throw new Error("logo not rendered");
    act(() => {
      img.dispatchEvent(new Event("error"));
    });
    const avatar = container.querySelector("[data-organiser-avatar]");
    expect(avatar?.querySelector("img")).toBeNull();
    expect(avatar?.textContent).toMatch(/^[A-Z]{1,2}$/);
  });

  it("shows initials without a logo URL (the demo has none)", () => {
    const { container } = render(<EventDetailsView event={findEvent("dead-letter-office")} demo />);
    const avatar = container.querySelector("[data-organiser-avatar]");
    expect(avatar?.querySelector("img")).toBeNull();
    expect(avatar).toHaveTextContent("ST");
  });

  it("keeps the organiser as plain text when there's no profile to link to", () => {
    const event = { ...findEvent("neon-static"), organiserName: "Nobody In The Samples" };
    const { container } = render(<EventDetailsView event={event} demo />);
    const row = container.querySelector<HTMLElement>("[data-event-organiser]");
    if (!row) throw new Error("organiser row not rendered");
    expect(row).toHaveTextContent("Hosted by Nobody In The Samples");
    expect(within(row).getByText("Nobody In The Samples")).toHaveClass("font-semibold");
    expect(within(row).queryByRole("link")).toBeNull();
    expect(screen.queryByRole("link", { name: /Nobody In The Samples/ })).not.toBeInTheDocument();
    expect(screen.queryByText(/View organiser/)).toBeNull();
  });
});

describe("EventDetailsView tickets panel", () => {
  function ticketsPanel(container: HTMLElement): HTMLElement {
    const tickets = container.querySelector<HTMLElement>("#tickets");
    if (!tickets) throw new Error("#tickets not rendered");
    return tickets;
  }

  it("states the booking fee once, from lib/fees.ts, so the copy can't drift from what's charged", () => {
    const { container } = render(<EventDetailsView event={findEvent("neon-static")} demo />);
    const tickets = ticketsPanel(container);
    const sentence = describeBookingFeeNote();
    expect(within(tickets).getAllByText(sentence)).toHaveLength(1);
    // And it says what's actually charged today.
    expect(sentence).toBe("Prices include a booking fee of 6% of ticket face value + A$0.50 per paid ticket.");
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
  it("puts the buy bar on the page's own surface, square, with the one orange Buy tickets → and the date under the price", () => {
    const { container } = render(<EventDetailsView event={findEvent("neon-static")} demo />);
    const bar = buyBar(container);
    if (!bar) throw new Error("buy bar not rendered");
    expect(bar).not.toHaveAttribute("data-surface");
    expect(bar).toHaveClass("bg-background", "border-t", "border-foreground");
    expect(bar.className).not.toMatch(/rounded/);
    const buy = within(bar).getByRole("link", { name: "Buy tickets" });
    expect(buy).toHaveClass("btn-signal", "btn-lg");
    // The trailing arrow, decorative.
    expect(buy.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
    expect(bar.querySelector("[data-bar-amount]")).toHaveClass("text-xl", "font-semibold");
    expect(bar.querySelector("p.mono-s")).toHaveTextContent(/^Fri 25 Sept?, · 8:00 pm$|^Fri 25 Sept? · 8:00 pm$/);
    // Checkout itself stays black.
    const tickets = container.querySelector<HTMLElement>("#tickets");
    if (!tickets) throw new Error("#tickets not rendered");
    expect(tickets.querySelector(".btn-signal")).toBeNull();
  });

  // Option A (owner, 27 Nov 2026): each action on its object. Save and Share on the photo's top-right corner (as the heart
  // is on every card), no date chip on it (the date line says it), and no row of buttons at any width.
  it("puts Save and Share on the photo, before the title in reading order, each named with the title; no date chip and no action row", () => {
    const event = findEvent("neon-static");
    // Demo favourites (accounts not configured), so the Save button renders.
    const { container } = render(
      <FakeAuthProvider value={fakeAuthValue({ configured: false, status: "signed-out" })}>
        <FavouritesProvider>
          <EventDetailsView event={event} demo />
        </FavouritesProvider>
      </FakeAuthProvider>,
    );
    const heading = screen.getByRole("heading", { level: 1, name: event.title });
    expect(heading).toHaveClass("event-title");
    expect(heading).not.toHaveClass("display-lg");
    const photo = container.querySelector("img, [aria-hidden='true'] svg");
    if (!photo) throw new Error("no photo");
    expect(photo.compareDocumentPosition(heading) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(container.querySelector("[data-event-tags] [data-tag='live-music']")).toHaveTextContent("Live music");
    // No date chip on the photo (owner, 27 Nov 2026).
    expect(container.querySelector("[data-date-chip]")).toBeNull();

    const group = container.querySelector<HTMLElement>("[data-event-actions]");
    if (!group) throw new Error("no Save and Share");
    // In the photo's box, at its top-right corner: 8px in below 640px (48px targets around 40px marks), 12px from 640px.
    expect(group.parentElement?.firstElementChild).toHaveAttribute("aria-hidden", "true");
    expect(group).toHaveClass("absolute", "top-1", "right-1", "sm:top-3", "sm:right-3", "sm:gap-2");
    // Share, then Save; nothing else (Add to calendar is under the date).
    expect(within(group).getAllByRole("button").map((b) => b.getAttribute("aria-label"))).toEqual([
      `Share ${event.title}`,
      `Save ${event.title}`,
    ]);
    expect(within(group).getByRole("button", { name: `Save ${event.title}` })).toHaveAttribute("data-save-variant", "photo");
    expect(within(group).getByRole("button", { name: `Share ${event.title}` })).toHaveAttribute("data-share-look", "photo");
    // Drawn on the photo, so first in reading and tab order, before the title (DOM order follows what you see).
    expect(group.compareDocumentPosition(heading) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // No row of Secondary buttons anywhere on the page.
    expect(container.querySelectorAll("[data-event-actions]")).toHaveLength(1);
    expect(container.querySelector("[data-ticket-panel] [data-event-actions]")).toBeNull();
    expect(container.querySelector(".\\@container [data-event-actions]")).toBeNull();
  });

  it("names the Tickets and Good to know sections by their headings (region landmarks)", () => {
    render(<EventDetailsView event={findEvent("neon-static")} demo />);
    expect(screen.getByRole("region", { name: "Choose your tickets" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Good to know" })).toBeInTheDocument();
    // The section headings are 22–24px, 600 (heading-section).
    for (const name of ["Choose your tickets", "About this event", "Good to know"]) {
      expect(screen.getByRole("heading", { level: 2, name })).toHaveClass("heading-section");
    }
  });

  it("says the time is Melbourne time with the zone in effect, and midnight in words", () => {
    // Neon Static: 8:00 pm Fri 25 Sep to midnight, Melbourne time (AEST: daylight saving starts 4 Oct).
    render(<EventDetailsView event={findEvent("neon-static")} demo />);
    const when = screen.getByText("When").closest("div");
    if (!when) throw new Error("When row not rendered");
    // (Node's ICU writes September as "Sep" or "Sept".)
    expect(within(when).getAllByRole("definition")[0]).toHaveTextContent(
      /^Fri 25 Sept?, 8:00 pm – Sat 26 Sept?, midnightMelbourne time \(AEST\)Add to calendar$/,
    );
    expect(document.body).not.toHaveTextContent("12:00 am");
  });

  it("offers Add to calendar once, under the date's zone line, as the underlined link look", () => {
    const { container } = render(<EventDetailsView event={findEvent("neon-static")} demo />);
    expect(screen.getAllByRole("button", { name: "Add to calendar" })).toHaveLength(1);
    const when = container.querySelector<HTMLElement>("[data-event-when] dd");
    if (!when) throw new Error("no When");
    const trigger = within(when).getByRole("button", { name: "Add to calendar" });
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(trigger).toHaveTextContent(/^Add to calendar$/);
    // A 44px target that takes only its 24px line (as the organiser's name does).
    expect(trigger).toHaveClass("min-h-11", "underline");
    expect(when.lastElementChild).toHaveClass("-my-2.5");
    expect(when.lastElementChild?.previousElementSibling).toHaveTextContent(/^Melbourne time/);
  });

  it("has no Add to calendar for a draft without a date (nothing to add)", () => {
    const { container } = render(<EventDetailsView event={findEvent("neon-static")} demo preview={{ missing: { title: false, description: false, when: true, where: false } }} />);
    expect(container.querySelector("[data-event-when]")).toHaveTextContent("Date and time to be added");
    expect(screen.queryByRole("button", { name: "Add to calendar" })).toBeNull();
  });
});

// S1 (owner, 27 Nov 2026: Option A): the venue's name and address together are the directions link; no separate
// Get directions.
describe("EventDetailsView Where: the venue is the directions link", () => {
  it("is one link around the venue and its address, opening Google Maps in a new tab with a clear name", () => {
    const event = findEvent("neon-static");
    render(<EventDetailsView event={event} demo />);
    const where = screen.getByText("Where").closest("div");
    if (!where) throw new Error("Where row not rendered");
    const links = within(where).getAllByRole("link");
    expect(links).toHaveLength(1);
    const link = links[0];
    const address = `${event.venueName}, ${event.venueAddress}`;
    // The visible words first (WCAG 2.5.3), then where it goes and that it's a new tab.
    expect(link).toHaveAccessibleName(`${address}: get directions (opens Google Maps in a new tab)`);
    expect(link).toHaveTextContent(`${event.venueName}${event.venueAddress}`);
    expect(screen.queryByText("Get directions")).toBeNull();
    expect(within(where).getByText(event.venueAddress).closest("a")).toBe(link);
    expect(within(where).getByText(event.venueName).closest("a")).toBe(link);
    expect(link).toHaveAttribute(
      "href",
      `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(address)}`,
    );
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
    // Only the venue's name is underlined (thicker on hover), with the decorative ↗ after it; the address is muted.
    const venue = within(where).getByText(event.venueName);
    expect(venue).toHaveClass("underline", "group-hover/dir:decoration-2", "body-m", "font-medium");
    expect(venue.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
    expect(within(where).getByText(event.venueAddress)).not.toHaveClass("underline");
    expect(link).toHaveClass("group/dir", "flex", "flex-col");
  });

  it("is never under 44px below lg, even as one line (an address that names its place: no second line)", () => {
    const event = { ...findEvent("neon-static"), venueName: "", venueAddress: "9 Rupert Street, Collingwood VIC 3066", suburb: "Collingwood", state: "VIC" as const };
    render(<EventDetailsView event={event} demo />);
    const where = screen.getByText("Where").closest("div");
    if (!where) throw new Error("Where row not rendered");
    const link = within(where).getByRole("link");
    expect(link).toHaveAccessibleName("9 Rupert Street, Collingwood VIC 3066: get directions (opens Google Maps in a new tab)");
    expect(link.querySelector("[data-venue-address]")).toBeNull();
    // 44px below lg; the line stays at the top, beside the pin (no centring).
    expect(link).toHaveClass("max-lg:min-h-11", "items-start");
    expect(link.className).not.toMatch(/justify-center/);
  });
});

describe("EventDetailsView organiser row", () => {
  it("links to the organiser's profile from their name, with no separate More from link", () => {
    const event = { ...findEvent("neon-static"), organiserId: "org 1", organiserName: "Northside Noise" };
    render(<EventDetailsView event={event} demo={false} />);
    expect(screen.getByRole("link", { name: "Northside Noise" })).toHaveAttribute("href", "/organisers/org%201");
    expect(screen.queryByRole("link", { name: /^More from/ })).toBeNull();
  });
});

describe("EventDetailsView Report this event", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("emails support, the subject naming the event and its page", () => {
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://sheltuh.com.au");
    const event = findEvent("neon-static");
    render(<EventDetailsView event={event} demo={false} />);
    const link = screen.getByRole("link", { name: "Report this event" });
    const href = link.getAttribute("href") ?? "";
    expect(href.startsWith("mailto:support@sheltuh.com.au?subject=")).toBe(true);
    expect(decodeURIComponent(href.split("?subject=")[1])).toBe(
      `Report: ${event.title} (https://sheltuh.com.au/events/${event.slug})`,
    );
  });

  it("without a configured site address, the page's path names it", () => {
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "");
    const event = findEvent("neon-static");
    render(<EventDetailsView event={event} demo />);
    const href = screen.getByRole("link", { name: "Report this event" }).getAttribute("href") ?? "";
    expect(decodeURIComponent(href.split("?subject=")[1])).toBe(`Report: ${event.title} (/events/${event.slug})`);
  });
});

describe("EventDetailsView booking info beside the tickets", () => {
  // The page: tickets, then About, Who's Going, Location and the refund info (owner, 30 Oct 2026).
  function tickets(container: HTMLElement): HTMLElement {
    return container;
  }

  it("orders the page About, Who's Going, Location, then Refunds, with refunds outside the tickets panel", () => {
    const { container } = render(<EventDetailsView event={findEvent("neon-static")} demo />);
    const info = container.querySelector("[data-booking-info]");
    if (!info) throw new Error("no booking info");
    expect(container.querySelector("#tickets")?.contains(info)).toBe(false);
    const about = screen.getByRole("heading", { name: "About this event" });
    // The panel (the "Who’s going?" card is up under Save and Share).
    const going = screen.getByRole("heading", { name: /^Who.s going$/i });
    const location = screen.getByRole("heading", { name: "Location" });
    const follows = (a: Node, b: Node) => Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
    expect(follows(about, going)).toBe(true);
    expect(follows(going, location)).toBe(true);
    expect(follows(location, info)).toBe(true);
  });

  // A6 (accessibility review, 22 Oct 2026): one plain sentence, linking the existing pages; then the
  // event's own refund policy before it (docs/architecture.md, Refund policy).
  it("where a paid purchase is possible: the event's refund policy, the ACL line, the Purchase Terms, and how to ask for one", () => {
    const { container } = render(<EventDetailsView event={findEvent("neon-static")} demo />);
    const info = tickets(container).querySelector<HTMLElement>("[data-booking-info]");
    if (!info) throw new Error("no booking info");
    expect(within(info).getByText("Refunds").tagName).toBe("DT");
    // A demo sample event has the default policy.
    expect([...info.querySelectorAll("dd > p")].map((p) => p.textContent)).toEqual([
      "No refunds for change of mind.",
      REFUND_ACL_STATEMENT,
      "Refund conditions are in our Purchase Terms. To ask for one, use Request a refund.",
    ]);
    expect(within(info).getByRole("link", { name: "Purchase Terms" })).toHaveAttribute("href", "/purchase-terms");
    expect(within(info).getByRole("link", { name: "Request a refund" })).toHaveAttribute("href", "/refunds");
  });

  it("says a days_before policy as the date and time refunds close (Melbourne time), with day or days", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-01T00:00:00.000Z"));
    try {
      // Sat 28 Nov 2026, 7:00 pm AEDT.
      const startsAt = "2026-11-28T08:00:00.000Z";
      const endsAt = "2026-11-28T11:00:00.000Z";
      for (const [days, text] of [
        [7, "Refunds available until Sat 21 Nov, 7:00 pm (7 days before the event)."],
        [1, "Refunds available until Fri 27 Nov, 7:00 pm (1 day before the event)."],
      ] as const) {
        const { container, unmount } = render(
          <EventDetailsView
            event={{ ...findEvent("neon-static"), startsAt, endsAt, refundPolicy: "days_before", refundDays: days }}
            demo
          />,
        );
        expect(tickets(container).querySelector("[data-refund-policy]")).toHaveTextContent(text);
        // The ACL line is one size on every page: text-sm, muted.
        expect(within(tickets(container)).getByText(REFUND_ACL_STATEMENT)).toHaveClass("text-sm", "text-muted");
        unmount();
      }
    } finally {
      vi.useRealTimers();
    }
  });

  it("an event closer than its policy's days says the refund window has closed (never 'up to 7 days before')", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    // Three days before the event.
    vi.setSystemTime(new Date("2026-11-25T08:00:00.000Z"));
    try {
      const { container } = render(
        <EventDetailsView
          event={{
            ...findEvent("neon-static"),
            startsAt: "2026-11-28T08:00:00.000Z",
            endsAt: "2026-11-28T11:00:00.000Z",
            refundPolicy: "days_before",
            refundDays: 7,
          }}
          demo
        />,
      );
      expect(tickets(container).querySelector("[data-refund-policy]")).toHaveTextContent(
        "The refund window for this event has closed. No refunds for change of mind.",
      );
      expect(container).not.toHaveTextContent("up to 7 days");
    } finally {
      vi.useRealTimers();
    }
  });

  it("says nothing untrue for a days_before policy without valid days (the links stay)", () => {
    const { container } = render(<EventDetailsView event={{ ...findEvent("neon-static"), refundPolicy: "days_before" }} demo />);
    expect(container.querySelector("[data-refund-policy]")).toBeNull();
    expect(within(tickets(container)).getByRole("link", { name: "Request a refund" })).toBeInTheDocument();
  });

  it("no refunds row where nothing can be paid for: free-only, ended, or external", () => {
    const free = findEvent("brunswick-zine-fair");
    expect(free.ticketTypes.every((t) => t.priceCents === 0)).toBe(true);
    const external = sampleEvents.find((e) => e.ticketingMode === "external");
    if (!external) throw new Error("no external sample");
    for (const event of [free, external]) {
      const { container, unmount } = render(<EventDetailsView event={event} demo />);
      expect(container.querySelector("[data-booking-info]")).toBeNull();
      expect(within(tickets(container)).queryByText("Refunds")).toBeNull();
      expect(container.querySelector("[data-refund-policy]")).toBeNull();
      expect(container).not.toHaveTextContent(REFUND_ACL_STATEMENT);
      unmount();
    }
    vi.setSystemTime(new Date("2026-12-01T00:00:00.000Z"));
    const { container } = render(<EventDetailsView event={findEvent("neon-static")} demo />);
    expect(container.querySelector("[data-booking-info]")).toBeNull();
  });

  it("a sold-out paid event keeps it (tickets can come back through the waitlist)", () => {
    const { container } = render(<EventDetailsView event={findEvent("dead-letter-office")} demo />);
    expect(container.querySelector("[data-booking-info]")).not.toBeNull();
  });

  // V5 (visual QA, 22 Oct 2026): the age restriction was shown twice. It stays in Good to know only.
  it("shows an age restriction once, in Good to know, never again beside the tickets", () => {
    const { container } = render(
      <EventDetailsView event={{ ...findEvent("neon-static"), ageRestriction: "18+ (ID checked)" }} demo />,
    );
    expect(screen.getAllByText("Age restriction")).toHaveLength(1);
    const ticketsPanel = container.querySelector<HTMLElement>("#tickets");
    if (!ticketsPanel) throw new Error("#tickets not rendered");
    expect(within(ticketsPanel).queryByText("Age restriction")).toBeNull();
    expect(screen.getByRole("region", { name: "Good to know" })).toHaveTextContent("18+ (ID checked)");
  });
});

describe("EventDetailsView: Before you go", () => {
  const ROWS = [
    { label: "Entry", value: "5:00 pm – 8:00 pm" },
    { label: "Age", value: "18+ · Photo ID required" },
    { label: "<b>Extras</b>", value: "<b>Earplugs</b> at the bar" },
  ];

  it("shows the organiser's rows as \"The essentials.\": numbered rows of a label and a value, as plain text, before Location", () => {
    const { container } = render(<EventDetailsView event={{ ...findEvent("neon-static"), beforeYouGo: ROWS }} demo />);
    const section = screen.getByRole("region", { name: "The essentials." });
    const heading = within(section).getByRole("heading", { level: 2, name: "The essentials." });
    // The full stop in Signal Orange (large text), the words in the foreground.
    const stop = heading.querySelector("span");
    expect(stop).toHaveTextContent(/^\.$/);
    expect(stop).toHaveClass("text-signal");
    // A description list: each <dt> "01 / " (decorative, hidden) and the label as typed (uppercased by CSS only),
    // in the small-text orange; each <dd> the value, right-aligned in the foreground.
    const terms = [...section.querySelectorAll("dt")];
    expect(terms.map((dt) => dt.textContent)).toEqual(["01 / Entry", "02 / Age", "03 / <b>Extras</b>"]);
    for (const dt of terms) {
      expect(dt.querySelector("span")).toHaveAttribute("aria-hidden", "true");
      expect(dt).toHaveClass("uppercase", "text-signal-text", "font-bold");
      expect(dt).not.toHaveClass("text-signal");
    }
    const values = [...section.querySelectorAll("dd")];
    expect(values.map((dd) => dd.textContent)).toEqual(ROWS.map((r) => r.value));
    for (const dd of values) expect(dd).toHaveClass("text-right", "text-foreground");
    // A divider under every row, the last included.
    for (const row of section.querySelectorAll("[data-before-you-go-row]")) expect(row).toHaveClass("border-b", "border-surface-border");
    // Escaped, never markup.
    expect(section.querySelector("b")).toBeNull();
    // Just before Location.
    const location = screen.getByRole("heading", { name: "Location" }).closest("section");
    expect(location).not.toBeNull();
    if (location) expect(section.compareDocumentPosition(location) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(container.querySelectorAll("[data-before-you-go]")).toHaveLength(1);
  });

  it("is absent when the event has no note", () => {
    // The sample has one (lib/sample-events.ts): taken away here.
    const { container } = render(<EventDetailsView event={{ ...findEvent("neon-static"), beforeYouGo: undefined }} demo />);
    expect(screen.queryByRole("region", { name: "The essentials." })).toBeNull();
    expect(container.querySelector("[data-before-you-go]")).toBeNull();
  });
});
