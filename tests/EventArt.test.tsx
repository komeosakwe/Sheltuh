// @vitest-environment jsdom
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import EventArt from "@/components/EventArt";
import type { EventPoster } from "@/lib/types";

afterEach(cleanup);

const poster: EventPoster = { pattern: "burst", background: "#000", primary: "#f00", secondary: "#fff" };

describe("EventArt", () => {
  it("shows the generated poster art when there is no photo", () => {
    const { container } = render(<EventArt poster={poster} title="Neon Static" />);
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("svg")).not.toBeNull();
  });

  it("shows the photo when there is one, and falls back to the poster art if it fails to load", () => {
    const { container } = render(<EventArt poster={poster} title="Neon Static" imageUrl="/events/x.jpg" />);
    const img = container.querySelector("img");
    expect(img).not.toBeNull();
    expect(img).toHaveAttribute("src", "/events/x.jpg");

    fireEvent.error(img as HTMLImageElement);

    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("svg")).not.toBeNull();
  });

  it("puts a neutral surface, not the poster colour, behind a photo that fills the box (no coloured edge on phones)", () => {
    const { container, rerender } = render(<EventArt poster={poster} title="Neon Static" imageUrl="/events/x.jpg" />);
    expect((container.firstElementChild as HTMLElement).style.backgroundColor).toBe("var(--surface)");
    rerender(<EventArt poster={poster} title="Neon Static" />);
    expect((container.firstElementChild as HTMLElement).style.backgroundColor).not.toBe("var(--surface)");
  });

  it("is decorative: the title is always real text elsewhere, so the art is hidden from assistive tech", () => {
    const { container } = render(<EventArt poster={poster} title="Neon Static" imageUrl="/events/x.jpg" />);
    expect(container.firstElementChild).toHaveAttribute("aria-hidden", "true");
    expect(container.querySelector("img")).toHaveAttribute("alt", "");
  });

  it("emits short, stable numbers for trig-based patterns, so server and browser render identical HTML (no hydration mismatch)", () => {
    for (const pattern of ["burst", "halftone"] as const) {
      const { container } = render(<EventArt poster={{ ...poster, pattern }} title="x" />);
      const numbers = Array.from(container.querySelectorAll("line, circle"))
        .flatMap((el) => ["x1", "y1", "x2", "y2", "cx", "cy", "r"].map((a) => el.getAttribute(a)))
        .filter((v): v is string => v !== null);
      expect(numbers.length).toBeGreaterThan(0);
      for (const value of numbers) expect(value).toMatch(/^-?\d+(\.\d{1,2})?$/);
      cleanup();
    }
  });

  it("loads photos lazily by default, and eagerly at high priority when it's the page's lead image", () => {
    const { container, rerender } = render(<EventArt poster={poster} title="x" imageUrl="/home/hero.jpg" />);
    let img = container.querySelector("img");
    expect(img).toHaveAttribute("loading", "lazy");
    expect(img).not.toHaveAttribute("fetchpriority");
    expect(img).toHaveAttribute("decoding", "async");

    rerender(<EventArt poster={poster} title="x" imageUrl="/home/hero.jpg" priority />);
    img = container.querySelector("img");
    expect(img).toHaveAttribute("loading", "eager");
    expect(img).toHaveAttribute("fetchpriority", "high");
  });

  it("only animates the photo when asked to (hero and feature images)", () => {
    const { container, rerender } = render(<EventArt poster={poster} title="x" imageUrl="/home/hero.jpg" />);
    expect(container.querySelector("img")?.className).not.toMatch(/ken-burns/);
    rerender(<EventArt poster={poster} title="x" imageUrl="/home/hero.jpg" motion />);
    expect(container.querySelector("img")?.className).toMatch(/ken-burns/);
  });

  // docs/design/theme-white-dark.md §4: a poster in the page's own colour gets a 1px inset edge,
  // in the theme where it would otherwise dissolve into the page.
  describe("edges in Light and Dark", () => {
    const edges = (container: HTMLElement) => [...container.querySelectorAll("span.ring-inset")];

    it("gives a black poster a white edge in Dark only", () => {
      const { container } = render(<EventArt poster={{ ...poster, background: "#000000" }} title="x" />);
      const [edge, ...rest] = edges(container);
      expect(rest).toHaveLength(0);
      expect(edge).toHaveClass("ring-1", "ring-foreground", "hidden", "dark:block");
      expect(edge).not.toHaveClass("dark:hidden");
    });

    it.each(["#fffae7", "#ffffff", "#f3f2ee", "#F2ECD6"])("gives a paper-tone poster (%s) its edge in Light only", (background) => {
      const { container } = render(<EventArt poster={{ ...poster, background }} title="x" />);
      const [edge, ...rest] = edges(container);
      expect(rest).toHaveLength(0);
      expect(edge).toHaveClass("ring-1", "ring-foreground", "dark:hidden");
      expect(edge).not.toHaveClass("hidden");
    });

    it("draws no edge on an orange poster, or over a photo", () => {
      const orange = render(<EventArt poster={{ ...poster, background: "#ff4800" }} title="x" />);
      expect(edges(orange.container)).toHaveLength(0);
      orange.unmount();
      const photo = render(<EventArt poster={{ ...poster, background: "#000000" }} title="x" imageUrl="/events/x.jpg" />);
      expect(edges(photo.container)).toHaveLength(0);
    });
  });
});

describe("EventArt photo focus", () => {
  it("centres the crop on the focus point, and leaves a photo without one alone", () => {
    const { container, rerender } = render(<EventArt poster={poster} title="x" imageUrl="/events/x.jpg" />);
    expect((container.querySelector("img") as HTMLImageElement).style.objectPosition).toBe("");
    rerender(<EventArt poster={poster} title="x" imageUrl="/events/x.jpg" imageFocus={{ x: 20, y: 70 }} />);
    expect((container.querySelector("img") as HTMLImageElement).style.objectPosition).toBe("20% 70%");
    rerender(<EventArt poster={poster} title="x" imageUrl="/events/x.jpg" imageFocus={null} />);
    expect((container.querySelector("img") as HTMLImageElement).style.objectPosition).toBe("");
  });

  it("keeps a contained photo whole (no position on it) and moves only its blurred backdrop", () => {
    const { container } = render(<EventArt poster={poster} title="x" imageUrl="/events/tall.jpg" fit="auto" imageFocus={{ x: 10, y: 90 }} />);
    const img = container.querySelector("img") as HTMLImageElement;
    // A portrait poster in a (jsdom: zero-sized, so not-portrait) box is contained.
    Object.defineProperty(img, "naturalWidth", { value: 400 });
    Object.defineProperty(img, "naturalHeight", { value: 800 });
    fireEvent.load(img);
    expect(img.className).toContain("object-contain");
    expect(img.style.objectPosition).toBe("");
    const backdrop = container.querySelector("[data-art-backdrop]") as HTMLElement;
    expect(backdrop.style.backgroundPosition).toBe("10% 90%");
  });
});

// Round 2 review: at the cards' 2:1 and the banner's 5:2, `auto` pillarboxed every ordinary photo.
// `poster` contains only a portrait poster in a box that isn't portrait, and re-decides when the box
// changes shape (the banner is 4:5 below 640px).
describe("EventArt fit=poster", () => {
  type Size = { width: number; height: number };
  let report: ((size: Size) => void) | undefined;

  function stubObserver(initial: Size) {
    class FakeResizeObserver {
      constructor(private readonly callback: ResizeObserverCallback) {}
      observe(target: Element) {
        report = (size) =>
          act(() => {
            this.callback([{ target, contentRect: size } as unknown as ResizeObserverEntry], this as unknown as ResizeObserver);
          });
        report(initial);
      }
      unobserve() {}
      disconnect() {}
    }
    vi.stubGlobal("ResizeObserver", FakeResizeObserver);
  }

  function load(img: HTMLImageElement, width: number, height: number) {
    Object.defineProperty(img, "naturalWidth", { value: width });
    Object.defineProperty(img, "naturalHeight", { value: height });
    fireEvent.load(img);
  }

  afterEach(() => {
    vi.unstubAllGlobals();
    report = undefined;
  });

  it.each<[string, number, number]>([
    ["3:2", 1500, 1000],
    ["4:3", 1200, 900],
    ["16:9", 1600, 900],
    ["square", 1000, 1000],
  ])("covers a %s photo in a 5:2 box (no pillarbox, no backdrop)", (_, width, height) => {
    stubObserver({ width: 1000, height: 400 });
    const { container } = render(<EventArt poster={poster} title="x" imageUrl="/events/photo.jpg" fit="poster" />);
    const img = container.querySelector("img") as HTMLImageElement;
    load(img, width, height);
    expect(img).toHaveClass("object-cover");
    expect(container.querySelector("[data-art-backdrop]")).toBeNull();
  });

  it("shows a portrait poster whole in a landscape box, and crops it when the box turns portrait, and back", () => {
    stubObserver({ width: 1000, height: 400 });
    const { container } = render(<EventArt poster={poster} title="x" imageUrl="/events/tall.jpg" fit="poster" />);
    const img = container.querySelector("img") as HTMLImageElement;
    load(img, 800, 1131);
    expect(img).toHaveClass("object-contain");
    expect(container.querySelector("[data-art-backdrop]")).not.toBeNull();
    report?.({ width: 390, height: 488 });
    expect(img).toHaveClass("object-cover");
    expect(container.querySelector("[data-art-backdrop]")).toBeNull();
    report?.({ width: 700, height: 350 });
    expect(img).toHaveClass("object-contain");
  });

  it("keeps per-breakpoint focal classes on a cropped photo (no inline position to override them)", () => {
    stubObserver({ width: 1000, height: 400 });
    const { container } = render(
      <EventArt poster={poster} title="x" imageUrl="/events/photo.jpg" fit="poster" imgClassName="object-[50%_50%] sm:object-[50%_40%]" />,
    );
    const img = container.querySelector("img") as HTMLImageElement;
    load(img, 1500, 1000);
    expect(img).toHaveClass("object-cover", "object-[50%_50%]", "sm:object-[50%_40%]");
    expect(img.style.objectPosition).toBe("");
  });
});

// Round 2 Part 2: "Show the whole photo in the home banner" (event_images.banner_fit = 'whole').
describe("EventArt fit=contain", () => {
  it("always shows the whole photo, contained before it has even loaded, its blurred backdrop once it has", () => {
    const { container } = render(<EventArt poster={poster} title="x" imageUrl="/events/wide.jpg" fit="contain" />);
    const img = container.querySelector("img") as HTMLImageElement;
    expect(img).toHaveClass("object-contain");
    expect(img).not.toHaveClass("object-cover");
    expect(img.style.objectPosition).toBe("");
    // CodeRabbit (PR #61): the backdrop is a CSS background, which `loading="lazy"` doesn't defer, so it waits for
    // the photo: an off-screen slide's photo isn't fetched early.
    expect(img).toHaveAttribute("loading", "lazy");
    expect(container.querySelector("[data-art-backdrop]")).toBeNull();
    Object.defineProperty(img, "naturalWidth", { value: 1600 });
    Object.defineProperty(img, "naturalHeight", { value: 900 });
    fireEvent.load(img);
    expect(container.querySelector("[data-art-backdrop]")).not.toBeNull();
  });

  it.each<[string, number, number]>([
    ["landscape", 1600, 900],
    ["portrait", 800, 1200],
    ["square", 1000, 1000],
  ])("keeps a %s photo whole once loaded", (_, width, height) => {
    const { container } = render(<EventArt poster={poster} title="x" imageUrl="/events/p.jpg" fit="contain" />);
    const img = container.querySelector("img") as HTMLImageElement;
    Object.defineProperty(img, "naturalWidth", { value: width });
    Object.defineProperty(img, "naturalHeight", { value: height });
    fireEvent.load(img);
    // The photo mounted now (never a node the load replaced), whole and never cropped.
    const shown = container.querySelectorAll("img");
    expect(shown).toHaveLength(1);
    expect(shown[0]).toBe(img);
    expect(shown[0]).toHaveClass("object-contain");
    expect(shown[0]).not.toHaveClass("object-cover");
  });

  it("puts the photo's focus on the backdrop only", () => {
    const { container } = render(
      <EventArt poster={poster} title="x" imageUrl="/events/p.jpg" fit="contain" imageFocus={{ x: 30, y: 60 }} />,
    );
    const img = container.querySelector("img") as HTMLImageElement;
    Object.defineProperty(img, "naturalWidth", { value: 1600 });
    Object.defineProperty(img, "naturalHeight", { value: 900 });
    fireEvent.load(img);
    expect((container.querySelector("img") as HTMLImageElement).style.objectPosition).toBe("");
    expect((container.querySelector("[data-art-backdrop]") as HTMLElement).style.backgroundPosition).toBe("30% 60%");
  });

  it("still falls back to the poster art when the photo fails", () => {
    const { container } = render(<EventArt poster={poster} title="x" imageUrl="/events/p.jpg" fit="contain" />);
    fireEvent.error(container.querySelector("img") as HTMLImageElement);
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("[data-art-backdrop]")).toBeNull();
    expect(container.querySelector("svg")).not.toBeNull();
  });
});
