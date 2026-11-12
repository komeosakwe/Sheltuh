// @vitest-environment jsdom
import { act, cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import CommunitySection, { COMMUNITY_BAND_LINE, COMMUNITY_DEMO_NOTE } from "@/components/home/CommunitySection";
import { HomeEventsProvider } from "@/components/home/HomeEventsProvider";
import { COMMUNITY_SAMPLE_FACES } from "@/components/home/home-content";
import { getSampleGoing } from "@/lib/sample-going";
import { sampleEvents } from "@/lib/sample-events";
import { FakeAuthProvider, fakeAuthValue } from "./test-utils/fakeAuth";

/**
 * Find your people (the proposal, redesign PR 3): the head (eyebrow, h2, lede, Explore
 * communities → /community), then the compact orange "See who's going." band with the owner's
 * illustrative portraits and, when the page has one, a real example. Demo mode here (no API
 * configured); live mode is tests/CommunitySectionLive.test.tsx.
 */

/** The five portraits: decorative (hidden, empty alt), round and overlapping, in order. */
function expectIllustrativeFaces(band: HTMLElement) {
  const faces = band.querySelector("[data-community-faces]");
  expect(faces).toHaveAttribute("aria-hidden", "true");
  const circles = Array.from(faces?.children ?? []);
  expect(circles).toHaveLength(5);
  for (const circle of circles) {
    expect(circle).toHaveClass("rounded-full", "border-paper", "size-10", "md:size-12");
    expect(circle.textContent).toBe("");
  }
  expect(circles.slice(1).every((circle) => circle.classList.contains("-ml-3"))).toBe(true);
  const imgs = Array.from(faces?.querySelectorAll("img") ?? []);
  expect(imgs).toHaveLength(5);
  imgs.forEach((img, i) => {
    expect(img).toHaveAttribute("alt", "");
    expect(img).toHaveAttribute("loading", "lazy");
    expect(decodeURIComponent(img.getAttribute("src") ?? "")).toContain(`/home/people/person-${i + 1}.webp`);
  });
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  // Wed 21 Oct 2026, 12:00 AEDT.
  vi.setSystemTime(new Date("2026-10-21T01:00:00.000Z"));
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const settle = () => act(() => new Promise((r) => setTimeout(r, 0)));
const band = (container: HTMLElement) => container.querySelector<HTMLElement>("[data-community-band]") as HTMLElement;

describe("CommunitySection: the head and the band", () => {
  it("is a jump target named 'Find your people.', with the proposal's eyebrow, lede and Explore communities to /community", () => {
    const { container } = render(
      <FakeAuthProvider value={fakeAuthValue({ status: "signed-out" })}>
        <CommunitySection />
      </FakeAuthProvider>,
    );
    const section = container.querySelector("#find-your-people");
    expect(section).toHaveAttribute("tabindex", "-1");
    expect(screen.getByRole("region", { name: "Find your people." })).toBe(section);
    expect(screen.getByText("Community")).toHaveClass("eyebrow", "text-muted");
    const h2 = screen.getByRole("heading", { level: 2 });
    expect(h2.textContent).toBe("Find your people.");
    expect(h2.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
    expect(screen.getByText("The people and creative scenes behind the events.")).toHaveClass("text-muted");
    const explore = screen.getByRole("link", { name: "Explore communities" });
    expect(explore).toHaveAttribute("href", "/community");
    expect(explore).toHaveClass("btn-solid");
    // No Fashion / Art / Music cards with invented counts or Follow buttons.
    expect(container).not.toHaveTextContent(/friends going|Follow|members/i);
  });

  it("the band: orange, 'See who’s going.' with the proposal's first half of its line only, and one black action", () => {
    const { container } = render(
      <FakeAuthProvider value={fakeAuthValue({ status: "signed-out" })}>
        <CommunitySection />
      </FakeAuthProvider>,
    );
    const b = band(container);
    expect(b).toHaveAttribute("data-surface", "signal");
    expect(b).toHaveClass("rounded-card");
    expect(within(b).getByRole("heading", { level: 3, name: "See who’s going." })).toBeInTheDocument();
    expect(COMMUNITY_BAND_LINE).toBe("Ticket holders choose to appear.");
    expect(within(b).getByText(COMMUNITY_BAND_LINE)).toBeInTheDocument();
    // No communities to follow yet (§7): the proposal's second half is cut.
    expect(b).not.toHaveTextContent(/follow a community/i);
    const links = within(b).getAllByRole("link");
    expect(links).toHaveLength(1);
    expect(links[0]).toHaveAccessibleName("Create profile");
    expect(links[0]).toHaveAttribute("href", "/signup");
    expect(links[0]).toHaveClass("btn-solid");
    expect(links[0].querySelector("svg[aria-hidden='true']")).not.toBeNull();
    // Never orange on the orange band.
    expect(container.querySelector(".btn-signal")).toBeNull();
  });

  it("sends signed-in members to find an event, in the same style", () => {
    const { container } = render(
      <FakeAuthProvider value={fakeAuthValue()}>
        <CommunitySection />
      </FakeAuthProvider>,
    );
    const link = within(band(container)).getByRole("link", { name: "Find an event" });
    expect(link).toHaveAttribute("href", "/events");
    expect(link).toHaveClass("btn-solid");
    expect(screen.queryByRole("link", { name: "Create profile" })).not.toBeInTheDocument();
  });

  it("treats loading auth (and the server render) as signed out", () => {
    render(
      <FakeAuthProvider value={fakeAuthValue({ status: "loading" })}>
        <CommunitySection />
      </FakeAuthProvider>,
    );
    expect(screen.getByRole("link", { name: "Create profile" })).toHaveAttribute("href", "/signup");
  });

  it("invents nothing: with no events to draw on, the band shows its line and the illustrative faces, and no number", () => {
    const { container } = render(<CommunitySection />);
    const b = band(container);
    expect(b).not.toHaveAttribute("data-community-example");
    expect(b.querySelector("[data-community-count]")).toBeNull();
    expect(b.querySelector("[data-community-note]")).toBeNull();
    expect(b).not.toHaveTextContent(/Illustrative photos|people going/);
    expect(container.textContent).not.toMatch(/\d/);
    expectIllustrativeFaces(b);
  });

  it("uses the owner's five portraits", () => {
    expect(COMMUNITY_SAMPLE_FACES).toEqual([1, 2, 3, 4, 5].map((n) => `/home/people/person-${n}.webp`));
  });
});

describe("CommunitySection: the band's example (demo)", () => {
  it("shows a real sample event, its sample count as text, and says both are examples", async () => {
    const { container } = render(
      <HomeEventsProvider>
        <CommunitySection />
      </HomeEventsProvider>,
    );
    await settle();
    const b = band(container);
    expect(b).toHaveAttribute("data-community-example");
    const line = b.querySelector("[data-community-count]")?.textContent ?? "";
    const match = /^(\d+) people going · (.+)$/.exec(line);
    expect(match).not.toBeNull();
    const event = sampleEvents.find((e) => e.title === match?.[2]);
    expect(event).toBeDefined();
    expect(Number(match?.[1])).toBe(getSampleGoing(event?.id ?? "").count);
    expect(b.querySelector("[data-community-note]")?.textContent).toBe(COMMUNITY_DEMO_NOTE);
    expect(COMMUNITY_DEMO_NOTE).toBe("Example event · Sample count");
    expectIllustrativeFaces(b);
  });
});
