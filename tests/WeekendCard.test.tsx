// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FavouritesProvider } from "@/components/favourites/FavouritesProvider";
import WeekendCard from "@/components/home/WeekendCard";
import { getSampleGoing } from "@/lib/sample-going";
import type { SheltuhEvent } from "@/lib/types";
import { FakeAuthProvider, fakeAuthValue } from "./test-utils/fakeAuth";

/*
 * The home's This weekend card (owner's mockup, 8 Nov 2026): its anatomy, accessible names and
 * links, the all-inclusive price from lib/fees.ts via CardPrice, and the going strip only beside a
 * real count (the demo's sample one, labelled, with its names' initials; live, a trending count and
 * no faces). No "Featured" badge.
 */

vi.mock("next/navigation", () => ({
  usePathname: () => "/",
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

// Wed 11 Nov 2026, 12:00 AEDT.
const NOW = new Date("2026-11-11T01:00:00.000Z");

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  localStorage.clear();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const HERE_AND_NOW: SheltuhEvent = {
  id: "evt-here-now",
  slug: "here-and-now",
  title: "Here & Now",
  description: "A phone-free night.",
  category: "live-music",
  suburb: "Coburg North",
  venueName: "INTERCONNECT STUDIO",
  venueAddress: "16 Catherine St",
  // Sat 14 Nov 2026, 5:00 pm AEDT.
  startsAt: "2026-11-14T06:00:00.000Z",
  endsAt: "2026-11-14T10:00:00.000Z",
  organiserId: "org-1",
  organiserName: "MONTE",
  poster: { pattern: "waves", background: "#000000", primary: "#ffffff", secondary: "#ff4800" },
  // A$24.00 + the booking fee = A$25.94 (lib/fees.ts).
  ticketTypes: [{ id: "ga", name: "General admission", priceCents: 2400, feePolicy: "buyer-pays", quantityAvailable: 100 }],
};

function renderCard(children: ReactNode) {
  return render(
    <FakeAuthProvider value={fakeAuthValue({ configured: false, status: "signed-out" })}>
      <FavouritesProvider>{children}</FavouritesProvider>
    </FakeAuthProvider>,
  );
}

describe("WeekendCard", () => {
  it("reads title, date, venue and place, category, then the price; the title is the card's link", () => {
    const { container } = renderCard(<WeekendCard event={HERE_AND_NOW} mode="live" now={NOW} />);
    const card = container.querySelector<HTMLElement>("[data-event-card]");
    if (!card) throw new Error("no card");
    expect(card).toHaveAttribute("data-variant", "weekend");
    const title = within(card).getByRole("heading", { level: 3 });
    // Capitals on screen only: the title is read as entered.
    expect(title).toHaveClass("uppercase");
    expect(title).toHaveTextContent("Here & Now");
    expect(within(card).getByRole("link", { name: "Here & Now" })).toHaveAttribute("href", "/events/here-and-now");
    expect(card.querySelector("[data-card-date]")).toHaveTextContent("Sat 14 Nov · 5:00 pm");
    // The venue as entered, then "Suburb, STATE", read with a separator between them.
    expect(card.querySelector("[data-place-lines]")?.textContent?.replace(/\s+/g, " ").trim()).toBe(
      "INTERCONNECT STUDIO · Coburg North, VIC",
    );
    expect(card.querySelector("[data-card-category]")).toHaveTextContent("Live music");
    expect(card.querySelector("[data-card-foot]")).toHaveTextContent("A$25.94 incl. booking fee");
    expect(card).not.toHaveTextContent(/featured/i);
  });

  it("names Save and the arrow for the event; the arrow opens the event page in a 44px target", () => {
    renderCard(<WeekendCard event={HERE_AND_NOW} mode="live" now={NOW} />);
    // The favourites toggle (no accounts configured here, so saves stay on this device).
    const save = screen.getByRole("button", { name: "Save Here & Now" });
    expect(save).toHaveAttribute("aria-pressed", "false");
    expect(save).toHaveAttribute("data-save-variant", "glass");
    expect(save).toHaveClass("size-11");
    const open = screen.getByRole("link", { name: "Open Here & Now" });
    expect(open).toHaveAttribute("href", "/events/here-and-now");
    expect(open).toHaveClass("min-h-11", "min-w-11");
  });

  it("from-prices, free and sold out read as on every card", () => {
    const from: SheltuhEvent = {
      ...HERE_AND_NOW,
      id: "evt-from",
      ticketTypes: [
        { id: "a", name: "Standing", priceCents: 6274, feePolicy: "buyer-pays", quantityAvailable: 10 },
        { id: "b", name: "Seated", priceCents: 8000, feePolicy: "buyer-pays", quantityAvailable: 10 },
      ],
    };
    const { container, unmount } = renderCard(<WeekendCard event={from} mode="live" now={NOW} />);
    expect(container.querySelector("[data-card-foot]")).toHaveTextContent("From A$67 incl. booking fee");
    unmount();
    const free: SheltuhEvent = { ...HERE_AND_NOW, id: "evt-free", ticketTypes: [{ ...HERE_AND_NOW.ticketTypes[0], priceCents: 0 }] };
    const second = renderCard(<WeekendCard event={free} mode="live" now={NOW} />);
    expect(second.container.querySelector("[data-card-foot]")).toHaveTextContent("Free No booking fee");
    second.unmount();
    const soldOut: SheltuhEvent = { ...HERE_AND_NOW, id: "evt-sold", soldOut: true, ticketTypes: [{ ...HERE_AND_NOW.ticketTypes[0], soldOut: true, remaining: 0 }] };
    const third = renderCard(<WeekendCard event={soldOut} mode="live" now={NOW} />);
    expect(third.container.querySelector("[data-card-foot]")).toHaveTextContent("Sold out");
    expect(third.container.querySelector("[data-event-card]")).toHaveAttribute("data-card-state", "sold-out");
    // "Sold out" (like "Free" and "Ended") is the amount on its own: in the amount's size only, never also
    // the note's, which sits on the wrapper (two text sizes on one element would clash).
    const soldOutText = within(third.container.querySelector("[data-card-foot]") as HTMLElement).getByText("Sold out");
    expect(soldOutText).toHaveClass("text-base", "font-bold");
    expect(soldOutText).not.toHaveClass("text-sm");
  });

  it("live without a going count: no strip at all", () => {
    const { container } = renderCard(<WeekendCard event={HERE_AND_NOW} mode="live" now={NOW} />);
    expect(container.querySelector("[data-card-going]")).toBeNull();
  });

  it("live with a trending going count: the strip says it, with no faces (list payloads carry no names)", () => {
    const { container } = renderCard(
      <WeekendCard event={HERE_AND_NOW} mode="live" signal={{ kind: "going", count: 42 }} now={NOW} />,
    );
    const strip = container.querySelector("[data-card-going]");
    expect(strip).toHaveTextContent(/^42 going$/);
    expect(strip?.querySelector("[data-card-faces]")).toBeNull();
  });

  it("never shows a count under three, even from a signal", () => {
    const { container } = renderCard(<WeekendCard event={HERE_AND_NOW} mode="live" signal={{ kind: "going", count: 2 }} now={NOW} />);
    expect(container.querySelector("[data-card-going]")).toBeNull();
  });

  it("demo: the sample count, labelled, with the first three sample names as decorative initials", () => {
    const sample = getSampleGoing(HERE_AND_NOW.id);
    const { container } = renderCard(<WeekendCard event={HERE_AND_NOW} mode="demo" now={NOW} />);
    const strip = container.querySelector("[data-card-going]");
    expect(strip).toHaveTextContent(`${sample.count} going (sample)`);
    const faces = strip?.querySelector("[data-card-faces]");
    expect(faces).toHaveAttribute("aria-hidden", "true");
    expect(faces?.children).toHaveLength(3);
  });

  it("an external event has no going strip (no Who's Going there)", () => {
    const external: SheltuhEvent = {
      ...HERE_AND_NOW,
      id: "evt-ext",
      ticketTypes: [],
      ticketingMode: "external",
      externalTicketUrl: "https://example.com/t",
      externalFree: false,
    };
    const { container } = renderCard(<WeekendCard event={external} mode="demo" now={NOW} />);
    expect(container.querySelector("[data-card-going]")).toBeNull();
    expect(screen.getByRole("link", { name: "Open Here & Now" })).toHaveAttribute("href", "/events/here-and-now");
  });
});
