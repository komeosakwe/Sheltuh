// @vitest-environment jsdom
import { act, cleanup, render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FavouritesProvider } from "@/components/favourites/FavouritesProvider";
import QuickBuyLink from "@/components/QuickBuyLink";
import EventCard, { EventCardPlaceholder } from "@/components/ui/EventCard";
import { sampleEvents } from "@/lib/sample-events";
import { getSampleGoing } from "@/lib/sample-going";
import type { SheltuhEvent } from "@/lib/types";
import { FakeAuthProvider, fakeAuthValue } from "./test-utils/fakeAuth";

/*
 * The one event card (docs/design/mobile-redesign.md §6.2 and its
 * Refinement, 22 Oct 2026), both variants: its anatomy and reading order
 * (image, title, date, place, a small secondary line, then price and the
 * ticket action), the stretched link with Save and the ticket action outside
 * it, every ticket state of §6.2.3 from real data (each with its own
 * `data-card-state`), and going counts that are real or (in the demo)
 * labelled samples, never faces.
 */

vi.mock("next/navigation", () => ({
  usePathname: () => "/",
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

// Wed 1 Oct 2026: before every fixture below.
const NOW = new Date("2026-10-01T00:00:00.000Z");

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  localStorage.clear();
  sessionStorage.clear();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const event: SheltuhEvent = {
  id: "evt-1",
  slug: "glass-sessions",
  title: "Glasshouse Sessions",
  description: "Acoustic sets among the ferns. Bring a blanket.",
  category: "live-music",
  suburb: "Carlton",
  venueName: "The Conservatory",
  venueAddress: "1 Garden Rd",
  startsAt: "2026-10-18T08:00:00.000Z",
  endsAt: "2026-10-18T11:00:00.000Z",
  organiserId: "org-1",
  organiserName: "Northside Noise",
  poster: { pattern: "waves", background: "#000000", primary: "#ffffff", secondary: "#ff4800" },
  ticketTypes: [
    { id: "t1", name: "GA", priceCents: 3500, feePolicy: "buyer-pays", quantityAvailable: 10 },
    { id: "t2", name: "VIP", priceCents: 6000, feePolicy: "buyer-pays", quantityAvailable: 10 },
  ],
};
const external: SheltuhEvent = {
  ...event,
  id: "evt-ext",
  slug: "dub-session",
  title: "Dub Session",
  ticketTypes: [],
  ticketingMode: "external",
  externalTicketUrl: "https://events.humanitix.com/dub",
  externalFree: false,
  externalProvider: "Humanitix",
};
const externalFree: SheltuhEvent = {
  ...external,
  id: "evt-ext-free",
  slug: "open-studios",
  title: "Open Studios",
  externalTicketUrl: "https://www.example.com.au/rsvp",
  externalFree: true,
  externalProvider: null,
};
const soldOut: SheltuhEvent = {
  ...event,
  soldOut: true,
  ticketTypes: event.ticketTypes.map((t) => ({ ...t, soldOut: true, remaining: 0 })),
};
const seated: SheltuhEvent = {
  ...event,
  seating: { version: 1 },
  ticketTypes: event.ticketTypes.map((t) => ({ ...t, seated: true })),
};
const allFree: SheltuhEvent = { ...event, ticketTypes: [{ ...event.ticketTypes[0], priceCents: 0 }] };
const freeAndPaidSoldOut: SheltuhEvent = {
  ...event,
  ticketTypes: [{ ...event.ticketTypes[0], priceCents: 0 }, { ...event.ticketTypes[1], soldOut: true, remaining: 0 }],
};

/** Demo favourites (accounts not configured): hearts work without any API. */
function withHearts(children: ReactNode) {
  return render(
    <FakeAuthProvider value={fakeAuthValue({ configured: false, status: "signed-out" })}>
      <FavouritesProvider>{children}</FavouritesProvider>
    </FakeAuthProvider>,
  );
}

const cardLink = (e: SheltuhEvent) => screen.getByRole("link", { name: new RegExp(`^${e.title}`) });
const cardRoot = (container: HTMLElement) => container.querySelector<HTMLElement>("[data-event-card]") as HTMLElement;

describe("EventCard anatomy (§6.2.1)", () => {
  // Refinement (owner, 22 Oct 2026): image, title, date, place, then the category and the count,
  // small; the price and the action last. Shorter: a 4:3 rail image (at every width since the owner's
  // "the pictures still way too big", 23 Oct 2026) and tighter lines.
  it.each(["rail", "grid"] as const)(
    "%s: image first, then the title, date and time, venue, a small category · going line; the all-inclusive price, then the action, in the foot",
    (variant) => {
      const { container } = render(<EventCard event={event} variant={variant} mode="demo" />);
      const root = cardRoot(container);
      expect(root).toHaveAttribute("data-variant", variant);
      const media = root.firstElementChild as HTMLElement;
      // A rounded photo with nothing on it: the decorative art alone, no chip or badge.
      expect(media).toHaveClass("rounded-card", "overflow-hidden");
      expect(media.children).toHaveLength(1);
      expect(media.firstElementChild).toHaveAttribute("aria-hidden", "true");
      if (variant === "rail") {
        expect(media.firstElementChild).toHaveClass("aspect-[4/3]");
        expect(media.firstElementChild?.className).not.toMatch(/aspect-square/);
      } else expect(media.firstElementChild).toHaveClass("aspect-square");
      const text = media.nextElementSibling as HTMLElement;
      const lines = Array.from(text.children).map((el) => el.textContent);
      expect(lines).toEqual([
        "Glasshouse Sessions",
        "Sun 18 Oct · 7:00 pm",
        "The Conservatory · Carlton, VIC",
        `Live music · ${getSampleGoing(event.id).count} going (sample)`,
      ]);
      expect(text.firstElementChild?.tagName).toBe("H3");
      // The secondary line is small and quiet.
      expect(text.lastElementChild).toHaveClass("text-xs", "text-muted");
      // The price leads the card's foot, then the ticket action.
      const foot = root.querySelector("[data-card-foot]") as HTMLElement;
      expect(foot.firstElementChild).toHaveTextContent("From A$37.60 incl. booking fee");
      expect(within(foot.children[1] as HTMLElement).getByRole("link", { name: "Buy tickets for Glasshouse Sessions" })).toBeInTheDocument();
      // No description on cards.
      expect(root).not.toHaveTextContent("Acoustic sets");
    },
  );

  // Owner brief (29 Oct 2026): the card's link is named by the title alone, so a list of links reads
  // as titles. The date, place, price and going count are the text after it, still on the card.
  it("names the card's link by its title alone; the date, place, price and going count are text beside it", () => {
    const { container } = render(<EventCard event={event} variant="rail" mode="demo" />);
    expect(cardLink(event)).toHaveAccessibleName("Glasshouse Sessions");
    expect(cardLink(event)).toHaveAttribute("href", "/events/glass-sessions");
    // The heading is named by the title too, for heading navigation.
    expect(screen.getByRole("heading", { level: 3 })).toHaveAccessibleName("Glasshouse Sessions");
    expect(cardRoot(container)).toHaveTextContent("Sun 18 Oct · 7:00 pm");
    expect(cardRoot(container)).toHaveTextContent("The Conservatory · Carlton, VIC");
    expect(cardRoot(container)).toHaveTextContent("From A$37.60 incl. booking fee");
    expect(cardRoot(container)).toHaveTextContent(`${getSampleGoing(event.id).count} going (sample)`);
  });

  it("skips an empty place line on screen", () => {
    const { container } = render(<EventCard event={{ ...event, venueName: "", suburb: "" }} variant="grid" mode="live" />);
    expect(cardLink(event)).toHaveAccessibleName("Glasshouse Sessions");
    expect(container).not.toHaveTextContent(/ · $/);
    expect(container.querySelector("[data-place-lines]")).toBeNull();
  });

  it("puts the amount before what it includes, the amount bold and the note quieter", () => {
    render(<EventCard event={event} variant="rail" mode="live" />);
    const amount = screen.getByText("From A$37.60");
    expect(amount).toHaveClass("font-semibold");
    expect(amount.nextElementSibling).toHaveTextContent("incl. booking fee");
    expect(amount.nextElementSibling).toHaveClass("text-muted");
  });

  it("keeps the fee note's last two words together, so 'fee' never sits alone on a line (V15)", () => {
    render(<EventCard event={event} variant="grid" mode="live" />);
    const note = screen.getByText("From A$37.60").nextElementSibling as HTMLElement;
    const together = note.querySelector(".whitespace-nowrap");
    expect(together).toHaveTextContent(/^booking fee$/);
    // Only those two words: the rest can still wrap on a narrow card (no whole-line nowrap).
    expect(note).not.toHaveClass("whitespace-nowrap");
    expect(note.textContent).toBe("incl. booking fee");
  });

  it("keeps the date's separator with the time, so a wrapped line never ends on '·' (V8)", () => {
    const { container } = render(<EventCard event={event} variant="grid" mode="live" />);
    const date = container.querySelector("[data-card-date]") as HTMLElement;
    const parts = Array.from(date.querySelectorAll(".whitespace-nowrap")).map((el) => el.textContent);
    expect(parts).toEqual(["Sun 18 Oct", "· 7:00 pm"]);
  });

  it("puts the venue and \"Suburb, STATE\" on a line each, so a long venue never cuts the state off (A2)", () => {
    const long = { ...event, venueName: "The Very Long Name Of A Community Hall And Garden", suburb: "Fortitude Valley", state: "QLD" as const };
    const { container } = render(<EventCard event={long} variant="grid" mode="live" />);
    const place = container.querySelector("[data-place-lines]") as HTMLElement;
    // Read together, it's still "venue · Suburb, STATE".
    expect(place.textContent).toBe(`${long.venueName} · Fortitude Valley, QLD`);
    // On screen: a line each, the separator for screen readers only.
    const [venue, separator, suburb] = Array.from(place.children);
    expect(venue).toHaveTextContent(long.venueName);
    expect(venue).toHaveClass("block", "truncate");
    expect(separator).toHaveClass("sr-only");
    expect(separator).toHaveTextContent("·");
    // The suburb's name is what's cut short; its state never is ("Fortitude Va… QLD").
    expect(suburb.textContent).toBe("Fortitude Valley, QLD");
    expect(suburb.firstElementChild?.textContent).toBe("Fortitude Valley,");
    expect(suburb.firstElementChild).toHaveClass("truncate");
    expect(suburb.lastElementChild?.textContent).toBe("QLD");
    expect(suburb.lastElementChild).toHaveClass("shrink-0");
  });

  it("puts a zone outside Melbourne's on its own unbreakable part, so it wraps under the time (visual QA)", () => {
    const perth = { ...event, state: "WA" as const, timeZone: "Australia/Perth" as const };
    const { container } = render(<EventCard event={perth} variant="grid" mode="live" />);
    const date = container.querySelector("[data-card-date]") as HTMLElement;
    const parts = Array.from(date.querySelectorAll(".whitespace-nowrap")).map((el) => el.textContent);
    expect(parts).toEqual(["Sun 18 Oct", "· 4:00 pm", "Perth time"]);
    expect(date.textContent).toBe("Sun 18 Oct · 4:00 pm Perth time");
  });

  it("says an in-progress multi-day event is on now, until when; never a countdown", () => {
    vi.setSystemTime(new Date("2026-10-20T00:00:00.000Z"));
    const running: SheltuhEvent = { ...event, startsAt: "2026-10-15T00:00:00.000Z", endsAt: "2026-11-01T08:00:00.000Z" };
    render(<EventCard event={running} variant="rail" mode="live" />);
    expect(screen.getByText("Now on · until Sun 1 Nov")).toHaveClass("text-sm", "font-medium");
    expect(document.body).not.toHaveTextContent(/today|left|hurry/i);
  });
});

describe("EventCard: the whole card is one link, with Save and the ticket action beside it (§6.2.1)", () => {
  it("stretches the title's link over the card; Save, the CTA and the organiser link sit above it, outside it", () => {
    const { container } = withHearts(<EventCard event={event} variant="grid" />);
    const root = cardRoot(container);
    const link = cardLink(event);
    expect(link).toHaveAttribute("data-card-link");
    expect(link).toHaveClass("after:absolute", "after:inset-0");
    expect(root).toHaveClass("relative");
    const save = screen.getByRole("button", { name: "Save Glasshouse Sessions" });
    const buy = screen.getByRole("link", { name: "Buy tickets for Glasshouse Sessions" });
    const organiser = screen.getByRole("link", { name: "By Northside Noise" });
    for (const control of [save, buy, organiser]) expect(link.contains(control)).toBe(false);
    expect(save).toHaveClass("absolute", "top-1", "right-1", "z-10");
    expect(buy.parentElement).toHaveClass("relative", "z-10", "pt-2");
    expect(organiser).toHaveClass("relative", "z-10", "min-h-11");
    // Nothing interactive inside the link.
    expect(link.querySelector("a, button")).toBeNull();
  });

  it("tabs: the card's link, Save, the ticket action, then 'By organiser'", () => {
    withHearts(<EventCard event={event} variant="grid" />);
    const focusable = Array.from(document.querySelectorAll<HTMLElement>("a[href], button"));
    expect(focusable).toEqual([
      cardLink(event),
      screen.getByRole("button", { name: "Save Glasshouse Sessions" }),
      screen.getByRole("link", { name: "Buy tickets for Glasshouse Sessions" }),
      screen.getByRole("link", { name: "By Northside Noise" }),
    ]);
  });

  it("rings the whole card for keyboard focus and presses it when the link is pressed (motion-safe)", () => {
    const { container } = render(<EventCard event={event} variant="rail" mode="live" />);
    expect(cardRoot(container)).toHaveClass(
      "has-[[data-card-link]:focus-visible]:outline-2",
      "has-[[data-card-link]:focus-visible]:outline-offset-4",
      "has-[[data-card-link]:focus-visible]:rounded-card",
      "motion-safe:has-[[data-card-link]:active]:scale-[0.98]",
    );
  });

  it("showSave={false} leaves the heart off", () => {
    withHearts(<EventCard event={event} variant="grid" showSave={false} />);
    expect(screen.queryByRole("button")).toBeNull();
  });
});

describe("EventCard: prices and buttons line up across sibling cards (owner feedback, 22 Oct 2026)", () => {
  const foot = (container: HTMLElement) => container.querySelector<HTMLElement>("[data-card-foot]") as HTMLElement;

  it.each(["rail", "grid"] as const)(
    "%s: a flex column whose foot (price, then the ticket action) is pushed to the bottom with mt-auto",
    (variant) => {
      const { container } = render(<EventCard event={event} variant={variant} mode="live" />);
      const root = cardRoot(container);
      expect(root).toHaveClass("flex", "flex-col");
      // The foot is the card's last flow child after the text (Save is absolutely placed).
      expect(foot(container)).toHaveClass("mt-auto", "flex", "flex-col");
      expect(root.lastElementChild).toBe(foot(container));
      const [price, cta] = Array.from(foot(container).children);
      expect(price).toHaveTextContent("From A$37.60 incl. booking fee");
      expect(within(cta as HTMLElement).getByRole("link", { name: "Buy tickets for Glasshouse Sessions" })).toBeInTheDocument();
      // The foot isn't raised above the card's link: a tap on the price still opens the event.
      expect(foot(container)).not.toHaveClass("z-10");
    },
  );

  it("keeps the button's room when there's no ticket action, so this card's price stays level with its neighbours'", () => {
    const { container } = render(<EventCard event={{ ...event, ticketTypes: [] }} variant="rail" mode="live" />);
    expect(screen.queryByRole("link", { name: /for Glasshouse Sessions$/ })).toBeNull();
    const placeholder = foot(container).querySelector("[data-cta-placeholder]");
    expect(placeholder).toHaveAttribute("aria-hidden", "true");
    expect(placeholder?.firstElementChild).toHaveClass("min-h-11", "sm:min-h-10");
  });

  it("grid: keeps two lines' room for the price on phones (it nearly always wraps there), so 'Sold out' lines up too", () => {
    render(<EventCard event={soldOut} variant="grid" mode="live" />);
    expect(screen.getByText("Sold out")).toHaveClass("min-h-10", "sm:min-h-0");
  });

  it("grid: an organiser without a profile still fills the organiser row, as plain text, so the feet match", () => {
    const { container } = render(
      <EventCard event={{ ...sampleEvents[0], organiserName: "Nobody In The Samples" }} variant="grid" mode="live" />,
    );
    expect(screen.queryByRole("link", { name: /^By / })).toBeNull();
    const row = screen.getByText("By Nobody In The Samples").parentElement;
    expect(row).toHaveClass("min-h-11");
    expect(foot(container).contains(row)).toBe(true);
  });

  it("puts nothing interactive between the stretched link and the foot, and keeps the link's name", () => {
    render(<EventCard event={event} variant="rail" mode="live" />);
    expect(cardLink(event)).toHaveAccessibleName("Glasshouse Sessions");
  });
});

describe("EventCard variants", () => {
  it("rail: a fixed width at every size (256px from 640px, never stretched); 18px title, 14px details; the CTA sized to its label; no organiser link", () => {
    const { container } = render(<EventCard event={event} variant="rail" mode="live" />);
    expect(cardRoot(container)).toHaveClass("w-[min(62vw,15rem)]", "shrink-0", "sm:w-64");
    expect(cardRoot(container)).not.toHaveClass("sm:w-full");
    expect(screen.getByRole("heading", { level: 3 })).toHaveClass("text-lg", "leading-6", "line-clamp-2", "break-words");
    const place = container.querySelector("[data-place-lines]");
    expect(place).toHaveTextContent("The Conservatory · Carlton, VIC");
    expect(place).toHaveClass("text-sm", "leading-5");
    expect(screen.getByText("From A$37.60").parentElement).toHaveClass("text-sm", "leading-5");
    const buy = screen.getByRole("link", { name: "Buy tickets for Glasshouse Sessions" });
    expect(buy).toHaveClass("self-start", "px-4", "min-h-11", "sm:min-h-10");
    expect(screen.queryByRole("link", { name: /^By / })).toBeNull();
  });

  // Owner (23 Oct 2026, layout polish): a home rail of one or two is a two-column grid from 1024px.
  it("rail, wide: a rail card below 1024px; from 1024px it fills its cell with a 12:5 image at most 200px tall", () => {
    const { container } = render(<EventCard event={event} variant="rail" wide mode="live" />);
    const root = cardRoot(container);
    expect(root).toHaveAttribute("data-wide", "");
    expect(root).toHaveClass("w-[min(62vw,15rem)]", "shrink-0", "sm:w-64", "lg:w-full");
    expect(root.querySelector("[data-card-media] > div")).toHaveClass("aspect-[4/3]", "lg:aspect-[12/5]", "lg:max-h-50");
    // The same foot (price, then the action), so the pair's prices and buttons line up.
    expect(root.querySelector("[data-card-foot]")).toHaveClass("mt-auto");
    expect(screen.getByRole("link", { name: "Buy tickets for Glasshouse Sessions" })).toBeInTheDocument();
    cleanup();
    // Not wide: no lg: overrides. And `wide` means nothing to a grid card.
    const plain = cardRoot(render(<EventCard event={event} variant="rail" mode="live" />).container);
    expect(plain).not.toHaveAttribute("data-wide");
    expect(plain.className).not.toMatch(/lg:/);
    cleanup();
    const grid = cardRoot(render(<EventCard event={event} variant="grid" wide mode="live" />).container);
    expect(grid).not.toHaveAttribute("data-wide");
    expect(grid.querySelector("[data-card-media] > div")?.className).not.toMatch(/lg:/);
  });

  it("grid: fills its cell; 16px titles on the phone grid, 18px from 640px, 14px details; a full-width CTA on phones whose label wraps rather than overflows", () => {
    const { container } = render(<EventCard event={event} variant="grid" mode="live" />);
    expect(cardRoot(container)).toHaveClass("w-full");
    expect(screen.getByRole("heading", { level: 3 })).toHaveClass("text-base", "leading-[1.375rem]", "sm:text-lg");
    // 14px at every width (it was 12px on the phone grid).
    const place = container.querySelector("[data-place-lines]");
    expect(place).toHaveTextContent("The Conservatory · Carlton, VIC");
    expect(place).toHaveClass("text-sm");
    expect(place?.className).not.toMatch(/text-xs/);
    const buy = screen.getByRole("link", { name: "Buy tickets for Glasshouse Sessions" });
    expect(buy).toHaveClass("w-full", "sm:w-auto", "px-2", "text-xs", "text-balance");
    expect(buy.className).not.toMatch(/truncate|whitespace-nowrap/);
  });

  it("grid organiser link: wraps a long name to two lines, and only where there's a profile", () => {
    render(<EventCard event={{ ...event, organiserName: "The Very Long Name Collective of Northside" }} variant="grid" />);
    expect(screen.getByText("By The Very Long Name Collective of Northside")).toHaveClass("line-clamp-2");
    cleanup();
    render(<EventCard event={{ ...sampleEvents[0], organiserName: "Nobody In The Samples" }} variant="grid" />);
    expect(screen.queryByRole("link", { name: /^By / })).toBeNull();
    cleanup();
    render(<EventCard event={event} variant="grid" showOrganiser={false} />);
    expect(screen.queryByRole("link", { name: /^By / })).toBeNull();
  });

  it("in the demo, links a sample event's organiser to the sample organiser's profile", () => {
    const sample = sampleEvents.find((e) => e.slug === "dead-letter-office");
    if (!sample) throw new Error("no sample dead-letter-office");
    render(<EventCard event={sample} variant="grid" />);
    expect(screen.getByRole("link", { name: "By Small Hours Theatre" })).toHaveAttribute("href", "/organisers/small-hours-theatre");
  });

  it("placeholder: the variant's width and media box (rail: 4:3 at every width) and flat bars, hidden from screen readers", () => {
    const { container } = render(<EventCardPlaceholder variant="rail" />);
    const root = container.firstElementChild as HTMLElement;
    expect(root).toHaveAttribute("aria-hidden", "true");
    expect(root).toHaveClass("w-[min(62vw,15rem)]");
    expect(root.querySelector(".aspect-\\[4\\/3\\].bg-surface")).not.toBeNull();
    expect(root.querySelector(".aspect-square")).toBeNull();
    expect(root.className).not.toMatch(/animate/);
  });
});

describe("EventCard media: organiser artwork on a phone rail card", () => {
  function loadPortrait(img: HTMLImageElement) {
    Object.defineProperty(img, "naturalWidth", { value: 800 });
    Object.defineProperty(img, "naturalHeight", { value: 1131 });
    act(() => {
      img.dispatchEvent(new Event("load"));
    });
  }

  it("rail: a portrait poster in the 4:3 box is shown whole on black, not cropped (fit auto)", () => {
    const { container } = render(<EventCard event={{ ...event, imageUrl: "/poster.jpg" }} variant="rail" mode="live" />);
    const img = container.querySelector("img");
    if (!img) throw new Error("no photo");
    loadPortrait(img);
    expect(img).toHaveClass("object-contain");
  });

  it("grid: a portrait poster is shown whole in the square box too, on a blurred copy of itself", () => {
    const { container } = render(<EventCard event={{ ...event, imageUrl: "/poster.jpg" }} variant="grid" mode="live" />);
    const img = container.querySelector("img");
    if (!img) throw new Error("no photo");
    expect(img).toHaveClass("object-cover");
    loadPortrait(img);
    expect(img).toHaveClass("object-contain");
    expect(container.querySelector("[data-art-backdrop]")).not.toBeNull();
  });

  it("grid: a landscape photo still fills the square box", () => {
    const { container } = render(<EventCard event={{ ...event, imageUrl: "/photo.jpg" }} variant="grid" mode="live" />);
    const img = container.querySelector("img");
    if (!img) throw new Error("no photo");
    Object.defineProperty(img, "naturalWidth", { value: 1500 });
    Object.defineProperty(img, "naturalHeight", { value: 1000 });
    act(() => {
      img.dispatchEvent(new Event("load"));
    });
    expect(img).toHaveClass("object-cover");
    expect(container.querySelector("[data-art-backdrop]")).toBeNull();
  });
});

describe("EventCard ticket states, from real data only (§6.2.3)", () => {
  it.each<[string, SheltuhEvent, string, string | null, string | null, "btn-signal" | "btn-outline" | null]>([
    ["paid, on sale", event, "From A$37.60 incl. booking fee", "Buy tickets", "/events/glass-sessions#tickets", "btn-signal"],
    ["every on-sale tier free", allFree, "Free No booking fee", "Get free tickets", "/events/glass-sessions#tickets", "btn-signal"],
    ["free on sale beside a sold-out paid tier", freeAndPaidSoldOut, "Free No booking fee", "Get free tickets", "/events/glass-sessions#tickets", "btn-signal"],
    ["seated, on sale", seated, "From A$37.60 incl. booking fee", "Choose seats", "/events/glass-sessions/seats", "btn-signal"],
    ["sold out, waitlist open", soldOut, "Sold out", "Join waitlist", "/events/glass-sessions#tickets", "btn-outline"],
    ["seated and sold out", { ...seated, soldOut: true, ticketTypes: soldOut.ticketTypes.map((t) => ({ ...t, seated: true })) }, "Sold out", "Join waitlist", "/events/glass-sessions#tickets", "btn-outline"],
    // A9: an external event's tickets aren't bought on Sheltüh, so "Get tickets"; the price line never names the ticket site (owner, 31 Oct 2026).
    ["external, paid", external, "Get tickets", "Get tickets", "/events/dub-session#tickets", "btn-signal"],
    ["external, paid, with the organiser's price", { ...external, externalPriceFromCents: 8900 }, "From A$89", "Get tickets", "/events/dub-session#tickets", "btn-signal"],
    ["external, free", externalFree, "Free", "Get free tickets", "/events/open-studios#tickets", "btn-signal"],
    ["no ticket types yet", { ...event, ticketTypes: [] }, "Tickets coming soon", null, null, null],
  ])("%s", (_label, e, price, label, href, tone) => {
    const { container } = render(<EventCard event={e} variant="grid" mode="live" />);
    // The price line is the foot's text (the link's name is the title alone).
    expect(cardLink(e)).toHaveAccessibleName(e.title);
    expect(container.querySelector("[data-card-foot]")).toHaveTextContent(price);
    const cta = screen.queryByRole("link", { name: new RegExp(`for ${e.title}$`) });
    if (!label) {
      expect(cta).toBeNull();
      // No empty CTA row left behind.
      expect(document.querySelector(".pt-3:empty")).toBeNull();
      return;
    }
    expect(cta).toHaveAccessibleName(`${label} for ${e.title}`);
    expect(cta).toHaveAttribute("href", href);
    expect(cta).toHaveClass("btn", tone ?? "");
    // The page's own foreground ring (black in Light, white in Dark), never a fixed black or orange one.
    expect(cta).not.toHaveClass("focus-visible:outline-ink");
    expect(cta?.className).not.toMatch(/outline-(?:ink|signal)/);
  });

  it("ended: 'Ended' on the price line, muted, and no ticket action, sold out or not", () => {
    vi.setSystemTime(new Date("2026-10-18T11:00:00.000Z"));
    for (const e of [event, soldOut, seated, externalFree]) {
      const { unmount } = render(<EventCard event={e} variant="rail" mode="live" />);
      expect(screen.getByText("Ended")).toHaveClass("font-semibold", "text-muted");
      expect(screen.queryByRole("link", { name: / for / })).toBeNull();
      expect(screen.queryByText(/Sold out|incl\. booking fee/)).toBeNull();
      unmount();
    }
  });

  it("never shows remaining counts or urgency, even when the server sends a low count", () => {
    const low: SheltuhEvent = { ...event, ticketTypes: event.ticketTypes.map((t) => ({ ...t, remaining: 2 })) };
    const { container } = render(<EventCard event={low} variant="rail" mode="demo" />);
    expect(container).not.toHaveTextContent(/left|selling fast|hurry|only/i);
  });

  it("external: no outbound link on the card (the event page holds it and its beacon)", () => {
    render(<EventCard event={external} variant="rail" mode="demo" />);
    for (const a of screen.getAllByRole("link")) expect(a.getAttribute("href")).toMatch(/^\/events\/dub-session/);
  });
});

describe("EventCard attendance and category qualifiers (§6.2.2, §6.2.5; Refinement 22 Oct 2026)", () => {
  const secondary = (container: HTMLElement) => container.querySelector("[data-card-secondary]") as HTMLElement;

  it("demo: the sample's count only, labelled a sample; no faces (no real profile photos on a card)", () => {
    const { container } = render(<EventCard event={event} variant="rail" mode="demo" />);
    expect(secondary(container)).toHaveTextContent(`Live music · ${getSampleGoing(event.id).count} going (sample)`);
    expect(container.querySelector(".rounded-dot, img[alt]")).toBeNull();
  });

  it("live: no count and no reserved space without a server count", () => {
    const { container } = render(<EventCard event={event} variant="rail" mode="live" />);
    expect(screen.queryByText(/going/)).toBeNull();
    expect(secondary(container)).toHaveTextContent(/^Live music$/);
  });

  it("live, trending by going: the server's count, as plain text after the category", () => {
    const { container } = render(<EventCard event={event} variant="rail" mode="live" signal={{ kind: "going", count: 14 }} />);
    expect(container.querySelector(".rounded-dot")).toBeNull();
    expect(secondary(container)).toHaveTextContent(/^Live music · 14 going$/);
    expect(cardLink(event)).toHaveAccessibleName("Glasshouse Sessions");
  });

  it("respects the privacy threshold: below three going, no number at all", () => {
    const { container } = render(<EventCard event={event} variant="rail" mode="live" signal={{ kind: "going", count: 2 }} />);
    expect(screen.queryByText(/going/)).toBeNull();
    expect(secondary(container)).toHaveTextContent(/^Live music$/);
  });

  it("external: never a count, demo included; a going signal reads 'Popular'", () => {
    const { container } = render(<EventCard event={external} variant="rail" mode="demo" signal={{ kind: "going", count: 14 }} />);
    expect(screen.queryByText(/going/)).toBeNull();
    // V9: "Popular" (was "Popular this week").
    expect(secondary(container)).toHaveTextContent(/^Live music · Popular$/);
  });

  it.each([
    [{ signal: { kind: "just-announced" } as const }, "Live music · Just announced"],
    [{ signal: { kind: "popular" } as const }, "Live music · Popular"],
  ])("one qualifier on the category line: %o", (extra, line) => {
    const { container } = render(<EventCard event={event} variant="rail" mode="live" {...extra} />);
    expect(secondary(container)).toHaveTextContent(new RegExp(`^${line}$`));
    // Seen, not repeated in the link's name.
    expect(cardLink(event)).toHaveAccessibleName("Glasshouse Sessions");
  });
});

describe("an external event's card never names the ticket site", () => {
  it.each<[string, SheltuhEvent, string]>([
    ["paid, no price", external, "Get tickets"],
    ["paid, organiser's price", { ...external, externalPriceFromCents: 8900 }, "From A$89"],
    ["free", externalFree, "Free"],
  ])("%s: the price line is only %j", (_label, e, price) => {
    for (const variant of ["grid", "rail"] as const) {
      const { container, unmount } = render(<EventCard event={e} variant={variant} mode="live" />);
      const foot = container.querySelector("[data-card-foot]");
      expect(foot?.firstElementChild?.textContent?.trim()).toBe(price);
      expect(container).not.toHaveTextContent(/Humanitix|Eventbrite|organiser.s site|Tickets on|Sold by/i);
      unmount();
    }
  });
});

describe("EventCard states are distinct (Refinement, 22 Oct 2026)", () => {
  it.each<[string, SheltuhEvent, string, string, string | null]>([
    ["paid", event, "paid", "From A$37.60 incl. booking fee", "Buy tickets"],
    ["free", allFree, "free", "Free No booking fee", "Get free tickets"],
    ["sold out (waitlist)", soldOut, "sold-out", "Sold out", "Join waitlist"],
    ["external", external, "external", "Get tickets", "Get tickets"],
    ["seated", seated, "seated", "From A$37.60 incl. booking fee", "Choose seats"],
  ])("%s: its own state, price line and action", (_label, e, state, price, action) => {
    const { container } = render(<EventCard event={e} variant="rail" mode="live" />);
    const root = cardRoot(container);
    expect(root).toHaveAttribute("data-card-state", state);
    expect(root.querySelector("[data-card-foot]")?.firstElementChild).toHaveTextContent(price);
    expect(screen.getByRole("link", { name: `${action} for ${e.title}` })).toBeInTheDocument();
    // Seated says so in the secondary line too.
    if (state === "seated") expect(root.querySelector("[data-card-secondary]")).toHaveTextContent("Reserved seating");
  });

  it("ended: the card still opens the event (title link) in both variants", () => {
    vi.setSystemTime(new Date("2026-10-18T11:00:00.000Z"));
    for (const variant of ["rail", "grid"] as const) {
      const { unmount } = render(<EventCard event={event} variant={variant} mode="live" />);
      expect(screen.getByRole("link", { name: event.title })).toHaveAttribute("href", `/events/${event.slug}`);
      expect(screen.getByText("Ended")).toBeInTheDocument();
      unmount();
    }
  });

  it("ended: its own state, 'Ended', no action and a greyed image", () => {
    vi.setSystemTime(new Date("2026-10-18T11:00:00.000Z"));
    const { container } = render(<EventCard event={event} variant="rail" mode="live" />);
    const root = cardRoot(container);
    expect(root).toHaveAttribute("data-card-state", "ended");
    expect(screen.getByText("Ended")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: / for / })).toBeNull();
    expect(root.querySelector("[data-card-media] > *")).toHaveClass("grayscale");
  });

  it("the five live states are all different from one another", () => {
    const states = [event, allFree, soldOut, external, seated].map((e) => {
      const { container, unmount } = render(<EventCard event={e} variant="grid" mode="live" />);
      const value = cardRoot(container).getAttribute("data-card-state");
      unmount();
      return value;
    });
    expect(new Set(states).size).toBe(5);
  });
});

describe("QuickBuyLink (the card's ticket action, also on the map's list and card)", () => {
  it("no link once the event has ended, by `now` or, by default, the time of rendering", () => {
    render(<QuickBuyLink event={event} now={new Date("2026-10-18T11:00:00.000Z")} />);
    expect(screen.queryByRole("link")).toBeNull();
    cleanup();
    vi.setSystemTime(new Date("2026-10-19T00:00:00.000Z"));
    render(<QuickBuyLink event={event} />);
    expect(screen.queryByRole("link")).toBeNull();
    cleanup();
    render(<QuickBuyLink event={event} now={new Date("2026-10-18T10:59:00.000Z")} />);
    expect(screen.getByRole("link", { name: "Buy tickets for Glasshouse Sessions" })).toBeInTheDocument();
  });

  it("shows the short label; the name adds the title", () => {
    render(<QuickBuyLink event={event} />);
    expect(within(screen.getByRole("link")).getByText("Buy tickets")).toHaveAttribute("aria-hidden", "true");
  });
});
