// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import CategoryRow from "@/components/home/phone/CategoryRow";
import CommunitySection from "@/components/home/phone/CommunitySection";
import CreatorsCard from "@/components/home/phone/CreatorsCard";
import GoingStack from "@/components/home/phone/GoingStack";
import GuideCard from "@/components/home/phone/GuideCard";
import PhoneHero from "@/components/home/phone/PhoneHero";
import PhoneRail, { PhoneRailItem } from "@/components/home/phone/PhoneRail";
import SectionHead from "@/components/home/phone/SectionHead";
import { Scribble } from "@/components/ui/Sticker";
import { FakeAuthProvider, fakeAuthValue } from "./test-utils/fakeAuth";

afterEach(cleanup);

describe("PhoneHero", () => {
  it("has one h1 that reads as a sentence, and CTAs to /events and the community section", () => {
    render(<PhoneHero />);
    expect(screen.getByRole("heading", { level: 1 })).toHaveAccessibleName("Find your room. Find your people.");
    expect(screen.getByRole("link", { name: "Explore events" })).toHaveAttribute("href", "/events");
    expect(screen.getByRole("link", { name: "Join the community" })).toHaveAttribute("href", "#find-your-people");
  });

  it("doesn't animate the headline (it's the largest paint on the page)", () => {
    render(<PhoneHero />);
    expect(screen.getByRole("heading", { level: 1 }).className).not.toMatch(/\b(rise|reveal)\b/);
  });
});

describe("Scribble", () => {
  it("is static decoration", () => {
    const { container } = render(<Scribble className="text-pop" />);
    const svg = container.querySelector("svg");
    expect(svg).toHaveAttribute("aria-hidden", "true");
    expect(svg?.getAttribute("class") ?? "").not.toMatch(/animate|spin|float/);
    expect(container.querySelector("path")).toHaveAttribute("vector-effect", "non-scaling-stroke");
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
    // Icons are decorative; the label names the link.
    for (const svg of nav.querySelectorAll("svg")) expect(svg).toHaveAttribute("aria-hidden", "true");
  });
});

describe("SectionHead", () => {
  it("names its See all link for screen readers", () => {
    render(<SectionHead id="x" title="Free & low-cost" seeAll={{ href: "/events?pricing=free", srLabel: "free events" }} />);
    expect(screen.getByRole("heading", { level: 2, name: "Free & low-cost" })).toHaveAttribute("id", "x");
    expect(screen.getByRole("link", { name: "See all free events" })).toHaveAttribute("href", "/events?pricing=free");
  });

  it("has no link without seeAll", () => {
    render(<SectionHead id="x" title="Only in the city" />);
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });
});

describe("PhoneRail", () => {
  it("is a list named by its heading, with no controls of its own (no arrows, no pause: nothing moves by itself)", () => {
    render(
      <>
        <h2 id="rail-title">Coming up</h2>
        <PhoneRail labelledBy="rail-title">
          <PhoneRailItem>
            <button type="button">A</button>
          </PhoneRailItem>
          <PhoneRailItem>
            <button type="button">B</button>
          </PhoneRailItem>
        </PhoneRail>
      </>,
    );
    const list = screen.getByRole("list", { name: "Coming up" });
    expect(within(list).getAllByRole("listitem")).toHaveLength(2);
    // The only controls are the two cards passed in.
    expect(screen.getAllByRole("button").map((b) => b.textContent)).toEqual(["A", "B"]);
    expect(list.className).toMatch(/snap-x/);
  });
});

describe("GoingStack", () => {
  it("sm: shows the count as text and hides the discs, which carry one initial each", () => {
    const { container } = render(<GoingStack count={12} initials={["MA", "LB", "TC"]} />);
    expect(screen.getByText("12 going")).toBeInTheDocument();
    const discs = container.querySelector("[aria-hidden='true']");
    expect(discs?.children).toHaveLength(3);
    expect(discs?.textContent).toBe("MLT");
  });

  it("lg: five discs and never a number", () => {
    const { container } = render(<GoingStack size="lg" initials={["A", "B", "C", "D", "E"]} />);
    expect(container.firstElementChild).toHaveAttribute("aria-hidden", "true");
    expect(container.firstElementChild?.children).toHaveLength(5);
    expect(container.textContent).not.toMatch(/\d|going/);
  });
});

describe("GuideCard and CreatorsCard", () => {
  it("the guide points at the map", () => {
    render(<GuideCard />);
    expect(screen.getByRole("region", { name: "Only in the city" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open the map" })).toHaveAttribute("href", "/map");
  });

  it("the creators card points at the organiser application", () => {
    render(<CreatorsCard />);
    expect(screen.getByRole("region", { name: "Bring your event to life" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "List your event" })).toHaveAttribute("href", "/organisers/apply");
  });
});

describe("CommunitySection", () => {
  it("is the hero's jump target and sends signed-out visitors to sign up", () => {
    const { container } = render(
      <FakeAuthProvider value={fakeAuthValue({ status: "signed-out" })}>
        <CommunitySection />
      </FakeAuthProvider>,
    );
    const section = container.querySelector("#find-your-people");
    expect(section).toHaveAttribute("tabindex", "-1");
    expect(screen.getByRole("region", { name: "Find your people" })).toBe(section);
    expect(screen.getByRole("link", { name: "Join the community" })).toHaveAttribute("href", "/signup");
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
