// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import FeaturedCarousel, { CAROUSEL_INTERVAL_MS, CAROUSEL_MAX } from "@/components/home/FeaturedCarousel";
import { slideFacts } from "@/lib/event-card";
import { formatCardPriceLabel } from "@/lib/pricing";
import { BANNER_COVER_PHOTO_SIZES, BANNER_PHOTO_SIZES } from "@/lib/responsive-image";
import type { SheltuhEvent } from "@/lib/types";

/** The featured banner (the proposal's banner, redesign PR 3; Round 2 §1.1; the WAI carousel pattern). */

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
const dots = () => within(screen.getByRole("list", { name: "Slides" })).getAllByRole("button");

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

  // Round 2 §1.1: category · title · date · venue · the ticket action. No time, no price, no Details.
  it("each slide: the category alone (never 'Featured'), the title, 'date · venue', and the event's own ticket action; no time, price or Details", () => {
    const { container } = renderCarousel();
    const [paid, free, sold] = slides();
    expect(container).not.toHaveTextContent(/Featured/i);
    expect(within(paid).getByText("Live music")).toHaveClass("mono-s", "text-foreground");
    expect(within(paid).getByText("Live music").className).not.toMatch(/uppercase|text-signal/);
    expect(within(paid).getByRole("heading", { level: 3, name: "Event paid" })).toBeInTheDocument();
    // "Sun 15 Nov · Northcote Theatre", as written.
    const facts = paid.querySelector("[data-slide-facts]") as HTMLElement;
    expect(facts).toHaveTextContent(/^Sun 15 Nov · Northcote Theatre$/);
    expect(facts).toHaveClass("body-m", "tabular-nums");
    expect(facts.className).not.toMatch(/uppercase|font-mono/);
    const price = formatCardPriceLabel(PAID) ?? "";
    expect(price).toMatch(/^From A\$|^A\$/);
    expect(paid).not.toHaveTextContent(price);
    expect(paid).not.toHaveTextContent(/7pm|7:00/);
    // The ticket action says what the card would ("Buy tickets", "Free tickets", "Join waitlist"), named with the event.
    expect(within(paid).getByRole("link", { name: "Buy tickets: Event paid" })).toHaveAttribute("href", "/events/paid#tickets");
    expect(within(paid).getByRole("link", { name: "Buy tickets: Event paid" })).toHaveClass("btn-signal");
    expect(within(free).getByRole("link", { name: "Free tickets: Event free" })).toBeInTheDocument();
    // A waitlist isn't a purchase: outlined, never orange.
    expect(within(sold).getByRole("link", { name: "Join waitlist: Event sold" })).toHaveClass("btn-outline");
    expect(within(sold).queryByText(/Sold out/)).toBeNull();
    expect(screen.queryByRole("link", { name: /^Details/ })).toBeNull();
  });

  it("dates an event already on as running, and falls back to the place when there's no venue", () => {
    const running = event("on", { startsAt: "2026-10-20T00:00:00.000Z", endsAt: "2026-10-25T08:00:00.000Z" });
    expect(slideFacts(running, NOW)).toBe("Now on · until Sun 25 Oct · Northcote Theatre");
    expect(slideFacts(event("nv", { venueName: "  " }), NOW)).toBe("Sun 15 Nov · Northcote, VIC");
    expect(slideFacts(event("none", { venueName: "", suburb: "" }), NOW)).toBe("Sun 15 Nov");
  });

  // Owner rule: the whole banner opens the event through one stretched title link; the ticket action is a
  // sibling above it, never nested in a link.
  it("stretches the title's link over the slide; the ticket action is a raised sibling, and nothing interactive is nested", () => {
    renderCarousel();
    const [paid] = slides();
    const link = within(paid).getByRole("link", { name: "Event paid" });
    expect(link).toHaveAttribute("href", "/events/paid");
    expect(link).toHaveAttribute("data-banner-link");
    expect(link).toHaveClass("after:absolute", "after:inset-0", "after:z-0", "after:rounded-card", "after:content-['']");
    // The stretch reaches the slide: nothing between the link and the slide is positioned (the words' box, nor the scrim around it).
    const content = paid.querySelector("[data-slide-content]") as HTMLElement;
    expect(content.className).not.toMatch(/(?:^|\s)(relative|absolute|fixed|sticky)(?:\s|$)/);
    const scrim = paid.querySelector("[data-slide-scrim]") as HTMLElement;
    expect(scrim.className).not.toMatch(/(?:^|\s)(relative|absolute|fixed|sticky)(?:\s|$)/);
    expect(paid).toHaveClass("relative", "isolate");
    const buy = within(paid).getByRole("link", { name: "Buy tickets: Event paid" });
    expect(link.contains(buy)).toBe(false);
    expect(buy.contains(link)).toBe(false);
    expect(buy).toHaveClass("relative", "z-10", "self-start");
    for (const a of document.querySelectorAll("a")) expect(a.querySelector("a, button")).toBeNull();
    // Only the title and the ticket action are links on a slide.
    expect(within(paid).getAllByRole("link")).toEqual([link, buy]);
  });

  it("underlines the title when the slide is hovered or the link has keyboard focus; the title is title-banner, as entered", () => {
    renderCarousel([event("mixed", { title: "Baby Keem at the Forum" }), PAID]);
    const [slide] = slides();
    expect(slide).toHaveClass("group/slide");
    const link = within(slide).getByRole("link", { name: "Baby Keem at the Forum" });
    expect(link).toHaveClass("underline", "decoration-transparent", "group-hover/slide:decoration-current", "focus-visible:decoration-current");
    const h3 = within(slide).getByRole("heading", { level: 3 });
    expect(h3).toHaveClass("title-banner");
    // Clamped on the link, so the h3's overflow never clips the link's focus ring; the link isn't positioned.
    expect(h3.className).not.toMatch(/line-clamp|overflow/);
    expect(link).toHaveClass("line-clamp-2", "break-words");
    expect(link.className).not.toMatch(/(?:^|\s)(relative|absolute)(?:\s|$)/);
    // Round 2 §1.7: never upper-cased by CSS.
    for (const el of [h3, link]) expect(el.className).not.toMatch(/uppercase/);
    expect(h3).toHaveTextContent("Baby Keem at the Forum");
  });

  it("is Buy tickets M (48) below 1440px and L (56) from it", () => {
    renderCarousel();
    const buy = within(slides()[0]).getByRole("link", { name: "Buy tickets: Event paid" });
    expect(buy).toHaveClass("btn", "btn-signal", "min-[90rem]:min-h-14", "min-[90rem]:px-8");
    expect(buy).not.toHaveClass("btn-lg");
  });

  it("tabs Pause, the dots, then the current slide's title and its ticket action", () => {
    stubMotion(true);
    renderCarousel();
    const focusable = Array.from(document.querySelectorAll<HTMLElement>("a[href], button")).filter((el) => !el.closest("[inert]"));
    expect(focusable.map((el) => el.getAttribute("aria-label") ?? el.textContent)).toEqual([
      "Pause carousel",
      "Slide 1: Event paid",
      "Slide 2: Event free",
      "Slide 3: Event sold",
      "Event paid",
      "Buy tickets: Event paid",
    ]);
  });

  it(`shows at most ${CAROUSEL_MAX} slides, and nothing at all with no events`, () => {
    renderCarousel(Array.from({ length: 8 }, (_, i) => event(`e${i}`)));
    expect(slides()).toHaveLength(CAROUSEL_MAX);
    cleanup();
    const { container } = renderCarousel([]);
    expect(container).toBeEmptyDOMElement();
  });

  it("has no Previous or Next (Round 2: dots and Pause only); the dots go straight to a slide, stop it, and say which is current", () => {
    stubMotion(true);
    renderCarousel();
    expect(screen.queryByRole("button", { name: /Previous slide|Next slide/ })).toBeNull();
    // jsdom lays nothing out: give the track a width, so a scroll that always went to 0 would fail.
    Object.defineProperty(track(), "clientWidth", { configurable: true, value: 640 });
    expect(dots().map((dot) => dot.getAttribute("aria-label"))).toEqual(["Slide 1: Event paid", "Slide 2: Event free", "Slide 3: Event sold"]);
    expect(dots().map((dot) => dot.getAttribute("aria-current"))).toEqual(["true", null, null]);
    fireEvent.click(dots()[1]);
    expect(current()).toBe(1);
    expect(slides().map((slide) => slide.hasAttribute("inert"))).toEqual([true, false, true]);
    expect(scrollTo).toHaveBeenLastCalledWith({ left: 640, behavior: "smooth" });
    // The visitor took over: it no longer plays.
    expect(screen.getByRole("button", { name: "Play carousel" })).toBeInTheDocument();
    fireEvent.click(dots()[2]);
    expect(current()).toBe(2);
    expect(scrollTo).toHaveBeenLastCalledWith({ left: 2 * 640, behavior: "smooth" });
    expect(dots().map((dot) => dot.getAttribute("aria-current"))).toEqual([null, null, "true"]);
    for (const control of [...dots(), screen.getByRole("button", { name: "Play carousel" })]) expect(control).toHaveAttribute("aria-controls", "home-featured-slides");
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

    // Keyboard focus on the title's link (or the ticket action, or a dot) holds it too.
    const title = within(slides()[1]).getByRole("link", { name: "Event free" });
    act(() => title.focus());
    await act(() => vi.advanceTimersByTimeAsync(2 * CAROUSEL_INTERVAL_MS));
    expect(current()).toBe(1);
    expect(title).toHaveFocus();
    act(() => title.blur());
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
    // A dot jumps without a smooth glide.
    fireEvent.click(dots()[1]);
    expect(scrollTo).toHaveBeenLastCalledWith({ left: track().clientWidth, behavior: "auto" });
  });

  it("with one event: one slide and no controls", () => {
    stubMotion(true);
    renderCarousel([PAID]);
    expect(slides()).toHaveLength(1);
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("puts its controls first in the DOM, Pause then the dots, over the photo's bottom-right at every width, white in both themes; 48px Pause below md, 40px from md", () => {
    stubMotion(true);
    const { container } = renderCarousel();
    const controls = container.querySelector("[data-carousel-controls]") as HTMLElement;
    expect(controls).toHaveClass("absolute", "right-6", "bottom-6", "z-10", "md:right-8", "md:bottom-8", "lg:right-12", "lg:bottom-12", "[--foreground:var(--paper)]");
    expect(controls.className).not.toMatch(/order-|mt-4|lg:absolute/);
    // Before the slides in reading and Tab order (the WAI carousel pattern), Pause first.
    expect((controls.compareDocumentPosition(track()) ?? 0) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    const pause = screen.getByRole("button", { name: "Pause carousel" });
    expect(controls.firstElementChild).toBe(pause);
    expect(pause).toHaveClass("size-12", "md:size-10", "rounded-control", "border-control", "border-ink", "bg-paper", "text-ink", "hover:bg-hover", "focus-visible:bg-hover");
    // The dots on a white pill at every width; their focus rings black on it.
    const pill = screen.getByRole("list", { name: "Slides" });
    expect(pill).toHaveClass("h-10", "rounded-control", "bg-paper", "px-2", "[--foreground:var(--ink)]");
    expect(pill.className).not.toMatch(/lg:/);
    // Each dot's target is at least 24px; hover and keyboard focus both darken an inactive dot.
    for (const dot of dots()) expect(dot).toHaveClass("size-6", "group/dot");
    const inactive = dots()[1].firstElementChild as HTMLElement;
    expect(inactive).toHaveClass("w-2", "bg-ink/60", "group-hover/dot:bg-ink", "group-focus-visible/dot:bg-ink");
    expect(dots()[0].firstElementChild).toHaveClass("w-6", "bg-signal");
  });

  it("a slide is 4:5 below 640px, 2:1 from 640px and 5:2 from 1024px, with its words in the flow (so long words grow it rather than being cut off)", () => {
    renderCarousel();
    const slide = slides()[0];
    expect(slide).toHaveClass("aspect-[4/5]", "sm:aspect-[2/1]", "lg:aspect-[5/2]", "flex", "flex-col", "justify-end");
    // Nothing clips the slide itself: only the photo's own box does.
    expect(slide).not.toHaveClass("overflow-hidden");
    const content = slide.querySelector("[data-slide-content]") as HTMLElement;
    expect(content).not.toHaveClass("absolute");
    expect(slide.querySelector("[data-slide-scrim]")).not.toHaveClass("absolute");
    expect(slide.querySelector(".absolute.inset-0.overflow-hidden img, .absolute.inset-0.overflow-hidden svg")).not.toBeNull();
  });

  // Round 2 §1.1: no box. The ink scope on the slide (black under the photo), a soft shade over it, and the words straight on
  // a scrim that fades in around them (Round 2 Part 2: the photo above the words lighter; every line on 60% ink or more).
  it("has no text box: the slide is the ink scope, a soft shade, then a full-width scrim around the words with 24/32/48px padding and stepped widths", () => {
    renderCarousel();
    const slide = slides()[0];
    expect(slide).toHaveAttribute("data-surface", "ink");
    expect(slide.querySelector("[data-slide-panel]")).toBeNull();
    const content = slide.querySelector("[data-slide-content]") as HTMLElement;
    expect(content).not.toHaveAttribute("data-surface");
    expect(content.className).not.toMatch(/bg-/);
    // No top padding of its own: the scrim's 6rem fade is above the words.
    expect(content).toHaveClass("px-6", "pb-22", "sm:pb-6", "md:px-8", "md:pb-8", "lg:px-12", "lg:pb-12", "md:max-w-md", "lg:max-w-xl", "xl:max-w-2xl");
    expect(content.className).not.toMatch(/(?:^|\s)(?:\w+:)?(?:p|pt|py)-/);
    const scrim = slide.querySelector("[data-slide-scrim]") as HTMLElement;
    expect(scrim).toHaveClass("banner-scrim", "rounded-b-card", "pt-24");
    // Full width: no max width of its own (the words' box has that).
    expect(scrim.className).not.toMatch(/max-w-/);
    expect(scrim.firstElementChild).toBe(content);
    const shade = slide.querySelector("[data-slide-shade]") as HTMLElement;
    expect(shade).toHaveAttribute("aria-hidden", "true");
    // Light: clear for the top 35%, at most 30% ink at the bottom.
    expect(shade).toHaveClass("absolute", "inset-0", "-z-10", "bg-linear-to-b", "from-transparent", "from-35%", "to-ink/30");
    expect(shade.className).not.toMatch(/via-|ink\/(?:[4-9]\d|100)/);
    // The photo, then the shade over it, then the scrim with the words.
    const art = slide.firstElementChild as HTMLElement;
    expect(art).toHaveClass("absolute", "inset-0", "-z-10", "overflow-hidden");
    expect(art.nextElementSibling).toBe(shade);
    expect(shade.nextElementSibling).toBe(scrim);
  });

  it("biases the photo's crop upward on wider slides when the event has no focal point; an imageFocus still wins", () => {
    renderCarousel([event("photo", { imageUrl: "/photo.jpg" }), event("focus", { imageUrl: "/focus.jpg", imageFocus: { x: 20, y: 70 } })]);
    const [plain, focused] = slides().map((slide) => slide.querySelector("img") as HTMLImageElement);
    expect(plain).toHaveClass("object-[50%_50%]", "sm:object-[50%_40%]", "lg:object-[50%_35%]");
    expect(focused.className).not.toMatch(/object-\[/);
    expect(focused.style.objectPosition).toBe("20% 70%");
  });

  it("shows the whole photo (contained on its backdrop, no focal defaults) when the event's banner fit is whole", () => {
    renderCarousel([
      event("whole", { imageUrl: "/whole.jpg", bannerFit: "whole" }),
      event("whole-focus", { imageUrl: "/whole-focus.jpg", bannerFit: "whole", imageFocus: { x: 20, y: 70 } }),
      event("crop", { imageUrl: "/crop.jpg" }),
    ]);
    const [whole, wholeFocus, crop] = slides();
    // The backdrop waits for its photo to load (EventArt: a lazy slide's photo isn't fetched early by it).
    expect(whole.querySelector("[data-art-backdrop]")).toBeNull();
    for (const slide of [whole, wholeFocus, crop]) {
      const img = slide.querySelector("img") as HTMLImageElement;
      Object.defineProperty(img, "naturalWidth", { value: 1600 });
      Object.defineProperty(img, "naturalHeight", { value: 900 });
      fireEvent.load(img);
    }
    const wholeImg = whole.querySelector("img") as HTMLImageElement;
    expect(wholeImg).toHaveClass("object-contain");
    expect(wholeImg.className).not.toMatch(/object-\[/);
    // On a phone's 4:5 slide the whole photo sits at the top, clear of the words; centred from 640px.
    expect(wholeImg).toHaveClass("max-sm:object-top");
    expect(whole.querySelector("[data-art-backdrop]")).not.toBeNull();
    const focusImg = wholeFocus.querySelector("img") as HTMLImageElement;
    expect(focusImg).toHaveClass("object-contain");
    expect(focusImg.style.objectPosition).toBe("");
    expect((wholeFocus.querySelector("[data-art-backdrop]") as HTMLElement).style.backgroundPosition).toBe("20% 70%");
    const cropImg = crop.querySelector("img") as HTMLImageElement;
    expect(cropImg).toHaveClass("object-cover", "object-[50%_50%]");
    expect(crop.querySelector("[data-art-backdrop]")).toBeNull();
  });

  it("asks for a stock photo at its drawn width: wider than a phone's 4:5 slide when it's cropped to fill, the slide's own when it's whole", () => {
    renderCarousel([event("crop", { imageUrl: "/events/street-market.jpg" }), event("whole", { imageUrl: "/events/street-market.jpg", bannerFit: "whole" })]);
    const [crop, whole] = slides().map((slide) => slide.querySelector("img") as HTMLImageElement);
    expect(crop).toHaveAttribute("sizes", BANNER_COVER_PHOTO_SIZES);
    expect(BANNER_COVER_PHOTO_SIZES).toMatch(/, calc\(\(100vw - 2rem\) \* 1\.875\)$/);
    expect(whole).toHaveAttribute("sizes", BANNER_PHOTO_SIZES);
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

  // PR 54 CI: a smooth glide on a busy runner paused past the rest timer, and the rest of it read as a swipe.
  it("its own glide stays its own through a pause mid-way; only a scroll after it arrives stops it", async () => {
    stubMotion(true);
    renderCarousel();
    const el = track();
    Object.defineProperty(el, "clientWidth", { configurable: true, value: 640 });
    let left = 0;
    Object.defineProperty(el, "scrollLeft", { configurable: true, get: () => left });
    await act(() => vi.advanceTimersByTimeAsync(CAROUSEL_INTERVAL_MS));
    expect(scrollTo).toHaveBeenLastCalledWith({ left: 640, behavior: "smooth" });
    left = 300;
    fireEvent.scroll(el);
    // The glide stalls longer than the rest timer, then carries on.
    await act(() => vi.advanceTimersByTimeAsync(200));
    left = 500;
    fireEvent.scroll(el);
    expect(screen.getByRole("button", { name: "Pause carousel" })).toBeInTheDocument();
    left = 640;
    fireEvent.scroll(el);
    await act(() => vi.advanceTimersByTimeAsync(200));
    expect(screen.getByRole("button", { name: "Pause carousel" })).toBeInTheDocument();
    expect(current()).toBe(1);
    // Arrived: now a scroll is the visitor's.
    left = 700;
    fireEvent.scroll(el);
    expect(screen.getByRole("button", { name: "Play carousel" })).toBeInTheDocument();
  });

  it("a swipe that cuts its own glide short is the visitor's: once the glide's window ends it stops on the slide swiped to", async () => {
    stubMotion(true);
    renderCarousel();
    const el = track();
    Object.defineProperty(el, "clientWidth", { configurable: true, value: 640 });
    let left = 0;
    Object.defineProperty(el, "scrollLeft", { configurable: true, get: () => left });
    await act(() => vi.advanceTimersByTimeAsync(CAROUSEL_INTERVAL_MS));
    expect(scrollTo).toHaveBeenLastCalledWith({ left: 640, behavior: "smooth" });
    // The visitor drags it back to the first slide mid-glide; the scroll ends there and nothing else scrolls.
    left = 200;
    fireEvent.scroll(el);
    left = 0;
    fireEvent.scroll(el);
    fireEvent(el, new Event("scrollend"));
    await act(() => vi.advanceTimersByTimeAsync(1100));
    expect(screen.getByRole("button", { name: "Play carousel" })).toBeInTheDocument();
    expect(current()).toBe(0);
  });

  it("new slides start again from the first", () => {
    stubMotion(false);
    const { rerender } = renderCarousel();
    fireEvent.click(dots()[2]);
    expect(current()).toBe(2);
    rerender(<FeaturedCarousel id="home-featured" title="Popular right now" events={[FREE, PAID]} now={NOW} />);
    expect(current()).toBe(0);
    expect(slides()).toHaveLength(2);
  });
});
