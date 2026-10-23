// @vitest-environment jsdom
import { act, cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import CommunitySection, { COMMUNITY_DEMO_NOTE } from "@/components/home/CommunitySection";
import { HomeEventsProvider } from "@/components/home/HomeEventsProvider";
import { COMMUNITY_SAMPLE_FACES } from "@/components/home/home-content";
import { initialsFor } from "@/lib/initials";
import { getSampleGoing } from "@/lib/sample-going";
import { sampleEvents } from "@/lib/sample-events";
import { FakeAuthProvider, fakeAuthValue } from "./test-utils/fakeAuth";

/**
 * Find your people, the owner's mockup (23 Oct 2026): the pitch on the left,
 * the "A look inside" card on the right. Demo mode here (no API configured);
 * live mode is tests/CommunitySectionLive.test.tsx.
 */

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

describe("CommunitySection: the pitch", () => {
  it("is the page's orange band and a jump target, with the eyebrow, a two-line h2, two lines of body and one large black action", () => {
    const { container } = render(
      <FakeAuthProvider value={fakeAuthValue({ status: "signed-out" })}>
        <CommunitySection />
      </FakeAuthProvider>,
    );
    const section = container.querySelector("#find-your-people");
    expect(section).toHaveAttribute("tabindex", "-1");
    expect(section).toHaveAttribute("data-surface", "signal");
    expect(screen.getByRole("region", { name: "See who’s going. Find your people." })).toBe(section);

    expect(screen.getByText("Better together")).toHaveClass("eyebrow");
    // One h2, two lines, sentence case and very large: not the uppercase display-lg.
    const h2 = screen.getByRole("heading", { level: 2 });
    expect(screen.getAllByRole("heading")).toHaveLength(1);
    expect(h2).toHaveAccessibleName("See who’s going. Find your people.");
    expect(Array.from(h2.children).map((line) => line.textContent)).toEqual(["See who’s going.", "Find your people."]);
    for (const line of h2.children) expect(line).toHaveClass("block");
    expect(h2).toHaveClass("font-bold", "tracking-tighter", "lg:text-6xl");
    expect(h2).not.toHaveClass("display-lg");
    expect(h2.className).not.toMatch(/uppercase/);

    expect(screen.getByText("Discover the crowd before you book.")).toHaveClass("block");
    expect(screen.getByText("Create a free profile to see who’s going.")).toHaveClass("block");

    // One action, black (never orange on the orange band), sentence case, with an arrow.
    const links = screen.getAllByRole("link");
    expect(links).toHaveLength(1);
    expect(links[0]).toHaveAccessibleName("Create profile now");
    expect(links[0]).toHaveAttribute("href", "/signup");
    expect(links[0]).toHaveClass("btn-solid", "min-h-14", "normal-case");
    expect(links[0].querySelector("svg[aria-hidden='true']")).not.toBeNull();
    expect(container.querySelector(".btn-signal")).toBeNull();
  });

  it("sends signed-in members to find an event, in the same style", () => {
    render(
      <FakeAuthProvider value={fakeAuthValue()}>
        <CommunitySection />
      </FakeAuthProvider>,
    );
    const link = screen.getByRole("link", { name: "Find an event" });
    expect(link).toHaveAttribute("href", "/events");
    expect(link).toHaveClass("btn-solid", "min-h-14");
    expect(screen.getByText("Open an event to see who’s going.")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Create profile now" })).not.toBeInTheDocument();
  });

  it("treats loading auth (and the server render) as signed out", () => {
    render(
      <FakeAuthProvider value={fakeAuthValue({ status: "loading" })}>
        <CommunitySection />
      </FakeAuthProvider>,
    );
    expect(screen.getByRole("link", { name: "Create profile now" })).toHaveAttribute("href", "/signup");
  });

  it("invents nothing: with no events to draw on, no card, no number and no faces, just the pitch", () => {
    const { container } = render(<CommunitySection />);
    expect(container.querySelector("[data-community-example]")).toBeNull();
    expect(container.querySelector("[data-community-faces]")).toBeNull();
    expect(screen.queryByText("A look inside")).toBeNull();
    expect(container.textContent).not.toMatch(/\d/);
    // A single column: no grid waiting for a card.
    expect(container.querySelector(".lg\\:grid")).toBeNull();
  });
});

describe("CommunitySection: the 'A look inside' card (demo)", () => {
  async function renderDemo() {
    const utils = render(
      <HomeEventsProvider>
        <CommunitySection />
      </HomeEventsProvider>,
    );
    await settle();
    const card = utils.container.querySelector<HTMLElement>("[data-community-example]");
    if (!card) throw new Error("no example card");
    return { ...utils, card };
  }

  it("shows a real sample event, its sample count as text, and says both are examples", async () => {
    const { card } = await renderDemo();
    expect(within(card).getByText("A look inside")).toHaveClass("eyebrow");
    const title = card.querySelector("p.font-bold")?.textContent ?? "";
    const event = sampleEvents.find((e) => e.title === title);
    expect(event).toBeDefined();
    const count = getSampleGoing(event?.id ?? "").count;
    // The count reads as one phrase: "22 people going".
    expect(card.querySelector("[data-community-count]")).toHaveTextContent(new RegExp(`^${count} people going$`));
    expect(within(card).getByText(COMMUNITY_DEMO_NOTE)).toBeInTheDocument();
    expect(COMMUNITY_DEMO_NOTE).toBe("Example event · Sample attendees");
    // White card on the band, 16px corners; its muted lines are readable grey, not the band's black.
    expect(card).toHaveClass("bg-card", "rounded-2xl");
    expect(within(card).getByText(COMMUNITY_DEMO_NOTE)).toHaveClass("text-foreground/60");
  });

  it("draws four overlapping circles, hidden from screen readers, with the sample attendees' initials", async () => {
    const { card } = await renderDemo();
    const faces = card.querySelector("[data-community-faces]");
    expect(faces).toHaveAttribute("aria-hidden", "true");
    const circles = Array.from(faces?.children ?? []);
    expect(circles).toHaveLength(4);
    for (const circle of circles) expect(circle).toHaveClass("rounded-full", "border-4", "border-card", "sm:size-20");
    expect(circles.slice(1).every((circle) => circle.classList.contains("-ml-4"))).toBe(true);
    // No photos are licensed into the repo yet, so the demo shows initials.
    expect(COMMUNITY_SAMPLE_FACES).toEqual([]);
    expect(faces?.querySelector("img")).toBeNull();
    const title = card.querySelector("p.font-bold")?.textContent ?? "";
    const event = sampleEvents.find((e) => e.title === title);
    const expected = getSampleGoing(event?.id ?? "")
      .attendees.slice(0, 4)
      .map((a) => initialsFor(a.displayName));
    expect(circles.map((circle) => circle.textContent)).toEqual(expected);
  });

  it("lays the pitch and the card side by side from 1024px", async () => {
    const { container, card } = await renderDemo();
    const grid = container.querySelector(".lg\\:grid");
    expect(grid).toHaveClass("lg:grid-cols-12");
    expect(card).toHaveClass("lg:col-span-5");
    expect(grid?.firstElementChild).toHaveClass("lg:col-span-7");
  });
});
