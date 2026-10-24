// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import CategoryRow from "@/components/home/CategoryRow";
import CreatorsCard from "@/components/home/CreatorsCard";
import GuideCard from "@/components/home/GuideCard";
import HomeHero from "@/components/home/HomeHero";
import { HOME_INTRO, HOME_TITLE, HOME_TITLE_LINES, titleParts, titleText } from "@/components/home/home-content";
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
  it("has one h1, 'Find your next thing.', on two lines that may wrap (never nowrap), in the display face", () => {
    render(<HomeHero />);
    const h1 = screen.getByRole("heading", { level: 1 });
    expect(h1).toHaveAccessibleName("Find your next thing.");
    expect(h1.textContent).toBe("Find your next thing.");
    expect(Array.from(h1.children).map((line) => line.textContent)).toEqual(["Find your", "next thing."]);
    for (const line of h1.children) expect(line).toHaveClass("block");
    expect(h1.innerHTML).not.toMatch(/nowrap/);
    expect(h1).toHaveClass("display-lg", "font-display");
  });

  // Owner (24 Oct 2026): "only two letters with dots". The h1 is plain; YOÜR and THÏNG are drawn by the
  // dotted face on two letters, while the text itself stays plainly spelled.
  it("draws only two letters in the dotted face, the u of 'your' and the i of 'thing', in a plain h1", () => {
    render(<HomeHero />);
    const h1 = screen.getByRole("heading", { level: 1 });
    expect(h1).toHaveClass("display-plain");
    expect(h1).not.toHaveClass("font-dots");
    const dotted = Array.from(h1.querySelectorAll(".font-dots"));
    expect(dotted.map((el) => el.textContent)).toEqual(["u", "i"]);
    for (const el of dotted) {
      expect(el.tagName).toBe("SPAN");
      expect(el).toHaveAttribute("data-dotted-letter");
      expect(el.children).toHaveLength(0);
    }
    const [first, second] = Array.from(h1.children);
    expect(first.contains(dotted[0])).toBe(true);
    expect(second.contains(dotted[1])).toBe(true);
    // Nothing else in the h1 is a dotted run, and no real diacritics are in the text.
    expect(h1.querySelectorAll("[data-dotted-letter]")).toHaveLength(2);
    expect(h1.textContent).not.toMatch(/[À-ɏ]/);
  });

  it("chooses the dotted letters in one place: HOME_TITLE_LINES, read by titleParts", () => {
    expect(HOME_TITLE_LINES).toEqual(["Find yo^ur", "next th^ing."]);
    expect(HOME_TITLE).toBe("Find your next thing.");
    expect(HOME_TITLE_LINES.map(titleText)).toEqual(["Find your", "next thing."]);
    expect(titleParts("Find yo^ur")).toEqual([
      { text: "Find yo", dotted: false },
      { text: "u", dotted: true },
      { text: "r", dotted: false },
    ]);
    // A mark at the start or the end of a line, two in a row, or none at all.
    expect(titleParts("^ab^c")).toEqual([
      { text: "a", dotted: true },
      { text: "b", dotted: false },
      { text: "c", dotted: true },
    ]);
    expect(titleParts("^a^b")).toEqual([
      { text: "a", dotted: true },
      { text: "b", dotted: true },
    ]);
    expect(titleParts("plain")).toEqual([{ text: "plain", dotted: false }]);
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
    expect(text?.querySelector("p.eyebrow")).not.toBeNull();
    // Its badge is a still copy: too small for a 44px Pause/Play target, so never a control.
    expect(thumb?.querySelector("[data-hero-badge]")).toHaveAttribute("aria-hidden", "true");
    expect(screen.queryByRole("button", { name: /badge animation/ })).toBeNull();
  });

  // Refinement (owner, 22 Oct 2026): a shorter hero, so the first event's image and title reach a
  // phone's first screen.
  it("has the eyebrow (the page's one use of the brand dots) and one short sentence", () => {
    const { container } = render(<HomeHero />);
    expect(screen.getByText("What’s on near you")).toHaveClass("eyebrow");
    // Owner (23 Oct 2026, layout polish): these words, muted, at every width (no longer hidden on phones).
    expect(HOME_INTRO).toBe("Music, art and pop-ups. See who’s going.");
    const intro = screen.getByText(HOME_INTRO);
    expect(intro).toHaveClass("text-muted", "mt-2");
    expect(intro.className).not.toMatch(/\bhidden\b/);
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
    const img = container.querySelector("[data-hero-collage] img");
    expect(img).toHaveClass("ken-burns");
    expect(img?.closest(".hidden.lg\\:block")).not.toBeNull();
  });

  it("never fetches a photo where it's hidden (the collage below lg, the tile from lg): lazy, with a high fetch priority where it shows", () => {
    const { container } = render(<HomeHero />);
    const imgs = Array.from(container.querySelectorAll("img"));
    expect(imgs).toHaveLength(2);
    for (const img of imgs) {
      expect(img).toHaveAttribute("loading", "lazy");
      expect(img).toHaveAttribute("fetchpriority", "high");
    }
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
    // A snapping horizontal rail at every width (owner, 23 Oct 2026): never a grid.
    expect(list).toHaveClass("flex", "snap-x", "snap-mandatory", "overflow-x-auto", "overflow-y-hidden");
    expect(list.className).not.toMatch(/\bgrid\b|grid-cols|sm:snap-none|sm:overflow-visible/);
    expect(within(list).getAllByRole("listitem")[0]).toHaveClass("snap-start", "shrink-0");
  });

  // Owner (23 Oct 2026, layout polish): one or two cards left most of a desktop row empty.
  it("a pair (one or two cards) is the same rail below 1024px and a two-column grid in the page column from 1024px", () => {
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
    // Below 1024px: the carousel, untouched.
    expect(list).toHaveClass("flex", "snap-x", "snap-mandatory", "overflow-x-auto", "ps-5", "pe-0", "after:block");
    // From 1024px: two columns between the column's edges, nothing to scroll or snap, no end spacer.
    expect(list).toHaveClass(
      "lg:grid",
      "lg:grid-cols-2",
      "lg:overflow-visible",
      "lg:snap-none",
      "sm:ps-[max(2rem,(100%_-_72rem)/2_+_2rem)]",
      "lg:pe-[max(2rem,(100%_-_72rem)/2_+_2rem)]",
      "lg:after:hidden",
    );
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

describe("section title dots (owner, 24 Oct 2026)", () => {
  it("This weekend dots exactly one letter, and its text and name stay plain", async () => {
    const { titleText, titleParts, WEEKEND_TITLE } = await import("@/components/home/home-content");
    expect(titleText(WEEKEND_TITLE)).toBe("This weekend");
    expect(titleParts(WEEKEND_TITLE).filter((p) => p.dotted).map((p) => p.text)).toEqual(["i"]);
  });
});

describe("SectionHead dottedTitle", () => {
  it("draws only the marked letter in the dotted face; the h2's name stays plain", () => {
    render(<SectionHead id="w" title="This weekend" dottedTitle="Th^is weekend" />);
    const h2 = screen.getByRole("heading", { level: 2, name: "This weekend" });
    const dots = h2.querySelectorAll("[data-dotted-letter]");
    expect([...dots].map((el) => el.textContent)).toEqual(["i"]);
    expect(dots[0]).toHaveClass("font-dots");
    expect(h2.textContent).toBe("This weekend");
  });
});
