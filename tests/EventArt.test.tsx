// @vitest-environment jsdom
import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
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
