// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import CategoryRow, { HOME_CATEGORIES } from "@/components/home/CategoryRow";
import CreatorsCard, { CREATORS_LINE } from "@/components/home/CreatorsCard";
import GuideCard from "@/components/home/GuideCard";
import HomeHero from "@/components/home/HomeHero";
import HomeSectionHead from "@/components/home/HomeSectionHead";
import { HOME_LEDE, HOME_TITLE, HOME_TITLE_LINES } from "@/components/home/home-content";
import SectionHead from "@/components/ui/SectionHead";
import { NO_HOME_FILTERS, type HomeFilters } from "@/lib/home-filters";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

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

describe("HomeHero (the proposal, redesign PR 3)", () => {
  // The proposal's hero headline: FIND YOÜR / NEXT THING. in Bootzy capitals, the brand's Ü shown
  // through BrandU (hidden from screen readers) and the plain sentence read instead.
  it("has one h1, read 'Find your next thing.', shown as FIND YOÜR / NEXT THING. (two lines from 1024px, free to wrap below), in the display face", () => {
    render(<HomeHero />);
    const h1 = screen.getByRole("heading", { level: 1 });
    expect(h1).toHaveAccessibleName("Find your next thing.");
    expect(h1).toHaveClass("display-m", "lg:display-l");
    const shown = h1.querySelector('[aria-hidden="true"]') as HTMLElement;
    expect(Array.from(shown.children).map((line) => line.textContent)).toEqual(["Find yoür", "next thing."]);
    for (const line of shown.children) expect(line).toHaveClass("lg:block");
    expect(h1.querySelector(".sr-only")).toHaveTextContent(/^Find your next thing\.$/);
    expect(h1.innerHTML).not.toMatch(/nowrap/);
    expect(h1.querySelector(".font-dots, [data-dotted-letter]")).toBeNull();
  });

  it("keeps the shown lines, the spoken title and the lede in one place, home-content", () => {
    expect(HOME_TITLE_LINES).toEqual(["Find yoür", "next thing."]);
    expect(HOME_TITLE).toBe("Find your next thing.");
    expect(HOME_LEDE).toBe("Curated creative events. See who’s going.");
  });

  it("has the proposal's one-line lede under the h1, and no eyebrow", () => {
    const { container } = render(<HomeHero />);
    const lede = container.querySelector("[data-home-lede]");
    expect(lede).toHaveTextContent(/^Curated creative events\. See who’s going\.$/);
    expect(lede).toHaveClass("text-muted");
    // The lede follows the h1 in reading order.
    const h1 = screen.getByRole("heading", { level: 1 });
    expect(h1.compareDocumentPosition(lede as Node) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.queryByText("Less scrolling. More going.")).toBeNull();
    expect(Array.from(container.querySelectorAll("p.eyebrow")).filter((el) => !el.closest("[popover]"))).toEqual([]);
  });

  // The rules' Search board (redesign PR 2): the field's magnifier, Where with its pin and chevron, and
  // the orange Search with its own magnifier.
  it("makes search the main action: an orange submit (the hero's one orange button), with the rules' four icons", () => {
    const { container } = render(<HomeHero />);
    const search = screen.getByRole("search", { name: "Search events" });
    expect(within(search).getByRole("searchbox", { name: "Search events" })).toHaveAttribute("placeholder", "Search events");
    const submit = within(search).getByRole("button", { name: "Search" });
    expect(submit).toHaveAttribute("type", "submit");
    expect(within(search).getByRole("button", { name: "Where: Your suburb" })).toBeInTheDocument();
    const bar = search.querySelector("[data-search-bar]");
    expect(Array.from(bar?.querySelectorAll("svg") ?? []).filter((svg) => !svg.closest("[data-location-panel]"))).toHaveLength(4);
    expect(submit.querySelectorAll("svg")).toHaveLength(1);
    expect(Array.from(container.querySelectorAll(".btn-signal"))).toEqual([submit]);
    // The hero has no links of its own (the location popover's Privacy link is in the closed popover).
    expect(screen.queryAllByRole("link").filter((link) => !link.closest("[popover]"))).toEqual([]);
    expect(screen.queryByRole("navigation")).toBeNull();
  });

  it("puts the round badge before the h1 from 1024px, with the h1 and lede beside it and the search after them", () => {
    stubMotion(false);
    const { container } = render(<HomeHero />);
    const badge = container.querySelector("[data-hero-badge]");
    expect(badge).toHaveClass("hidden", "lg:flex", "size-28");
    const h1 = screen.getByRole("heading", { level: 1 });
    expect((badge?.compareDocumentPosition(h1) ?? 0) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    const search = screen.getByRole("search", { name: "Search events" });
    expect(h1.compareDocumentPosition(search) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // One row from 1280px: the text block and the search side by side.
    expect(container.querySelector("section")).toHaveClass("xl:flex", "xl:items-center", "xl:justify-between");
  });

  it("where motion is fine, the badge is the hero's one Pause control; under reduced motion it holds still and isn't one", () => {
    stubMotion(true);
    const { unmount } = render(<HomeHero />);
    expect(screen.getAllByRole("button", { name: "Pause the badge animation" })).toHaveLength(1);
    unmount();
    stubMotion(false);
    render(<HomeHero />);
    expect(screen.queryByRole("button", { name: /badge animation/ })).toBeNull();
  });

  it("carries no demo label of its own, nothing animates in, and there are no photos or sticker graphics", () => {
    const { container } = render(<HomeHero />);
    expect(screen.queryByRole("note")).toBeNull();
    expect(container.querySelector(".rise")).toBeNull();
    expect(container.querySelector("img")).toBeNull();
    expect(container.innerHTML).not.toMatch(/scribble|marquee|float/i);
  });
});

/** CategoryRow with its own filters, as the home holds them. */
function Chips({ onChange }: { onChange?: (next: HomeFilters) => void }) {
  const [filters, setFilters] = useState<HomeFilters>(NO_HOME_FILTERS);
  return (
    <>
      <CategoryRow
        filters={filters}
        controls="home-all-events"
        onChange={(next) => {
          setFilters(next);
          onChange?.(next);
        }}
      />
      <output data-testid="filters">{JSON.stringify(filters)}</output>
    </>
  );
}

describe("CategoryRow: the category chips (the proposal, redesign PR 3)", () => {
  it("is a labelled group of toggle chips: All events (pressed by default), each category, then Free", () => {
    render(<Chips />);
    const group = screen.getByRole("group", { name: "Browse by category" });
    const chips = within(group).getAllByRole("button");
    expect(chips.map((chip) => chip.textContent)).toEqual(["All events", ...HOME_CATEGORIES.map((c) => c.label), "Free"]);
    expect(chips.map((chip) => chip.getAttribute("aria-pressed"))).toEqual(["true", "false", "false", "false", "false", "false", "false"]);
    for (const chip of chips) {
      expect(chip).toHaveAttribute("aria-controls", "home-all-events");
      // FilterChip: 48px, radius 8, the 1.5px stroke.
      expect(chip).toHaveClass("h-12", "rounded-control", "border-control");
      // Each with its decorative icon.
      expect(chip.querySelector("svg[aria-hidden='true']")).not.toBeNull();
    }
    // The pressed chip also gains the two orange dots: never colour alone.
    expect(chips[0].querySelector("[data-selected-dots]")).not.toBeNull();
    // Nothing here navigates: they're the page's own filters.
    expect(within(group).queryAllByRole("link")).toEqual([]);
  });

  it("a category chip sets the category (and unsets All events); pressed again it goes back to all", () => {
    render(<Chips />);
    const art = screen.getByRole("button", { name: "Art" });
    fireEvent.click(art);
    expect(art).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "All events" })).toHaveAttribute("aria-pressed", "false");
    expect(JSON.parse(screen.getByTestId("filters").textContent ?? "")).toEqual({ ...NO_HOME_FILTERS, category: "art" });
    fireEvent.click(screen.getByRole("button", { name: "Live music" }));
    expect(art).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByRole("button", { name: "Live music" })).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByRole("button", { name: "Live music" }));
    expect(screen.getByRole("button", { name: "All events" })).toHaveAttribute("aria-pressed", "true");
  });

  it("Free sets the price filter alongside a category; All events clears both", () => {
    render(<Chips />);
    fireEvent.click(screen.getByRole("button", { name: "Workshops" }));
    fireEvent.click(screen.getByRole("button", { name: "Free" }));
    expect(JSON.parse(screen.getByTestId("filters").textContent ?? "")).toEqual({ category: "workshop", price: "free", date: "all" });
    expect(screen.getByRole("button", { name: "Free" })).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByRole("button", { name: "All events" }));
    expect(JSON.parse(screen.getByTestId("filters").textContent ?? "")).toEqual(NO_HOME_FILTERS);
    expect(screen.getByRole("button", { name: "All events" })).toHaveAttribute("aria-pressed", "true");
  });

  it("is one row that scrolls sideways inside its own container on phones (bleeding to the page edges) and wraps from 640px", () => {
    render(<Chips />);
    const list = screen.getByRole("list");
    expect(list).toHaveClass("flex", "overflow-x-auto", "px-4", "sm:flex-wrap", "sm:overflow-visible", "sm:px-0");
    expect(list.parentElement).toHaveClass("-mx-4", "sm:mx-0");
  });
});

describe("HomeSectionHead", () => {
  it("is a Heading/H2 with the two decorative dots, an optional mono note and a link", () => {
    render(<HomeSectionHead id="w" title="This weekend" note="Fri 13 – Sun 15 Nov" link={{ href: "/map?time=weekend", label: "See all this weekend" }} />);
    const h2 = screen.getByRole("heading", { level: 2, name: "This weekend" });
    expect(h2).toHaveAttribute("id", "w");
    expect(h2).toHaveAttribute("tabindex", "-1");
    expect(h2).toHaveClass("heading-h2");
    expect(h2.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
    const note = screen.getByText("Fri 13 – Sun 15 Nov");
    expect(note).toHaveClass("mono-s", "uppercase", "text-muted");
    expect(h2.compareDocumentPosition(note) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByRole("link", { name: "See all this weekend" })).toHaveAttribute("href", "/map?time=weekend");
  });

  it("has no note or link without them", () => {
    const { container } = render(<HomeSectionHead id="x" title="Scenes by city" />);
    expect(container.querySelector("[data-section-note]")).toBeNull();
    expect(screen.queryByRole("link")).toBeNull();
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


describe("GuideCard and CreatorsCard", () => {
  it("the guide is a white, black-bordered card pointing at the map", () => {
    const { container } = render(<GuideCard />);
    expect(screen.getByRole("region", { name: "After dark" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 3, name: "Australia after dark, mapped" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open the map" })).toHaveAttribute("href", "/map");
    expect(container.querySelector(".bg-card.border-foreground")).not.toBeNull();
  });

  it("Bring your event to life is a black banner with the proposal's line, a decorative 2:1 photo and List your event", () => {
    const { container } = render(<CreatorsCard />);
    expect(screen.getByText("For organisers")).toHaveClass("eyebrow");
    expect(screen.getByRole("region", { name: "Bring your event to life" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 2, name: "Bring your event to life" })).toHaveClass("heading-h2");
    expect(screen.getByText(CREATORS_LINE)).toBeInTheDocument();
    expect(CREATORS_LINE).toBe("Every organiser checked by a person · Only the good stuff");
    const photo = container.querySelector("[aria-hidden='true'] .aspect-\\[2\\/1\\]");
    expect(photo?.querySelector("img")).toHaveAttribute("src", "/events/street-market.jpg");
    const cta = screen.getByRole("link", { name: "List your event" });
    expect(cta).toHaveAttribute("href", "/organisers/apply");
    expect(cta).toHaveClass("btn-outline");
    expect(container.querySelector("[data-surface='ink']")).not.toBeNull();
    expect(container.querySelector(".btn-signal")).toBeNull();
  });
});

describe("functional headings carry no dotted letters (29 Oct 2026)", () => {
  it("SectionHead is a plain h2: no dotted letter, no dotted-face class", () => {
    render(<SectionHead id="w" title="This weekend" />);
    const h2 = screen.getByRole("heading", { level: 2, name: "This weekend" });
    expect(h2.querySelector("[data-dotted-letter], .font-dots")).toBeNull();
    expect(h2.textContent).toBe("This weekend");
  });

  it("HomeSectionHead's h2 text is the title alone", () => {
    render(<HomeSectionHead id="a" title="All events" />);
    expect(screen.getByRole("heading", { level: 2 }).textContent).toBe("All events");
  });
});
