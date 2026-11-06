// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import HomeLogoLink from "@/components/HomeLogoLink";

let pathname = "/";
const push = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({
  usePathname: () => pathname,
  useRouter: () => ({ push }),
}));

const scrollTo = vi.fn();
let reducedMotion = false;

beforeEach(() => {
  window.scrollTo = scrollTo as unknown as typeof window.scrollTo;
  window.matchMedia = ((query: string) => ({
    matches: reducedMotion && query === "(prefers-reduced-motion: reduce)",
    media: query,
  })) as unknown as typeof window.matchMedia;
});

afterEach(() => {
  cleanup();
  pathname = "/";
  reducedMotion = false;
  scrollTo.mockClear();
  push.mockClear();
  window.history.replaceState(null, "", "/");
});

function renderLogo(onActivate?: () => void) {
  render(
    <HomeLogoLink className="logo" onActivate={onActivate}>
      <span>Wordmark</span>
    </HomeLogoLink>,
  );
  return screen.getByRole("link", { name: "Sheltüh home" });
}

describe("HomeLogoLink", () => {
  it("stays a link to the home", () => {
    expect(renderLogo()).toHaveAttribute("href", "/");
  });

  it("on the home, a click scrolls smoothly to the top and does not navigate", () => {
    const link = renderLogo();
    expect(fireEvent.click(link)).toBe(false); // preventDefault was called
    expect(scrollTo).toHaveBeenCalledWith({ top: 0, left: 0, behavior: "smooth" });
    expect(push).not.toHaveBeenCalled();
  });

  it("scrolls instantly under prefers-reduced-motion", () => {
    reducedMotion = true;
    fireEvent.click(renderLogo());
    expect(scrollTo).toHaveBeenCalledWith({ top: 0, left: 0, behavior: "instant" });
  });

  it("runs onActivate (closing the phone menu) on a plain click", () => {
    const onActivate = vi.fn();
    fireEvent.click(renderLogo(onActivate));
    expect(onActivate).toHaveBeenCalledTimes(1);
  });

  it("on the home with a query string, goes to the clean / and scrolls to the top", () => {
    window.history.replaceState(null, "", "/?category=music");
    fireEvent.click(renderLogo());
    expect(push).toHaveBeenCalledWith("/");
    expect(scrollTo).toHaveBeenCalledWith({ top: 0, left: 0, behavior: "smooth" });
  });

  it("on the home with a hash, goes to the clean /", () => {
    window.history.replaceState(null, "", "/#events");
    fireEvent.click(renderLogo());
    expect(push).toHaveBeenCalledWith("/");
  });

  it("from another page, leaves the navigation to the link (no scroll, no preventDefault)", () => {
    pathname = "/events";
    const link = renderLogo();
    // Swallow the navigation jsdom would otherwise report as not implemented.
    link.addEventListener("click", (event) => event.preventDefault(), { once: true });
    fireEvent.click(link);
    expect(scrollTo).not.toHaveBeenCalled();
    expect(push).not.toHaveBeenCalled();
  });

  it.each([
    ["ctrl", { ctrlKey: true }],
    ["meta", { metaKey: true }],
    ["shift", { shiftKey: true }],
    ["alt", { altKey: true }],
    ["middle button", { button: 1 }],
  ])("leaves a %s click to the browser (a new tab or window)", (_name, init) => {
    const onActivate = vi.fn();
    const link = renderLogo(onActivate);
    link.addEventListener("click", (event) => event.preventDefault(), { once: true });
    fireEvent.click(link, init);
    expect(scrollTo).not.toHaveBeenCalled();
    expect(onActivate).not.toHaveBeenCalled();
  });
});
