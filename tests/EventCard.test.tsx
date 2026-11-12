// @vitest-environment jsdom
import { act, cleanup, render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FavouritesProvider } from "@/components/favourites/FavouritesProvider";
import QuickBuyLink from "@/components/QuickBuyLink";
import EventCard, { EventCardPlaceholder } from "@/components/ui/EventCard";
import { getSampleGoing } from "@/lib/sample-going";
import type { SheltuhEvent } from "@/lib/types";
import { FakeAuthProvider, fakeAuthValue } from "./test-utils/fakeAuth";

/*
 * The one event card (the redesign rules' Cards board): its
 * anatomy and reading order (the image with the date chip, the tags, the
 * title, one mono line, then who's going and the price label), the one
 * stretched link with Save outside it and the price label inside it (never a
 * control), the hover panel, every ticket state from real data (each with its
 * own `data-card-state`), and going counts that are real or (in the demo)
 * labelled samples, with faces only in the demo.
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

const foot = (container: HTMLElement) => container.querySelector<HTMLElement>("[data-card-foot]") as HTMLElement;
const tags = (container: HTMLElement) =>
  Array.from(container.querySelectorAll<HTMLElement>("[data-card-tags] [data-tag]")).map((tag) => tag.textContent);
const meta = (container: HTMLElement) => container.querySelector<HTMLElement>("[data-card-meta]") as HTMLElement;
/** The mono line's text with its no-break spaces (each "·" is joined to the part after it) as plain spaces. */
const plain = (text: string | null | undefined) => (text ?? "").replace(/\u00a0/g, " ");
const metaText = (container: HTMLElement) => plain(meta(container).textContent);
const priceTag = (container: HTMLElement) => container.querySelector<HTMLElement>("[data-price-tag]");

describe("EventCard anatomy (the rules' Cards board)", () => {
  it("the 4:3 image with the date chip, then the tags, the title and one mono line; going and the price label in the foot", () => {
      const { container } = render(<EventCard event={event} mode="demo" />);
      const root = cardRoot(container);
      // The first child is the (decorative) hover panel; the media follows.
      const hover = root.firstElementChild as HTMLElement;
      expect(hover).toHaveAttribute("data-card-hover");
      expect(hover).toHaveAttribute("aria-hidden", "true");
      const media = hover.nextElementSibling as HTMLElement;
      expect(media).toHaveAttribute("data-card-media");
      // A 4:3 image at radius 16, with the date chip (decorative) and nothing else.
      expect(media).toHaveClass("rounded-card", "overflow-hidden");
      expect(media.children).toHaveLength(2);
      expect(media.firstElementChild).toHaveAttribute("aria-hidden", "true");
      expect(media.firstElementChild).toHaveClass("aspect-[4/3]");
      expect(media.firstElementChild?.className).not.toMatch(/aspect-square/);
      expect(media.lastElementChild).toHaveAttribute("data-date-chip");
      expect(media.lastElementChild).toHaveAttribute("aria-hidden", "true");
      const text = media.nextElementSibling as HTMLElement;
      expect(text).toHaveClass("flex", "flex-col", "gap-2", "pt-4");
      expect(Array.from(text.children).map((el) => plain(el.textContent))).toEqual([
        "Live music",
        "Glasshouse Sessions",
        "Sun 18 Oct · 7pm · Carlton, VIC",
      ]);
      expect(text.children[1].tagName).toBe("H3");
      // The title is Heading/H4, at most two lines; the mono line is Mono/M, secondary, in capitals by CSS.
      expect(text.children[1]).toHaveClass("heading-h4", "line-clamp-2", "break-words");
      // One line, cut short if it doesn't fit: Mono/S on a narrow card, Mono/M from an 18rem one.
      expect(meta(container)).toHaveClass("mono-s", "@2xs:mono-m", "truncate", "text-muted", "uppercase");
      // The foot: who's going (decorative faces, then the count), then the all-inclusive price label (the amount alone).
      const [going, price] = Array.from(foot(container).children);
      expect(going).toHaveAttribute("data-card-going");
      expect(price).toHaveClass("shrink-0", "@3xs:ml-auto");
      // No "(sample)" on the card: the demo banner says it's sample data.
      expect(going.lastElementChild?.textContent).toBe(`${getSampleGoing(event.id).count} going`);
      expect(price).toHaveAttribute("data-price-tag");
      expect(price.textContent).toBe("From A$37.60");
      // No description, no ticket button, no "By organiser".
      expect(root).not.toHaveTextContent("Acoustic sets");
      expect(screen.queryByRole("link", { name: /for Glasshouse Sessions$/ })).toBeNull();
      expect(root).not.toHaveTextContent(/By Northside Noise/);
    },
  );

  // Owner brief (29 Oct 2026): the card's link is named by the title alone, so a list of links reads
  // as titles. The tags, date, place, going count and price are the text around it, still on the card.
  it("names the card's link by its title alone; the date, place, price and going count are text beside it", () => {
    const { container } = render(<EventCard event={event} mode="demo" />);
    expect(cardLink(event)).toHaveAccessibleName("Glasshouse Sessions");
    expect(cardLink(event)).toHaveAttribute("href", "/events/glass-sessions");
    // The heading is named by the title too, for heading navigation.
    expect(screen.getByRole("heading", { level: 3 })).toHaveAccessibleName("Glasshouse Sessions");
    expect(cardRoot(container)).toHaveTextContent("Sun 18 Oct · 7pm · Carlton, VIC");
    expect(cardRoot(container)).toHaveTextContent("From A$37.60");
    expect(cardRoot(container)).toHaveTextContent(`${getSampleGoing(event.id).count} going`);
  });

  it("leaves an empty place off the mono line, with no dangling separator", () => {
    const { container } = render(<EventCard event={{ ...event, venueName: "", suburb: "" }} mode="live" />);
    expect(cardLink(event)).toHaveAccessibleName("Glasshouse Sessions");
    expect(metaText(container)).toBe("Sun 18 Oct · 7pm");
    expect(metaText(container)).not.toMatch(/·\s*$/);
  });

  it("names the venue on the mono line only when there's no suburb (owner decision D4: always 'Suburb, STATE')", () => {
    const { container } = render(<EventCard event={{ ...event, suburb: "" }} mode="live" />);
    expect(metaText(container)).toBe("Sun 18 Oct · 7pm · The Conservatory");
    cleanup();
    const long = { ...event, suburb: "Fortitude Valley", state: "QLD" as const };
    const again = render(<EventCard event={long} mode="live" />);
    expect(metaText(again.container)).toBe("Sun 18 Oct · 7pm · Fortitude Valley, QLD");
  });

  // Visual QA (PR 1): one line that never wraps, so a narrow card never scrolls the page sideways.
  it("keeps the mono line to one plain line of text, never wrapped (it's cut short instead)", () => {
    const { container } = render(<EventCard event={event} mode="live" />);
    expect(meta(container).children).toHaveLength(0);
    expect(meta(container).textContent).toBe("Sun 18 Oct · 7pm · Carlton, VIC");
    expect(meta(container)).toHaveClass("truncate");
  });

  it("names a zone outside Melbourne's with the time (visual QA)", () => {
    const perth = { ...event, state: "WA" as const, timeZone: "Australia/Perth" as const, suburb: "Fremantle" };
    const { container } = render(<EventCard event={perth} mode="live" />);
    expect(metaText(container)).toBe("Sun 18 Oct · 4pm Perth time · Fremantle, WA");
  });

  it("shows a half-past time with its minutes, as the mocks' '7:30PM'", () => {
    const { container } = render(<EventCard event={{ ...event, startsAt: "2026-10-18T08:30:00.000Z" }} mode="live" />);
    expect(metaText(container)).toBe("Sun 18 Oct · 7:30pm · Carlton, VIC");
  });

  it("says an in-progress multi-day event is on now, until when; never a countdown", () => {
    vi.setSystemTime(new Date("2026-10-20T00:00:00.000Z"));
    const running: SheltuhEvent = { ...event, startsAt: "2026-10-15T00:00:00.000Z", endsAt: "2026-11-01T08:00:00.000Z" };
    const { container } = render(<EventCard event={running} mode="live" />);
    expect(metaText(container)).toBe("Now on · until Sun 1 Nov · Carlton, VIC");
    expect(document.body).not.toHaveTextContent(/today|left|hurry/i);
  });

  it("dates the chip in the event's own zone: weekday, day and month", () => {
    // 11:30 pm on Sat 17 Oct in Perth is already Sun 18 Oct in Melbourne.
    const perth = { ...event, state: "WA" as const, timeZone: "Australia/Perth" as const, startsAt: "2026-10-17T15:30:00.000Z" };
    const { container } = render(<EventCard event={perth} mode="live" />);
    const chip = container.querySelector("[data-date-chip]") as HTMLElement;
    expect(Array.from(chip.children).map((el) => el.textContent)).toEqual(["Sat", "17", "OCT"]);
  });
});

describe("EventCard: one link, with Save beside it and the price label inside it", () => {
  it("stretches the title's link over the card and its hover margin; Save sits above it, outside it", () => {
    const { container } = withHearts(<EventCard event={event} />);
    const root = cardRoot(container);
    const link = cardLink(event);
    expect(link).toHaveAttribute("data-card-link");
    expect(link).toHaveClass("after:absolute", "after:-inset-1.5", "md:after:-inset-4");
    expect(root).toHaveClass("relative", "isolate");
    const save = screen.getByRole("button", { name: "Save Glasshouse Sessions" });
    expect(link.contains(save)).toBe(false);
    expect(save).toHaveClass("absolute", "top-0", "right-0", "z-10");
    // Nothing interactive inside the link, and no other link or button on the card.
    expect(link.querySelector("a, button")).toBeNull();
    expect(screen.getAllByRole("link")).toEqual([link]);
    expect(screen.getAllByRole("button")).toEqual([save]);
  });

  // Owner rule: the price is a non-interactive label inside the card's link, never a nested control.
  it("makes the price a plain label: not a link or button, never focusable, and under the link's stretch (not raised)", () => {
    const { container } = withHearts(<EventCard event={event} />);
    const price = priceTag(container) as HTMLElement;
    expect(price).toHaveTextContent(/^From A\$37\.60$/);
    expect(price.tagName).toBe("SPAN");
    expect(price).not.toHaveAttribute("tabindex");
    expect(price).not.toHaveAttribute("role");
    expect(price.closest("a, button")).toBeNull();
    // Neither it nor its row is lifted above the stretched link, so a tap on it opens the event.
    expect(price.className).not.toMatch(/\bz-\d/);
    expect(foot(container).className).not.toMatch(/\bz-\d/);
    // Orange with a black label (6.18:1), radius 8.
    expect(price).toHaveClass("bg-signal", "text-signal-foreground", "rounded-control");
  });

  it("tabs: the card's link, then Save", () => {
    withHearts(<EventCard event={event} />);
    const focusable = Array.from(document.querySelectorAll<HTMLElement>("a[href], button, [tabindex]"));
    expect(focusable).toEqual([cardLink(event), screen.getByRole("button", { name: "Save Glasshouse Sessions" })]);
  });

  // The rules: hover fills cream and underlines the title over 200ms; no lift, no shadow, no scale.
  it("hovers with the cream panel and a title underline, eased over 200ms, and never lifts or scales", () => {
    const { container } = render(<EventCard event={event} mode="live" />);
    const root = cardRoot(container);
    const hover = root.querySelector("[data-card-hover]") as HTMLElement;
    expect(hover).toHaveClass(
      "absolute",
      // 6px out on phones (rails' cards are 12px apart, so it never meets a neighbour), 16px from 768px.
      "-inset-1.5",
      "md:-inset-4",
      "-z-10",
      "pointer-events-none",
      "rounded-card",
      "bg-hover",
      "opacity-0",
      "group-hover/card:opacity-100",
      "motion-safe:duration-200",
      "motion-safe:ease-out",
    );
    expect(cardLink(event)).toHaveClass("underline", "decoration-transparent", "group-hover/card:decoration-current");
    const everything = [root, ...root.querySelectorAll("*")].map((el) => el.getAttribute("class") ?? "").join(" ");
    expect(everything).not.toMatch(/translate-y|scale-\[|:scale-|shadow-/);
  });

  it("rings the hover panel for keyboard focus (the link's own ring is dropped where :has() works)", () => {
    const { container } = render(<EventCard event={event} mode="live" />);
    expect(container.querySelector("[data-card-hover]")).toHaveClass(
      "outline-foreground",
      "group-has-[[data-card-link]:focus-visible]/card:outline-2",
      "group-has-[[data-card-link]:focus-visible]/card:opacity-100",
    );
  });

  it("showSave={false} leaves the heart off", () => {
    withHearts(<EventCard event={event} showSave={false} />);
    expect(screen.queryByRole("button")).toBeNull();
  });
});

describe("EventCard: the feet line up across sibling cards (owner feedback, 22 Oct 2026)", () => {
  it("a flex column whose foot is pushed to the bottom with mt-auto", () => {
    const { container } = render(<EventCard event={event} mode="live" />);
    const root = cardRoot(container);
    expect(root).toHaveClass("flex", "flex-col", "@container");
    // One line from a 16rem card (going left, price right); stacked on a narrower one, the price on the
    // right under who's going, the same on every card of the row.
    expect(foot(container)).toHaveClass("mt-auto", "flex", "flex-col", "justify-end", "pt-4", "@3xs:flex-row", "@3xs:items-center", "@3xs:justify-between");
    expect(root.lastElementChild).toBe(foot(container));
    expect(priceTag(container)).toHaveClass("self-end", "@3xs:ml-auto", "@3xs:self-auto");
  });

  it("keeps a price label's room when there's none (sold out), so this card's foot sits level with its neighbours'", () => {
    const { container } = render(<EventCard event={soldOut} mode="live" />);
    expect(priceTag(container)).toBeNull();
    expect(foot(container)).toHaveClass("min-h-14");
  });
});

describe("EventCard variants", () => {
  it("loads its photo lazily, or at once with `priority` (the home's first row)", () => {
    const withPhoto: SheltuhEvent = { ...event, imageUrl: "https://img.example/a.jpg" };
    const { container } = render(<EventCard event={withPhoto} mode="live" />);
    expect(container.querySelector("img")).toHaveAttribute("loading", "lazy");
    cleanup();
    const eager = render(<EventCard event={withPhoto} priority mode="live" />);
    expect(eager.container.querySelector("img")).toHaveAttribute("loading", "eager");
  });

  it("grid: fills its cell", () => {
    const { container } = render(<EventCard event={event} mode="live" />);
    expect(cardRoot(container)).toHaveClass("w-full");
  });

  it("placeholder: the card's full width, the 4:3 image box and three flat bars, hidden from screen readers", () => {
    {
      const { container, unmount } = render(<EventCardPlaceholder />);
      const root = container.firstElementChild as HTMLElement;
      expect(root).toHaveAttribute("aria-hidden", "true");
      expect(root).toHaveClass("w-full");
      expect(root.querySelector(".aspect-\\[4\\/3\\].bg-surface")).not.toBeNull();
      expect(root.querySelector(".aspect-square")).toBeNull();
      expect(root.querySelectorAll(".pt-4 > .bg-surface")).toHaveLength(3);
      expect(root.innerHTML).not.toMatch(/animate/);
      unmount();
    }
  });
});

describe("EventCard media: organiser artwork", () => {
  function loadPortrait(img: HTMLImageElement) {
    Object.defineProperty(img, "naturalWidth", { value: 800 });
    Object.defineProperty(img, "naturalHeight", { value: 1131 });
    act(() => {
      img.dispatchEvent(new Event("load"));
    });
  }

  it("grid: a portrait poster is shown whole in the 4:3 box, on a blurred copy of itself", () => {
    const { container } = render(<EventCard event={{ ...event, imageUrl: "/poster.jpg" }} mode="live" />);
    const img = container.querySelector("img");
    if (!img) throw new Error("no photo");
    expect(img).toHaveClass("object-cover");
    loadPortrait(img);
    expect(img).toHaveClass("object-contain");
    expect(container.querySelector("[data-art-backdrop]")).not.toBeNull();
  });

  it("grid: a landscape photo still fills the box", () => {
    const { container } = render(<EventCard event={{ ...event, imageUrl: "/photo.jpg" }} mode="live" />);
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

describe("EventCard ticket states, from real data only", () => {
  it.each<[string, SheltuhEvent, string[], string | null]>([
    ["paid, on sale", event, ["Live music"], "From A$37.60"],
    // No "Free" tag: the price label says it (review L4).
    ["every on-sale tier free", allFree, ["Live music"], "Free"],
    // A free tier beside a paid one on sale: never just "Free" (review M1).
    ["free and paid tiers on sale", { ...event, ticketTypes: [{ ...event.ticketTypes[0], priceCents: 0 }, event.ticketTypes[1]] }, ["Live music"], "Free + paid"],
    // Every tier still on sale is free (the paid one is sold out), so it's a free event.
    ["free on sale beside a sold-out paid tier", freeAndPaidSoldOut, ["Live music"], "Free"],
    ["seated, on sale", seated, ["Live music", "Reserved seating"], "From A$37.60"],
    ["sold out", soldOut, ["Live music", "Sold out"], null],
    ["seated and sold out", { ...seated, soldOut: true, ticketTypes: soldOut.ticketTypes.map((t) => ({ ...t, seated: true })) }, ["Live music", "Sold out"], null],
    // An external event's card never names the ticket site (owner, 31 Oct 2026).
    ["external, paid", external, ["Live music"], "Buy tickets"],
    ["external, paid, with the organiser's price", { ...external, externalPriceFromCents: 8900 }, ["Live music"], "From A$89"],
    ["external, free", externalFree, ["Live music"], "Free"],
  ])("%s: its tags and its price label", (_label, e, expectedTags, price) => {
    const { container } = render(<EventCard event={e} mode="live" />);
    expect(cardLink(e)).toHaveAccessibleName(e.title);
    expect(tags(container)).toEqual(expectedTags);
    if (price) {
      expect(priceTag(container)).toHaveTextContent(new RegExp(`^${price.replace(/[$.+]/g, "\\$&")}$`));
      expect(priceTag(container)).toHaveAttribute("data-price-tag", "signal");
    } else expect(priceTag(container)).toBeNull();
    // No ticket button on the card: the event page has it.
    expect(screen.queryByRole("link", { name: new RegExp(`for ${e.title}$`) })).toBeNull();
  });

  it("no ticket types yet: a quiet 'Tickets coming soon' label, never orange", () => {
    const { container } = render(<EventCard event={{ ...event, ticketTypes: [] }} mode="live" />);
    expect(priceTag(container)).toHaveTextContent(/^Tickets coming soon$/);
    expect(priceTag(container)).toHaveAttribute("data-price-tag", "neutral");
    expect(priceTag(container)).not.toHaveClass("bg-signal");
  });

  it("sold out: the 'Sold out' tag (neutral) and the image at 60%", () => {
    const { container } = render(<EventCard event={soldOut} mode="live" />);
    expect(container.querySelector('[data-tag="neutral"]')).toHaveTextContent("Sold out");
    expect(container.querySelector("[data-card-media] > *")).toHaveClass("opacity-60");
  });

  it("ended: the 'Ended' tag, no price label and a greyed image, sold out or not", () => {
    vi.setSystemTime(new Date("2026-10-18T11:00:00.000Z"));
    for (const e of [event, soldOut, seated, externalFree]) {
      const { container, unmount } = render(<EventCard event={e} mode="live" />);
      expect(tags(container)).toEqual(["Live music", "Ended"]);
      expect(priceTag(container)).toBeNull();
      expect(screen.queryByText(/Sold out|incl\. booking fee/)).toBeNull();
      expect(container.querySelector("[data-card-media] > *")).toHaveClass("grayscale");
      unmount();
    }
  });

  it("never shows remaining counts or urgency, even when the server sends a low count", () => {
    const low: SheltuhEvent = { ...event, ticketTypes: event.ticketTypes.map((t) => ({ ...t, remaining: 2 })) };
    const { container } = render(<EventCard event={low} mode="demo" />);
    expect(container).not.toHaveTextContent(/left|selling fast|hurry|only/i);
  });

  it("external: no outbound link on the card (the event page holds it and its beacon), and never the ticket site's name", () => {
    for (const e of [external, { ...external, externalPriceFromCents: 8900 }, externalFree]) {
      const { container, unmount } = render(<EventCard event={e} mode="demo" />);
      for (const a of screen.getAllByRole("link")) expect(a.getAttribute("href")).toMatch(/^\/events\//);
      expect(container).not.toHaveTextContent(/Humanitix|Eventbrite|organiser.s site|Tickets on|Sold by/i);
      unmount();
    }
  });
});

describe("EventCard attendance and qualifiers", () => {
  it("demo: the sample's count beside three small colour dots (no initials); the demo banner, not the card, says it's a sample", () => {
    const { container } = render(<EventCard event={event} mode="demo" />);
    const going = container.querySelector("[data-card-going]") as HTMLElement;
    expect(going).toHaveTextContent(new RegExp(`^${getSampleGoing(event.id).count} going$`));
    const faces = going.querySelector("[data-card-faces]") as HTMLElement;
    expect(faces).toHaveAttribute("aria-hidden", "true");
    expect(faces.children).toHaveLength(3);
    for (const face of faces.children) {
      expect(face).toHaveClass("size-5", "rounded-full");
      expect(face.textContent).toBe("");
    }
    // Never a real profile photo on a card.
    expect(container.querySelector("img[alt]:not([alt=''])")).toBeNull();
  });

  it("live: no count, no faces and no going line without a server count", () => {
    const { container } = render(<EventCard event={event} mode="live" />);
    expect(screen.queryByText(/going/)).toBeNull();
    expect(container.querySelector("[data-card-going]")).toBeNull();
  });

  it("live, trending by going: the server's count, with no faces (list payloads carry no names)", () => {
    const { container } = render(<EventCard event={event} mode="live" signal={{ kind: "going", count: 14 }} />);
    expect(container.querySelector("[data-card-going]")).toHaveTextContent(/^14 going$/);
    expect(container.querySelector("[data-card-faces]")).toBeNull();
    expect(cardLink(event)).toHaveAccessibleName("Glasshouse Sessions");
  });

  it("respects the privacy threshold: below three going, no number at all", () => {
    render(<EventCard event={event} mode="live" signal={{ kind: "going", count: 2 }} />);
    expect(screen.queryByText(/going/)).toBeNull();
  });

  it("external: never a count, demo included; a going signal reads 'Popular'", () => {
    const { container } = render(<EventCard event={external} mode="demo" signal={{ kind: "going", count: 14 }} />);
    expect(screen.queryByText(/going/)).toBeNull();
    expect(tags(container)).toEqual(["Live music", "Popular"]);
  });

  it.each([
    [{ signal: { kind: "just-announced" } as const }, "Just announced"],
    [{ signal: { kind: "popular" } as const }, "Popular"],
  ])("one qualifier tag: %o", (extra, qualifier) => {
    const { container } = render(<EventCard event={event} mode="live" {...extra} />);
    expect(tags(container)).toEqual(["Live music", qualifier]);
    // Seen, not repeated in the link's name.
    expect(cardLink(event)).toHaveAccessibleName("Glasshouse Sessions");
  });

  it("tints the category tag by its category, and the rest neutral", () => {
    const { container } = render(<EventCard event={{ ...seated, category: "theatre" }} mode="live" />);
    const tones = Array.from(container.querySelectorAll("[data-card-tags] [data-tag]")).map((tag) => tag.getAttribute("data-tag"));
    expect(tones).toEqual(["theatre", "neutral"]);
  });
});

describe("EventCard states are distinct", () => {
  it("the five live states are all different from one another", () => {
    const states = [event, allFree, soldOut, external, seated].map((e) => {
      const { container, unmount } = render(<EventCard event={e} mode="live" />);
      const value = cardRoot(container).getAttribute("data-card-state");
      unmount();
      return value;
    });
    expect(new Set(states).size).toBe(5);
  });

  it("ended: the card still opens the event (title link)", () => {
    vi.setSystemTime(new Date("2026-10-18T11:00:00.000Z"));
    {
      const { container, unmount } = render(<EventCard event={event} mode="live" />);
      expect(screen.getByRole("link", { name: event.title })).toHaveAttribute("href", `/events/${event.slug}`);
      expect(cardRoot(container)).toHaveAttribute("data-card-state", "ended");
      unmount();
    }
  });
});

describe("QuickBuyLink (the ticket action on the map's list rows and card)", () => {
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

describe("EventCard photo focus", () => {
  it("crops its photo on the event's focus point", () => {
    const { container } = render(
      <FakeAuthProvider value={fakeAuthValue()}>
        <FavouritesProvider>
          <EventCard event={{ ...event, imageUrl: "/api/events/evt-1/image?v=1", imageFocus: { x: 12, y: 34 } }} />
        </FavouritesProvider>
      </FakeAuthProvider>,
    );
    expect((container.querySelector("[data-card-media] img") as HTMLImageElement).style.objectPosition).toBe("12% 34%");
  });
});
