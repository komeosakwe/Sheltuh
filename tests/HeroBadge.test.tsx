// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import HeroBadge, { HERO_BADGE_TEXT, HERO_BADGE_TURN } from "@/components/home/HeroBadge";

/**
 * The home hero's turning badge (owner, 23 Oct 2026: "keep this as well and the motion in the
 * picture"), beside the h1 from 1024px since redesign PR 3 (tests/HomeStatic.test.tsx places it).
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

  // For a badge too small to be a 44px Pause/Play target.
  it("`still`: holds still and isn't a control even where motion is fine", () => {
    stubMotion(true);
    const { container } = render(<HeroBadge still />);
    expect(screen.queryByRole("button")).toBeNull();
    expect(container.querySelector("[data-hero-badge]")).toHaveAttribute("aria-hidden", "true");
    expect(container.querySelector("[data-hero-badge-art]")?.getAttribute("class")).not.toMatch(/animate/);
    expect(container.querySelector("textPath")?.textContent).toBe(HERO_BADGE_TEXT.toUpperCase());
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
