// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import HeroBadge, { HERO_BADGE_TEXT, HERO_BADGE_TURN } from "@/components/home/HeroBadge";
import HeroCollage from "@/components/home/HeroCollage";
import HomeHero from "@/components/home/HomeHero";

/**
 * The desktop hero collage and its turning badge, restored at the owner's
 * request (23 Oct 2026): "keep this as well and the motion in the picture".
 */

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

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("HeroBadge", () => {
  it("reads MELBOURNE · NAARM · CURATED around a dot, in black on orange, round", () => {
    stubMotion(true);
    const { container } = render(<HeroBadge />);
    expect(HERO_BADGE_TEXT.toUpperCase()).toContain("MELBOURNE · NAARM · CURATED");
    expect(container.querySelector("textPath")?.textContent).toBe(HERO_BADGE_TEXT.toUpperCase());
    expect(container.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
    expect(container.querySelector("svg circle")).not.toBeNull();
    expect(container.querySelector("[data-hero-badge]")).toHaveClass("rounded-full", "bg-signal", "text-signal-foreground");
  });

  it("turns slowly (30s a turn, motion-safe only) and is a button that pauses and restarts it (WCAG 2.2.2)", () => {
    stubMotion(true);
    const { container } = render(<HeroBadge />);
    const art = container.querySelector<SVGElement>("[data-hero-badge-art]");
    expect(HERO_BADGE_TURN).toBe("30s");
    expect(art).toHaveClass("motion-safe:animate-spin", "group-hover/badge:[animation-play-state:paused]");
    expect(art?.style.animationDuration).toBe("30s");
    expect(art?.style.animationPlayState).toBe("");

    fireEvent.click(screen.getByRole("button", { name: "Pause the badge animation" }));
    expect(art?.style.animationPlayState).toBe("paused");
    const play = screen.getByRole("button", { name: "Play the badge animation" });
    fireEvent.click(play);
    expect(art?.style.animationPlayState).toBe("");
    expect(screen.getByRole("button", { name: "Pause the badge animation" })).toBe(play);
  });

  it("holds still and isn't a control for people who prefer reduced motion (and on the server render)", () => {
    stubMotion(false);
    const { container } = render(<HeroBadge />);
    expect(screen.queryByRole("button")).toBeNull();
    const badge = container.querySelector("[data-hero-badge]");
    expect(badge).toHaveAttribute("aria-hidden", "true");
    expect(container.querySelector("[data-hero-badge-art]")?.getAttribute("class")).not.toMatch(/animate/);
  });
});

describe("HeroCollage", () => {
  it("has three decorative photos (the lead with its one-off push-in), the asterisk and the badge", () => {
    stubMotion(false);
    const { container } = render(<HeroCollage />);
    const collage = container.querySelector("[data-hero-collage]");
    const art = collage?.querySelector(":scope > [aria-hidden='true']");
    expect(art?.querySelectorAll("img")).toHaveLength(3);
    expect(Array.from(art?.querySelectorAll("img") ?? []).map((img) => img.getAttribute("src"))).toEqual([
      "/events/vintage-market-stall.jpg",
      "/events/record-shop-dj.jpg",
      "/events/gallery-opening.jpg",
    ]);
    expect(art?.querySelectorAll("img.ken-burns")).toHaveLength(1);
    // The gaps between the photos are the page's own background, whatever colour the site is.
    expect(art?.querySelectorAll(".border-background")).toHaveLength(2);
    expect(collage?.querySelector("[data-hero-badge]")).not.toBeNull();
  });

  it("shows in the hero from 1024px only: phones keep a short hero", () => {
    stubMotion(false);
    const { container } = render(<HomeHero />);
    expect(container.querySelector("[data-hero-collage]")).toHaveClass("hidden", "lg:block", "lg:col-span-5");
  });
});
