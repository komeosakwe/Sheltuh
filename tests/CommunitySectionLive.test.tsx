// @vitest-environment jsdom
import { act, cleanup, render, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import CommunitySection, { COMMUNITY_BAND_LINE, COMMUNITY_DEMO_NOTE, COMMUNITY_LIVE_NOTE } from "@/components/home/CommunitySection";
import { SCENES_DEMO_NOTE } from "@/components/home/SceneCards";
import { HomeEventsProvider } from "@/components/home/HomeEventsProvider";
import type { TrendingItem } from "@/lib/home-sections";
import type { SheltuhEvent } from "@/lib/types";
import { fakeAuthValue, FakeAuthProvider } from "./test-utils/fakeAuth";

/** Find your people's band in live mode: real counts only, and the faces never presented as attendees. */

vi.mock("@/lib/api/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api/client")>()),
  isApiConfigured: true,
}));
const loadHomeEvents = vi.fn<(now: Date) => Promise<SheltuhEvent[]>>();
const loadHomeTrending = vi.fn<(now: Date) => Promise<TrendingItem[]>>();
let feedComplete = true;
vi.mock("@/lib/home-events", () => ({
  loadHomeFeed: async (now: Date) => ({ events: await loadHomeEvents(now), complete: feedComplete }),
  loadHomeTrending: (now: Date) => loadHomeTrending(now),
  loadHomeFollowing: () => Promise.resolve([]),
}));

function event(id: string, startsAt: string, category: SheltuhEvent["category"] = "art"): SheltuhEvent {
  return {
    id,
    organiserId: "org",
    slug: id,
    title: `Event ${id}`,
    description: "d",
    category,
    suburb: "Fitzroy",
    venueName: "Venue",
    venueAddress: "1 St",
    startsAt,
    endsAt: new Date(Date.parse(startsAt) + 3 * 3600_000).toISOString(),
    organiserName: "Org",
    poster: { pattern: "rings", background: "#000000", primary: "#ffffff", secondary: "#ff4800" },
    ticketTypes: [{ id: `${id}-t`, name: "GA", priceCents: 3000, feePolicy: "buyer-pays", quantityAvailable: 10 }],
  };
}

const T = Array.from({ length: 4 }, (_, i) => event(`t${i}`, `2026-11-2${i}T08:00:00.000Z`));

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-21T01:00:00.000Z"));
  loadHomeEvents.mockReset().mockResolvedValue(T);
  feedComplete = true;
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

async function renderLive() {
  const utils = render(
    <FakeAuthProvider value={fakeAuthValue({ status: "signed-out" })}>
      <HomeEventsProvider>
        <CommunitySection />
      </HomeEventsProvider>
    </FakeAuthProvider>,
  );
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
  return utils;
}

describe("CommunitySection in live mode", () => {
  it("shows a trending event's real going count, with the illustrative faces and a footnote saying it's real", async () => {
    loadHomeTrending.mockReset().mockResolvedValue([
      { event: T[0], signal: { kind: "popular" } },
      { event: T[1], signal: { kind: "going", count: 22 } },
      { event: T[2], signal: { kind: "popular" } },
      { event: T[3], signal: { kind: "popular" } },
    ]);
    const { container } = await renderLive();
    const card = container.querySelector<HTMLElement>("[data-community-band][data-community-example]");
    if (!card) throw new Error("no example");
    expect(card.querySelector("[data-community-count]")).toHaveTextContent(/^22 people going · Event t1$/);
    expect(COMMUNITY_LIVE_NOTE).toBe("Popular right now · Real count");
    expect(card.querySelector("[data-community-note]")).toHaveTextContent(COMMUNITY_LIVE_NOTE);
    expect(card).not.toHaveTextContent(COMMUNITY_DEMO_NOTE);
    expect(card).not.toHaveTextContent(/sample/i);
    const faces = card.querySelector("[data-community-faces]");
    expect(faces).toHaveAttribute("aria-hidden", "true");
    const circles = Array.from(faces?.children ?? []);
    expect(circles).toHaveLength(5);
    for (const circle of circles) {
      expect(circle.textContent).toBe("");
      expect(circle.querySelector("img")).toHaveAttribute("alt", "");
    }
  });

  it("with no real count to show (no going signals), the band still shows, with the faces and no number", async () => {
    loadHomeTrending.mockReset().mockResolvedValue(T.map((e) => ({ event: e, signal: { kind: "popular" } })));
    const { container } = await renderLive();
    const card = container.querySelector<HTMLElement>("[data-community-band]");
    if (!card) throw new Error("no band");
    expect(card).not.toHaveAttribute("data-community-example");
    // Never a real event's title beside the faces without its real count.
    for (const e of T) expect(card).not.toHaveTextContent(e.title);
    expect(within(card).getByText(COMMUNITY_BAND_LINE)).toBeInTheDocument();
    expect(card.querySelector("[data-community-count]")).toBeNull();
    expect(card.querySelector("[data-community-note]")).toBeNull();
    expect(card).not.toHaveTextContent(/Illustrative photos/);
    expect(card.querySelectorAll("[data-community-faces] img")).toHaveLength(5);
    expect(card.textContent).not.toMatch(/\d/);
    // Nor on the scene cards: no going counts without real ones.
    expect(container.querySelector("[data-scene-going]")).toBeNull();
  });

  it("while the events load or when they fail, shows the band without an example (never a number)", async () => {
    loadHomeEvents.mockReset().mockRejectedValue(new Error("down"));
    loadHomeTrending.mockReset().mockRejectedValue(new Error("down"));
    const { container } = await renderLive();
    const card = container.querySelector<HTMLElement>("[data-community-band]");
    expect(card).not.toBeNull();
    expect(card).not.toHaveAttribute("data-community-example");
    expect(container.querySelector("#find-your-people")?.textContent).not.toMatch(/\d/);
    // The scene cards still show, each with its filler photo (never a grey tile), its link and no numbers.
    expect(container.querySelectorAll("[data-community-scene]")).toHaveLength(3);
    expect(container.querySelectorAll("[data-scene-filler] img")).toHaveLength(3);
  });
});

describe("CommunitySection's scene cards in live mode", () => {
  // This week (to Sun 25 Oct): two art events and a live music one; next week, another art one.
  const W = [
    event("w-art-1", "2026-10-22T08:00:00.000Z"),
    event("w-music", "2026-10-23T09:00:00.000Z", "live-music"),
    event("w-art-2", "2026-10-24T08:00:00.000Z"),
    event("n-art", "2026-10-28T08:00:00.000Z"),
  ];

  it("sums only the server's thresholded counts per scene this week, never labelled sample, with whole event counts", async () => {
    loadHomeEvents.mockReset().mockResolvedValue(W);
    loadHomeTrending.mockReset().mockResolvedValue([
      { event: W[0], signal: { kind: "going", count: 12 } },
      { event: W[2], signal: { kind: "going", count: 5 } },
      { event: W[3], signal: { kind: "going", count: 30 } },
      { event: W[1], signal: { kind: "popular" } },
    ]);
    const { container } = await renderLive();
    const art = container.querySelector<HTMLElement>("[data-community-scene='art']");
    const music = container.querySelector<HTMLElement>("[data-community-scene='live-music']");
    const popups = container.querySelector<HTMLElement>("[data-community-scene='pop-up']");
    if (!art || !music) throw new Error("no scene cards");
    expect(art.querySelector("[data-scene-going]")).toHaveTextContent("17 going this week");
    expect(art.querySelector("[data-scene-meta]")).toHaveTextContent("3 events this month");
    // Popular without a count: no number.
    expect(music.querySelector("[data-scene-going]")).toBeNull();
    expect(music.querySelector("[data-scene-meta]")).toHaveTextContent("1 event this month");
    // No pop-up events at all: the card still shows (owner request, Round 2), on its filler photo, saying so.
    if (!popups) throw new Error("no Pop-ups card");
    expect(decodeURIComponent(popups.querySelector("[data-scene-filler] img")?.getAttribute("src") ?? "")).toContain(
      "/events/vintage-market-stall.jpg",
    );
    expect(popups.querySelector("[data-scene-meta]")).toHaveTextContent("No upcoming events");
    expect(within(popups).getByRole("link", { name: "See events: Pop-ups" })).toHaveAttribute("href", "/events?category=pop-up");
    expect(container.querySelectorAll("[data-community-scene]")).toHaveLength(3);
    expect(container.querySelector("[data-community-scenes]")).toHaveClass("lg:grid-cols-3");
    // These leads have no photo of their own: their scenes' fillers too, never a grey tile.
    expect(decodeURIComponent(art.querySelector("[data-scene-filler] img")?.getAttribute("src") ?? "")).toContain("/events/gallery-opening.jpg");
    expect(decodeURIComponent(music.querySelector("[data-scene-filler] img")?.getAttribute("src") ?? "")).toContain("/events/record-shop-dj.jpg");
    expect(container.querySelector("[data-scenes-note]")).toBeNull();
    expect(container).not.toHaveTextContent(SCENES_DEMO_NOTE);
    expect(container.querySelector("#find-your-people")).not.toHaveTextContent(/friends|members|follow/i);
  });

  it("with no scene's events loaded: all three scenes on their filler photos, each saying No upcoming events, and no note", async () => {
    loadHomeEvents.mockReset().mockResolvedValue([event("theatre", "2026-10-22T08:00:00.000Z", "theatre")]);
    loadHomeTrending.mockReset().mockResolvedValue([]);
    const { container } = await renderLive();
    expect(container.querySelector("[data-community-band]")).not.toBeNull();
    const scenes = Array.from(container.querySelectorAll<HTMLElement>("[data-community-scene]"));
    expect(scenes).toHaveLength(3);
    for (const scene of scenes) {
      expect(scene.querySelector("[data-scene-filler]")).toHaveAttribute("aria-hidden", "true");
      expect(scene.querySelector("[data-scene-filler] img")).toHaveAttribute("alt", "");
      expect(scene.querySelector("[data-scene-meta]")).toHaveTextContent("No upcoming events");
    }
    expect(container.querySelector("[data-scenes-note]")).toBeNull();
  });

  it("a scene whose lead event has a photo shows that photo, not its filler", async () => {
    const withPhoto = { ...event("art-photo", "2026-10-22T08:00:00.000Z"), imageUrl: "/api/events/art-photo/image?v=1" };
    loadHomeEvents.mockReset().mockResolvedValue([withPhoto, event("music", "2026-10-23T09:00:00.000Z", "live-music")]);
    loadHomeTrending.mockReset().mockResolvedValue([]);
    const { container } = await renderLive();
    const art = container.querySelector<HTMLElement>("[data-community-scene='art']");
    if (!art) throw new Error("no Art card");
    expect(art.querySelector("[data-scene-filler]")).toBeNull();
    const imgs = art.querySelectorAll("[data-scene-media] img");
    expect(imgs).toHaveLength(1);
    expect(imgs[0]).toHaveAttribute("src", "/api/events/art-photo/image?v=1");
    expect(imgs[0].closest("[aria-hidden='true']")).not.toBeNull();
    // The scene without one keeps its filler.
    expect(container.querySelector("[data-community-scene='live-music'] [data-scene-filler]")).not.toBeNull();
  });

  it("leaves the event counts out when the loaded events may not be all of them", async () => {
    feedComplete = false;
    loadHomeEvents.mockReset().mockResolvedValue(W);
    loadHomeTrending.mockReset().mockResolvedValue([]);
    const { container } = await renderLive();
    expect(container.querySelectorAll("[data-community-scene]")).toHaveLength(3);
    expect(container.querySelector("[data-scene-meta]")).toBeNull();
    expect(container.querySelector("[data-scene-going]")).toBeNull();
  });
});
