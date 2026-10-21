// @vitest-environment jsdom
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FavouritesProvider } from "@/components/favourites/FavouritesProvider";
import FeaturedEventCard from "@/components/home/FeaturedEventCard";
import HomeEventCard, { trendingChipText } from "@/components/home/HomeEventCard";
import QuickBuyLink from "@/components/home/QuickBuyLink";
import { formatDateBadge } from "@/lib/format";
import { getSampleGoing } from "@/lib/sample-going";
import type { SheltuhEvent } from "@/lib/types";
import { FakeAuthProvider, fakeAuthValue } from "./test-utils/fakeAuth";

vi.mock("next/navigation", () => ({
  usePathname: () => "/",
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));
const getGoingSummary = vi.fn();
vi.mock("@/lib/api/going", () => ({
  getGoingSummary: (...args: unknown[]) => getGoingSummary(...args),
}));

afterEach(cleanup);
beforeEach(() => {
  getGoingSummary.mockReset();
  localStorage.clear();
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
  organiserName: "Org",
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

/** Demo favourites (accounts not configured): hearts work without any API. */
function withHearts(children: ReactNode) {
  return render(
    <FakeAuthProvider value={fakeAuthValue({ configured: false, status: "signed-out" })}>
      <FavouritesProvider>{children}</FavouritesProvider>
    </FakeAuthProvider>,
  );
}

const mainLink = (title: string) =>
  screen.getAllByRole("link").find((a) => a.getAttribute("href") === `/events/${title}`) as HTMLElement;

describe("FeaturedEventCard", () => {
  it("is one link to the event with its title, date, venue and the all-inclusive price first", () => {
    render(<FeaturedEventCard event={event} mode="demo" />);
    const link = screen.getByRole("link");
    expect(link).toHaveAttribute("href", "/events/glass-sessions");
    expect(screen.getByRole("heading", { level: 3, name: "Glasshouse Sessions" })).toBeInTheDocument();
    expect(link).toHaveTextContent("Up next");
    expect(link).toHaveTextContent("The Conservatory · Carlton");
    // A$35 + 4% + A$0.50 = A$36.90, the cheapest buyer total, before what it includes.
    expect(link).toHaveTextContent("From A$36.90 incl. booking fee");
  });

  it("puts its text in the ink scope inside the link, so the link's focus ring stays the page's", () => {
    render(<FeaturedEventCard event={event} mode="demo" />);
    const link = screen.getByRole("link");
    expect(link).not.toHaveAttribute("data-surface");
    expect(link.querySelector("[data-surface='ink']")).not.toBeNull();
  });

  it("gets the one-cycle push-in and loads its image eagerly", () => {
    const { container } = render(<FeaturedEventCard event={{ ...event, imageUrl: "/x.jpg" }} mode="demo" />);
    const img = container.querySelector("img");
    expect(img).toHaveClass("ken-burns");
    expect(img).toHaveAttribute("loading", "eager");
  });

  it("is landscape at every width (owner decision 7: the compact hero)", () => {
    render(<FeaturedEventCard event={event} mode="demo" />);
    expect(screen.getByRole("link")).toHaveClass("min-[375px]:aspect-video", "sm:aspect-[2/1]", "lg:aspect-[4/3]");
    expect(screen.getByRole("link").className).not.toMatch(/aspect-\[4\/5\]|aspect-square/);
  });

  it("demo: shows the sample going count and makes no request", () => {
    render(<FeaturedEventCard event={event} mode="demo" />);
    expect(screen.getByText(`${getSampleGoing(event.id).count} going`)).toBeInTheDocument();
    expect(getGoingSummary).not.toHaveBeenCalled();
  });

  it("live: shows a real count at or above the threshold, from one request", async () => {
    getGoingSummary.mockResolvedValue({ count: 12, closed: false, countHidden: false });
    render(<FeaturedEventCard event={event} mode="live" />);
    expect(await screen.findByText("12 going")).toBeInTheDocument();
    expect(getGoingSummary).toHaveBeenCalledTimes(1);
    expect(getGoingSummary).toHaveBeenCalledWith("evt-1");
  });

  it.each([
    ["the count is hidden", { count: 12, closed: false, countHidden: true }],
    ["the list is closed", { count: 12, closed: true, countHidden: false }],
    ["the count is below three", { count: 2, closed: false, countHidden: false }],
  ])("live: shows no going row when %s", async (_label, summary) => {
    getGoingSummary.mockResolvedValue(summary);
    render(<FeaturedEventCard event={event} mode="live" />);
    await waitFor(() => expect(getGoingSummary).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 0));
    expect(screen.queryByText(/going/)).not.toBeInTheDocument();
  });

  it("external: where tickets are sold instead of a price, no going count, and no request even live", () => {
    render(<FeaturedEventCard event={external} mode="live" />);
    expect(screen.getByRole("link")).toHaveTextContent("Tickets on Humanitix");
    expect(screen.getByRole("link")).not.toHaveTextContent(/A\$|Tickets coming soon/);
    expect(screen.queryByText(/going/)).not.toBeInTheDocument();
    expect(getGoingSummary).not.toHaveBeenCalled();
  });
});

describe("HomeEventCard", () => {
  it("standard: image first, then date, title, venue and the all-inclusive price", () => {
    render(<HomeEventCard event={event} variant="standard" mode="demo" />);
    const link = mainLink("glass-sessions");
    expect(screen.getByRole("heading", { level: 3, name: "Glasshouse Sessions" })).toBeInTheDocument();
    expect(link).toHaveTextContent("Live music");
    expect(link).toHaveTextContent("Sun 18 Oct · 7:00 pm");
    expect(link).toHaveTextContent("The Conservatory · Carlton");
    expect(link).toHaveTextContent("From A$36.90 incl. booking fee");
    expect(link).toHaveTextContent(`${getSampleGoing(event.id).count} going`);
    // No container: the rounded square is the media, not the link.
    expect(link.className).not.toMatch(/rounded|shadow|bg-card/);
    expect(link.querySelector(".rounded-card.overflow-hidden")).not.toBeNull();
  });

  it("puts the amount before what it includes, the amount bold and the note quieter", () => {
    render(<HomeEventCard event={event} variant="standard" mode="live" />);
    const amount = screen.getByText("From A$36.90");
    expect(amount).toHaveClass("font-semibold");
    expect(amount.nextElementSibling).toHaveTextContent("incl. booking fee");
    expect(amount.nextElementSibling).toHaveClass("text-muted");
  });

  it("live cards show no going count (the list API has none yet) and make no requests", () => {
    render(<HomeEventCard event={event} variant="standard" mode="live" />);
    expect(screen.queryByText(/going/)).not.toBeInTheDocument();
    expect(getGoingSummary).not.toHaveBeenCalled();
  });

  it("wide: a readable date badge and the first sentence of the description", () => {
    render(<HomeEventCard event={event} variant="wide" mode="demo" />);
    const { range, month } = formatDateBadge(event.startsAt, event.endsAt);
    const link = mainLink("glass-sessions");
    expect(link).toHaveTextContent(`${range} ${month}`);
    expect(link).toHaveTextContent("Acoustic sets among the ferns.");
    expect(link).not.toHaveTextContent("Bring a blanket");
  });

  it.each([
    ["free", "Free", "bg-signal"],
    ["low-cost", "Under A$20", "border-foreground"],
  ] as const)("compact: the %s badge, the exact price, and no going row", (badge, label, cls) => {
    render(<HomeEventCard event={event} variant="compact" mode="demo" badge={badge} />);
    expect(screen.getByText(label)).toHaveClass("rounded-badge", cls);
    expect(mainLink("glass-sessions")).toHaveTextContent("From A$36.90 incl. booking fee");
    expect(screen.queryByText(/going/)).not.toBeInTheDocument();
  });

  it("trending: the signal chip replaces the category chip and the going row", () => {
    render(<HomeEventCard event={event} variant="standard" mode="demo" signal={{ kind: "going", count: 14 }} />);
    const link = mainLink("glass-sessions");
    expect(link).toHaveTextContent("14 going");
    expect(link).not.toHaveTextContent("Live music");
    expect(screen.getAllByText(/going/)).toHaveLength(1);
  });

  it("trending chip text: a thresholded going count, or a label; never a count on an external event", () => {
    expect(trendingChipText({ kind: "going", count: 9 }, false)).toBe("9 going");
    expect(trendingChipText({ kind: "going", count: 9 }, true)).toBe("Popular this week");
    expect(trendingChipText({ kind: "just-announced" }, false)).toBe("Just announced");
    expect(trendingChipText({ kind: "popular" }, false)).toBe("Popular this week");
  });

  it.each(["standard", "wide", "compact"] as const)(
    "%s, external: 'Tickets on {provider}', no price, no going count, no outbound link on the card",
    (variant) => {
      render(<HomeEventCard event={external} variant={variant} mode="demo" />);
      const link = mainLink("dub-session");
      expect(link).toHaveTextContent("Tickets on Humanitix");
      expect(link).not.toHaveTextContent(/A\$|incl\. booking fee|Tickets coming soon/);
      expect(screen.queryByText(/going/)).not.toBeInTheDocument();
      for (const a of screen.getAllByRole("link")) expect(a.getAttribute("href")).toMatch(/^\/events\/dub-session/);
    },
  );

  it("external and free: 'Free · Tickets on the organiser's site' for an unknown site", () => {
    render(<HomeEventCard event={externalFree} variant="standard" mode="live" />);
    expect(mainLink("open-studios")).toHaveTextContent("Free · Tickets on the organiser's site");
  });
});

describe("quick buy", () => {
  it.each(["standard", "wide", "compact"] as const)(
    "%s: a sibling link to the tickets, after the card's link and its Save, named for the event",
    (variant) => {
      withHearts(<HomeEventCard event={event} variant={variant} mode="live" />);
      const card = mainLink("glass-sessions");
      const save = screen.getByRole("button", { name: "Save Glasshouse Sessions" });
      const buy = screen.getByRole("link", { name: "Get tickets for Glasshouse Sessions" });
      expect(buy).toHaveAttribute("href", "/events/glass-sessions#tickets");
      expect(card.contains(buy)).toBe(false);
      // Tab order: main link → Save → Get tickets.
      expect(card.compareDocumentPosition(save) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      expect(save.compareDocumentPosition(buy) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      // 44px tall, black and underlined, never orange.
      expect(buy).toHaveClass("min-h-11", "underline");
      expect(buy.className).not.toMatch(/signal/);
    },
  );

  const allFree: SheltuhEvent = { ...event, ticketTypes: [{ ...event.ticketTypes[0], priceCents: 0 }] };
  it.each<[string, SheltuhEvent, "demo" | "live", string]>([
    ["live, paid", event, "live", "Get tickets for Glasshouse Sessions"],
    ["live, all free", allFree, "live", "Get free tickets for Glasshouse Sessions"],
    ["demo", event, "demo", "See tickets for Glasshouse Sessions"],
    ["live, external", external, "live", "Get tickets for Dub Session"],
  ])("%s: %s", (_label, e, mode, name) => {
    render(<QuickBuyLink event={e} mode={mode} />);
    expect(screen.getByRole("link", { name })).toHaveAttribute("href", `/events/${e.slug}#tickets`);
  });

  it("no link when the event has no tickets yet", () => {
    render(<HomeEventCard event={{ ...event, ticketTypes: [] }} variant="standard" mode="live" />);
    expect(mainLink("glass-sessions")).toHaveTextContent("Tickets coming soon");
    expect(screen.queryByRole("link", { name: /tickets for/ })).not.toBeInTheDocument();
  });

  it("the visible label is the short one; the name adds the title", () => {
    render(<QuickBuyLink event={event} mode="live" />);
    const buy = screen.getByRole("link");
    expect(within(buy).getByText("Get tickets")).toHaveAttribute("aria-hidden", "true");
  });
});
