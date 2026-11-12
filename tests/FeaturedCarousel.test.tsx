// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import FeaturedCarousel, { CAROUSEL_INTERVAL_MS, CAROUSEL_MAX } from "@/components/home/FeaturedCarousel";
import { formatCardPriceLabel } from "@/lib/pricing";
import type { SheltuhEvent } from "@/lib/types";

/** The featured carousel (the proposal's banner, redesign PR 3; the WAI carousel pattern). */

const NOW = new Date("2026-10-21T01:00:00.000Z");

function event(id: string, overrides: Partial<SheltuhEvent> = {}): SheltuhEvent {
  return {
    id,
    slug: id,
    title: `Event ${id}`,
    description: "d",
    category: "live-music",
    suburb: "Northcote",
    venueName: "Northcote Theatre",
    venueAddress: "1 St",
    startsAt: "2026-11-15T08:00:00.000Z",
    endsAt: "2026-11-15T11:00:00.000Z",
    organiserName: "Org",
    poster: { pattern: "rings", background: "#000000", primary: "#ffffff", secondary: "#ff4800" },
    ticketTypes: [{ id: `${id}-t`, name: "GA", priceCents: 6000, feePolicy: "buyer-pays", quantityAvailable: 10 }],
    ...overrides,
  };
}

const PAID = event("paid");
const FREE = event("free", { category: "art", ticketTypes: [{ id: "f-t", name: "Entry", priceCents: 0, feePolicy: "buyer-pays", quantityAvailable: 10 }] });
const SOLD = event("sold", { category: "theatre", soldOut: true });
const EVENTS = [PAID, FREE, SOLD];

function stubMotion(ok: boolean) {
  vi.stubGlobal(
    "matchMedia",
    vi.fn().mockImplementation((query: string) => ({
      matches: query.includes("no-preference") ? ok : false,
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    })),
  );
}

const scrollTo = vi.fn();
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  scrollTo.mockReset();
  Object.defineProperty(HTMLElement.prototype, "scrollTo", { configurable: true, writable: true, value: scrollTo });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  Reflect.deleteProperty(HTMLElement.prototype, "scrollTo");
});

function renderCarousel(events: SheltuhEvent[] = EVENTS) {
  return render(<FeaturedCarousel id="home-featured" title="Popular right now" events={events} now={NOW} />);
}

const slides = () => Array.from(document.querySelectorAll<HTMLElement>("[data-slide]"));
const current = () => slides().findIndex((slide) => slide.hasAttribute("data-current"));
const track = () => document.getElementById("home-featured-slides") as HTMLElement;

describe("FeaturedCarousel", () => {
  it("is a named carousel region of labelled slides; only the current slide is reachable, the rest are inert", () => {
    renderCarousel();
    const region = screen.getByRole("region", { name: "Popular right now" });
    expect(region).toHaveAttribute("aria-roledescription", "carousel");
    expect(screen.getByRole("heading", { level: 2, name: "Popular right now" })).toHaveClass("sr-only");
    expect(slides().map((slide) => [slide.getAttribute("role"), slide.getAttribute("aria-roledescription"), slide.getAttribute("aria-label")])).toEqual([
      ["group", "slide", "1 of 3"],
      ["group", "slide", "2 of 3"],
      ["group", "slide", "3 of 3"],
    ]);
    expect(slides().map((slide) => slide.hasAttribute("inert"))).toEqual([false, true, true]);
  });

  it("each slide: the category alone as its eyebrow (never 'Featured'), the title, one mono line with the all-inclusive price, the event's own ticket action and Details", () => {
    const { container } = renderCarousel();
    const [paid, free, sold] = slides();
    expect(container).not.toHaveTextContent(/Featured/i);
    expect(within(paid).getByText("Live music")).toHaveClass("mono-s", "text-signal");
    expect(within(paid).getByRole("heading", { level: 3, name: "Event paid" })).toBeInTheDocument();
    // "SUN 15 NOV · 7PM · NORTHCOTE, VIC · FROM A$…": the card's facts, then the buyer-payable price.
    const price = formatCardPriceLabel(PAID);
    expect(price).toMatch(/^From A\$|^A\$/);
    expect(within(paid).getByText(new RegExp(`Sun 15 Nov · 7pm · Northcote, VIC · ${price?.replace("$", "\\$")}$`))).toHaveClass("uppercase");
    // The ticket action says what the card would ("Buy tickets", "Free tickets", "Join waitlist"), named with the event.
    expect(within(paid).getByRole("link", { name: "Buy tickets: Event paid" })).toHaveAttribute("href", "/events/paid#tickets");
    expect(within(paid).getByRole("link", { name: "Buy tickets: Event paid" })).toHaveClass("btn-signal");
    expect(within(free).getByRole("link", { name: "Free tickets: Event free" })).toBeInTheDocument();
    // A waitlist isn't a purchase: outlined, never orange. And the price line says Sold out.
    expect(within(sold).getByRole("link", { name: "Join waitlist: Event sold" })).toHaveClass("btn-outline");
    expect(within(sold).getByText(/Sold out$/)).toBeInTheDocument();
    for (const slide of slides()) {
      const slug = slide.querySelector("h3")?.textContent?.replace("Event ", "");
      expect(within(slide).getByRole("link", { name: `Details: Event ${slug}` })).toHaveAttribute("href", `/events/${slug}`);
    }
  });

  it(`shows at most ${CAROUSEL_MAX} slides, and nothing at all with no events`, () => {
    renderCarousel(Array.from({ length: 8 }, (_, i) => event(`e${i}`)));
    expect(slides()).toHaveLength(CAROUSEL_MAX);
    cleanup();
    const { container } = renderCarousel([]);
    expect(container).toBeEmptyDOMElement();
  });

  it("Next and Previous move one slide, looping, and stop it; the dots go straight to a slide and say which is current", () => {
    stubMotion(true);
    renderCarousel();
    // jsdom lays nothing out: give the track a width, so a scroll that always went to 0 would fail.
    Object.defineProperty(track(), "clientWidth", { configurable: true, value: 640 });
    fireEvent.click(screen.getByRole("button", { name: "Next slide" }));
    expect(current()).toBe(1);
    expect(slides().map((slide) => slide.hasAttribute("inert"))).toEqual([true, false, true]);
    expect(scrollTo).toHaveBeenLastCalledWith({ left: 640, behavior: "smooth" });
    // The visitor took over: it no longer plays.
    expect(screen.getByRole("button", { name: "Play carousel" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Previous slide" }));
    fireEvent.click(screen.getByRole("button", { name: "Previous slide" }));
    expect(current()).toBe(2);
    expect(scrollTo).toHaveBeenLastCalledWith({ left: 2 * 640, behavior: "smooth" });
    const dots = within(screen.getByRole("list", { name: "Slides" })).getAllByRole("button");
    expect(dots.map((dot) => dot.getAttribute("aria-label"))).toEqual(["Slide 1: Event paid", "Slide 2: Event free", "Slide 3: Event sold"]);
    expect(dots.map((dot) => dot.getAttribute("aria-current"))).toEqual([null, null, "true"]);
    fireEvent.click(dots[0]);
    expect(current()).toBe(0);
    expect(dots[0]).toHaveAttribute("aria-current", "true");
    for (const control of [...dots, screen.getByRole("button", { name: "Next slide" })]) expect(control).toHaveAttribute("aria-controls", "home-featured-slides");
  });

  it("where motion is welcome: advances every few seconds, looping, with its live region off; Pause stops it and makes it polite", async () => {
    stubMotion(true);
    renderCarousel();
    expect(track()).toHaveAttribute("aria-live", "off");
    await act(() => vi.advanceTimersByTimeAsync(CAROUSEL_INTERVAL_MS));
    expect(current()).toBe(1);
    await act(() => vi.advanceTimersByTimeAsync(2 * CAROUSEL_INTERVAL_MS));
    expect(current()).toBe(0);
    // It never takes focus anywhere as it moves.
    expect(document.activeElement).toBe(document.body);

    fireEvent.click(screen.getByRole("button", { name: "Pause carousel" }));
    expect(screen.getByRole("button", { name: "Play carousel" })).toBeInTheDocument();
    expect(track()).toHaveAttribute("aria-live", "polite");
    await act(() => vi.advanceTimersByTimeAsync(3 * CAROUSEL_INTERVAL_MS));
    expect(current()).toBe(0);
    fireEvent.click(screen.getByRole("button", { name: "Play carousel" }));
    await act(() => vi.advanceTimersByTimeAsync(CAROUSEL_INTERVAL_MS));
    expect(current()).toBe(1);
  });

  it("holds still while the mouse is over it or keyboard focus is in it, and carries on after", async () => {
    stubMotion(true);
    renderCarousel();
    const region = screen.getByRole("region", { name: "Popular right now" });
    fireEvent.pointerEnter(region, { pointerType: "mouse" });
    expect(track()).toHaveAttribute("aria-live", "polite");
    await act(() => vi.advanceTimersByTimeAsync(2 * CAROUSEL_INTERVAL_MS));
    expect(current()).toBe(0);
    fireEvent.pointerLeave(region, { pointerType: "mouse" });
    await act(() => vi.advanceTimersByTimeAsync(CAROUSEL_INTERVAL_MS));
    expect(current()).toBe(1);

    const details = within(slides()[1]).getByRole("link", { name: "Details: Event free" });
    act(() => details.focus());
    await act(() => vi.advanceTimersByTimeAsync(2 * CAROUSEL_INTERVAL_MS));
    expect(current()).toBe(1);
    expect(details).toHaveFocus();
    act(() => details.blur());
    await act(() => vi.advanceTimersByTimeAsync(CAROUSEL_INTERVAL_MS));
    expect(current()).toBe(2);
  });

  it("Play pressed from the keyboard plays: focus on Pause/Play doesn't hold it", async () => {
    stubMotion(true);
    renderCarousel();
    const pause = screen.getByRole("button", { name: "Pause carousel" });
    act(() => pause.focus());
    fireEvent.click(pause);
    const play = screen.getByRole("button", { name: "Play carousel" });
    expect(play).toHaveFocus();
    fireEvent.click(play);
    await act(() => vi.advanceTimersByTimeAsync(CAROUSEL_INTERVAL_MS));
    expect(current()).toBe(1);
    expect(screen.getByRole("button", { name: "Pause carousel" })).toHaveFocus();
  });

  it("under reduced motion (and in the server render): never moves by itself, has no Pause, and its live region is polite", async () => {
    stubMotion(false);
    renderCarousel();
    expect(screen.queryByRole("button", { name: /Pause carousel|Play carousel/ })).toBeNull();
    expect(track()).toHaveAttribute("aria-live", "polite");
    await act(() => vi.advanceTimersByTimeAsync(5 * CAROUSEL_INTERVAL_MS));
    expect(current()).toBe(0);
    expect(scrollTo).not.toHaveBeenCalled();
    // Next jumps without a smooth glide.
    fireEvent.click(screen.getByRole("button", { name: "Next slide" }));
    expect(scrollTo).toHaveBeenLastCalledWith({ left: track().clientWidth, behavior: "auto" });
  });

  it("with one event: one slide and no controls", () => {
    stubMotion(true);
    renderCarousel([PAID]);
    expect(slides()).toHaveLength(1);
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("puts its controls first in the DOM, drawn under the photo, and over its bottom-right in white from 1024px; 48px targets below md, 40px from md", () => {
    stubMotion(true);
    const { container } = renderCarousel();
    const controls = container.querySelector("[data-carousel-controls]");
    expect(controls).toHaveClass("order-last", "mt-4", "lg:absolute", "lg:right-6", "lg:bottom-6");
    // Before the slides in reading and Tab order (the WAI carousel pattern).
    expect((controls?.compareDocumentPosition(track()) ?? 0) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    for (const name of ["Pause carousel", "Previous slide", "Next slide"]) {
      expect(screen.getByRole("button", { name })).toHaveClass("size-12", "md:size-10", "lg:bg-paper", "lg:text-ink");
    }
    // Each dot's target is at least 24px.
    for (const dot of within(screen.getByRole("list", { name: "Slides" })).getAllByRole("button")) expect(dot).toHaveClass("size-6");
  });

  it("a slide is square on phones, 2:1 from 640px and 7:2 from 1024px (the owner: show more on first open), with its panel in the flow (so long words grow it rather than being cut off)", () => {
    renderCarousel();
    const slide = slides()[0];
    expect(slide).toHaveClass("aspect-square", "sm:aspect-[2/1]", "lg:aspect-[7/2]", "flex", "flex-col", "justify-end");
    // Nothing clips the slide itself: only the photo's own box does.
    expect(slide).not.toHaveClass("overflow-hidden");
    const panel = slide.querySelector("[data-slide-panel]");
    expect(panel).not.toHaveClass("absolute");
    expect(panel).toHaveClass("md:p-6");
    expect(panel).not.toHaveClass("lg:p-8");
    expect(slide.querySelector(".absolute.inset-0.overflow-hidden img, .absolute.inset-0.overflow-hidden svg")).not.toBeNull();
  });

  it("a touch on it stops it (the visitor has taken over); a mouse press doesn't", async () => {
    stubMotion(true);
    renderCarousel();
    const region = screen.getByRole("region", { name: "Popular right now" });
    fireEvent.pointerDown(region, { pointerType: "mouse" });
    expect(screen.getByRole("button", { name: "Pause carousel" })).toBeInTheDocument();
    fireEvent.pointerDown(region, { pointerType: "touch" });
    expect(screen.getByRole("button", { name: "Play carousel" })).toBeInTheDocument();
    await act(() => vi.advanceTimersByTimeAsync(2 * CAROUSEL_INTERVAL_MS));
    expect(current()).toBe(0);
  });

  it("a scroll it didn't make (a swipe, a trackpad) stops it; its own scrolls don't", async () => {
    stubMotion(true);
    renderCarousel();
    // Its own move: the scroll that follows doesn't stop it.
    await act(() => vi.advanceTimersByTimeAsync(CAROUSEL_INTERVAL_MS));
    fireEvent.scroll(track());
    expect(screen.getByRole("button", { name: "Pause carousel" })).toBeInTheDocument();
    // Settled (the rest timer), then a scroll the visitor made.
    await act(() => vi.advanceTimersByTimeAsync(200));
    fireEvent.scroll(track());
    expect(screen.getByRole("button", { name: "Play carousel" })).toBeInTheDocument();
  });

  it("new slides start again from the first", () => {
    stubMotion(false);
    const { rerender } = renderCarousel();
    fireEvent.click(screen.getByRole("button", { name: "Next slide" }));
    fireEvent.click(screen.getByRole("button", { name: "Next slide" }));
    expect(current()).toBe(2);
    rerender(<FeaturedCarousel id="home-featured" title="Popular right now" events={[FREE, PAID]} now={NOW} />);
    expect(current()).toBe(0);
    expect(slides()).toHaveLength(2);
  });
});
