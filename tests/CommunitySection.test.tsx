// @vitest-environment jsdom
import { act, cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import CommunitySection, { COMMUNITY_DEMO_NOTE, COMMUNITY_TEASER } from "@/components/home/CommunitySection";
import { HomeEventsProvider } from "@/components/home/HomeEventsProvider";
import { COMMUNITY_SAMPLE_FACES } from "@/components/home/home-content";
import { getSampleGoing } from "@/lib/sample-going";
import { sampleEvents } from "@/lib/sample-events";
import { FakeAuthProvider, fakeAuthValue } from "./test-utils/fakeAuth";

/**
 * Find your people, the owner's mockup (23 Oct 2026): the pitch on the left,
 * the "A look inside" card on the right, always, with the owner's illustrative
 * portraits. Demo mode here (no API configured); live mode is
 * tests/CommunitySectionLive.test.tsx.
 */

/** The five portraits: decorative (hidden, empty alt), round, ringed and overlapping, in order. */
function expectIllustrativeFaces(card: HTMLElement) {
  const faces = card.querySelector("[data-community-faces]");
  expect(faces).toHaveAttribute("aria-hidden", "true");
  const circles = Array.from(faces?.children ?? []);
  expect(circles).toHaveLength(5);
  for (const circle of circles) {
    expect(circle).toHaveClass("rounded-full", "border-4", "border-card", "size-14", "sm:size-20", "lg:size-18", "xl:size-20");
    expect(circle.textContent).toBe("");
  }
  expect(circles.slice(1).every((circle) => circle.classList.contains("-ml-4"))).toBe(true);
  const imgs = Array.from(faces?.querySelectorAll("img") ?? []);
  expect(imgs).toHaveLength(5);
  imgs.forEach((img, i) => {
    expect(img).toHaveAttribute("alt", "");
    expect(img).toHaveAttribute("loading", "lazy");
    expect(img).toHaveAttribute("decoding", "async");
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

describe("CommunitySection: the pitch", () => {
  it("is the page's orange band and a jump target, with a two-line h2 and one large black action", () => {
    const { container } = render(
      <FakeAuthProvider value={fakeAuthValue({ status: "signed-out" })}>
        <CommunitySection />
      </FakeAuthProvider>,
    );
    const section = container.querySelector("#find-your-people");
    expect(section).toHaveAttribute("tabindex", "-1");
    expect(section).toHaveAttribute("data-surface", "signal");
    expect(screen.getByRole("region", { name: "See who’s going. Find your people." })).toBe(section);

    expect(screen.queryByText("Better together")).toBeNull();
    // One h2, two lines, sentence case and very large: not the uppercase display-lg.
    const h2 = screen.getByRole("heading", { level: 2 });
    expect(screen.getAllByRole("heading")).toHaveLength(1);
    expect(h2).toHaveAccessibleName("See who’s going. Find your people.");
    expect(Array.from(h2.children).map((line) => line.textContent)).toEqual(["See who’s going.", "Find your people."]);
    for (const line of h2.children) expect(line).toHaveClass("block");
    expect(h2).toHaveClass("font-bold", "tracking-tighter", "lg:text-6xl");
    expect(h2).not.toHaveClass("display-lg");
    expect(h2.className).not.toMatch(/uppercase/);

    expect(screen.queryByText("Discover the crowd before you book.")).toBeNull();
    expect(screen.queryByText("Create a free profile to see who’s going.")).toBeNull();

    // One action, black (never orange on the orange band), sentence case, with an arrow.
    const links = screen.getAllByRole("link");
    expect(links).toHaveLength(1);
    expect(links[0]).toHaveAccessibleName("Create profile now");
    expect(links[0]).toHaveAttribute("href", "/signup");
    expect(links[0]).toHaveClass("btn-solid", "min-h-14", "normal-case");
    expect(links[0].querySelector("svg[aria-hidden='true']")).not.toBeNull();
    expect(container.querySelector(".btn-signal")).toBeNull();
  });

  // Owner (23 Oct 2026, layout polish): compact on phones (about 32px between the blocks, 20–24px card
  // padding); from 640px as before.
  it("is compact on phones: 40px band padding, 32px around the action and the card, 20px card padding", () => {
    const { container } = render(
      <FakeAuthProvider value={fakeAuthValue({ status: "signed-out" })}>
        <CommunitySection />
      </FakeAuthProvider>,
    );
    const inner = container.querySelector("#find-your-people > div");
    expect(inner).toHaveClass("py-10", "sm:py-16", "lg:py-20");
    expect(screen.getByRole("link", { name: "Create profile now" })).toHaveClass("mt-8");
    const card = container.querySelector("[data-community-card]");
    expect(card).toHaveClass("mt-8", "sm:mt-10", "lg:mt-0", "p-5", "sm:p-8");
    expect(container.querySelector("[data-community-faces]")).toHaveClass("mt-4", "sm:mt-6");
    // The footnote stays readable: 14px, #666 on white (5.74:1).
    expect(container.querySelector("[data-community-note]")).toHaveClass("text-sm", "text-foreground/60");
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
    expect(screen.queryByText("Open an event to see who’s going.")).toBeNull();
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

  it("invents nothing: with no events to draw on, the card shows the pitch, the illustrative faces and no number", () => {
    const { container } = render(<CommunitySection />);
    const card = container.querySelector<HTMLElement>("[data-community-card]");
    if (!card) throw new Error("no card");
    expect(card).not.toHaveAttribute("data-community-example");
    expect(within(card).getByText("A look inside")).toHaveClass("eyebrow");
    expect(within(card).getByText(COMMUNITY_TEASER.title)).toHaveClass("font-bold");
    expect(within(card).getByText(COMMUNITY_TEASER.body)).toBeInTheDocument();
    expect(card.querySelector("[data-community-note]")).toHaveTextContent(/^Illustrative photos$/);
    expect(card.querySelector("[data-community-count]")).toBeNull();
    expect(card).not.toHaveTextContent(/people going/);
    // No number anywhere in the band, and no claim that anyone is going.
    expect(container.textContent).not.toMatch(/\d/);
    expectIllustrativeFaces(card);
    // Still two columns from 1024px: the card is always there.
    expect(container.querySelector(".lg\\:grid")).toHaveClass("lg:grid-cols-12");
    expect(card).toHaveClass("bg-card", "rounded-2xl", "lg:col-span-5");
  });

  it("uses the owner's five portraits", () => {
    expect(COMMUNITY_SAMPLE_FACES).toEqual([1, 2, 3, 4, 5].map((n) => `/home/people/person-${n}.webp`));
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
    const card = utils.container.querySelector<HTMLElement>("[data-community-card][data-community-example]");
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
    expect(card).toHaveAttribute("data-community-example");
    const note = card.querySelector("[data-community-note]");
    expect(note?.textContent).toBe(COMMUNITY_DEMO_NOTE);
    // Each part stays on one line, so "Illustrative photos" never splits.
    expect(Array.from(note?.querySelectorAll(".whitespace-nowrap") ?? []).map((part) => part.textContent)).toEqual([
      "Example event",
      "Sample count",
      "Illustrative photos",
    ]);
    expect(COMMUNITY_DEMO_NOTE).toBe("Example event · Sample count · Illustrative photos");
    // White card on the band, 16px corners; its muted lines are readable grey, not the band's black.
    expect(card).toHaveClass("bg-card", "rounded-2xl");
    expect(note).toHaveClass("text-foreground/60");
  });

  it("keeps the illustrative faces beside the sample count, and the footnote says they're illustrative", async () => {
    const { card } = await renderDemo();
    expectIllustrativeFaces(card);
    expect(card.querySelector("[data-community-note]")).toHaveTextContent(/Illustrative photos$/);
    // The no-example pitch isn't shown alongside an example.
    expect(within(card).queryByText(COMMUNITY_TEASER.body)).toBeNull();
  });

  it("lays the pitch and the card side by side from 1024px", async () => {
    const { container, card } = await renderDemo();
    const grid = container.querySelector(".lg\\:grid");
    expect(grid).toHaveClass("lg:grid-cols-12");
    expect(card).toHaveClass("lg:col-span-5");
    expect(grid?.firstElementChild).toHaveClass("lg:col-span-7");
  });
});
