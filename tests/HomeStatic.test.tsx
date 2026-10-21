// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import CategoryRow from "@/components/home/CategoryRow";
import CommunitySection from "@/components/home/CommunitySection";
import CreatorsCard from "@/components/home/CreatorsCard";
import GoingStack from "@/components/home/GoingStack";
import GuideCard from "@/components/home/GuideCard";
import HomeHero from "@/components/home/HomeHero";
import HomeRail, { HomeRailItem } from "@/components/home/HomeRail";
import SectionHead from "@/components/home/SectionHead";
import { FakeAuthProvider, fakeAuthValue } from "./test-utils/fakeAuth";

afterEach(cleanup);

describe("HomeHero", () => {
  it("has one h1, the brand question, which screen readers hear as 'Where is your Sheltüh?'", () => {
    render(<HomeHero upNext={<p>Up next slot</p>} />);
    const h1 = screen.getByRole("heading", { level: 1 });
    expect(h1).toHaveAccessibleName("Where is your Sheltüh?");
    // The visible "ÜR" is hidden from screen readers; "your" is read instead.
    expect(within(h1).getByText("ÜR")).toHaveAttribute("aria-hidden", "true");
    expect(within(h1).getByText("your")).toHaveClass("sr-only");
    // The display token, compact sizes (owner decision 7): at most 36px on phones, 44px from sm, 56px from lg.
    expect(h1).toHaveClass("font-display", "sm:text-[2.75rem]", "lg:text-[3.5rem]");
    expect(h1.className).toMatch(/text-\[clamp\(2rem,9\.25vw,2\.25rem\)\]/);
  });

  it("explains what Sheltüh does in one plain sentence", () => {
    render(<HomeHero upNext={null} />);
    expect(
      screen.getByText("Live music, art, workshops and pop-ups in Melbourne, curated, with the people going."),
    ).toBeInTheDocument();
  });

  it("has one orange CTA to /events and an outline one to the community section", () => {
    render(<HomeHero upNext={null} />);
    const explore = screen.getByRole("link", { name: "Explore events" });
    expect(explore).toHaveAttribute("href", "/events");
    expect(explore).toHaveClass("btn-signal", "btn-lg");
    const join = screen.getByRole("link", { name: "Join the community" });
    expect(join).toHaveAttribute("href", "#find-your-people");
    expect(join).toHaveClass("btn-outline");
    expect(document.querySelectorAll(".btn-signal")).toHaveLength(1);
  });

  it("holds search, the categories, the demo note and then the Up next slot, in that order", () => {
    render(<HomeHero upNext={<p>Up next slot</p>} />);
    const order = [
      screen.getByRole("search", { name: "Search events" }),
      screen.getByRole("navigation", { name: "Browse by category" }),
      screen.getByRole("note"),
      screen.getByText("Up next slot"),
    ];
    for (let i = 1; i < order.length; i++) {
      expect(order[i - 1].compareDocumentPosition(order[i]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    }
    // Tests run without Supabase settings: demo mode.
    expect(screen.getByRole("note")).toHaveTextContent("Demo — sample events");
  });

  it("never animates the h1 in (it's the LCP element), only the rest of the hero", () => {
    render(<HomeHero upNext={null} />);
    expect(screen.getByRole("heading", { level: 1 }).className).not.toMatch(/\brise\b/);
    expect(screen.getByText("Melbourne · What’s on").className).toMatch(/\brise\b/);
    expect(screen.getByRole("link", { name: "Explore events" }).parentElement?.className).toMatch(/\brise\b/);
  });

  it("keeps the photo cell below lg only, with the one-cycle push-in", () => {
    const { container } = render(<HomeHero upNext={null} />);
    const img = container.querySelector("img");
    expect(img).toHaveClass("ken-burns");
    expect(img?.closest(".lg\\:hidden")).not.toBeNull();
  });

  it("has no sticker graphics", () => {
    const { container } = render(<HomeHero upNext={null} />);
    expect(container.innerHTML).not.toMatch(/scribble|marquee|float|spin/i);
  });
});

describe("CategoryRow", () => {
  it("is a named navigation of six links, each to /events with that filter", () => {
    render(<CategoryRow />);
    const nav = screen.getByRole("navigation", { name: "Browse by category" });
    const links = within(nav).getAllByRole("link");
    expect(links.map((l) => [l.textContent, l.getAttribute("href")])).toEqual([
      ["Live music", "/events?category=live-music"],
      ["Art", "/events?category=art"],
      ["Workshops", "/events?category=workshop"],
      ["Pop-ups", "/events?category=pop-up"],
      ["Theatre", "/events?category=theatre"],
      ["Free", "/events?pricing=free"],
    ]);
    // Icons are decorative; the label names the link. Discs are rounded squares, not circles.
    for (const svg of nav.querySelectorAll("svg")) expect(svg).toHaveAttribute("aria-hidden", "true");
    expect(nav.querySelector(".rounded-full")).toBeNull();
    expect(nav.querySelectorAll(".rounded-dot")).toHaveLength(6);
  });
});

describe("SectionHead", () => {
  it("names its See all link for screen readers", () => {
    render(<SectionHead id="x" title="Free & low-cost" seeAll={{ href: "/events?pricing=free", srLabel: "free events" }} />);
    expect(screen.getByRole("heading", { level: 2, name: "Free & low-cost" })).toHaveAttribute("id", "x");
    expect(screen.getByRole("link", { name: "See all free events" })).toHaveAttribute("href", "/events?pricing=free");
  });

  it("has a ruled strap whose label repeats the h2 for sighted readers only, and a readable note", () => {
    const { container } = render(
      <SectionHead id="w" title="Coming up near you" strap="Coming up" note={{ text: "Fri 23 – Sun 25 Oct" }} />,
    );
    const strap = container.querySelector(".border-t.border-foreground");
    expect(strap).not.toBeNull();
    expect(within(strap as HTMLElement).getByText("Coming up").closest("[aria-hidden='true']")).not.toBeNull();
    expect(screen.getByText("Fri 23 – Sun 25 Oct").closest("[aria-hidden='true']")).toBeNull();
  });

  it("has no link without seeAll", () => {
    render(<SectionHead id="x" title="Only in the city" />);
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });
});

describe("HomeRail", () => {
  it("is a list named by its heading, with no controls of its own (nothing moves by itself)", () => {
    render(
      <>
        <h2 id="rail-title">Coming up</h2>
        <HomeRail labelledBy="rail-title" grid="cards">
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
    // A snapping rail on phones, a grid from 640px.
    expect(list).toHaveClass("snap-x", "sm:grid", "sm:grid-cols-2", "md:grid-cols-3");
  });

  it("compact: 3 columns only from lg", () => {
    render(
      <HomeRail labelledBy="x" grid="compact">
        <HomeRailItem>a</HomeRailItem>
      </HomeRail>,
    );
    expect(screen.getByRole("list")).toHaveClass("sm:grid-cols-2", "lg:grid-cols-3");
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

  it("the creators card is an ink card pointing at the organiser application", () => {
    const { container } = render(<CreatorsCard />);
    expect(screen.getByRole("region", { name: "Bring your event to life" })).toBeInTheDocument();
    const cta = screen.getByRole("link", { name: "List your event" });
    expect(cta).toHaveAttribute("href", "/organisers/apply");
    expect(cta).toHaveClass("btn-outline");
    expect(container.querySelector("[data-surface='ink']")).not.toBeNull();
  });
});

describe("CommunitySection", () => {
  it("is the page's orange band and the hero's jump target, sending signed-out visitors to sign up", () => {
    const { container } = render(
      <FakeAuthProvider value={fakeAuthValue({ status: "signed-out" })}>
        <CommunitySection />
      </FakeAuthProvider>,
    );
    const section = container.querySelector("#find-your-people");
    expect(section).toHaveAttribute("tabindex", "-1");
    expect(section).toHaveAttribute("data-surface", "signal");
    expect(screen.getByRole("region", { name: "Find your people" })).toBe(section);
    const cta = screen.getByRole("link", { name: "Join the community" });
    expect(cta).toHaveAttribute("href", "/signup");
    // Never an orange button on the orange band.
    expect(cta).toHaveClass("btn-solid");
    expect(container.querySelector(".btn-signal")).toBeNull();
  });

  it("sends signed-in members to find an event", () => {
    render(
      <FakeAuthProvider value={fakeAuthValue()}>
        <CommunitySection />
      </FakeAuthProvider>,
    );
    expect(screen.getByRole("link", { name: "Find an event" })).toHaveAttribute("href", "/events");
    expect(screen.queryByRole("link", { name: "Join the community" })).not.toBeInTheDocument();
  });

  it("treats loading auth (and the server render) as signed out", () => {
    render(
      <FakeAuthProvider value={fakeAuthValue({ status: "loading" })}>
        <CommunitySection />
      </FakeAuthProvider>,
    );
    expect(screen.getByRole("link", { name: "Join the community" })).toHaveAttribute("href", "/signup");
  });

  it("never shows a community size", () => {
    const { container } = render(<CommunitySection />);
    expect(container.textContent).not.toMatch(/\d/);
  });
});
