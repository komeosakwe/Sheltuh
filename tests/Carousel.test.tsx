// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Carousel, { CarouselItem } from "@/components/ui/Carousel";

/** jsdom has no layout, so give the rail fake scroll metrics. */
function setMetrics(el: HTMLElement, { scrollWidth, clientWidth, scrollLeft }: Record<string, number>) {
  Object.defineProperty(el, "scrollWidth", { configurable: true, value: scrollWidth });
  Object.defineProperty(el, "clientWidth", { configurable: true, value: clientWidth });
  el.scrollLeft = scrollLeft;
}

function stubMatchMedia(reducedMotion: boolean) {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: reducedMotion && query.includes("prefers-reduced-motion"),
    media: query,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  })) as unknown as typeof window.matchMedia;
}

function renderCarousel(props: { autoScroll?: boolean } = {}) {
  return render(
    <Carousel label="Events" {...props}>
      <CarouselItem>one</CarouselItem>
      <CarouselItem>two</CarouselItem>
    </Carousel>,
  );
}

beforeEach(() => {
  // Never run the animation loop for real in these tests.
  vi.spyOn(window, "requestAnimationFrame").mockImplementation(() => 0);
  Element.prototype.scrollBy = vi.fn() as unknown as typeof Element.prototype.scrollBy;
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  // @ts-expect-error -- remove the stub so other tests see jsdom's real (absent) matchMedia
  delete window.matchMedia;
});

describe("Carousel arrows", () => {
  it("are labelled, and stay focusable (aria-disabled) at the ends", () => {
    stubMatchMedia(false);
    renderCarousel();
    const region = screen.getByRole("region", { name: "Events" });
    setMetrics(region, { scrollWidth: 3000, clientWidth: 1000, scrollLeft: 0 });
    act(() => void fireEvent.scroll(region));

    const prev = screen.getByRole("button", { name: "Previous events" });
    const next = screen.getByRole("button", { name: "Next events" });
    expect(prev).toHaveAttribute("aria-disabled", "true");
    expect(prev).not.toBeDisabled(); // still in the tab order
    expect(next).toHaveAttribute("aria-disabled", "false");

    setMetrics(region, { scrollWidth: 3000, clientWidth: 1000, scrollLeft: 2000 });
    act(() => void fireEvent.scroll(region));
    expect(prev).toHaveAttribute("aria-disabled", "false");
    expect(next).toHaveAttribute("aria-disabled", "true");
  });

  it("scroll by about a screen, and do nothing when disabled", () => {
    stubMatchMedia(false);
    renderCarousel();
    const region = screen.getByRole("region", { name: "Events" });
    setMetrics(region, { scrollWidth: 3000, clientWidth: 1000, scrollLeft: 0 });
    act(() => void fireEvent.scroll(region));

    fireEvent.click(screen.getByRole("button", { name: "Previous events" })); // disabled at the start
    expect(region.scrollBy).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Next events" }));
    expect(region.scrollBy).toHaveBeenCalledWith({ left: 800, behavior: "smooth" });
  });

  it("jump instead of animating for people who prefer reduced motion", () => {
    stubMatchMedia(true);
    renderCarousel();
    const region = screen.getByRole("region", { name: "Events" });
    setMetrics(region, { scrollWidth: 3000, clientWidth: 1000, scrollLeft: 0 });
    act(() => void fireEvent.scroll(region));
    fireEvent.click(screen.getByRole("button", { name: "Next events" }));
    expect(region.scrollBy).toHaveBeenCalledWith({ left: 800, behavior: "auto" });
  });
});

describe("Carousel auto-drift controls", () => {
  it("offers a Pause/Play button that toggles, so moving content can be stopped (WCAG 2.2.2)", () => {
    stubMatchMedia(false);
    renderCarousel({ autoScroll: true });
    const pause = screen.getByRole("button", { name: /^pause automatic scrolling/i });
    fireEvent.click(pause);
    const play = screen.getByRole("button", { name: /^play automatic scrolling/i });
    fireEvent.click(play);
    expect(screen.getByRole("button", { name: /^pause automatic scrolling/i })).toBeInTheDocument();
  });

  it("stops for good when the carousel is clicked, until Play is pressed", () => {
    stubMatchMedia(false);
    renderCarousel({ autoScroll: true });
    fireEvent.click(screen.getByRole("region", { name: "Events" }));
    expect(screen.getByRole("button", { name: /^play automatic scrolling/i })).toBeInTheDocument();
  });

  it("clicking an arrow also stops the drift", () => {
    stubMatchMedia(false);
    renderCarousel({ autoScroll: true });
    fireEvent.click(screen.getByRole("button", { name: "Next events" }));
    expect(screen.getByRole("button", { name: /^play automatic scrolling/i })).toBeInTheDocument();
  });

  it("has no drift and no Pause button for people who prefer reduced motion", () => {
    stubMatchMedia(true);
    renderCarousel({ autoScroll: true });
    expect(screen.queryByRole("button", { name: /automatic scrolling/i })).not.toBeInTheDocument();
  });

  it("has no Pause button when auto-scroll isn't requested", () => {
    stubMatchMedia(false);
    renderCarousel();
    expect(screen.queryByRole("button", { name: /automatic scrolling/i })).not.toBeInTheDocument();
  });
});
