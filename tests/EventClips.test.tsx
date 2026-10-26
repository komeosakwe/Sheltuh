// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import EventDetailsView from "@/components/EventDetailsView";
import ClipPlayButton from "@/components/events/ClipPlayButton";
import { CLIP_ERROR_TEXT, CLIP_LOADER_DELAY_MS, ClipViewerProvider } from "@/components/events/ClipViewer";
import { FavouritesProvider } from "@/components/favourites/FavouritesProvider";
import { HomeRailItem } from "@/components/home/HomeRail";
import HomeRailSection from "@/components/home/HomeRailSection";
import EventCard from "@/components/ui/EventCard";
import { clipPlayName, clipTimeLabel } from "@/lib/clip-display";
import { sampleEvents } from "@/lib/sample-events";
import type { SheltuhEvent } from "@/lib/types";
import { FakeAuthProvider, fakeAuthValue } from "./test-utils/fakeAuth";

/**
 * Event clips on the public pages (docs/design/event-clips.md §5.1–§5.3):
 * a real Play button over an event's image (cards and the event page),
 * outside the card's link, in the tab order between the link and Save; and
 * the page's one viewer (SeatDialog), whose video exists only while it's
 * open, muted with controls and inline, plays on opening except under
 * reduced motion, describes itself, shows an error with Try again, and puts
 * focus back on closing (on the real card when a rail copy opened it).
 */

vi.mock("next/navigation", () => ({
  usePathname: () => "/",
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

const NOW = new Date("2026-10-01T00:00:00.000Z");
const CLIP = {
  url: "/api/events/evt-1/clip?v=1761000000000",
  durationMs: 12_400,
  width: 1080,
  height: 1920,
  description: "Two singers trade verses under green lights while the crowd claps.",
};
const base = sampleEvents.find((e) => e.slug === "neon-static") as SheltuhEvent;
const event: SheltuhEvent = {
  ...base,
  id: "evt-1",
  title: "Glasshouse Sessions",
  imageUrl: "/events/glasshouse.jpg",
  startsAt: "2026-10-18T08:00:00.000Z",
  endsAt: "2026-10-18T11:00:00.000Z",
  clip: CLIP,
};

let play: ReturnType<typeof vi.fn>;
function stubMotion(reduce: boolean) {
  vi.stubGlobal(
    "matchMedia",
    vi.fn().mockImplementation((query: string) => ({
      matches: query.includes("no-preference") ? !reduce : query.includes("reduce") ? reduce : false,
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    })),
  );
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
  vi.setSystemTime(NOW);
  localStorage.clear();
  stubMotion(false);
  HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement) {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close = function close(this: HTMLDialogElement) {
    this.removeAttribute("open");
  };
  play = vi.fn().mockResolvedValue(undefined);
  HTMLMediaElement.prototype.play = play as unknown as HTMLMediaElement["play"];
  HTMLMediaElement.prototype.pause = vi.fn();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function withProviders(children: ReactNode) {
  return render(
    <FakeAuthProvider value={fakeAuthValue({ configured: false, status: "signed-out" })}>
      <FavouritesProvider>
        <ClipViewerProvider>{children}</ClipViewerProvider>
      </FavouritesProvider>
    </FakeAuthProvider>,
  );
}

const playButton = () => screen.getByRole("button", { name: "Play clip: Glasshouse Sessions, 0:12" });
const dialog = () => document.querySelector("dialog") as HTMLDialogElement;
const video = () => document.querySelector("dialog video") as HTMLVideoElement | null;

describe("the Play button (§5.1)", () => {
  it("names the clip with its length, shows 0:12 (in the name: no aria-label), and opens a dialog", () => {
    withProviders(<EventCard event={event} variant="rail" mode="demo" />);
    const button = playButton();
    // Label in Name: visually hidden words before the visible length, never an aria-label over it.
    expect(button).not.toHaveAttribute("aria-label");
    expect(button.querySelector(".sr-only")).toHaveTextContent("Play clip: Glasshouse Sessions,");
    expect(button).toHaveAttribute("type", "button");
    expect(button).toHaveAttribute("aria-haspopup", "dialog");
    expect(button).toHaveAttribute("data-clip-play", "evt-1");
    expect(button).toHaveTextContent("0:12");
    // The glyph is an SVG, never the ▶ character (an emoji on iOS).
    expect(button.textContent).not.toContain("▶");
    expect(button.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
  });

  it("names every Play control the same way, the visible words included", () => {
    expect(clipPlayName("Gig", 12_400)).toBe("Play clip: Gig, 0:12");
  });

  it("rounds to whole seconds, at least 1 and at most 15", () => {
    expect(clipTimeLabel(600)).toBe("0:01");
    expect(clipTimeLabel(15_400)).toBe("0:15");
    expect(clipTimeLabel(5_200)).toBe("0:05");
    expect(clipTimeLabel(15_500)).toBe("0:15");
  });

  it("only shows for an event with a clip, and only with the viewer on the page", () => {
    const { unmount } = withProviders(<EventCard event={{ ...event, clip: undefined }} variant="grid" mode="demo" />);
    expect(screen.queryByRole("button", { name: /^Play clip/ })).toBeNull();
    expect(document.querySelector("[data-clip-frame]")).toBeNull();
    unmount();
    render(<ClipPlayButton event={event} />);
    expect(screen.queryByRole("button", { name: /^Play clip/ })).toBeNull();
  });

  it.each(["rail", "grid"] as const)("%s: outside the card's link, between the link and Save in the tab order", (variant) => {
    const { container } = withProviders(<EventCard event={event} variant={variant} mode="demo" />);
    const link = screen.getByRole("link", { name: /^Glasshouse Sessions/ });
    const button = playButton();
    expect(link.contains(button)).toBe(false);
    expect(button.closest("[aria-hidden='true']")).toBeNull();
    const focusables = Array.from(
      container.querySelectorAll<HTMLElement>("[data-event-card] a[href], [data-event-card] button"),
    ).filter((el) => el.tabIndex >= 0);
    const order = focusables.map((el) => el.getAttribute("aria-label") ?? el.textContent);
    const at = (name: string) => order.findIndex((n) => n?.startsWith(name));
    expect(focusables[0]).toBe(link);
    expect(at("Play clip")).toBe(1);
    expect(at("Save Glasshouse Sessions")).toBe(2);
    // The frame repeats the image's box, at its bottom-left, and passes taps through elsewhere.
    const frame = container.querySelector("[data-clip-frame]") as HTMLElement;
    expect(frame).toHaveClass("pointer-events-none", "absolute", variant === "rail" ? "aspect-[4/3]" : "aspect-square");
    // The 36px chip 8px in from the image's bottom-left (its 44px target 4px from the bottom).
    expect(button).toHaveClass("pointer-events-auto", "absolute", "bottom-1", "left-2", "min-h-11", "min-w-11");
    // One ring only: the page's own focus outline is dropped (!important beats the unlayered rule).
    expect(button).toHaveClass("focus-visible:outline-none!");
  });

  it("a pair's card repeats the wide image box from 1024px", () => {
    const { container } = withProviders(<EventCard event={event} variant="rail" wide mode="demo" />);
    expect(container.querySelector("[data-clip-frame]")).toHaveClass("lg:aspect-[12/5]", "lg:max-h-50");
  });

  it("an ended event's chip keeps its colour (only the image is greyed)", () => {
    vi.setSystemTime(new Date("2026-11-01T00:00:00.000Z"));
    withProviders(<EventCard event={event} variant="grid" mode="demo" />);
    expect(playButton().closest(".grayscale")).toBeNull();
  });
});

describe("the viewer (§5.2)", () => {
  it("loads nothing until Play is pressed; then a muted, inline video with controls, the photo as poster, described", () => {
    withProviders(<EventCard event={event} variant="rail" mode="demo" />);
    expect(video()).toBeNull();
    expect(document.querySelector("video")).toBeNull();
    fireEvent.click(playButton());

    expect(dialog()).toHaveAttribute("open");
    expect(within(dialog()).getByRole("heading", { name: "Glasshouse Sessions" })).toHaveFocus();
    const v = video();
    if (!v) throw new Error("no video");
    expect(v.getAttribute("src")).toBe(CLIP.url);
    expect(v.muted).toBe(true);
    expect(v).toHaveAttribute("controls");
    expect(v).toHaveAttribute("playsinline");
    expect(v).not.toHaveAttribute("loop");
    expect(v).not.toHaveAttribute("autoplay");
    expect(v).toHaveAttribute("poster", "/events/glasshouse.jpg");
    expect(v).toHaveAttribute("preload", "auto");
    expect(v).toHaveAttribute("width", "1080");
    expect(v).toHaveAttribute("height", "1920");
    // Its box is reserved from the clip's shape, as wide as fits the dialog and 80dvh less its chrome.
    expect(v.style.aspectRatio).toBe("1080 / 1920");
    expect(v.style.width).toMatch(/^min\(100%, .*0\.5625.*\(80dvh - 10rem\)/);
    expect(v).toHaveClass("mx-auto", "block", "h-auto", "object-contain");
    expect(v).not.toHaveClass("w-auto");
    expect(v).toHaveAccessibleName("Clip: Glasshouse Sessions");
    expect(v).toHaveAccessibleDescription(CLIP.description);
    expect(within(dialog()).getByText(CLIP.description)).toBeVisible();
    // It plays on opening.
    expect(play).toHaveBeenCalledTimes(1);
    // Portrait: the narrower dialog.
    expect(dialog()).toHaveClass("sm:max-w-lg");
  });

  it("a landscape clip gets the wide dialog; no photo, no poster", () => {
    withProviders(<EventCard event={{ ...event, imageUrl: undefined, clip: { ...CLIP, width: 1920, height: 1080 } }} variant="rail" mode="demo" />);
    fireEvent.click(playButton());
    expect(dialog()).toHaveClass("sm:max-w-2xl");
    expect(video()).not.toHaveAttribute("poster");
  });

  it("a clip of unknown size gets a 16:9 box instead", () => {
    withProviders(<EventCard event={{ ...event, clip: { ...CLIP, width: 0, height: 0 } }} variant="rail" mode="demo" />);
    fireEvent.click(playButton());
    expect(video()).toHaveClass("aspect-video", "w-full", "object-contain");
    expect(video()?.style.aspectRatio).toBe("");
  });

  it("under reduced motion it doesn't play by itself, and only reads the clip's header", () => {
    stubMotion(true);
    withProviders(<EventCard event={event} variant="rail" mode="demo" />);
    fireEvent.click(playButton());
    expect(video()).toHaveAttribute("preload", "metadata");
    expect(play).not.toHaveBeenCalled();
  });

  it("a refused autoplay is quiet: the controls stay", async () => {
    play.mockRejectedValueOnce(new DOMException("blocked", "NotAllowedError"));
    withProviders(<EventCard event={event} variant="rail" mode="demo" />);
    fireEvent.click(playButton());
    await act(async () => {});
    expect(video()).toHaveAttribute("controls");
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it.each(["Close", "Escape"])("%s closes it: the video goes (no more loading) and focus is back on Play", (how) => {
    withProviders(<EventCard event={event} variant="rail" mode="demo" />);
    const button = playButton();
    fireEvent.click(button);
    expect(video()).not.toBeNull();
    // Escape: the browser closes a modal dialog and fires `close`.
    if (how === "Close") fireEvent.click(within(dialog()).getByRole("button", { name: "Close" }));
    else act(() => void dialog().dispatchEvent(new Event("close")));
    expect(dialog()).not.toHaveAttribute("open");
    expect(video()).toBeNull();
    expect(button).toHaveFocus();
  });

  it("shows a loader only if the clip is slow to start, and drops it once it can play", () => {
    withProviders(<EventCard event={event} variant="rail" mode="demo" />);
    fireEvent.click(playButton());
    expect(screen.queryByText("Loading clip…")).toBeNull();
    act(() => void vi.advanceTimersByTime(CLIP_LOADER_DELAY_MS));
    expect(screen.getByText("Loading clip…")).toBeInTheDocument();
    fireEvent.canPlay(video() as HTMLVideoElement);
    expect(screen.queryByText("Loading clip…")).toBeNull();
  });

  it("an error says so, keeps the description, and Try again loads the same clip again", () => {
    withProviders(<EventCard event={event} variant="rail" mode="demo" />);
    fireEvent.click(playButton());
    const first = video() as HTMLVideoElement;
    fireEvent.error(first);
    expect(screen.getByRole("alert")).toHaveTextContent(CLIP_ERROR_TEXT);
    expect(video()).toBeNull();
    expect(within(dialog()).getByText(CLIP.description)).toBeInTheDocument();
    fireEvent.click(within(dialog()).getByRole("button", { name: "Try again" }));
    const again = video();
    expect(again).not.toBeNull();
    expect(again).not.toBe(first);
    expect(again?.getAttribute("src")).toBe(CLIP.url);
    // Focus stays in the dialog (on the new video where the browser lets it, else the title).
    expect(dialog().contains(document.activeElement)).toBe(true);
    expect(document.activeElement).not.toBe(document.body);
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("when Try again fails again, focus goes to the new Try again, never the page's body", () => {
    withProviders(<EventCard event={event} variant="rail" mode="demo" />);
    fireEvent.click(playButton());
    fireEvent.error(video() as HTMLVideoElement);
    fireEvent.click(within(dialog()).getByRole("button", { name: "Try again" }));
    const again = video() as HTMLVideoElement;
    // Focus on the video's controls, as a browser allows (jsdom doesn't count a video as focusable).
    again.setAttribute("tabindex", "-1");
    again.focus();
    expect(again).toHaveFocus();
    fireEvent.error(again);
    expect(screen.getByRole("alert")).toHaveTextContent(CLIP_ERROR_TEXT);
    expect(within(dialog()).getByRole("button", { name: "Try again" })).toHaveFocus();
  });
});

describe("rail copies (§5.1, §5.2)", () => {
  const CARD = 256;
  const events = Array.from({ length: 6 }, (_, i) => ({ ...event, id: `evt-${i}`, slug: `e-${i}`, title: `Night ${i}` }));

  function renderRail() {
    vi.spyOn(HTMLLIElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLLIElement) {
      const list = this.parentElement;
      const left = (list ? Array.from(list.children).indexOf(this) : 0) * CARD - (list?.scrollLeft ?? 0);
      return { left, right: left + CARD, width: CARD, top: 0, bottom: 300, height: 300, x: left, y: 0 } as DOMRect;
    });
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => setTimeout(() => cb(0), 16) as unknown as number);
    vi.stubGlobal("cancelAnimationFrame", (id: number) => clearTimeout(id));
    withProviders(
      <HomeRailSection id="home-popular" title="Popular right now" count={events.length}>
        {events.map((e) => (
          <HomeRailItem key={e.id}>
            <EventCard event={e} variant="rail" mode="demo" />
          </HomeRailItem>
        ))}
      </HomeRailSection>,
    );
    const rail = screen.getByRole("list", { name: "Popular right now" });
    Object.defineProperty(rail, "clientWidth", { configurable: true, value: 1000 });
    Object.defineProperty(rail, "scrollWidth", { configurable: true, get: () => rail.children.length * CARD + 40 });
    act(() => {
      fireEvent.scroll(rail);
      window.dispatchEvent(new Event("resize"));
      vi.advanceTimersByTime(32);
    });
    const copies = Array.from(rail.querySelectorAll<HTMLElement>(":scope > li[data-rail-clone]"));
    expect(copies.length).toBeGreaterThan(0);
    return copies;
  }

  it("a copy's Play is out of the tab order, yet opens the viewer; focus returns to the real card's Play", () => {
    const copies = renderRail();
    const copyPlay = copies[2].querySelector<HTMLButtonElement>("[data-clip-play]");
    if (!copyPlay) throw new Error("no Play in the copy");
    expect(copyPlay.tabIndex).toBe(-1);
    expect(copyPlay.closest("[aria-hidden='true']")).not.toBeNull();
    const real = screen.getByRole("button", { name: "Play clip: Night 2, 0:12" });

    fireEvent.click(copyPlay);
    expect(dialog()).toHaveAttribute("open");
    expect(video()?.getAttribute("src")).toBe(CLIP.url);
    fireEvent.click(within(dialog()).getByRole("button", { name: "Close" }));
    expect(real).toHaveFocus();
    expect(copyPlay).not.toHaveFocus();
  });
});

describe("the event page's photo (§5.3)", () => {
  it("has a hero Play on the photo's bottom-left, in the same box as before", () => {
    const { container } = withProviders(<EventDetailsView event={{ ...event, slug: "neon-static" }} demo />);
    const button = playButton();
    expect(button).toHaveTextContent("Play clip0:12");
    expect(button).toHaveClass("focus-visible:outline-none!");
    expect(button).toHaveClass("absolute", "bottom-3", "left-5", "sm:left-3", "h-11");
    const wrapper = button.parentElement as HTMLElement;
    expect(wrapper).toHaveClass("relative", "-mx-5", "sm:mx-0");
    const art = wrapper.firstElementChild as HTMLElement;
    expect(art).toHaveAttribute("aria-hidden", "true");
    expect(art).toHaveClass("aspect-[4/3]", "max-h-[26svh]", "w-full", "sm:aspect-[3/2]", "sm:rounded-card");
    expect(container.querySelector("video")).toBeNull();
    fireEvent.click(button);
    expect(video()?.getAttribute("src")).toBe(CLIP.url);
  });

  it("an event without a clip keeps the same box and has no Play", () => {
    const { container } = withProviders(<EventDetailsView event={{ ...event, clip: undefined }} demo />);
    expect(screen.queryByRole("button", { name: /^Play clip/ })).toBeNull();
    const art = container.querySelector(".-mx-5 > [aria-hidden='true']");
    expect(art).toHaveClass("aspect-[4/3]", "w-full");
  });
});
