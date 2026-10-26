// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FavouritesProvider } from "@/components/favourites/FavouritesProvider";
import SaveButton from "@/components/favourites/SaveButton";
import { HomeRailItem } from "@/components/home/HomeRail";
import HomeRailSection from "@/components/home/HomeRailSection";
import { fakeAuthValue, FakeAuthProvider } from "./test-utils/fakeAuth";

/**
 * The home rails' marquee copies (owner round, 24 Oct 2026) are clickable
 * like the real cards: a copy's Save is the same Save, through the one
 * favourites store keyed by the event, so saving on a copy fills the real
 * card's heart too (and the other way round). Demo mode: saves live in this
 * browser.
 */

vi.mock("next/navigation", () => ({
  usePathname: () => "/",
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

const CARD = 256;
const EVENTS = Array.from({ length: 6 }, (_, i) => ({ id: `evt-${i}`, title: `Night Market ${i}`, slug: `night-market-${i}` }));

beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal(
    "matchMedia",
    vi.fn().mockImplementation((query: string) => ({
      matches: query.includes("no-preference"),
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    })),
  );
  // Cards side by side, so the rail measures one set (1536px) wider than itself and renders copies.
  vi.spyOn(HTMLLIElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLLIElement) {
    const list = this.parentElement;
    const left = (list ? Array.from(list.children).indexOf(this) : 0) * CARD - (list?.scrollLeft ?? 0);
    return { left, right: left + CARD, width: CARD, top: 0, bottom: 300, height: 300, x: left, y: 0 } as DOMRect;
  });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function renderRail() {
  render(
    <FakeAuthProvider value={fakeAuthValue({ configured: false, status: "signed-out", email: undefined, accessToken: undefined })}>
      <FavouritesProvider>
        <HomeRailSection id="home-popular" title="Popular right now" count={EVENTS.length}>
          {EVENTS.map((event) => (
            <HomeRailItem key={event.id}>
              <a href={`/events/${event.slug}`}>{event.title}</a>
              <SaveButton event={event} variant="overlay" />
            </HomeRailItem>
          ))}
        </HomeRailSection>
      </FavouritesProvider>
    </FakeAuthProvider>,
  );
  const rail = screen.getByRole("list", { name: "Popular right now" });
  Object.defineProperty(rail, "clientWidth", { configurable: true, value: 1000 });
  Object.defineProperty(rail, "scrollWidth", { configurable: true, get: () => rail.children.length * CARD + 40 });
  act(() => {
    fireEvent.scroll(rail);
    window.dispatchEvent(new Event("resize"));
  });
  const copies = Array.from(rail.querySelectorAll<HTMLElement>(":scope > li[data-rail-clone]"));
  expect(copies).toHaveLength(EVENTS.length);
  return copies;
}

const realHeart = (i: number) => screen.getByRole("button", { name: `Save Night Market ${i}` });
const copyHeart = (copy: HTMLElement) => {
  const button = copy.querySelector("button");
  if (!button) throw new Error("no Save in the copy");
  return button;
};

describe("home rail copies: clickable like the real cards", () => {
  it("a copy has the real card's link, out of the tab order", () => {
    const copies = renderRail();
    const link = copies[2].querySelector("a");
    expect(link).toHaveAttribute("href", "/events/night-market-2");
    expect(link).toHaveAttribute("tabindex", "-1");
    expect(copyHeart(copies[2])).toHaveAttribute("tabindex", "-1");
    // Only the real hearts are buttons to assistive tech.
    expect(screen.getAllByRole("button", { name: /^Save Night Market/ })).toHaveLength(EVENTS.length);
  });

  it("Save on a copy saves the event: the real card's heart fills too, and unsaving on the real card empties the copy's", async () => {
    const copies = renderRail();
    await waitFor(() => expect(realHeart(3)).not.toHaveAttribute("aria-disabled"));
    expect(realHeart(3)).toHaveAttribute("aria-pressed", "false");

    fireEvent.click(copyHeart(copies[3]));
    await waitFor(() => expect(realHeart(3)).toHaveAttribute("aria-pressed", "true"));
    expect(copyHeart(copies[3])).toHaveAttribute("aria-pressed", "true");
    // Only that event.
    expect(realHeart(2)).toHaveAttribute("aria-pressed", "false");

    fireEvent.click(realHeart(3));
    await waitFor(() => expect(copyHeart(copies[3])).toHaveAttribute("aria-pressed", "false"));
    expect(realHeart(3)).toHaveAttribute("aria-pressed", "false");
  });
});
