// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import CategoryRow from "@/components/home/CategoryRow";
import CreatorsCard from "@/components/home/CreatorsCard";
import GuideCard from "@/components/home/GuideCard";
import HomeHero from "@/components/home/HomeHero";
import { HOME_HERO, HOME_TITLE, HOME_TITLE_LINES } from "@/components/home/home-content";
import HomeRail, { HOME_CONTAINER, HomeRailItem, isPairRail, PAIR_MAX } from "@/components/home/HomeRail";
import SectionHead from "@/components/ui/SectionHead";

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
  // The proposal's hero headline: FIND YOÜR / NEXT THING. in Bootzy capitals, the brand's Ü shown
  // through BrandU (hidden from screen readers) and the plain sentence read instead.
  it("has one h1, read 'Find your next thing.', shown as FIND YOÜR / NEXT THING. on two lines that may wrap, in the display face", () => {
    render(<HomeHero />);
    const h1 = screen.getByRole("heading", { level: 1 });
    expect(h1).toHaveAccessibleName("Find your next thing.");
    // display-m, and 48px from 1024px (the owner's compact hero, 4 Nov 2026), until the hero is redone in PR 3.
    expect(h1).toHaveClass("display-m", "lg:text-5xl");
    const shown = h1.querySelector('[aria-hidden="true"]') as HTMLElement;
    expect(Array.from(shown.children).map((line) => line.textContent)).toEqual(["Find yoür", "next thing."]);
    for (const line of shown.children) expect(line).toHaveClass("block");
    expect(h1.querySelector(".sr-only")).toHaveTextContent(/^Find your next thing\.$/);
    expect(h1.innerHTML).not.toMatch(/nowrap/);
    // No dotted face any more: the Ü is a real letter in the display face.
    expect(h1.querySelector(".font-dots, [data-dotted-letter]")).toBeNull();
  });

  it("keeps the shown lines and the spoken title in one place, home-content", () => {
    expect(HOME_TITLE_LINES).toEqual(["Find yoür", "next thing."]);
    expect(HOME_TITLE).toBe("Find your next thing.");
  });

  // Owner (24 Oct 2026): "little image should be there", in the empty space beside the phone headline.
  it("puts a small decorative tile of the collage's lead photo beside the eyebrow and h1, below 1024px only", () => {
    const { container } = render(<HomeHero />);
    const thumb = container.querySelector("[data-hero-thumb]");
    expect(thumb).toHaveAttribute("aria-hidden", "true");
    expect(thumb).toHaveClass("lg:hidden", "shrink-0", "size-18", "min-[375px]:size-22", "sm:size-28");
    const img = thumb?.querySelector("img");
    expect(img).toHaveAttribute("src", "/events/gallery-opening.jpg");
    expect(img).toHaveAttribute("alt", "");
    // Hidden from 1024px, so lazy (never fetched there), first where it shows; it doesn't push in.
    expect(img).toHaveAttribute("loading", "lazy");
    expect(img).toHaveAttribute("fetchpriority", "high");
    expect(img).not.toHaveClass("ken-burns");
    // In the same row as the eyebrow and the h1, after them, in a column of its own.
    const row = thumb?.parentElement;
    expect(row).toHaveClass("flex", "items-start");
    const text = row?.firstElementChild;
    expect(text).toHaveClass("min-w-0", "flex-1");
    expect(text?.querySelector("h1")).not.toBeNull();
    // Its badge is a still copy: too small for a 44px Pause/Play target, so never a control.
    expect(thumb?.querySelector("[data-hero-badge]")).toHaveAttribute("aria-hidden", "true");
    expect(screen.queryByRole("button", { name: /badge animation/ })).toBeNull();
  });

  // Refinement (owner, 22 Oct 2026): a shorter hero, so the first event's image and title reach a
  // phone's first screen.
  it("has no eyebrow above the headline and no intro sentence under it", () => {
    const { container } = render(<HomeHero />);
    // Owner (31 Oct 2026): the "Less scrolling. More going." eyebrow and its dots are gone.
    expect(screen.queryByText("Less scrolling. More going.")).toBeNull();
    // (The location menu's own section labels, Recent and Suggested, are in its closed popover.)
    expect(Array.from(container.querySelectorAll("p.eyebrow")).filter((el) => !el.closest("[popover]"))).toEqual([]);
    // Owner (28 Oct 2026, less helper text): the "Music, art and pop-ups" line is gone; the h1 is followed by the search.
    expect(screen.queryByText(/Music, art and pop-ups/)).toBeNull();
  });

  // The rules' Search board (redesign PR 2): the field's magnifier, Where with its pin and chevron, and
  // the orange Search with its own magnifier.
  it("makes search the main action: an orange submit (the hero's one orange button), with the rules' four icons", () => {
    const { container } = render(<HomeHero />);
    const search = screen.getByRole("search", { name: "Search events" });
    // A3 (WCAG 2.5.3): the field's name is the words it shows, so "Search events" works by voice too.
    expect(within(search).getByRole("searchbox", { name: "Search events" })).toHaveAttribute("placeholder", "Search events");
    const submit = within(search).getByRole("button", { name: "Search" });
    expect(submit).toHaveAttribute("type", "submit");
    expect(within(search).getByRole("button", { name: "Where: Your suburb" })).toBeInTheDocument();
    // Outside the closed location menu: the field's magnifier, the pin, the chevron and the submit's magnifier.
    expect(Array.from(search.querySelectorAll("svg")).filter((svg) => !svg.closest("[popover]"))).toHaveLength(4);
    expect(submit.querySelectorAll("svg")).toHaveLength(1);
    expect(Array.from(container.querySelectorAll(".btn-signal"))).toEqual([submit]);
    // Browsing is the category row under the hero; the hero itself has no links. (Where the browser
    // has geolocation, the location popover's Privacy link is in the closed popover, display: none.)
    expect(screen.queryAllByRole("link").filter((link) => !link.closest("[popover]"))).toEqual([]);
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
    const img = container.querySelector("[data-hero-collage] img");
    expect(img).toHaveClass("ken-burns");
    expect(img?.closest(".hidden.lg\\:block")).not.toBeNull();
  });

  it("never fetches a photo where it's hidden (the collage below lg, the tile from lg): lazy, with a high fetch priority where it shows", () => {
    const { container } = render(<HomeHero />);
    // Every hero photo is lazy, so a hidden one (display: none) is never fetched.
    const imgs = Array.from(container.querySelectorAll("img"));
    expect(imgs.length).toBeGreaterThanOrEqual(2);
    for (const img of imgs) expect(img).toHaveAttribute("loading", "lazy");
    // The lead photo, once as the phone tile and once in the desktop collage, goes first where it shows.
    const lead = imgs.filter((img) => img.getAttribute("src") === HOME_HERO.imageUrl);
    expect(lead).toHaveLength(2);
    for (const img of lead) expect(img).toHaveAttribute("fetchpriority", "high");
    // The collage's smaller tiles wait their turn.
    for (const img of imgs.filter((img) => !lead.includes(img))) expect(img).not.toHaveAttribute("fetchpriority");
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
    expect(list).toHaveClass("flex", "overflow-x-auto", "px-5", "sm:flex-wrap", "sm:overflow-visible");
    // The row bleeds to the screen edges on phones through its frame, which also carries the scroll cue.
    expect(list.parentElement).toHaveClass("relative", "-mx-5", "sm:mx-0");
    expect(list.className).not.toMatch(/\bgrid\b/);
    for (const item of within(list).getAllByRole("listitem")) expect(item).toHaveClass("shrink-0");
    // Pills (owner's mockup, 8 Nov 2026): All events solid, the categories outlined; links, never pressed or current.
    expect(screen.getByRole("link", { name: "Theatre" })).toHaveClass("h-11", "sm:h-10", "rounded-full", "border-foreground/50");
    expect(screen.getByRole("link", { name: "All events" })).toHaveClass("h-11", "sm:h-10", "rounded-full", "bg-foreground", "text-background");
    expect(list.querySelector("[aria-current], [aria-pressed]")).toBeNull();
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

  it("feature: This weekend's big head, with the link's words underlined in orange beside the arrow", () => {
    render(
      <SectionHead id="w" title="This weekend" note="Fri 13 – Sun 15 Nov" link={{ href: "/events", label: "All events" }} variant="feature" />,
    );
    const h2 = screen.getByRole("heading", { level: 2, name: "This weekend" });
    expect(h2).toHaveClass("text-3xl", "sm:text-4xl", "font-bold");
    expect(h2.nextElementSibling).toHaveTextContent("Fri 13 – Sun 15 Nov");
    const link = screen.getByRole("link", { name: "All events" });
    expect(link).toHaveAttribute("href", "/events");
    expect(link).toHaveClass("min-h-11");
    // The underline is the words' (orange, 3px), not the arrow's; the arrow is decorative.
    const words = within(link).getByText("All events");
    expect(words).toHaveClass("underline", "decoration-signal", "decoration-3");
    expect(link.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
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
    // A snapping horizontal rail at every width (owner, 23 Oct 2026): never a grid.
    expect(list).toHaveClass("flex", "snap-x", "snap-mandatory", "overflow-x-auto", "overflow-y-hidden");
    expect(list.className).not.toMatch(/\bgrid\b|grid-cols|sm:snap-none|sm:overflow-visible/);
    expect(within(list).getAllByRole("listitem")[0]).toHaveClass("snap-start", "shrink-0");
  });

  // Owner (4 Nov 2026): the pair's giant two-up grid is gone; it's the same rail, left-aligned.
  it("a pair (one or two cards) is marked, but is the same rail as any other at every width", () => {
    expect(PAIR_MAX).toBe(2);
    expect([0, 1, 2, 3, 5].map(isPairRail)).toEqual([false, true, true, false, false]);
    render(
      <HomeRail labelledBy="x" pair>
        <HomeRailItem>a</HomeRailItem>
        <HomeRailItem>b</HomeRailItem>
      </HomeRail>,
    );
    const list = screen.getByRole("list");
    expect(list).toHaveAttribute("data-rail-layout", "pair");
    expect(list).toHaveClass("flex", "snap-x", "snap-mandatory", "overflow-x-auto", "ps-5", "pe-0", "after:block");
    expect(list.className).not.toMatch(/\bgrid\b|grid-cols|lg:/);
    cleanup();
    render(
      <HomeRail labelledBy="x">
        <HomeRailItem>a</HomeRailItem>
      </HomeRail>,
    );
    expect(screen.getByRole("list")).toHaveAttribute("data-rail-layout", "rail");
    expect(screen.getByRole("list").className).not.toMatch(/lg:/);
  });

  it("starts its first card on the page column's edge (the gutter on phones), and snaps to the same line", () => {
    render(
      <HomeRail labelledBy="x">
        <HomeRailItem>a</HomeRailItem>
      </HomeRail>,
    );
    const list = screen.getByRole("list");
    expect(list).toHaveClass(
      "ps-5",
      "scroll-px-5",
      "sm:ps-[max(2rem,(100%_-_72rem)/2_+_2rem)]",
      "sm:scroll-ps-[max(2rem,(100%_-_72rem)/2_+_2rem)]",
    );
    // The page column it lines up with: 72rem wide, 1.25rem gutters, 2rem from 640px.
    expect(HOME_CONTAINER).toBe("mx-auto max-w-6xl px-5 sm:px-8");
  });

  it("keeps an end gutter (the gap plus a spacer, and no end padding): 20px on phones, the page column's edge from 640px", () => {
    render(
      <HomeRail labelledBy="x">
        <HomeRailItem>a</HomeRailItem>
      </HomeRail>,
    );
    const list = screen.getByRole("list");
    expect(list).toHaveClass("gap-3", "sm:gap-6", "after:block", "after:w-2", "after:shrink-0", "sm:after:w-[max(0.5rem,100%_-_69.5rem)]");
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
    expect(screen.getByRole("region", { name: "After dark" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 3, name: "Australia after dark, mapped" })).toBeInTheDocument();
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

describe("functional headings carry no dotted letters (29 Oct 2026)", () => {
  it("SectionHead is a plain h2: no dotted letter, no dotted-face class", () => {
    render(<SectionHead id="w" title="This weekend" />);
    const h2 = screen.getByRole("heading", { level: 2, name: "This weekend" });
    expect(h2.querySelector("[data-dotted-letter], .font-dots")).toBeNull();
    expect(h2.textContent).toBe("This weekend");
  });
});
