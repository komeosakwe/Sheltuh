// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import CategoryRow from "@/components/home/CategoryRow";
import CommunitySection from "@/components/home/CommunitySection";
import CreatorsCard from "@/components/home/CreatorsCard";
import GuideCard from "@/components/home/GuideCard";
import HomeHero from "@/components/home/HomeHero";
import HomeRail, { HomeRailItem } from "@/components/home/HomeRail";
import SectionHead from "@/components/ui/SectionHead";
import GoingStack from "@/components/ui/GoingStack";
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

  it("has the eyebrow and one plain sentence", () => {
    render(<HomeHero />);
    expect(screen.getByText("Melbourne • What’s on")).toHaveClass("eyebrow");
    expect(
      screen.getByText("Discover Melbourne’s music, art, workshops and pop-ups. See who’s going before you book."),
    ).toBeInTheDocument();
  });

  // Owner feedback (22 Oct 2026): search is the hero's main action; "Explore events" was a full-width
  // orange button and is now a text link under the search, so the first screen reaches the categories.
  it("makes search the main action, with 'Explore all events' a text link under it (no orange button)", () => {
    const { container } = render(<HomeHero />);
    const search = screen.getByRole("search", { name: "Search events" });
    // A3 (WCAG 2.5.3): the field's name is the words it shows, so "Search events" works by voice too.
    expect(within(search).getByRole("searchbox", { name: "Search events" })).toHaveAttribute("placeholder", "Search events");
    const explore = screen.getByRole("link", { name: "Explore all events" });
    expect(explore).toHaveAttribute("href", "/events");
    expect(explore).toHaveClass("underline", "min-h-11");
    expect(explore.className).not.toMatch(/\bbtn/);
    expect(explore.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
    expect(search.compareDocumentPosition(explore) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getAllByRole("link")).toEqual([explore]);
    expect(container.querySelector(".btn-signal")).toBeNull();
    // The old second CTA and the categories have left the hero.
    expect(screen.queryByRole("link", { name: "Find your people" })).toBeNull();
    expect(screen.queryByRole("navigation")).toBeNull();
  });

  it("ends with the demo label, compact (one short line), after the search", () => {
    render(<HomeHero />);
    const search = screen.getByRole("search", { name: "Search events" });
    // Tests run without Supabase settings: demo mode.
    const note = screen.getByRole("note");
    expect(note).toHaveTextContent("Demo — sample events");
    expect(note).toHaveTextContent("Not real bookings.");
    expect(note).toHaveAttribute("data-compact");
    expect(note).toHaveClass("text-xs");
    expect(search.compareDocumentPosition(note) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
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

describe("CategoryRow: Explore by category (§6.3.6)", () => {
  it("is a section with its own head and a list of six tiles, each to /events with that filter", () => {
    render(<CategoryRow />);
    const section = screen.getByRole("region", { name: "Explore by category" });
    expect(within(section).getByRole("heading", { level: 2, name: "Explore by category" })).toBeInTheDocument();
    const links = within(within(section).getByRole("list")).getAllByRole("link");
    expect(links.map((l) => [l.textContent, l.getAttribute("href")])).toEqual([
      ["Live music", "/events?category=live-music"],
      ["Art", "/events?category=art"],
      ["Workshops", "/events?category=workshop"],
      ["Pop-ups", "/events?category=pop-up"],
      ["Theatre", "/events?category=theatre"],
      ["Free", "/events?pricing=free"],
    ]);
    // Icons are decorative; the label names the link. No See all: it's the index.
    for (const svg of section.querySelectorAll("svg")) expect(svg).toHaveAttribute("aria-hidden", "true");
    expect(screen.queryByRole("link", { name: /See all/ })).toBeNull();
  });

  it("is a grid, three across on phones and six from 640px (no sideways rail); bordered 72px tiles", () => {
    render(<CategoryRow />);
    expect(screen.getByRole("list")).toHaveClass("grid", "grid-cols-3", "sm:grid-cols-6");
    expect(screen.getByRole("list").className).not.toMatch(/overflow-x|snap-x/);
    expect(screen.getByRole("link", { name: "Theatre" })).toHaveClass("min-h-18", "rounded-control", "border", "border-foreground");
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

  it("never repeats the h2 in a strap: a black rule, then the h2 (dots first, hidden), and nothing else saying the title", () => {
    const { container } = render(<SectionHead id="w" title="Popular right now" link={{ href: "/events", label: "All events" }} />);
    const root = container.firstElementChild as HTMLElement;
    expect(root).toHaveClass("border-t", "border-foreground");
    const h2 = screen.getByRole("heading", { level: 2, name: "Popular right now" });
    expect(h2).toHaveClass("display-md");
    expect(h2.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
    // The title's words appear once in the head (the old mono strap said them twice).
    expect(root.textContent?.match(/Popular right now/g)).toHaveLength(1);
    expect(root.querySelector(".eyebrow")).toBeNull();
  });

  it("balances a long title's lines, keeps the dots on its first line, and lines the link up on the h2's baseline (V7, V14)", () => {
    const { container } = render(<SectionHead id="w" title="From organisers you follow" link={{ href: "/following", srLabel: "organisers you follow" }} />);
    const root = container.firstElementChild as HTMLElement;
    expect(root).toHaveClass("items-baseline");
    const h2 = screen.getByRole("heading", { level: 2 });
    expect(h2).toHaveClass("items-baseline");
    expect(within(h2).getByText("From organisers you follow")).toHaveClass("text-balance");
    // The dots sit in a one-line-tall box at the top, out of the baseline.
    expect(h2.querySelector("svg")?.parentElement).toHaveClass("h-lh", "items-center", "self-start");
  });

  it("puts the note (real context, e.g. the weekend's dates) after the h2 in reading order", () => {
    render(<SectionHead id="w" title="This weekend" note="Fri 23 – Sun 25 Oct" link={{ href: "/events", label: "All events" }} />);
    const h2 = screen.getByRole("heading", { level: 2, name: "This weekend" });
    const note = screen.getByText("Fri 23 – Sun 25 Oct");
    expect(note).toHaveClass("meta", "text-muted");
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

describe("GoingStack", () => {
  it("sm: shows the count as text and hides the avatars, which carry one initial each", () => {
    const { container } = render(<GoingStack count={12} initials={["MA", "LB", "TC"]} />);
    expect(screen.getByText("12 going")).toBeInTheDocument();
    const avatars = container.querySelector("[aria-hidden='true']");
    expect(avatars?.children).toHaveLength(3);
    expect(avatars?.textContent).toBe("MLT");
    for (const avatar of avatars?.children ?? []) expect(avatar).toHaveClass("rounded-dot");
  });

  it("lg: five avatars and never a number", () => {
    const { container } = render(<GoingStack size="lg" initials={["A", "B", "C", "D", "E"]} />);
    expect(container.firstElementChild).toHaveAttribute("aria-hidden", "true");
    expect(container.firstElementChild?.children).toHaveLength(5);
    expect(container.textContent).not.toMatch(/\d|going/);
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

describe("CommunitySection", () => {
  it("is the page's orange band and a jump target (#find-your-people), sending signed-out visitors to sign up", () => {
    const { container } = render(
      <FakeAuthProvider value={fakeAuthValue({ status: "signed-out" })}>
        <CommunitySection />
      </FakeAuthProvider>,
    );
    const section = container.querySelector("#find-your-people");
    expect(section).toHaveAttribute("tabindex", "-1");
    expect(section).toHaveAttribute("data-surface", "signal");
    // The h2 names the band; "Find your people" is its eyebrow.
    expect(screen.getByRole("region", { name: "See who’s going before you book." })).toBe(section);
    expect(screen.getByText("Find your people")).toHaveClass("eyebrow");
    // What's open before buying, as the API allows it: the count to anyone (from three), the names to
    // members with a free profile, no ticket needed (lib/server/handlers/going.ts).
    expect(
      screen.getByText(
        "Anyone can see how many are going, once there are three or more. Make a free profile and you’ll see who.",
      ),
    ).toBeInTheDocument();
    const cta = screen.getByRole("link", { name: "Join the community" });
    expect(cta).toHaveAttribute("href", "/signup");
    // Never an orange button on the orange band.
    expect(cta).toHaveClass("btn-solid");
    expect(container.querySelector(".btn-signal")).toBeNull();
    // A1: buying needs no account, so the way to events is right beside it, after it in reading order.
    const browse = screen.getByRole("link", { name: "Browse events" });
    expect(browse).toHaveAttribute("href", "/events");
    expect(browse).toHaveClass("min-h-11");
    expect(cta.compareDocumentPosition(browse) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("sends signed-in members to find an event", () => {
    render(
      <FakeAuthProvider value={fakeAuthValue()}>
        <CommunitySection />
      </FakeAuthProvider>,
    );
    expect(screen.getByRole("link", { name: "Find an event" })).toHaveAttribute("href", "/events");
    expect(screen.queryByRole("link", { name: "Join the community" })).not.toBeInTheDocument();
    // One way to events is enough here.
    expect(screen.queryByRole("link", { name: "Browse events" })).not.toBeInTheDocument();
  });

  it("treats loading auth (and the server render) as signed out", () => {
    render(
      <FakeAuthProvider value={fakeAuthValue({ status: "loading" })}>
        <CommunitySection />
      </FakeAuthProvider>,
    );
    expect(screen.getByRole("link", { name: "Join the community" })).toHaveAttribute("href", "/signup");
  });

  // The steps used to start with "Get a ticket", which contradicted the heading: names are visible to
  // members with a profile before they book. Now: see (profile), add yourself (ticket), message (on the list).
  it("explains how it works in three real steps, in the order access opens up (the numbers are for the eye only)", () => {
    render(<CommunitySection />);
    const steps = screen.getByRole("list");
    expect(steps.tagName).toBe("OL");
    expect(within(steps).getAllByRole("listitem").map((li) => li.querySelector("p")?.textContent)).toEqual([
      "Sign up and make a free profile to see who’s going.",
      "Got a ticket? Add yourself to the list, only if you want to.",
      "Once you’re on the list, say hi to others going before the night.",
    ]);
    // Seeing comes before the ticket; the ticket only gates adding yourself.
    expect(screen.queryByText(/^Get a ticket/)).toBeNull();
    for (const n of steps.querySelectorAll("[data-step-number]")) expect(n).toHaveAttribute("aria-hidden", "true");
  });

  it("never shows a community size", () => {
    const { container } = render(<CommunitySection />);
    // The steps' "01"–"03" are ordinal labels, not counts: read everything else.
    const clone = container.cloneNode(true) as HTMLElement;
    for (const n of clone.querySelectorAll("[data-step-number]")) n.remove();
    expect(clone.textContent).not.toMatch(/\d/);
  });
});
