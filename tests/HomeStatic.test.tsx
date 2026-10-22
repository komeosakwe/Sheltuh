// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import CategoryRow from "@/components/home/CategoryRow";
import CommunitySection, { COMMUNITY_BENEFIT } from "@/components/home/CommunitySection";
import CreatorsCard from "@/components/home/CreatorsCard";
import GuideCard from "@/components/home/GuideCard";
import HomeHero from "@/components/home/HomeHero";
import { HOME_INTRO } from "@/components/home/home-content";
import HomeRail, { HomeRailItem } from "@/components/home/HomeRail";
import SectionHead from "@/components/ui/SectionHead";
import { FakeAuthProvider, fakeAuthValue } from "./test-utils/fakeAuth";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

/**
 * Keyboard focus. jsdom's :focus-visible never matches a link, so it's
 * emulated as a browser does after Tab: the focused element matches.
 */
function tabTo(el: HTMLElement) {
  const matches = Element.prototype.matches;
  vi.spyOn(Element.prototype, "matches").mockImplementation(function (this: Element, selector: string) {
    return selector === ":focus-visible" ? this === document.activeElement : matches.call(this, selector);
  });
  el.focus();
}

describe("HomeHero (mobile-redesign.md §6.1)", () => {
  it("has one h1, 'Find your next thing.', on two lines that may wrap (never nowrap), in the display face", () => {
    render(<HomeHero />);
    const h1 = screen.getByRole("heading", { level: 1 });
    expect(h1).toHaveAccessibleName("Find your next thing.");
    expect(Array.from(h1.children).map((line) => line.textContent)).toEqual(["Find your", "next thing."]);
    for (const line of h1.children) expect(line).toHaveClass("block");
    expect(h1.innerHTML).not.toMatch(/nowrap/);
    expect(h1).toHaveClass("display-lg", "font-display");
  });

  // Refinement (owner, 22 Oct 2026): a shorter hero, so the first event's image and title reach a
  // phone's first screen.
  it("has the eyebrow (the page's one use of the brand dots) and one short sentence", () => {
    const { container } = render(<HomeHero />);
    expect(screen.getByText("Melbourne • What’s on")).toHaveClass("eyebrow");
    expect(screen.getByText(HOME_INTRO)).toBeInTheDocument();
    expect(HOME_INTRO.length).toBeLessThanOrEqual(60);
    expect(container.querySelectorAll("p.eyebrow svg")).toHaveLength(1);
  });

  it("makes search the main action, with one search icon (the submit button) and no orange button or link", () => {
    const { container } = render(<HomeHero />);
    const search = screen.getByRole("search", { name: "Search events" });
    // A3 (WCAG 2.5.3): the field's name is the words it shows, so "Search events" works by voice too.
    expect(within(search).getByRole("searchbox", { name: "Search events" })).toHaveAttribute("placeholder", "Search events");
    expect(within(search).getByRole("button", { name: "Search" })).toHaveAttribute("type", "submit");
    // No second magnifier at the field's start: the submit button's is the only one.
    expect(search.querySelectorAll("svg")).toHaveLength(1);
    expect(container.querySelector(".btn-signal")).toBeNull();
    // Browsing is the category row under the hero; the hero itself has no links.
    expect(screen.queryAllByRole("link")).toEqual([]);
    expect(screen.queryByRole("navigation")).toBeNull();
  });

  it("carries no demo label of its own: the page's one sample-data disclosure is the banner (DemoBanner)", () => {
    render(<HomeHero />);
    expect(screen.queryByRole("note")).toBeNull();
  });

  it("nothing animates in: the hero reads at once", () => {
    const { container } = render(<HomeHero />);
    expect(container.querySelector(".rise")).toBeNull();
  });

  it("shows the photo from lg only, beside the text, with the one-cycle push-in", () => {
    const { container } = render(<HomeHero />);
    const img = container.querySelector("img");
    expect(img).toHaveClass("ken-burns");
    expect(img?.closest(".hidden.lg\\:block")).not.toBeNull();
  });

  it("never fetches the photo where it's hidden (below lg): lazy, with a high fetch priority where it shows", () => {
    const { container } = render(<HomeHero />);
    const img = container.querySelector("img");
    expect(img).toHaveAttribute("loading", "lazy");
    expect(img).toHaveAttribute("fetchpriority", "high");
  });

  it("has no sticker graphics", () => {
    const { container } = render(<HomeHero />);
    expect(container.innerHTML).not.toMatch(/scribble|marquee|float|spin/i);
  });
});

describe("CategoryRow: browse by category (Refinement, 22 Oct 2026)", () => {
  it("is a labelled nav of chips, All events first, then each category, each to /events with that filter", () => {
    render(<CategoryRow />);
    const nav = screen.getByRole("navigation", { name: "Browse by category" });
    const links = within(within(nav).getByRole("list")).getAllByRole("link");
    expect(links.map((l) => [l.textContent, l.getAttribute("href")])).toEqual([
      ["All events", "/events"],
      ["Live music", "/events?category=live-music"],
      ["Art", "/events?category=art"],
      ["Workshops", "/events?category=workshop"],
      ["Pop-ups", "/events?category=pop-up"],
      ["Theatre", "/events?category=theatre"],
      ["Free", "/events?pricing=free"],
    ]);
    // Icons are decorative; the label names the link.
    for (const svg of nav.querySelectorAll("svg")) expect(svg).toHaveAttribute("aria-hidden", "true");
    // No heading: the chips say what they are.
    expect(screen.queryByRole("heading")).toBeNull();
  });

  it("is one compact row that scrolls sideways inside its own container on phones and wraps from 640px; 44px chips", () => {
    render(<CategoryRow />);
    const list = screen.getByRole("list");
    expect(list).toHaveClass("flex", "overflow-x-auto", "-mx-5", "px-5", "sm:flex-wrap", "sm:overflow-visible");
    expect(list.className).not.toMatch(/\bgrid\b/);
    for (const item of within(list).getAllByRole("listitem")) expect(item).toHaveClass("shrink-0");
    expect(screen.getByRole("link", { name: "Theatre" })).toHaveClass("h-11", "sm:h-10", "rounded-control");
  });
});

describe("SectionHead", () => {
  it("names its See all link for screen readers", () => {
    render(<SectionHead id="x" title="Free & low-cost" link={{ href: "/events?pricing=free", srLabel: "free events" }} />);
    expect(screen.getByRole("heading", { level: 2, name: "Free & low-cost" })).toHaveAttribute("id", "x");
    expect(screen.getByRole("link", { name: "See all free events" })).toHaveAttribute("href", "/events?pricing=free");
  });

  it("says where a link goes when it isn't the section's own list (A8: 'All events')", () => {
    render(<SectionHead id="w" title="This weekend" link={{ href: "/events", label: "All events" }} />);
    const link = screen.getByRole("link", { name: "All events" });
    expect(link).toHaveAttribute("href", "/events");
    // The visible words are the whole name (WCAG 2.5.3), with no hidden variant.
    expect(link.querySelector(".sr-only")).toBeNull();
    expect(link).toHaveTextContent(/^All events$/);
  });

  // Refinement (owner, 22 Oct 2026): calmer section heads, no rule and no orange dots.
  it("is a calm sentence-case h2 with no rule, no dots and no strap repeating it", () => {
    const { container } = render(<SectionHead id="w" title="Popular right now" link={{ href: "/events", label: "All events" }} />);
    const root = container.firstElementChild as HTMLElement;
    expect(root.className).not.toMatch(/border-t/);
    const h2 = screen.getByRole("heading", { level: 2, name: "Popular right now" });
    expect(h2).toHaveClass("display-md", "text-balance");
    expect(h2.querySelector("svg")).toBeNull();
    expect(root.textContent?.match(/Popular right now/g)).toHaveLength(1);
    expect(root.querySelector(".eyebrow")).toBeNull();
    // The link sits on the h2's baseline.
    expect(root).toHaveClass("items-baseline");
  });

  it("puts the note (real context, e.g. the weekend's dates) after the h2 in reading order", () => {
    render(<SectionHead id="w" title="This weekend" note="Fri 23 – Sun 25 Oct" link={{ href: "/events", label: "All events" }} />);
    const h2 = screen.getByRole("heading", { level: 2, name: "This weekend" });
    const note = screen.getByText("Fri 23 – Sun 25 Oct");
    expect(note).toHaveClass("text-sm", "text-muted");
    expect(note.closest("[aria-hidden='true']")).toBeNull();
    expect(h2.compareDocumentPosition(note) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // The link after both, with a 44px target.
    const link = screen.getByRole("link", { name: "All events" });
    expect(note.compareDocumentPosition(link) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(link).toHaveClass("min-h-11");
  });

  it("has no link without one", () => {
    render(<SectionHead id="x" title="Only in the city" />);
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });
});

describe("HomeRail", () => {
  it("is a list named by its heading, with no controls of its own (nothing moves by itself)", () => {
    render(
      <>
        <h2 id="rail-title">Coming up</h2>
        <HomeRail labelledBy="rail-title">
          <HomeRailItem>
            <button type="button">A</button>
          </HomeRailItem>
          <HomeRailItem>
            <button type="button">B</button>
          </HomeRailItem>
        </HomeRail>
      </>,
    );
    const list = screen.getByRole("list", { name: "Coming up" });
    expect(within(list).getAllByRole("listitem")).toHaveLength(2);
    expect(screen.getAllByRole("button").map((b) => b.textContent)).toEqual(["A", "B"]);
    // A snapping rail on phones, a grid from 640px: 2, 3, then 4 across from 1024px (V10).
    expect(list).toHaveClass("snap-x", "sm:grid", "sm:grid-cols-2", "md:grid-cols-3", "lg:grid-cols-4");
  });

  it("keeps a 20px end gutter on phones (the gap plus an 8px spacer, and no end padding), and none in the grid", () => {
    render(
      <HomeRail labelledBy="x">
        <HomeRailItem>a</HomeRailItem>
      </HomeRail>,
    );
    const list = screen.getByRole("list");
    expect(list).toHaveClass("gap-3", "after:block", "after:w-2", "after:shrink-0", "sm:after:hidden");
    // V12: Chromium counted the end padding on top of the spacer (40px). With none, it's 20px in every engine.
    expect(list).toHaveClass("ps-5", "pe-0");
    expect(list).not.toHaveClass("px-5");
  });

  it.each([
    ["no preference", false, "smooth"],
    ["reduced motion", true, "auto"],
  ])("brings a keyboard-focused card fully into view (%s)", (_label, reduce, behavior) => {
    const scrollIntoView = vi.fn();
    Element.prototype.scrollIntoView = scrollIntoView;
    vi.stubGlobal("matchMedia", vi.fn().mockReturnValue({ matches: reduce }));
    render(
      <HomeRail labelledBy="x">
        <HomeRailItem>
          <a href="#a">A</a>
          <button type="button">Save A</button>
        </HomeRailItem>
      </HomeRail>,
    );
    // Focus by keyboard on any control in the card scrolls the whole item (the li), not just the control.
    tabTo(screen.getByRole("button", { name: "Save A" }));
    expect(scrollIntoView).toHaveBeenCalledTimes(1);
    expect(scrollIntoView.mock.contexts[0]).toBe(screen.getByRole("listitem"));
    expect(scrollIntoView).toHaveBeenCalledWith({ inline: "nearest", block: "nearest", behavior });
  });

  it("doesn't scroll for a pointer focus (a tap or click mustn't move the card from under it)", () => {
    const scrollIntoView = vi.fn();
    Element.prototype.scrollIntoView = scrollIntoView;
    render(
      <HomeRail labelledBy="x">
        <HomeRailItem>
          <a href="#a">A</a>
        </HomeRailItem>
      </HomeRail>,
    );
    const link = screen.getByRole("link");
    // A focus event whose target isn't :focus-visible (it isn't actually focused here).
    fireEvent.focus(link);
    expect(scrollIntoView).not.toHaveBeenCalled();
  });

});

describe("GuideCard and CreatorsCard", () => {
  it("the guide is a white, black-bordered card pointing at the map", () => {
    const { container } = render(<GuideCard />);
    expect(screen.getByRole("region", { name: "Only in the city" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 3, name: "Melbourne after dark, mapped" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open the map" })).toHaveAttribute("href", "/map");
    expect(container.querySelector(".bg-card.border-foreground")).not.toBeNull();
  });

  it("the For organisers card is an ink card pointing at the organiser application, with a short 2:1 photo on phones", () => {
    const { container } = render(<CreatorsCard />);
    expect(screen.getByText("For organisers")).toHaveClass("eyebrow");
    expect(container.querySelector("[aria-hidden='true'].aspect-\\[2\\/1\\]")).not.toBeNull();
    expect(screen.getByRole("region", { name: "Bring your event to life" })).toBeInTheDocument();
    const cta = screen.getByRole("link", { name: "List your event" });
    expect(cta).toHaveAttribute("href", "/organisers/apply");
    expect(cta).toHaveClass("btn-outline");
    expect(container.querySelector("[data-surface='ink']")).not.toBeNull();
  });
});

describe("CommunitySection (compressed in the Refinement, 22 Oct 2026)", () => {
  it("is the page's orange band and a jump target (#find-your-people): a calm heading, one benefit line, one action", () => {
    const { container } = render(
      <FakeAuthProvider value={fakeAuthValue({ status: "signed-out" })}>
        <CommunitySection />
      </FakeAuthProvider>,
    );
    const section = container.querySelector("#find-your-people");
    expect(section).toHaveAttribute("tabindex", "-1");
    expect(section).toHaveAttribute("data-surface", "signal");
    const h2 = screen.getByRole("heading", { level: 2, name: "See who’s going before you book" });
    expect(screen.getByRole("region", { name: "See who’s going before you book" })).toBe(section);
    // A section heading, not a second display headline.
    expect(h2).toHaveClass("display-md");
    expect(h2).not.toHaveClass("display-lg");
    // What's open before buying, as the API allows it: the count to anyone (from three), the names to
    // members with a free profile (lib/server/handlers/going.ts).
    expect(screen.getByText(COMMUNITY_BENEFIT)).toBeInTheDocument();
    expect(COMMUNITY_BENEFIT).toMatch(/three/);
    expect(COMMUNITY_BENEFIT).toMatch(/free profile/);
    // One action, never orange on the orange band.
    const links = screen.getAllByRole("link");
    expect(links).toHaveLength(1);
    expect(links[0]).toHaveAccessibleName("Sign up free");
    expect(links[0]).toHaveAttribute("href", "/signup");
    expect(links[0]).toHaveClass("btn-solid");
    expect(container.querySelector(".btn-signal")).toBeNull();
    // The step-by-step lives on the event page's Who's Going panel now.
    expect(screen.queryByRole("list")).toBeNull();
  });

  it("sends signed-in members to find an event", () => {
    render(
      <FakeAuthProvider value={fakeAuthValue()}>
        <CommunitySection />
      </FakeAuthProvider>,
    );
    expect(screen.getByRole("link", { name: "Find an event" })).toHaveAttribute("href", "/events");
    expect(screen.queryByRole("link", { name: "Sign up free" })).not.toBeInTheDocument();
  });

  it("treats loading auth (and the server render) as signed out", () => {
    render(
      <FakeAuthProvider value={fakeAuthValue({ status: "loading" })}>
        <CommunitySection />
      </FakeAuthProvider>,
    );
    expect(screen.getByRole("link", { name: "Sign up free" })).toHaveAttribute("href", "/signup");
  });

  it("invents nothing: with no events to draw on, no example and no number at all", () => {
    const { container } = render(<CommunitySection />);
    expect(container.querySelector("[data-community-example]")).toBeNull();
    expect(container.textContent).not.toMatch(/\d/);
  });
});
